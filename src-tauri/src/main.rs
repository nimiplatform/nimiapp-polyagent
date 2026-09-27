fn main() {
    tauri::Builder::default()
        .setup(|app| {
            use tauri::Manager;
            app.manage(
                nimi_shell_tauri::capabilities::runtime::RuntimeBridgeLocalAppHost::platform_default(),
            );
            Ok(())
        })
        .invoke_handler(nimi_shell_tauri::nimi_shell_tauri_local_app_standard_shell_handler![])
        .run(tauri::generate_context!())
        .expect("failed to run Nimi App shell");
}
