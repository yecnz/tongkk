use tauri::{
    ActivationPolicy, LogicalSize, Manager, PhysicalPosition, Rect, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::NewWindowResponse,
};

// 메뉴바 팝오버(이슈 104). 웹의 /mini 화면을 그대로 띄운다 — 운영은 tongkk.com, 개발은 devUrl.
// 웹을 배포하면 앱 화면도 같이 바뀌므로 앱 업데이트는 창 껍데기가 바뀔 때만 필요하다.
const WIDTH: f64 = 468.0;
const HEIGHT: f64 = 608.0;

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
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Dock 아이콘 없이 메뉴바에만 머문다.
            app.set_activation_policy(ActivationPolicy::Accessory);

            let handle = app.handle().clone();
            // 원격 frontendDist를 사용할 때 App 경로가 홈으로 해석되지 않도록 주소를 명시한다.
            let mini_url = if cfg!(debug_assertions) {
                "http://localhost:5173/mini"
            } else {
                "https://tongkk.com/mini"
            };
            let window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::External(mini_url.parse()?))
                    .title("Tongkk")
                    .inner_size(WIDTH, HEIGHT)
                    .resizable(false)
                    .decorations(false)
                    .transparent(true)
                    // 투명 창 자체의 그림자가 팝오버 카드 바깥에 한 겹 더 보이지 않도록 한다.
                    .shadow(false)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .visible(false)
                    .initialization_script("document.documentElement.classList.add('menubar-app')")
                    // target="_blank" 링크: 로그인은 이 창 안에서(세션을 앱에 남기려고), 나머지는 기본 브라우저로.
                    .on_new_window(move |url, _| {
                        if url.path().starts_with("/auth") {
                            if let Some(w) = handle.get_webview_window("main") {
                                let _ = w.navigate(url);
                            }
                        } else {
                            let _ = std::process::Command::new("open").arg(url.as_str()).spawn();
                        }
                        NewWindowResponse::Deny
                    })
                    .build()?;
            let _ = window.set_size(LogicalSize::new(WIDTH, HEIGHT));

            TrayIconBuilder::new()
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
                        let Some(window) = tray.app_handle().get_webview_window("main") else {
                            return;
                        };
                        if window.is_visible().unwrap_or(false) {
                            let _ = window.hide();
                        } else {
                            show_under_tray(&window, rect);
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        // 팝오버처럼 바깥을 누르면 닫힌다.
        .on_window_event(|window, event| {
            if let WindowEvent::Focused(false) = event {
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Tongkk menubar app");
}
