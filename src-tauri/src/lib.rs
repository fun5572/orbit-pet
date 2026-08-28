use keytap::{Error as KeytapError, EventKind, Tap};
use mouce::{
    common::{MouseButton, MouseEvent},
    Mouse, MouseActions,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    ffi::OsString,
    fs, io,
    path::{Path, PathBuf},
    process::Command,
    sync::{Mutex, OnceLock},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

const CODEX_BRIDGE_MARKER: &str = "orbit-pet-bridge";
const CODEX_HOOK_EVENTS: [&str; 6] = [
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PermissionRequest",
    "Stop",
    "SessionEnd",
];
const CODEX_CAPTURE_SH: &str =
    include_str!("../../integrations/orbit-pet-bridge/scripts/capture.sh");
const CODEX_CAPTURE_PS1: &str =
    include_str!("../../integrations/orbit-pet-bridge/scripts/capture.ps1");
const KEYBOARD_STATUS_EVENT: &str = "keyboard-listener-status";
#[cfg(target_os = "macos")]
const ORBIT_PET_BUNDLE_ID: &str = "com.mochasoft.orbitpet";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexHookEvent {
    received_at_ms: u64,
    payload: Value,
}

#[derive(Serialize)]
struct CodexBridgeInstallResult {
    installed: bool,
    message: String,
}

#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyboardListenerStatus {
    state: String,
    message: String,
    can_reauthorize: bool,
}

fn keyboard_status_store() -> &'static Mutex<KeyboardListenerStatus> {
    static STATUS: OnceLock<Mutex<KeyboardListenerStatus>> = OnceLock::new();
    STATUS.get_or_init(|| {
        Mutex::new(KeyboardListenerStatus {
            state: "starting".into(),
            message: "正在检查键盘监听…".into(),
            can_reauthorize: cfg!(target_os = "macos"),
        })
    })
}

fn current_keyboard_listener_status() -> KeyboardListenerStatus {
    keyboard_status_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

fn publish_keyboard_listener_status(app: &AppHandle, status: KeyboardListenerStatus) {
    let changed = {
        let mut current = keyboard_status_store()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if *current == status {
            false
        } else {
            *current = status.clone();
            true
        }
    };
    if changed {
        let _ = app.emit_to("settings", KEYBOARD_STATUS_EVENT, status);
    }
}

#[tauri::command]
fn keyboard_listener_status() -> KeyboardListenerStatus {
    current_keyboard_listener_status()
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("cannot locate Orbit Pet data directory: {error}"))
}

fn event_modified_at_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_else(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64
        })
}

#[tauri::command]
fn drain_codex_hook_events(app: AppHandle) -> Result<Vec<CodexHookEvent>, String> {
    const MAX_EVENTS_PER_DRAIN: usize = 128;
    const MAX_EVENT_BYTES: u64 = 2 * 1024 * 1024;

    let event_dir = app_data_dir(&app)?.join("codex-events");
    fs::create_dir_all(&event_dir)
        .map_err(|error| format!("cannot create Codex event directory: {error}"))?;

    let mut paths = fs::read_dir(&event_dir)
        .map_err(|error| format!("cannot read Codex event directory: {error}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("json"))
        .collect::<Vec<_>>();
    paths.sort_by_key(|path| event_modified_at_ms(path));

    let mut events = Vec::new();
    for path in paths.into_iter().take(MAX_EVENTS_PER_DRAIN) {
        let received_at_ms = event_modified_at_ms(&path);
        let payload = fs::metadata(&path)
            .ok()
            .filter(|metadata| metadata.len() <= MAX_EVENT_BYTES)
            .and_then(|_| fs::read_to_string(&path).ok())
            .and_then(|contents| serde_json::from_str::<Value>(&contents).ok());
        let _ = fs::remove_file(&path);
        if let Some(payload) = payload {
            events.push(CodexHookEvent {
                received_at_ms,
                payload,
            });
        }
    }
    Ok(events)
}

fn write_file(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
    }
    fs::write(path, contents).map_err(|error| format!("cannot write {}: {error}", path.display()))
}

fn codex_home_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("CODEX_HOME").filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(path));
    }
    app.path()
        .home_dir()
        .map(|path| path.join(".codex"))
        .map_err(|error| format!("cannot locate Codex configuration directory: {error}"))
}

