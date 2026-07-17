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
    /// Previous default output device name (restored after meeting recording stops)
    pub prev_default_audio: Mutex<Option<String>>,
}

fn shared_client(app: &AppHandle) -> Option<Arc<api::ApiClient>> {
    app.try_state::<AppState>()
        .and_then(|s| s.api.lock().unwrap().clone())
}

const AUDIO_ROUTER_BIN: &str = ".local/bin/conveneai-audio-router";

/// Toggle audio routing for "meeting" source: when recording starts, set the
/// aggregate device as default output (so system audio flows into BlackHole).
/// When recording stops, restore the previous default output device.
fn toggle_meeting_audio_routing(start: bool, state: &AppState) {
    let home = std::env::var("HOME").unwrap_or_default();
    let bin = format!("{}/{}", home, AUDIO_ROUTER_BIN);

    if start {
        match std::process::Command::new(&bin).arg("--start").output() {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                // Look for "PREV_DEFAULT:<name>" in the output
                if let Some(name) = stdout
                    .lines()
                    .find(|l| l.starts_with("PREV_DEFAULT:"))
                    .and_then(|l| l.strip_prefix("PREV_DEFAULT:"))
                {
                    *state.prev_default_audio.lock().unwrap() = Some(name.to_string());
                }
            }
            Err(e) => eprintln!("audio-router --start failed: {e}"),
        }
    } else {
        let prev = state.prev_default_audio.lock().unwrap().take();
        if let Some(device_name) = prev {
            let _ = std::process::Command::new(&bin)
                .arg("--stop")
                .arg(&device_name)
                .output();
        }
    }
}

// ── Tray helpers ──

/// Menu bar icon state — title-based (template icon stays constant).
/// Combines audio source (mic 🎙 / internal 🎧) with state (idle /
/// 🔴 recording / ⚙ processing) so the user can tell at a glance what
/// the hotkey will record.
fn set_tray_state(app: &AppHandle, state: tray::TrayState) {
    if let Some(tray_icon) = app.tray_by_id("main-tray") {
        let settings = config::AppSettings::load(&get_config_path()).unwrap_or_default();
        let title = tray::format_title(state, &settings.last_source);
        let _ = tray_icon.set_title(Some(&title));
        let _ = tray_icon.set_tooltip(Some(&tray::format_tooltip(state, &settings.last_source)));
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

#[tauri::command]
fn cmd_meeting_input_available() -> bool {
    audio::meeting_input_available()
}

/// Start capturing audio from the given source ("blackhole" | "mic").
fn start_recording_impl(app: &AppHandle, source: &str) -> Result<(), String> {
    let state = app.state::<AppState>();
    {
        let mut recorder = state.recorder.lock().unwrap();
        recorder.start_recording(source).map_err(|e| format!("{e:?}"))?;
    }

    // When recording with any source that needs BlackHole (meeting or
    // internal audio), route system audio into BlackHole by setting the
    // aggregate device as default output.
    if source == "meeting" || source == "blackhole" {
        toggle_meeting_audio_routing(true, &state);
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

    // Restore previous default output device (undoes the aggregate device routing
    // that was set up during meeting recording start).
    toggle_meeting_audio_routing(false, &state);

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
                    .title("conveneAI")
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
    if capture::is_effectively_silent(&captured.samples) {
        return Err(
            "No audio was captured — the recording is silent. If you're using Internal Audio, \
             route your Mac's sound output into BlackHole (Multi-Output Device); if you meant \
             to record yourself, switch the source to Microphone."
                .to_string(),
        );
    }

    let client = shared_client(app).ok_or_else(|| "Not signed in — open the app and log in".to_string())?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let tmp = std::env::temp_dir();
    let wav_path = tmp.join(format!("conveneai-{timestamp}.wav"));
    let mp3_path = tmp.join(format!("conveneai-{timestamp}.mp3"));

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

    let result = client.upload_audio(&upload_path, "en").await.map_err(|e| match e {
        api::ApiError::Unauthorized(msg) => msg,
        other => format!("{other:?}"),
    });

    // Persist temp files for 24h so failed uploads are recoverable.
    // Cleaned up on next recording or app launch.
    persist_temp_recording(&wav_path, &mp3_path, timestamp);

    result
}

/// Move temp WAV/MP3 files to a persistent directory, then purge
/// recordings older than 24 hours.
fn persist_temp_recording(
    wav_path: &std::path::Path,
    mp3_path: &std::path::Path,
    timestamp: u64,
) {
    let dir = match recordings_dir() {
        Some(d) => {
            let _ = std::fs::create_dir_all(&d);
            d
        }
        None => return,
    };

    // Move files to persistent storage (ignore errors — best-effort)
    let dest_wav = dir.join(format!("conveneai-{timestamp}.wav"));
    let dest_mp3 = dir.join(format!("conveneai-{timestamp}.mp3"));
    let _ = std::fs::rename(wav_path, &dest_wav);
    let _ = std::fs::rename(mp3_path, &dest_mp3);

    // Purge recordings older than 24 hours
    let cutoff = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() - 86_400)
        .unwrap_or(0);
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if let Some(ts_str) = name
                .strip_prefix("conveneai-")
                .and_then(|rest| rest.split('.').next())
            {
                if let Ok(ts) = ts_str.parse::<u64>() {
                    if ts < cutoff {
                        let _ = std::fs::remove_file(entry.path());
                    }
                }
            }
        }
    }
}

