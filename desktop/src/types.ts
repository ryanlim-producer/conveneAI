/// Shared types for the Tauri desktop app frontend

/** Audio source types available for recording */
export type AudioSource = "blackhole" | "mic" | "meeting";

/** Recording lifecycle state reported by the Rust backend */
export type RecorderState = "idle" | "recording" | "processing";

/** Audio device info from the Rust backend */
export interface AudioDevice {
  id: string;
  name: string;
  is_blackhole: boolean;
  is_mic: boolean;
}

/** App settings persisted by the Rust backend (never holds credentials) */
export interface AppSettings {
  api_url: string;
  hotkey: string;
  last_source: string;
}

/** Result of cmd_auth_status */
export interface AuthStatus {
  authenticated: boolean;
  api_url: string;
}
