fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "settings_info",
            "set_popover_shortcut",
            "set_settings_autostart",
            "close_settings",
            "minimize_settings",
            "drag_settings",
            "resize_settings",
            "notify_study",
            "resize_popover",
        ]),
    ))
    .expect("failed to build Tongkk desktop configuration");
}
