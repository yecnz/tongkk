mod desktop_settings;
mod popover_shortcut;
mod url_policy;

use desktop_settings::{LOGIN_START, SETTINGS_HEIGHT, SETTINGS_WIDTH};
use tauri::{
    ActivationPolicy, LogicalSize, Manager, PhysicalPosition, Rect, RunEvent, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, WindowEvent,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::NewWindowResponse,
};
use tauri_plugin_global_shortcut::ShortcutState;

// 메뉴바 팝오버(이슈 104). 웹의 /mini 화면을 그대로 띄운다 — 운영은 tongkk.com, 개발은 devUrl.
// 웹을 배포하면 앱 화면도 같이 바뀌므로 앱 업데이트는 창 껍데기가 바뀔 때만 필요하다.
const WIDTH: f64 = 468.0;
const HEIGHT: f64 = 608.0;
const TRAY_ID: &str = "tongkk";

#[tauri::command]
fn resize_popover(window: WebviewWindow, height: Option<u32>) -> Result<(), String> {
    desktop_settings::check_route(
        &window,
        "main",
        &["/mini", "/mini/", "/mini/tutor", "/mini/tutor/"],
    )?;
    let height = height.map_or(HEIGHT, |height| f64::from(height).clamp(120.0, HEIGHT));
    let size = LogicalSize::new(WIDTH, height);
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    if window.inner_size().map_err(|error| error.to_string())? == size.to_physical::<u32>(scale) {
        return Ok(());
    }

    let anchor = window.outer_position().map_err(|error| error.to_string())?;
    window.set_size(size).map_err(|error| error.to_string())?;
    window
        .set_position(anchor)
        .map_err(|error| error.to_string())
}

fn show_settings(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn toggle_popover(app: &tauri::AppHandle, rect: Rect) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            show_under_tray(&window, rect);
        }
    }
}

fn show_under_tray(window: &WebviewWindow, tray: Rect) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let (pos, size) = (
        tray.position.to_physical::<f64>(scale),
        tray.size.to_physical::<f64>(scale),
    );
    let x = pos.x + size.width / 2.0 - WIDTH * scale / 2.0;
    let _ = window.set_position(PhysicalPosition::new(x, pos.y + size.height));
    // 로그인 등으로 /mini 밖으로 나갔다면 다시 /mini로 돌려놓는다. 튜터 대화(/mini/tutor)는 유지.
    if let Ok(url) = window.url() {
        if !url.path().starts_with("/mini") {
            let mut next = url.clone();
            next.set_path("/mini");
            let _ = window.navigate(next);
        }
    }
    let _ = window.show();
    let _ = window.set_focus();
    let _ = window.eval("window.dispatchEvent(new Event('tongkk:mini-open'))");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![LOGIN_START]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state == ShortcutState::Pressed
                        && let Some(rect) = app.tray_by_id(TRAY_ID).and_then(|tray| tray.rect().ok().flatten())
                    {
                        toggle_popover(app, rect);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            desktop_settings::settings_info,
            popover_shortcut::set_popover_shortcut,
            desktop_settings::set_settings_autostart,
            desktop_settings::close_settings,
            desktop_settings::minimize_settings,
            desktop_settings::drag_settings,
            desktop_settings::resize_settings,
            desktop_settings::notify_study,
            resize_popover,
        ])
        .setup(|app| {
            app.set_activation_policy(ActivationPolicy::Regular);
            popover_shortcut::initialize(app.handle());

            let handle = app.handle().clone();
            // 원격 frontendDist를 사용할 때 App 경로가 홈으로 해석되지 않도록 주소를 명시한다.
            let mini_url = if cfg!(debug_assertions) {
                app.config().build.dev_url.as_ref().ok_or("Missing development URL")?.join("/mini")?
            } else {
                "https://tongkk.com/mini".parse()?
            };
            let navigation_origin = mini_url.clone();
            let authentication_origin = mini_url.clone();
            let window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::External(mini_url.clone()))
                    .title("Tongkk")
                    .inner_size(WIDTH, HEIGHT)
                    .resizable(false)
                    .decorations(false)
                    .transparent(true)
                    // 투명 창 자체의 그림자가 팝오버 카드 바깥에 한 겹 더 보이지 않도록 한다.
                    .shadow(false)
                    .always_on_top(true)
                .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
                    .skip_taskbar(true)
                    .visible(false)
                    // WebKit may run the script before the root element exists.
                    .initialization_script(
                        "const markMenubar = () => document.documentElement.classList.add('menubar-app');
                         if (document.documentElement) markMenubar();
                         else document.addEventListener('DOMContentLoaded', markMenubar, { once: true });",
                    )
                    // target="_blank" 링크: 로그인은 이 창 안에서(세션을 앱에 남기려고), 나머지는 기본 브라우저로.
                    .on_navigation(move |url| {
                        if url_policy::is_app_url(url, &navigation_origin) {
                            true
                        } else {
                            url_policy::open_external(url);
                            false
                        }
                    })
                    .on_new_window(move |url, _| {
                        if url_policy::is_auth_url(&url, &authentication_origin) {
                            if let Some(w) = handle.get_webview_window("main") {
                                let _ = w.navigate(url);
                            }
                        } else {
                            url_policy::open_external(&url);
                        }
                        NewWindowResponse::Deny
                    })
                    .build()?;
            let _ = window.set_size(LogicalSize::new(WIDTH, HEIGHT));

            let settings_url = mini_url.join("/mini/settings")?;
            let settings_origin = mini_url.clone();
            WebviewWindowBuilder::new(app, "settings", WebviewUrl::External(settings_url))
                .title("Tongkk 설정")
                .inner_size(SETTINGS_WIDTH, SETTINGS_HEIGHT)
                .center()
                .resizable(false)
                .maximizable(false)
                .decorations(false)
                .transparent(true)
                .shadow(false)
                .visible(false)
                .initialization_script(
                    "const markSettings = () => document.documentElement.classList.add('menubar-app', 'menubar-settings-app');
                     if (document.documentElement) markSettings();
                     else document.addEventListener('DOMContentLoaded', markSettings, { once: true });",
                )
                .on_navigation(move |url| {
                    if url_policy::is_app_url(url, &settings_origin) {
                        true
                    } else {
                        url_policy::open_external(url);
                        false
                    }
                })
                .on_new_window(|url, _| {
                    url_policy::open_external(&url);
                    NewWindowResponse::Deny
                })
                .build()?;

            TrayIconBuilder::with_id(TRAY_ID)
                // 다른 메뉴바 아이콘처럼 단색 템플릿으로 — 메뉴바 밝기에 맞춰 macOS가 색을 바꾼다.
                .icon(tauri::image::Image::from_bytes(include_bytes!(
                    "../icons/tray.png"
                ))?)
                .icon_as_template(true)
                .tooltip("Tongkk")
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        rect,
                        ..
                    } = event
                    {
                        toggle_popover(tray.app_handle(), rect);
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| match (window.label(), event) {
            ("main", WindowEvent::Focused(false)) => { let _ = window.hide(); }
            ("settings", WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("error while building Tongkk menubar app")
        .run(|app, event| match event {
            RunEvent::Ready if !std::env::args().any(|arg| arg == LOGIN_START) => show_settings(app),
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => show_settings(app),
            _ => {}
        });
}
