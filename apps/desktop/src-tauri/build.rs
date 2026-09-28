fn main() {
    // The app's own commands get permissions (allow-connect, …), so the
    // server's pages can be given only the one they need (lib.rs).
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["startup", "connect", "remember_theme"]),
    ))
    .expect("failed to run tauri-build");
}