fn codex_bridge_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(CODEX_BRIDGE_MARKER))
}

fn codex_candidates() -> Vec<OsString> {
    let mut candidates = vec![OsString::from("codex")];

    #[cfg(target_os = "macos")]
    {
        candidates.push(OsString::from(
            "/Applications/ChatGPT.app/Contents/Resources/codex",
        ));
        if let Some(home) = std::env::var_os("HOME") {
            candidates.push(
                PathBuf::from(home)
                    .join("Applications/ChatGPT.app/Contents/Resources/codex")
                    .into_os_string(),
            );
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            let root = PathBuf::from(local_app_data);
            candidates.push(
                root.join("Programs/ChatGPT/resources/codex.exe")
                    .into_os_string(),
            );
            candidates.push(root.join("ChatGPT/resources/codex.exe").into_os_string());
        }
        if let Some(program_files) = std::env::var_os("ProgramFiles") {
            candidates.push(
                PathBuf::from(program_files)
                    .join("ChatGPT/resources/codex.exe")
                    .into_os_string(),
            );
        }
    }

    candidates
}

fn run_codex_best_effort(args: &[&str]) {
    for candidate in codex_candidates() {
        match Command::new(candidate).args(args).output() {
            Ok(_) => return,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(_) => return,
        }
    }
}

fn cleanup_legacy_codex_marketplace() {
    run_codex_best_effort(&[
        "plugin",
        "remove",
        "orbit-pet-bridge@orbit-pet-local",
        "--json",
    ]);
    run_codex_best_effort(&[
        "plugin",
        "marketplace",
        "remove",
        "orbit-pet-local",
        "--json",
    ]);
}

fn value_contains_orbit_bridge(value: &Value) -> bool {
    match value {
        Value::String(value) => value.contains(CODEX_BRIDGE_MARKER),
        Value::Array(values) => values.iter().any(value_contains_orbit_bridge),
        Value::Object(values) => values.values().any(value_contains_orbit_bridge),
        _ => false,
    }
}

fn merge_codex_hooks(
    document: &mut Value,
    unix_command: &str,
    windows_command: &str,
) -> Result<(), String> {
    let root = document
        .as_object_mut()
        .ok_or_else(|| "Codex hooks.json must contain a JSON object".to_string())?;
    let hooks = root.entry("hooks").or_insert_with(|| json!({}));
    let hooks = hooks
        .as_object_mut()
        .ok_or_else(|| "the hooks field in Codex hooks.json must be an object".to_string())?;

    for event_name in CODEX_HOOK_EVENTS {
        let entries = hooks.entry(event_name).or_insert_with(|| json!([]));
        let entries = entries.as_array_mut().ok_or_else(|| {
            format!("the {event_name} field in Codex hooks.json must be an array")
        })?;
        entries.retain(|entry| !value_contains_orbit_bridge(entry));
        entries.push(json!({
            "hooks": [{
                "type": "command",
                "command": unix_command,
                "commandWindows": windows_command,
                "timeout": 3
            }]
        }));
    }
    Ok(())
}

fn codex_hooks_contain_bridge(path: &Path) -> bool {
    fs::read_to_string(path)
        .ok()
        .and_then(|contents| serde_json::from_str::<Value>(&contents).ok())
        .is_some_and(|document| value_contains_orbit_bridge(&document))
}

fn codex_hooks_contain_current_bridge(path: &Path) -> bool {
    fs::read_to_string(path)
        .ok()
        .and_then(|contents| serde_json::from_str::<Value>(&contents).ok())
        .and_then(|document| document.get("hooks").cloned())
        .and_then(|hooks| hooks.as_object().cloned())
        .is_some_and(|hooks| {
            CODEX_HOOK_EVENTS.iter().all(|event_name| {
                hooks
                    .get(*event_name)
                    .is_some_and(value_contains_orbit_bridge)
            })
        })
}

