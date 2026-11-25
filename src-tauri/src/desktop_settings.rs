use serde::Serialize;
use tauri::{AppHandle, LogicalSize, Manager, WebviewWindow};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_notification::NotificationExt;

pub const SETTINGS_WIDTH: f64 = 520.0;
pub const SETTINGS_HEIGHT: f64 = 441.0;
pub const LOGIN_START: &str = "--menubar-login-start";

#[derive(Serialize)]
pub struct SettingsInfo {
    autostart: bool,
    version: String,
}

// WKWebView IPC reports the remote origin. Check the current route as well.
fn check_route(window: &WebviewWindow, label: &str, paths: &[&str]) -> Result<(), String> {
    let url = window.url().map_err(|e| e.to_string())?;
    let trusted_origin = if cfg!(debug_assertions) {
        window
            .app_handle()
            .config()
            .build
            .dev_url
            .as_ref()
            .map(|url| url.origin())
    } else {
        tauri::Url::parse("https://tongkk.com")
            .ok()
            .map(|url| url.origin())
    };
    if window.label() == label
        && trusted_origin == Some(url.origin())
        && paths.contains(&url.path())
    {
        Ok(())
    } else {
        Err("Tongkk command is unavailable in this window.".into())
    }
}

fn check_settings(window: &WebviewWindow) -> Result<(), String> {
    check_route(window, "settings", &["/mini/settings"])
}

#[tauri::command]
pub fn settings_info(app: AppHandle, window: WebviewWindow) -> Result<SettingsInfo, String> {
    check_settings(&window)?;
    Ok(SettingsInfo {
        autostart: app.autolaunch().is_enabled().map_err(|e| e.to_string())?,
        version: app.package_info().version.to_string(),
    })
}

#[tauri::command]
pub fn set_settings_autostart(
    app: AppHandle,
    window: WebviewWindow,
    enabled: bool,
) -> Result<bool, String> {
    check_settings(&window)?;
    let launcher = app.autolaunch();
    if enabled {
        launcher.enable()
    } else {
        launcher.disable()
    }
    .map_err(|e| e.to_string())?;
    launcher.is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn close_settings(window: WebviewWindow) -> Result<(), String> {
    check_settings(&window)?;
    window.hide().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn minimize_settings(window: WebviewWindow) -> Result<(), String> {
    check_settings(&window)?;
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn drag_settings(window: WebviewWindow) -> Result<(), String> {
    check_settings(&window)?;
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn resize_settings(window: WebviewWindow, height: u32) -> Result<(), String> {
    check_settings(&window)?;
    let size = LogicalSize::new(SETTINGS_WIDTH, f64::from(height.clamp(240, 600)) + 40.0);
    if window.inner_size().map_err(|e| e.to_string())?
        == size.to_physical::<u32>(window.scale_factor().map_err(|e| e.to_string())?)
    {
        return Ok(());
    }
    window.set_size(size).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn notify_study(app: AppHandle, window: WebviewWindow, kind: &str) -> Result<(), String> {
    check_route(&window, "main", &["/mini", "/mini/tutor"])?;
    let (title, body) = match kind {
        "plans" => ("오늘 할 일", "오늘 할 일이 남아 있어요."),
        "deadlines" => ("시험·과제 하루 전", "내일 예정된 시험이나 과제가 있어요."),
        _ => return Err("Unknown study reminder".into()),
    };
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}