fn recordings_dir() -> Option<std::path::PathBuf> {
    std::env::var("HOME").ok().map(|home| {
        let mut p = std::path::PathBuf::from(home);
        p.push("Library");
        p.push("Application Support");
        p.push("conveneAI");
        p.push("recordings");
        p
    })
}

/// Delete any stored recordings older than 24 hours. Called on app startup.
fn purge_old_recordings() {
    let dir = match recordings_dir() {
        Some(d) => d,
        None => return,
    };
    let cutoff = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() - 86_400)
        .unwrap_or(0);
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if let Some(ts_str) = name
                .strip_prefix("conveneai-")
                .and_then(|rest| rest.split('.').next())
            {
                if let Ok(ts) = ts_str.parse::<u64>() {
                    if ts < cutoff {
                        let _ = std::fs::remove_file(entry.path());
                    }
                }
            }
        }
    }
}

/// Name the recording right after upload (called from the post-upload banner).
#[tauri::command]
async fn cmd_rename_job(app: AppHandle, job_id: String, filename: String) -> Result<(), String> {
    let client = shared_client(&app).ok_or_else(|| "Not signed in".to_string())?;
    client
        .rename_job(&job_id, filename.trim())
        .await
        .map_err(|e| match e {
            api::ApiError::Unauthorized(msg) => msg,
            other => format!("{other:?}"),
        })
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

/// Read the companion device volume via the audio router (0.0–1.0).
#[tauri::command]
fn cmd_get_output_volume() -> Result<f64, String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let bin = format!("{}/{}", home, AUDIO_ROUTER_BIN);
    let output = std::process::Command::new(&bin)
        .arg("--get-volume")
        .output()
        .map_err(|e| format!("audio-router error: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .find(|l| l.starts_with("VOLUME:"))
        .and_then(|l| l.strip_prefix("VOLUME:"))
        .and_then(|v| v.parse::<f64>().ok())
        .filter(|v| *v >= 0.0)
        .ok_or_else(|| "Could not read volume".to_string())
}

/// Set the companion device volume (0–100 percentage).
#[tauri::command]
fn cmd_set_output_volume(volume_pct: f64) -> Result<(), String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let bin = format!("{}/{}", home, AUDIO_ROUTER_BIN);
    let pct = volume_pct.clamp(0.0, 100.0) as u32;
    std::process::Command::new(&bin)
        .arg("--volume")
        .arg(pct.to_string())
        .output()
        .map_err(|e| format!("audio-router error: {e}"))?;
    Ok(())
}

fn get_config_path() -> std::path::PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        let mut p = std::path::PathBuf::from(home);
        p.push("Library");
        p.push("Application Support");
        p.push("conveneAI");
        std::fs::create_dir_all(&p).ok();
        p.push("conveneai-settings.json");
        p
    } else {
        std::path::PathBuf::from("conveneai-settings.json")
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
            prev_default_audio: Mutex::new(None),
        })
        .setup(|app| {
            // Purge recordings older than 24h left over from prior sessions
            purge_old_recordings();

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

            let settings = config::AppSettings::load(&get_config_path()).unwrap_or_default();
            let initial_title = tray::format_title(tray::TrayState::Idle, &settings.last_source);

            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().cloned().unwrap())
                .icon_as_template(true)
                .title(&initial_title)
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    MENU_QUIT => app.exit(0),
                    MENU_START_RECORDING => toggle_recording(app),
                    "show-window" => show_main_window(app),
                    _ => {}
                })
                .build(app)?;

            // Set the initial tooltip (title is set above; the builder
            // doesn't expose tooltip so we set it right after build).
            set_tray_state(app.handle(), tray::TrayState::Idle);

            // Register the global shortcut (configurable in settings)
            use hotkey::HotkeyConfig;
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
            cmd_meeting_input_available,
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
            cmd_rename_job,
            cmd_get_output_volume,
            cmd_set_output_volume,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
