use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::menu::{MenuBuilder, MenuItem, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineInfo {
    base_url: String,
    token: String,
    running: bool,
}

struct Inner {
    child: Option<Child>,
    port: u16,
    token: String,
    running: bool,
    intentional_stop: bool,
    restarts: u32,
}

struct Engine {
    inner: Arc<Mutex<Inner>>,
    pause_item: Arc<Mutex<Option<MenuItem<tauri::Wry>>>>,
}

static QUITTING: AtomicBool = AtomicBool::new(false);

fn home_dir() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/".into()))
}

fn log_path() -> PathBuf {
    home_dir()
        .join("Library")
        .join("Logs")
        .join("Q Studio")
        .join("engine.log")
}

fn app_support() -> PathBuf {
    home_dir()
        .join("Library")
        .join("Application Support")
        .join("Q Studio")
}

fn output_root() -> PathBuf {
    let config = app_support().join("config.json");
    if let Ok(text) = fs::read_to_string(&config) {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(root) = value.get("outputRoot").and_then(|v| v.as_str()) {
                return PathBuf::from(root);
            }
        }
    }
    home_dir().join("Pictures").join("Q Studio")
}

fn make_token() -> String {
    let mut bytes = [0u8; 24];
    if let Ok(mut file) = fs::File::open("/dev/urandom") {
        let _ = file.read_exact(&mut bytes);
    }
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn engine_info(inner: &Inner) -> EngineInfo {
    EngineInfo {
        base_url: if inner.running && inner.port > 0 {
            format!("http://127.0.0.1:{}", inner.port)
        } else {
            String::new()
        },
        token: inner.token.clone(),
        running: inner.running,
    }
}

fn emit_state(app: &AppHandle, engine: &Engine) {
    let info = {
        let inner = engine.inner.lock().unwrap();
        engine_info(&inner)
    };
    let _ = app.emit("engine-state", info.clone());
    if let Ok(slot) = engine.pause_item.lock() {
        if let Some(item) = slot.as_ref() {
            let _ = item.set_text(if info.running { "Pause engine" } else { "Resume engine" });
        }
    }
}

#[cfg(debug_assertions)]
fn resolve_engine(_app: &AppHandle) -> (PathBuf, Vec<String>, Option<PathBuf>) {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root = manifest.join("..").join("..").join("..");
    (
        PathBuf::from("node"),
        vec![
            "--import".into(),
            "tsx".into(),
            "apps/server/src/index.ts".into(),
        ],
        Some(root),
    )
}

#[cfg(not(debug_assertions))]
fn resolve_engine(app: &AppHandle) -> (PathBuf, Vec<String>, Option<PathBuf>) {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Ok(resources) = app.path().resource_dir() {
        let node = resources.join("engine").join("node");
        let script = resources.join("engine").join("index.mjs");
        if node.exists() && script.exists() {
            return (node, vec![script.to_string_lossy().into_owned()], None);
        }
    }
    let bundled_node = manifest.join("resources").join("engine").join("node");
    let bundled_script = manifest.join("resources").join("engine").join("index.mjs");
    if bundled_node.exists() && bundled_script.exists() {
        return (
            bundled_node,
            vec![bundled_script.to_string_lossy().into_owned()],
            None,
        );
    }
    let root = manifest.join("..").join("..").join("..");
    (
        PathBuf::from("node"),
        vec![
            "--import".into(),
            "tsx".into(),
            "apps/server/src/index.ts".into(),
        ],
        Some(root),
    )
}

fn write_log(line: &str) {
    let path = log_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{line}");
    }
}

