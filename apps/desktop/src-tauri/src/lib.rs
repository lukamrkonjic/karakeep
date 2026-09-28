//! vrana as a Mac or Windows app: one window around the web app on your own
//! server (apps/web), so everything in it is the web app — nothing to keep in
//! step. What the window adds is what a browser tab can't:
//!
//! - on a Mac, vrana's header is the title bar: the window's buttons sit in
//!   it and its empty parts move the window (the web app pads for them when
//!   `<html data-shell="macos">`, which the script below sets);
//! - on a Mac, closing the window keeps vrana running — the Dock icon brings
//!   it back as it was (⌘Q quits);
//! - links to other sites open in the browser; downloads land in Downloads
//!   and show in Finder / Explorer;
//! - the window opens in the theme vrana was last in (no white flash), and a
//!   page of its own (src/index.html) asks for the server's address, or says
//!   when it can't be reached.

use std::{
    collections::HashMap,
    fs,
    net::{TcpStream, ToSocketAddrs},
    path::PathBuf,
    sync::Mutex,
    time::Duration,
};

use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use tauri::RunEvent;
use tauri::{
    ipc::CapabilityBuilder,
    webview::{DownloadEvent, NewWindowResponse, PageLoadEvent},
    window::Color,
    AppHandle, Manager, Theme, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window,
    WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

const WINDOW: &str = "main";

/// Baked in at build time (`VRANA_SERVER=https://… pnpm app:build`), so a
/// first launch opens straight onto it; otherwise the app's page asks.
const BUILT_IN_SERVER: Option<&str> = option_env!("VRANA_SERVER");

/// How long to wait for the server before saying it can't be reached.
const REACH_TIMEOUT: Duration = Duration::from_secs(4);

/// The theme's backgrounds (apps/web/lib/themeColors.ts).
const DARK: Color = Color(0x19, 0x17, 0x15, 0xff);
const LIGHT: Color = Color(0xfb, 0xfa, 0xf7, 0xff);

/// In every page: tells the web app it's in the Mac app (it makes room for
/// the window's buttons), and tells the app vrana's theme as it changes
/// (next-themes' class on <html>), for the window's own colours.
const PAGE_SCRIPT: &str = r#"
(() => {
  if (__VRANA_MAC__) document.documentElement.dataset.shell = "macos";
  const ipc = window.__TAURI_INTERNALS__;
  if (!ipc) return;
  let last = null;
  const report = () => {
    const c = document.documentElement.classList;
    const theme = c.contains("dark") ? "dark" : c.contains("light") ? "light" : null;
    if (theme && theme !== last) {
      last = theme;
      ipc.invoke("remember_theme", { theme }).catch(() => {});
    }
  };
  new MutationObserver(report).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  addEventListener("DOMContentLoaded", report);
})();
"#;

#[derive(Default, Serialize, Deserialize)]
struct Settings {
    /// The server's address, e.g. https://nas.tailnet.ts.net/.
    server: Option<String>,
    /// "dark" or "light": vrana's theme when it last ran.
    theme: Option<String>,
}

#[derive(Default)]
struct AppState {
    settings: Mutex<Settings>,
    /// The app's own page (src/index.html), where "Change Server…" goes.
    home: Mutex<Option<Url>>,
    /// Where each download went (macOS doesn't say when it's done).
    downloads: Mutex<HashMap<String, PathBuf>>,
    /// The servers whose pages were given their permissions.
    granted: Mutex<Vec<String>>,
}

fn settings_file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("settings.json"))
}

