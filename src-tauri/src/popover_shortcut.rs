use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

use crate::desktop_settings::check_settings;

struct PopoverShortcut(Mutex<Shortcut>);

#[derive(serde::Serialize)]
pub struct ShortcutInfo {
    accelerator: String,
    registered: bool,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|path| path.join("popover-shortcut"))
        .map_err(|error| error.to_string())
}

fn parse_shortcut(accelerator: &str) -> Result<Shortcut, String> {
    if accelerator.len() > 64 {
        return Err("Invalid shortcut".into());
    }
    let shortcut = accelerator
        .parse::<Shortcut>()
        .map_err(|error| error.to_string())?;
    if !shortcut
        .mods
        .intersects(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER)
    {
        return Err("A shortcut must include Control, Option, or Command.".into());
    }
    Ok(shortcut)
}

fn save_shortcut(app: &AppHandle, shortcut: Shortcut) -> Result<(), String> {
    let path = config_path(app)?;
    let temporary = path.with_extension(format!("{}.tmp", std::process::id()));
    fs::create_dir_all(path.parent().expect("shortcut has a config directory"))
        .map_err(|error| error.to_string())?;
    let result =
        fs::write(&temporary, shortcut.to_string()).and_then(|()| fs::rename(&temporary, path));
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result.map_err(|error| error.to_string())
}

pub fn initialize(app: &AppHandle) {
    let shortcut = config_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|value| parse_shortcut(value.trim()).ok())
        .unwrap_or_else(|| Shortcut::new(Some(Modifiers::ALT | Modifiers::SUPER), Code::KeyT));
    if let Err(error) = app.global_shortcut().register(shortcut) {
        eprintln!("Could not register Tongkk shortcut: {error}");
    }
    app.manage(PopoverShortcut(Mutex::new(shortcut)));
}

pub fn shortcut_info(app: &AppHandle) -> ShortcutInfo {
    let shortcut = *app
        .state::<PopoverShortcut>()
        .0
        .lock()
        .expect("shortcut state");
    ShortcutInfo {
        accelerator: shortcut.to_string(),
        registered: app.global_shortcut().is_registered(shortcut),
    }
}

#[tauri::command]
pub fn set_popover_shortcut(
    app: AppHandle,
    window: WebviewWindow,
    accelerator: &str,
) -> Result<ShortcutInfo, String> {
    check_settings(&window)?;
    let next = parse_shortcut(accelerator)?;
    let state = app.state::<PopoverShortcut>();
    let mut current = state.0.lock().map_err(|error| error.to_string())?;
    let shortcuts = app.global_shortcut();
    let registered = shortcuts.is_registered(*current);
    if registered && *current == next {
        return Ok(ShortcutInfo {
            accelerator: next.to_string(),
            registered: true,
        });
    }

    shortcuts
        .register(next)
        .map_err(|error| error.to_string())?;
    if let Err(error) = save_shortcut(&app, next) {
        let _ = shortcuts.unregister(next);
        return Err(error);
    }
    if registered && let Err(error) = shortcuts.unregister(*current) {
        let _ = save_shortcut(&app, *current);
        let _ = shortcuts.unregister(next);
        return Err(error.to_string());
    }
    *current = next;
    Ok(ShortcutInfo {
        accelerator: next.to_string(),
        registered: true,
    })
}

#[cfg(test)]
mod tests {
    use super::parse_shortcut;

    #[test]
    fn saved_shortcut_round_trips() {
        let shortcut = parse_shortcut("alt+shift+super+KeyK").unwrap();
        assert_eq!(parse_shortcut(&shortcut.to_string()).unwrap(), shortcut);
    }

    #[test]
    fn rejects_unmodified_or_shift_only_shortcuts() {
        assert!(parse_shortcut("KeyK").is_err());
        assert!(parse_shortcut("shift+KeyK").is_err());
    }
}