fn spawn_engine(app: &AppHandle, engine: &Engine) -> Result<(), String> {
    {
        let inner = engine.inner.lock().unwrap();
        if inner.child.is_some() {
            return Ok(());
        }
    }
    let token = make_token();
    let (node, args, cwd) = resolve_engine(app);
    let existing_path = std::env::var("PATH").unwrap_or_default();
    let mut command = Command::new(&node);
    if let Some(parent) = node.parent() {
        let bundled_ffmpeg = parent.join("bin").join("ffmpeg");
        if bundled_ffmpeg.exists() {
            command.env("QSTUDIO_FFMPEG", &bundled_ffmpeg);
        }
    }
    command
        .args(&args)
        .env("QSTUDIO_PORT", "0")
        .env("QSTUDIO_TOKEN", &token)
        .env("QSTUDIO_LOG", log_path().to_string_lossy().as_ref())
        .env("PATH", format!("{existing_path}:/opt/homebrew/bin:/usr/local/bin"))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = cwd {
        command.current_dir(dir);
    }
    #[cfg(unix)]
    unsafe {
        use std::os::unix::process::CommandExt;
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    write_log(&format!("[shell] starting engine: {} {}", node.display(), args.join(" ")));
    let mut child = command.spawn().map_err(|e| format!("engine spawn failed: {e}"))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    {
        let mut inner = engine.inner.lock().unwrap();
        inner.token = token;
        inner.port = 0;
        inner.running = false;
        inner.intentional_stop = false;
        inner.child = Some(child);
    }
    if let Some(out) = stdout {
        let app_clone = app.clone();
        let inner_clone = engine.inner.clone();
        let pause_clone = engine.pause_item.clone();
        std::thread::spawn(move || {
            let engine_ref = Engine {
                inner: inner_clone,
                pause_item: pause_clone,
            };
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                write_log(&line);
                if let Some(rest) = line.strip_prefix("QSTUDIO_READY ") {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(rest) {
                        if let Some(port) = value.get("port").and_then(|v| v.as_u64()) {
                            {
                                let mut inner = engine_ref.inner.lock().unwrap();
                                inner.port = port as u16;
                                inner.running = true;
                                inner.restarts = 0;
                            }
                            emit_state(&app_clone, &engine_ref);
                        }
                    }
                }
            }
        });
    }
    if let Some(err) = stderr {
        std::thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                write_log(&line);
            }
        });
    }
    let app_clone = app.clone();
    let inner_clone = engine.inner.clone();
    let pause_clone = engine.pause_item.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(500));
        let exited = {
            let mut inner = inner_clone.lock().unwrap();
            match inner.child.as_mut() {
                Some(child) => matches!(child.try_wait(), Ok(Some(_))),
                None => return,
            }
        };
        if !exited {
            continue;
        }
        let (intentional, restarts) = {
            let mut inner = inner_clone.lock().unwrap();
            inner.child = None;
            inner.running = false;
            inner.port = 0;
            (inner.intentional_stop, inner.restarts)
        };
        let engine_ref = Engine {
            inner: inner_clone.clone(),
            pause_item: pause_clone.clone(),
        };
        emit_state(&app_clone, &engine_ref);
        if intentional || QUITTING.load(Ordering::SeqCst) {
            return;
        }
        write_log("[shell] engine exited unexpectedly");
        if restarts >= 5 {
            write_log("[shell] giving up after 5 restarts");
            return;
        }
        {
            let mut inner = inner_clone.lock().unwrap();
            inner.restarts += 1;
        }
        std::thread::sleep(Duration::from_millis(1000 * (1 << restarts.min(3))));
        let _ = spawn_engine(&app_clone, &engine_ref);
        return;
    });
    Ok(())
}

fn stop_engine_blocking(engine: &Engine) {
    let pid = {
        let mut inner = engine.inner.lock().unwrap();
        inner.intentional_stop = true;
        inner.child.as_ref().map(|c| c.id())
    };
    let Some(pid) = pid else { return };
    #[cfg(unix)]
    unsafe {
        libc::kill(-(pid as i32), libc::SIGTERM);
    }
    for _ in 0..30 {
        std::thread::sleep(Duration::from_millis(100));
        let done = {
            let mut inner = engine.inner.lock().unwrap();
            match inner.child.as_mut() {
                Some(child) => matches!(child.try_wait(), Ok(Some(_))),
                None => true,
            }
        };
        if done {
            break;
        }
    }
    #[cfg(unix)]
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
    let mut inner = engine.inner.lock().unwrap();
    if let Some(mut child) = inner.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    inner.running = false;
    inner.port = 0;
}

fn wait_ready(engine: &Engine, timeout: Duration) {
    let steps = (timeout.as_millis() / 100) as usize;
    for _ in 0..steps {
        {
            let inner = engine.inner.lock().unwrap();
            if inner.running {
                return;
            }
            if inner.child.is_none() {
                return;
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn active_jobs(engine: &Engine) -> u32 {
    let (port, token, running) = {
        let inner = engine.inner.lock().unwrap();
        (inner.port, inner.token.clone(), inner.running)
    };
    if !running || port == 0 {
        return 0;
    }
    let Ok(mut stream) = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port)) else {
        return 0;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let request = format!(
        "GET /api/health HTTP/1.0\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return 0;
    }
    let mut body = String::new();
    if stream.read_to_string(&mut body).is_err() {
        return 0;
    }
    body.split("\"running\":")
        .nth(1)
        .and_then(|rest| {
            let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
            digits.parse().ok()
        })
        .unwrap_or(0)
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn request_quit(app: AppHandle) {
    if QUITTING.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        let engine = app.state::<Engine>();
        let active = active_jobs(&engine);
        if active > 0 {
            let proceed = app
                .dialog()
                .message(format!(
                    "{active} job{} still running. Quitting stops the engine; submitted tasks keep their IDs and can resume next launch.",
                    if active == 1 { " is" } else { "s are" }
                ))
                .title("Quit Q Studio?")
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "Quit anyway".into(),
                    "Keep working".into(),
                ))
                .blocking_show();
            if !proceed {
                QUITTING.store(false, Ordering::SeqCst);
                return;
            }
        }
        stop_engine_blocking(&engine);
        app.exit(0);
    });
}