fn load_settings(app: &AppHandle) -> Settings {
    settings_file(app)
        .and_then(|file| fs::read_to_string(file).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save_settings(app: &AppHandle, settings: &Settings) {
    if let Some(file) = settings_file(app) {
        if let Some(dir) = file.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(text) = serde_json::to_string_pretty(settings) {
            let _ = fs::write(file, text);
        }
    }
}

/// "nas.tailnet.ts.net" or "http://localhost:3000/dashboard" → the server's
/// root: https:// unless said otherwise, no path.
fn server_url(address: &str) -> Result<Url, String> {
    let address = address.trim();
    if address.is_empty() {
        return Err("Enter the address of your vrana server.".into());
    }
    let with_scheme = if address.contains("://") {
        address.to_string()
    } else {
        format!("https://{address}")
    };
    let mut url = Url::parse(&with_scheme).map_err(|_| format!("“{address}” isn't an address."))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(format!("“{address}” isn't a web address."));
    }
    url.set_path("/");
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

fn same_server(url: &Url, server: &Url) -> bool {
    url.scheme() == server.scheme()
        && url.host_str() == server.host_str()
        && url.port_or_known_default() == server.port_or_known_default()
}

fn current_server(app: &AppHandle) -> Option<Url> {
    let settings = app.state::<AppState>();
    let settings = settings.settings.lock().unwrap();
    settings.server.as_deref().and_then(|s| server_url(s).ok())
}

/// Can the server be reached at all (Tailscale on, the NAS up)? A connection
/// to its port is enough, and fails fast when its name doesn't resolve.
fn reachable(url: &Url) -> bool {
    let (Some(host), Some(port)) = (url.host_str(), url.port_or_known_default()) else {
        return false;
    };
    let Ok(addresses) = (host, port).to_socket_addrs() else {
        return false;
    };
    addresses
        .into_iter()
        .any(|address| TcpStream::connect_timeout(&address, REACH_TIMEOUT).is_ok())
}

/// The server's pages may move the window by its header, double-click it to
/// zoom, and say which theme they're in — nothing else of the app's.
fn grant(app: &AppHandle, server: &Url) -> Result<(), String> {
    let origin = server.as_str().to_string();
    let state = app.state::<AppState>();
    let mut granted = state.granted.lock().unwrap();
    if granted.contains(&origin) {
        return Ok(());
    }
    app.add_capability(
        CapabilityBuilder::new(format!("server-{}", granted.len()))
            .remote(origin.clone())
            .local(false)
            .window(WINDOW)
            .permission("core:window:allow-start-dragging")
            .permission("core:window:allow-internal-toggle-maximize")
            .permission("allow-remember-theme"),
    )
    .map_err(|e| e.to_string())?;
    granted.push(origin);
    Ok(())
}

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(WINDOW)
}

fn show(app: &AppHandle) {
    if let Some(window) = window(app) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Anything that isn't the server's, or the app's own page: the browser (or
/// Mail, for a mailto:).
fn open_elsewhere(app: &AppHandle, url: &Url) {
    let _ = app.opener().open_url(url.as_str(), None::<&str>);
}

fn is_own_page(url: &Url) -> bool {
    matches!(
        url.scheme(),
        "tauri" | "asset" | "ipc" | "about" | "blob" | "data"
    ) || url.host_str() == Some("tauri.localhost")
}

#[derive(Serialize)]
struct Startup {
    /// The server to open: the saved one, else the built-in one.
    address: Option<String>,
    /// vrana's theme when it last ran, for the app's page's colours.
    theme: Option<String>,
}

#[tauri::command]
fn startup(app: AppHandle) -> Startup {
    let state = app.state::<AppState>();
    let settings = state.settings.lock().unwrap();
    Startup {
        address: settings
            .server
            .clone()
            .or_else(|| BUILT_IN_SERVER.map(str::to_string)),
        theme: settings.theme.clone(),
    }
}

/// Opens vrana at this address, once it's reachable, and remembers it.
#[tauri::command]
async fn connect(app: AppHandle, address: String) -> Result<(), String> {
    let url = server_url(&address)?;
    let check = url.clone();
    let ok = tauri::async_runtime::spawn_blocking(move || reachable(&check))
        .await
        .unwrap_or(false);
    if !ok {
        return Err(format!(
            "Can't reach {} — is the server up, and Tailscale on?",
            url.host_str().unwrap_or(url.as_str())
        ));
    }
    {
        let state = app.state::<AppState>();
        let mut settings = state.settings.lock().unwrap();
        settings.server = Some(url.to_string());
        save_settings(&app, &settings);
    }
    grant(&app, &url)?;
    let window = window(&app).ok_or("The window is gone.")?;
    window.navigate(url).map_err(|e| e.to_string())
}

/// vrana's theme (from the page): the window's own colours follow — the
/// title bar on Windows, the backdrop before a page paints — and the next
/// launch opens in it.
#[tauri::command]
fn remember_theme(app: AppHandle, theme: String) {
    let (theme, color) = match theme.as_str() {
        "dark" => (Theme::Dark, DARK),
        "light" => (Theme::Light, LIGHT),
        _ => return,
    };
    if let Some(window) = window(&app) {
        let _ = window.set_theme(Some(theme));
        let _ = window.set_background_color(Some(color));
        #[cfg(target_os = "macos")]
        place_window_buttons(&window);
    }
    let state = app.state::<AppState>();
    let mut settings = state.settings.lock().unwrap();
    let name = if theme == Theme::Dark {
        "dark"
    } else {
        "light"
    };
    if settings.theme.as_deref() != Some(name) {
        settings.theme = Some(name.to_string());
        save_settings(&app, &settings);
    }
}

/// Where the window's buttons go: left of vrana's logo, centred on its 80px
/// header's middle (the header makes room for them: `mac-app:pl-[88px]` in
/// the web app). AppKit keeps them about 10px above their bar's bottom edge,
/// hence 42.5 for a middle at 40; they span about 14–76px across.
#[cfg(target_os = "macos")]
const BUTTONS_AT: (f64, f64) = (14.0, 42.5);

/// Puts the window's buttons in vrana's header. Tauri does it only when the
/// window's own view redraws, which the page covering it keeps from
/// happening, and AppKit puts them back now and then (a resize, the window
/// becoming active, a theme change) — so this runs after each.
#[cfg(target_os = "macos")]
fn place_window_buttons(window: &WebviewWindow) {
    let target = window.clone();
    let _ = window.run_on_main_thread(move || {
        use objc2_app_kit::{NSWindow, NSWindowButton};
        let Ok(ns_window) = target.ns_window() else {
            return;
        };
        // SAFETY: the window's NSWindow, used on the main thread.
        let ns_window: &NSWindow = unsafe { &*ns_window.cast() };
        let [Some(close), Some(minimize), Some(zoom)] = [
            NSWindowButton::CloseButton,
            NSWindowButton::MiniaturizeButton,
            NSWindowButton::ZoomButton,
        ]
        .map(|kind| ns_window.standardWindowButton(kind)) else {
            return;
        };
        // SAFETY: AppKit's own views, on the main thread.
        let Some(bar) = (unsafe { close.superview() }).and_then(|view| unsafe { view.superview() })
        else {
            return;
        };
        let (x, y) = BUTTONS_AT;
        let close_frame = close.frame();
        let mut bar_frame = bar.frame();
        bar_frame.size.height = close_frame.size.height + y;
        bar_frame.origin.y = ns_window.frame().size.height - bar_frame.size.height;
        bar.setFrame(bar_frame);
        let spacing = minimize.frame().origin.x - close_frame.origin.x;
        for (i, button) in [close, minimize, zoom].iter().enumerate() {
            let mut origin = button.frame().origin;
            origin.x = x + i as f64 * spacing;
            button.setFrameOrigin(origin);
        }
    });
}

/// A two-finger swipe goes back and forward, as in Safari.
#[cfg(target_os = "macos")]
fn swipe_to_go_back(window: &WebviewWindow) {
    let _ = window.with_webview(|webview| unsafe {
        let view: &objc2_web_kit::WKWebView = &*webview.inner().cast();
        view.setAllowsBackForwardNavigationGestures(true);
    });
}

/// Full screen hides a Mac window's buttons: the header needn't make room.
#[cfg(target_os = "macos")]
fn mark_fullscreen(window: &WebviewWindow) {
    let full = window.is_fullscreen().unwrap_or(false);
    let _ = window.eval(format!(
        "document.documentElement.toggleAttribute('data-fullscreen', {full})"
    ));
}

#[cfg(target_os = "macos")]
fn mac_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
    let about = AboutMetadata {
        name: Some("vrana".into()),
        version: Some(app.package_info().version.to_string()),
        ..Default::default()
    };
    let vrana = Submenu::with_items(
        app,
        "vrana",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About vrana"), Some(about))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?,
            &MenuItem::with_id(app, "server", "Change Server…", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(app, "reload", "Reload", true, Some("CmdOrCtrl+R"))?,
            // Safari's keys (⌘← and ⌘→ belong to text fields); a two-finger
            // swipe goes back and forward too.
            &MenuItem::with_id(app, "back", "Back", true, Some("CmdOrCtrl+["))?,
            &MenuItem::with_id(app, "forward", "Forward", true, Some("CmdOrCtrl+]"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, Some("Zoom"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    Menu::with_items(app, &[&vrana, &edit, &view, &window])
}

#[cfg(target_os = "macos")]
fn menu_action(app: &AppHandle, id: &str) {
    let Some(window) = window(app) else { return };
    match id {
        "settings" => {
            if let Some(mut url) = current_server(app) {
                url.set_path("/settings");
                let _ = window.navigate(url);
            }
        }
        "server" => {
            if let Some(mut home) = app.state::<AppState>().home.lock().unwrap().clone() {
                home.set_query(Some("change"));
                let _ = window.navigate(home);
            }
        }
        "reload" => {
            let _ = window.eval("location.reload()");
        }
        "back" => {
            let _ = window.eval("history.back()");
        }
        "forward" => {
            let _ = window.eval("history.forward()");
        }
        _ => {}
    }
}

fn build_window(app: &AppHandle, theme: Option<&str>) -> tauri::Result<WebviewWindow> {
    let on_navigation = {
        let app = app.clone();
        move |url: &Url| {
            if is_own_page(url) {
                return true;
            }
            if let Some(server) = current_server(&app) {
                if same_server(url, &server) {
                    return true;
                }
            }
            open_elsewhere(&app, url);
            false
        }
    };
    let on_new_window = {
        let app = app.clone();
        move |url: Url, _features| {
            // A link in a new tab (⌘-click, target=_blank): the server's
            // opens here, anything else in the browser.
            match current_server(&app) {
                Some(server) if same_server(&url, &server) => {
                    if let Some(window) = window(&app) {
                        let _ = window.navigate(url);
                    }
                }
                _ => open_elsewhere(&app, &url),
            }
            NewWindowResponse::Deny
        }
    };
    let on_download = {
        let app = app.clone();
        move |_webview, event: DownloadEvent<'_>| {
            let state = app.state::<AppState>();
            match event {
                // Downloads, under the name the server gave it (a number
                // added if it's taken).
                DownloadEvent::Requested { url, destination } => {
                    state
                        .downloads
                        .lock()
                        .unwrap()
                        .insert(url.to_string(), destination.clone());
                }
                DownloadEvent::Finished { url, path, success } => {
                    let went = state.downloads.lock().unwrap().remove(url.as_str());
                    if let (true, Some(path)) = (success, path.or(went)) {
                        let _ = app.opener().reveal_item_in_dir(path);
                    }
                }
                _ => {}
            }
            true
        }
    };

    let mut builder = WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::App("index.html".into()))
        .title("vrana")
        .inner_size(1440.0, 900.0)
        .min_inner_size(900.0, 600.0)
        // Shown once the first page is in (on_page_load), where the window
        // was last.
        .visible(false)
        // Files dropped on the window go to the page (its upload drop zone).
        .disable_drag_drop_handler()
        .zoom_hotkeys_enabled(true)
        .initialization_script(PAGE_SCRIPT.replace(
            "__VRANA_MAC__",
            if cfg!(target_os = "macos") {
                "true"
            } else {
                "false"
            },
        ))
        .on_navigation(on_navigation)
        .on_new_window(on_new_window)
        .on_download(on_download)
        .on_page_load(|window, payload| {
            if payload.event() == PageLoadEvent::Finished {
                let _ = window.show();
                #[cfg(target_os = "macos")]
                {
                    place_window_buttons(&window);
                    mark_fullscreen(&window);
                }
            }
        });

    match theme {
        Some("dark") => builder = builder.theme(Some(Theme::Dark)).background_color(DARK),
        Some("light") => builder = builder.theme(Some(Theme::Light)).background_color(LIGHT),
        _ => {}
    }

    #[cfg(target_os = "macos")]
    {
        // The header is the title bar: its buttons centred in vrana's 80px
        // header, left of the logo (which the web app moves over for them).
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(tauri::LogicalPosition::new(BUTTONS_AT.0, BUTTONS_AT.1));
    }

    builder.build()
}

/// A Mac app stays open without windows: closing hides it, and the Dock icon
/// (or opening it again) brings it back as it was — and the window's buttons
/// go back in the header after anything that may have moved them. Windows
/// keeps its own ways: closing quits.
fn on_window_event(window: &Window, event: &WindowEvent) {
    #[cfg(target_os = "macos")]
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = window.hide();
        }
        WindowEvent::Resized(_)
        | WindowEvent::Focused(_)
        | WindowEvent::ThemeChanged(_)
        | WindowEvent::ScaleFactorChanged { .. } => {
            if let Some(window) = window.app_handle().get_webview_window(window.label()) {
                place_window_buttons(&window);
                mark_fullscreen(&window);
            }
        }
        _ => {}
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (window, event);
}

pub fn run() {
    #[allow(unused_mut)] // a plugin more on Windows and Linux
    let mut builder = tauri::Builder::default();

    // A second launch on Windows (a Mac does this itself): the open window.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show(app)
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // It shows itself (on_page_load), so no flash of an empty one.
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![startup, connect, remember_theme])
        .setup(|app| {
            let handle = app.handle().clone();
            let settings = load_settings(&handle);
            let theme = settings.theme.clone();
            *app.state::<AppState>().settings.lock().unwrap() = settings;

            #[cfg(target_os = "macos")]
            {
                app.set_menu(mac_menu(&handle)?)?;
                app.on_menu_event(|app, event| menu_action(app, event.id().as_ref()));
            }

            let main = build_window(&handle, theme.as_deref())?;
            *app.state::<AppState>().home.lock().unwrap() = main.url().ok();
            #[cfg(target_os = "macos")]
            swipe_to_go_back(&main);

            // Shown after a moment even if the first page is slow to load.
            let late = handle.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(1500));
                if let Some(window) = window(&late) {
                    let _ = window.show();
                }
            });
            Ok(())
        })
        .on_window_event(on_window_event)
        .build(tauri::generate_context!())
        .expect("error while building vrana")
        .run(|_app, _event| {
            // The Dock icon, or opening vrana again, with no window showing.
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen { .. } = _event {
                show(_app);
            }
        });
}
