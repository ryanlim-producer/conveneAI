mod tray;
mod hotkey;
mod audio;
mod capture;
mod recorder;
mod encoder;
mod api;
mod notifications;
mod config;

use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use tauri_plugin_notification::NotificationExt;
use recorder::Recorder;
use tray::{MENU_QUIT, MENU_START_RECORDING};

// ── App State ──

pub struct AppState {
    pub recorder: Mutex<Recorder>,
    pub capture: Mutex<Option<capture::CaptureHandle>>,
    /// Shared API client — its cookie jar holds the login session, so the
    /// same instance must serve every authenticated request.
    pub api: Mutex<Option<Arc<api::ApiClient>>>,
}

fn shared_client(app: &AppHandle) -> Option<Arc<api::ApiClient>> {
    app.try_state::<AppState>()
        .and_then(|s| s.api.lock().unwrap().clone())
}

// ── Tray helpers ──

/// Menu bar icon state: 🎙 idle / 🔴 recording / ⚙ processing (title-based —
/// template icon stays constant, the emoji title conveys state at a glance).
fn set_tray_state(app: &AppHandle, state: tray::TrayState) {
    if let Some(tray_icon) = app.tray_by_id("main-tray") {
        let title = match state {
            tray::TrayState::Idle => "🎙",
            tray::TrayState::Recording => "🔴",
            tray::TrayState::Processing => "⚙",
        };
        let _ = tray_icon.set_title(Some(title));
        let _ = tray_icon.set_tooltip(Some(state.tooltip()));
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

// ── Auth commands ──

#[derive(serde::Serialize)]
struct AuthStatus {
    authenticated: bool,
    api_url: String,
}

#[tauri::command]
async fn cmd_login(
    app: AppHandle,
    email: String,
    password: String,
    api_url: String,
) -> Result<(), String> {
    let api_url = api_url.trim().trim_end_matches('/').to_string();
    let client = api::ApiClient::new(&api_url).map_err(|e| format!("{e:?}"))?;
    client.login(&email, &password).await.map_err(|e| match e {
        api::ApiError::Unauthorized(msg) => msg,
        api::ApiError::NetworkError(msg) => format!("Cannot reach the server: {msg}"),
        other => format!("{other:?}"),
    })?;

    if let Some(state) = app.try_state::<AppState>() {
        *state.api.lock().unwrap() = Some(Arc::new(client));
    }

    // Persist the server URL (never the credentials)
    let config_path = get_config_path();
    let mut settings = config::AppSettings::load(&config_path).unwrap_or_default();
    settings.api_url = api_url;
    let _ = settings.save(&config_path);

    Ok(())
}

#[tauri::command]
async fn cmd_auth_status(app: AppHandle) -> AuthStatus {
    let settings = config::AppSettings::load(&get_config_path()).unwrap_or_default();
    let authenticated = match shared_client(&app) {
        Some(client) => client.is_authenticated().await.unwrap_or(false),
        None => false,
    };
    AuthStatus {
        authenticated,
        api_url: settings.api_url,
    }
}

#[tauri::command]
fn cmd_logout(app: AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        *state.api.lock().unwrap() = None;
    }
}

// ── Recording commands ──

#[tauri::command]
fn cmd_ping() -> String {
    "pong".to_string()
}

#[tauri::command]
fn cmd_get_audio_devices() -> Vec<audio::AudioDevice> {
    audio::enumerate_input_devices()
}

#[tauri::command]
fn cmd_blackhole_available() -> bool {
    audio::blackhole_available()
}

/// Start capturing audio from the given source ("blackhole" | "mic").
fn start_recording_impl(app: &AppHandle, source: &str) -> Result<(), String> {
    let state = app.state::<AppState>();
    {
        let mut recorder = state.recorder.lock().unwrap();
        recorder.start_recording(source).map_err(|e| format!("{e:?}"))?;
    }

    match capture::start_capture(source) {
        Ok(handle) => {
            *state.capture.lock().unwrap() = Some(handle);
            set_tray_state(app, tray::TrayState::Recording);

            // Remember the source so the hotkey reuses it next time
            let config_path = get_config_path();
            let mut settings = config::AppSettings::load(&config_path).unwrap_or_default();
            settings.last_source = source.to_string();
            let _ = settings.save(&config_path);

            let _ = app.emit("recorder-changed", "recording");
            Ok(())
        }
        Err(e) => {
            // Roll back the state machine so the user can retry
            let mut recorder = state.recorder.lock().unwrap();
            let _ = recorder.stop_recording();
            let _ = recorder.processing_complete();
            Err(e)
        }
    }
}

#[tauri::command]
fn cmd_start_recording(app: AppHandle, source: String) -> Result<(), String> {
    start_recording_impl(&app, &source)
}

/// Recorder state + elapsed seconds — polled by the UI to stay in sync even
/// when recording is started/stopped via the hotkey or tray.
#[derive(serde::Serialize)]
struct RecorderStatus {
    state: String,
    elapsed_seconds: u64,
}

#[tauri::command]
fn cmd_get_recorder_state(state: tauri::State<AppState>) -> RecorderStatus {
    let recorder = state.recorder.lock().unwrap();
    let state_name = match recorder.state() {
        recorder::RecordingState::Idle => "idle",
        recorder::RecordingState::Recording => "recording",
        recorder::RecordingState::Processing => "processing",
    };
    RecorderStatus {
        state: state_name.to_string(),
        elapsed_seconds: recorder.elapsed_seconds().as_secs(),
    }
}

/// Current audio input level [0.0, 1.0] — polled by the recording UI.
#[tauri::command]
fn cmd_get_audio_level(state: tauri::State<AppState>) -> f64 {
    state
        .capture
        .lock()
        .unwrap()
        .as_ref()
        .map(|h| h.level())
        .unwrap_or(0.0)
}

/// Stop recording: encode to MP3 and upload to the server in the background.
/// The desktop app is a dumb recorder — no transcription happens locally.
fn stop_recording_impl(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    {
        let mut recorder = state.recorder.lock().unwrap();
        recorder.stop_recording().map_err(|e| format!("{e:?}"))?;
    }

    let handle = state
        .capture
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| "No active capture".to_string())?;

    set_tray_state(app, tray::TrayState::Processing);
    let _ = app.emit("recorder-changed", "processing");
    let captured = handle.stop();

    let app_for_task = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = upload_recording(&app_for_task, captured).await;

        match &result {
            Ok(upload) => {
                let _ = app_for_task.emit("upload-complete", upload.job_id.clone());
                let _ = app_for_task
                    .notification()
                    .builder()
                    .title(notifications::build_notification_title())
                    .body(notifications::build_notification_body(upload))
                    .show();
            }
            Err(e) => {
                log::error!("Recording upload failed: {e}");
                let _ = app_for_task.emit("upload-error", e.clone());
                let _ = app_for_task
                    .notification()
                    .builder()
                    .title("AsisVoz")
                    .body(notifications::build_error_body(e))
                    .show();
            }
        }

        if let Some(state) = app_for_task.try_state::<AppState>() {
            let _ = state.recorder.lock().unwrap().processing_complete();
        }
        set_tray_state(&app_for_task, tray::TrayState::Idle);
        let _ = app_for_task.emit("recorder-changed", "idle");
    });

    Ok(())
}