#[tauri::command]
fn get_engine_info(state: State<'_, Engine>) -> EngineInfo {
    let inner = state.inner.lock().unwrap();
    engine_info(&inner)
}

#[tauri::command]
fn start_engine(app: AppHandle, state: State<'_, Engine>) -> Result<(), String> {
    spawn_engine(&app, &state)?;
    wait_ready(&state, Duration::from_secs(15));
    emit_state(&app, &state);
    Ok(())
}

#[tauri::command]
fn stop_engine(app: AppHandle, state: State<'_, Engine>) {
    stop_engine_blocking(&state);
    emit_state(&app, &state);
}

#[tauri::command]
fn restart_engine(app: AppHandle, state: State<'_, Engine>) -> Result<(), String> {
    stop_engine_blocking(&state);
    emit_state(&app, &state);
    spawn_engine(&app, &state)?;
    wait_ready(&state, Duration::from_secs(15));
    emit_state(&app, &state);
    Ok(())
}

pub fn run() {
    let engine = Engine {
        inner: Arc::new(Mutex::new(Inner {
            child: None,
            port: 0,
            token: String::new(),
            running: false,
            intentional_stop: false,
            restarts: 0,
        })),
        pause_item: Arc::new(Mutex::new(None)),
    };
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_window(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(engine)
        .invoke_handler(tauri::generate_handler![
            get_engine_info,
            start_engine,
            stop_engine,
            restart_engine
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let open_item = MenuItemBuilder::with_id("open", "Open Q Studio").build(app)?;
            let pause_item = MenuItemBuilder::with_id("pause", "Pause engine").build(app)?;
            let restart_item = MenuItemBuilder::with_id("restart", "Restart engine").build(app)?;
            let output_item =
                MenuItemBuilder::with_id("output", "Open output folder").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit Q Studio").build(app)?;
            {
                let engine = app.state::<Engine>();
                *engine.pause_item.lock().unwrap() = Some(pause_item.clone());
            }
            let menu = MenuBuilder::new(app)
                .item(&open_item)
                .separator()
                .item(&pause_item)
                .item(&restart_item)
                .item(&output_item)
                .separator()
                .item(&quit_item)
                .build()?;
            let icon = tauri::image::Image::new_owned(
                include_bytes!("../icons/tray.rgba").to_vec(),
                44,
                44,
            );
            TrayIconBuilder::with_id("main")
                .icon(icon)
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => show_window(app),
                    "pause" => {
                        let engine = app.state::<Engine>();
                        let running = engine.inner.lock().unwrap().running;
                        if running {
                            let app_clone = app.clone();
                            std::thread::spawn(move || {
                                let engine = app_clone.state::<Engine>();
                                stop_engine_blocking(&engine);
                                emit_state(&app_clone, &engine);
                            });
                        } else {
                            let _ = spawn_engine(app, &engine);
                        }
                    }
                    "restart" => {
                        let app_clone = app.clone();
                        std::thread::spawn(move || {
                            let engine = app_clone.state::<Engine>();
                            stop_engine_blocking(&engine);
                            let _ = spawn_engine(&app_clone, &engine);
                            wait_ready(&engine, Duration::from_secs(15));
                            emit_state(&app_clone, &engine);
                        });
                    }
                    "output" => {
                        let root = output_root();
                        let _ = fs::create_dir_all(&root);
                        let _ = Command::new("open").arg(&root).spawn();
                    }
                    "quit" => request_quit(app.clone()),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_window(tray.app_handle());
                    }
                })
                .build(app)?;
            let engine = handle.state::<Engine>();
            if let Err(err) = spawn_engine(&handle, &engine) {
                write_log(&format!("[shell] initial engine start failed: {err}"));
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if !QUITTING.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Q Studio");
    app.run(|handle, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if !QUITTING.load(Ordering::SeqCst) {
                api.prevent_exit();
                request_quit(handle.clone());
            }
        }
    });
}