fn prepare_codex_bridge(app: &AppHandle) -> Result<(PathBuf, String, String), String> {
    let bridge_root = codex_bridge_root(app)?;
    let scripts_root = bridge_root.join("scripts");
    let capture_sh = scripts_root.join("capture.sh");
    let capture_ps1 = scripts_root.join("capture.ps1");
    write_file(&capture_sh, CODEX_CAPTURE_SH)?;
    write_file(&capture_ps1, CODEX_CAPTURE_PS1)?;

    let unix_command = format!(
        "ORBIT_PET_BRIDGE={CODEX_BRIDGE_MARKER} /bin/sh \"{}\"",
        capture_sh.display()
    );
    let windows_command = format!(
        "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{}\"",
        capture_ps1.display()
    );
    Ok((bridge_root, unix_command, windows_command))
}

#[tauri::command]
fn codex_bridge_status(app: AppHandle) -> Result<CodexBridgeInstallResult, String> {
    let hooks_path = codex_home_dir(&app)?.join("hooks.json");
    let installed = codex_hooks_contain_current_bridge(&hooks_path)
        && codex_bridge_root(&app)?
            .join("scripts/capture.sh")
            .is_file()
        && codex_bridge_root(&app)?
            .join("scripts/capture.ps1")
            .is_file();
    Ok(CodexBridgeInstallResult {
        installed,
        message: if installed {
            "连接已安装；首次使用请在 Codex 的 /hooks 中启用".into()
        } else if codex_hooks_contain_bridge(&hooks_path) {
            "连接需要更新以显示执行过程".into()
        } else {
            "还未安装 Codex 连接".into()
        },
    })
}

#[tauri::command]
fn install_codex_bridge(app: AppHandle) -> Result<CodexBridgeInstallResult, String> {
    let (_bridge_root, unix_command, windows_command) = prepare_codex_bridge(&app)?;
    let hooks_path = codex_home_dir(&app)?.join("hooks.json");
    let mut hooks_document = if hooks_path.is_file() {
        let contents = fs::read_to_string(&hooks_path)
            .map_err(|error| format!("cannot read {}: {error}", hooks_path.display()))?;
        serde_json::from_str::<Value>(&contents)
            .map_err(|error| format!("cannot parse {}: {error}", hooks_path.display()))?
    } else {
        json!({ "hooks": {} })
    };

    merge_codex_hooks(&mut hooks_document, &unix_command, &windows_command)?;
    if hooks_path.is_file() {
        let backup_path = hooks_path.with_extension("json.orbit-pet-backup");
        if !backup_path.exists() {
            fs::copy(&hooks_path, &backup_path).map_err(|error| {
                format!(
                    "cannot back up {} to {}: {error}",
                    hooks_path.display(),
                    backup_path.display()
                )
            })?;
        }
    }
    let contents = serde_json::to_string_pretty(&hooks_document)
        .map_err(|error| format!("cannot serialize Codex hooks: {error}"))?;
    write_file(&hooks_path, &format!("{contents}\n"))?;
    cleanup_legacy_codex_marketplace();

    Ok(CodexBridgeInstallResult {
        installed: true,
        message: "已从 Orbit Pet 直接安装。请在 Codex 的 /hooks 中审查并启用".into(),
    })
}

fn upgrade_existing_codex_bridge(app: &AppHandle) {
    let Ok(hooks_path) = codex_home_dir(app).map(|path| path.join("hooks.json")) else {
        return;
    };
    if !codex_hooks_contain_bridge(&hooks_path) || codex_hooks_contain_current_bridge(&hooks_path) {
        return;
    }
    if let Err(error) = install_codex_bridge(app.clone()) {
        eprintln!("cannot update existing Codex bridge: {error}");
    }
}

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceButtonState(state_id: i32, button: u32) -> bool;
}

#[cfg(target_os = "windows")]
#[link(name = "user32")]
extern "system" {
    fn GetAsyncKeyState(virtual_key: i32) -> i16;
}

#[cfg(target_os = "macos")]
#[link(name = "IOKit", kind = "framework")]
extern "C" {
    fn IOHIDRequestAccess(request: u32) -> bool;
}