#[tauri::command]
fn cmd_stop_recording(app: AppHandle) -> Result<(), String> {
    stop_recording_impl(&app)
}

/// WAV → MP3 → POST /api/upload with the shared authenticated client.
/// Falls back to uploading the WAV when ffmpeg is not installed.
async fn upload_recording(
    app: &AppHandle,
    captured: capture::CapturedAudio,
) -> Result<api::UploadResult, String> {
    if captured.samples.is_empty() {
        return Err("No audio was captured".to_string());
    }

    let client = shared_client(app).ok_or_else(|| "Not signed in — open the app and log in".to_string())?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let tmp = std::env::temp_dir();
    let wav_path = tmp.join(format!("asisvoz-{timestamp}.wav"));
    let mp3_path = tmp.join(format!("asisvoz-{timestamp}.mp3"));

    capture::write_wav(&captured, &wav_path)?;

    let upload_path = match encoder::encode_mp3(
        wav_path.to_str().unwrap_or_default(),
        mp3_path.to_str().unwrap_or_default(),
        128_000,
    ) {
        Ok(p) => p,
        Err(encoder::EncodeError::FfmpegNotFound) => {
            log::warn!("ffmpeg not found — uploading WAV instead of MP3");
            wav_path.to_string_lossy().to_string()
        }
        Err(e) => {
            let _ = std::fs::remove_file(&wav_path);
            return Err(format!("MP3 encoding failed: {e:?}"));
        }
    };

    let result = client.upload_audio(&upload_path, "es").await.map_err(|e| match e {
        api::ApiError::Unauthorized(msg) => msg,
        other => format!("{other:?}"),
    });

    // Clean up temp files regardless of outcome
    let _ = std::fs::remove_file(&wav_path);
    let _ = std::fs::remove_file(&mp3_path);

    result
}

// ── Settings commands ──

#[tauri::command]
fn cmd_get_settings() -> config::AppSettings {
    config::AppSettings::load(&get_config_path()).unwrap_or_default()
}

#[tauri::command]
fn cmd_save_settings(settings: config::AppSettings) -> Result<(), String> {
    settings.save(&get_config_path())
}

#[tauri::command]
fn cmd_set_always_on_top(app: AppHandle, on_top: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.set_always_on_top(on_top).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn get_config_path() -> std::path::PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        let mut p = std::path::PathBuf::from(home);
        p.push("Library");
        p.push("Application Support");
        p.push("AsisVoz");
        std::fs::create_dir_all(&p).ok();
        p.push("asisvoz-settings.json");
        p
    } else {
        std::path::PathBuf::from("asisvoz-settings.json")
    }
}

/// Option+R behavior: a complete toggle. Idle → start with the last-used
/// source; recording → stop and upload. No window juggling required — the
/// main window is persistent.
fn toggle_recording(app: &AppHandle) {
    let is_recording = app
        .try_state::<AppState>()
        .map(|s| *s.recorder.lock().unwrap().state() == recorder::RecordingState::Recording)
        .unwrap_or(false);

    if is_recording {
        if let Err(e) = stop_recording_impl(app) {
            log::error!("Hotkey stop failed: {e}");
        }
    } else {
        let settings = config::AppSettings::load(&get_config_path()).unwrap_or_default();
        if let Err(e) = start_recording_impl(app, &settings.last_source) {
            log::error!("Hotkey start failed: {e}");
            show_main_window(app);
        }
    }
}

// ── Application Entry Point ──

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            recorder: Mutex::new(Recorder::new()),
            capture: Mutex::new(None),
            api: Mutex::new(None),
        })
        .setup(|app| {
            // Regular app: dock icon + menu bar tray icon
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Regular);

            use tauri::menu::{MenuBuilder, MenuItemBuilder};
            use tauri::tray::TrayIconBuilder;

            let show = MenuItemBuilder::with_id("show-window", "Show Window").build(app)?;
            let start = MenuItemBuilder::with_id(MENU_START_RECORDING, "Start / Stop Recording")
                .build(app)?;
            let quit = MenuItemBuilder::with_id(MENU_QUIT, "Quit").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&show)
                .item(&start)
                .separator()
                .item(&quit)
                .build()?;

            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().cloned().unwrap())
                .icon_as_template(true)
                .title("🎙")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    MENU_QUIT => app.exit(0),
                    MENU_START_RECORDING => toggle_recording(app),
                    "show-window" => show_main_window(app),
                    _ => {}
                })
                .build(app)?;

            // Register the global shortcut (configurable in settings)
            use hotkey::HotkeyConfig;
            let settings = config::AppSettings::load(&get_config_path()).unwrap_or_default();
            let hotkey_config = HotkeyConfig::new(&settings.hotkey);

            let shortcut_result: Result<tauri_plugin_global_shortcut::Shortcut, _> =
                hotkey_config.shortcut.as_str().try_into();

            if let Ok(shortcut) = shortcut_result {
                if let Err(e) = app.global_shortcut().register(shortcut) {
                    log::error!("Failed to register global shortcut: {}", e);
                }
            }

            Ok(())
        })
        .plugin(tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                    log::info!("Global shortcut pressed: {:?}", shortcut.id());
                    toggle_recording(app);
                }
            })
            .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            cmd_ping,
            cmd_get_audio_devices,
            cmd_blackhole_available,
            cmd_start_recording,
            cmd_stop_recording,
            cmd_get_audio_level,
            cmd_get_recorder_state,
            cmd_get_settings,
            cmd_save_settings,
            cmd_set_always_on_top,
            cmd_login,
            cmd_auth_status,
            cmd_logout,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