#[cfg(target_os = "macos")]
fn request_global_input_access() {
    const IOHID_REQUEST_TYPE_LISTEN_EVENT: u32 = 1;

    unsafe {
        let _ = IOHIDRequestAccess(IOHID_REQUEST_TYPE_LISTEN_EVENT);
    }
}

#[cfg(not(target_os = "macos"))]
fn request_global_input_access() {}

#[cfg(target_os = "macos")]
#[tauri::command]
fn reset_keyboard_input_permission(app: AppHandle) -> Result<KeyboardListenerStatus, String> {
    let output = Command::new("/usr/bin/tccutil")
        .args(["reset", "ListenEvent", ORBIT_PET_BUNDLE_ID])
        .output()
        .map_err(|error| format!("cannot start tccutil: {error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return Err(if detail.is_empty() {
            format!("tccutil failed with status {}", output.status)
        } else {
            format!("tccutil failed: {detail}")
        });
    }

    let status = KeyboardListenerStatus {
        state: "starting".into(),
        message: "已清除旧授权，Orbit Pet 即将重启并重新申请…".into(),
        can_reauthorize: false,
    };
    publish_keyboard_listener_status(&app, status.clone());
    thread::spawn(move || {
        // TCC does not present a fresh Input Monitoring prompt to the same
        // process after reset. The restarted process requests access in setup.
        thread::sleep(Duration::from_millis(650));
        app.restart();
    });
    Ok(status)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn reset_keyboard_input_permission(_app: AppHandle) -> Result<KeyboardListenerStatus, String> {
    Err("当前系统不需要重置输入监控权限".into())
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn is_primary_mouse_button_pressed() -> Option<bool> {
    // Combined session state is independent of the event tap used by the
    // global listener, so it still works if that listener misses mouse-up.
    const COMBINED_SESSION_STATE: i32 = 0;
    const LEFT_MOUSE_BUTTON: u32 = 0;
    Some(unsafe { CGEventSourceButtonState(COMBINED_SESSION_STATE, LEFT_MOUSE_BUTTON) })
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn is_primary_mouse_button_pressed() -> Option<bool> {
    const VK_LBUTTON: i32 = 0x01;
    Some(unsafe { GetAsyncKeyState(VK_LBUTTON) < 0 })
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[tauri::command]
fn is_primary_mouse_button_pressed() -> Option<bool> {
    None
}

fn start_global_keyboard_listener(app: AppHandle) {
    thread::spawn(move || {
        let mut last_error = None;

        loop {
            match Tap::new() {
                Ok(tap) => {
                    last_error = None;
                    eprintln!("global keyboard listener ready");
                    publish_keyboard_listener_status(
                        &app,
                        KeyboardListenerStatus {
                            state: "ready".into(),
                            message: "键盘监听正常".into(),
                            can_reauthorize: cfg!(target_os = "macos"),
                        },
                    );

                    for event in tap.iter() {
                        if let EventKind::KeyDown(_) = event.kind {
                            let _ = app.emit_to("effects", "global-key-down", ());
                            let _ = app.emit_to("pet", "global-key-down", ());
                        }
                    }

                    eprintln!("global keyboard listener stopped; retrying");
                    publish_keyboard_listener_status(
                        &app,
                        KeyboardListenerStatus {
                            state: "failed".into(),
                            message: "键盘监听意外停止，正在重试".into(),
                            can_reauthorize: cfg!(target_os = "macos"),
                        },
                    );
                }
                Err(error) => {
                    let message = format!("{error:?}");
                    if last_error.as_deref() != Some(message.as_str()) {
                        eprintln!("global keyboard listener unavailable: {message}; retrying");
                        last_error = Some(message);
                    }
                    let (state, message) = if matches!(&error, KeytapError::PermissionDenied) {
                        ("permission-denied", "未获得 macOS 输入监控权限".to_string())
                    } else {
                        ("failed", format!("键盘监听启动失败：{error}"))
                    };
                    publish_keyboard_listener_status(
                        &app,
                        KeyboardListenerStatus {
                            state: state.into(),
                            message,
                            can_reauthorize: cfg!(target_os = "macos"),
                        },
                    );
                }
            }

            thread::sleep(Duration::from_secs(2));
        }
    });
}

fn start_global_mouse_listener(app: AppHandle) {
    thread::spawn(move || {
        let mut mouse = Mouse::new();
        if let Err(error) = mouse.hook(Box::new(move |event| match event {
            MouseEvent::Press(_) => {
                let _ = app.emit_to("pet", "global-mouse-down", ());
            }
            MouseEvent::Release(MouseButton::Left) => {
                let _ = app.emit_to("pet", "global-mouse-up", ());
            }
            _ => {}
        })) {
            eprintln!("global mouse listener unavailable: {error:?}");
            return;
        }

        loop {
            thread::park();
        }
    });
}

fn start_global_input_listener(app: AppHandle) {
    start_global_keyboard_listener(app.clone());
    start_global_mouse_listener(app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            is_primary_mouse_button_pressed,
            keyboard_listener_status,
            reset_keyboard_input_permission,
            drain_codex_hook_events,
            codex_bridge_status,
            install_codex_bridge
        ])
        .setup(|app| {
            request_global_input_access();
            start_global_input_listener(app.handle().clone());
            upgrade_existing_codex_bridge(app.handle());

            let show = MenuItem::with_id(app, "show", "Show pet", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "Hide pet", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
            let codex_tasks =
                MenuItem::with_id(app, "codex-tasks", "Codex Tasks…", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Orbit Pet", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[&show, &hide, &settings, &codex_tasks, &separator, &quit],
            )?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("app icon missing").clone())
                .tooltip("Orbit Pet")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("pet") {
                            let _ = window.show();
                        }
                        if let Some(window) = app.get_webview_window("effects") {
                            let _ = window.show();
                        }
                    }
                    "hide" => {
                        if let Some(window) = app.get_webview_window("pet") {
                            let _ = window.hide();
                        }
                        if let Some(window) = app.get_webview_window("effects") {
                            let _ = window.hide();
                        }
                    }
                    "settings" => {
                        if let Some(window) = app.get_webview_window("settings") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "codex-tasks" => {
                        if let Some(window) = app.get_webview_window("codex-tasks") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Orbit Pet");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_orbit_hooks_without_replacing_other_hooks() {
        let mut document = json!({
            "description": "keep me",
            "hooks": {
                "Stop": [
                    { "hooks": [{ "type": "command", "command": "/usr/bin/other-hook" }] },
                    { "hooks": [{ "type": "command", "command": "old orbit-pet-bridge command" }] }
                ]
            }
        });

        merge_codex_hooks(
            &mut document,
            "ORBIT_PET_BRIDGE=orbit-pet-bridge /bin/sh /tmp/capture.sh",
            "powershell.exe -File C:\\orbit-pet-bridge\\capture.ps1",
        )
        .expect("hooks should merge");

        assert_eq!(document["description"], "keep me");
        assert_eq!(document["hooks"]["Stop"].as_array().unwrap().len(), 2);
        assert_eq!(
            document["hooks"]["UserPromptSubmit"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(document["hooks"]["PreToolUse"].as_array().unwrap().len(), 1);
        assert_eq!(
            document["hooks"]["PostToolUse"].as_array().unwrap().len(),
            1
        );
        assert!(document["hooks"]["Stop"][0]["hooks"][0]["command"]
            .as_str()
            .unwrap()
            .contains("other-hook"));

        merge_codex_hooks(
            &mut document,
            "ORBIT_PET_BRIDGE=orbit-pet-bridge /bin/sh /tmp/capture.sh",
            "powershell.exe -File C:\\orbit-pet-bridge\\capture.ps1",
        )
        .expect("reinstall should be idempotent");
        assert_eq!(document["hooks"]["Stop"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn rejects_an_invalid_hooks_document_without_overwriting_it() {
        let mut document = json!({ "hooks": [] });
        let original = document.clone();

        assert!(merge_codex_hooks(&mut document, "unix", "windows").is_err());
        assert_eq!(document, original);
    }
}
