use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Application settings for the desktop app.
/// Never stores auth tokens — the session lives in the in-memory cookie jar.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    /// The base URL of the deployed server
    #[serde(default = "default_api_url")]
    pub api_url: String,
    /// The global keyboard shortcut (e.g., "Option+R")
    #[serde(default = "default_hotkey")]
    pub hotkey: String,
    /// Last-used audio source — the hotkey starts recording with this
    #[serde(default = "default_source")]
    pub last_source: String,
}

fn default_api_url() -> String {
    "https://5.223.84.152.sslip.io/conveneai".to_string()
}

fn default_hotkey() -> String {
    "Option+R".to_string()
}

fn default_source() -> String {
    "mic".to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            api_url: default_api_url(),
            hotkey: default_hotkey(),
            last_source: default_source(),
        }
    }
}

impl AppSettings {
    /// Load settings from a JSON file, falling back to defaults
    pub fn load(path: &PathBuf) -> Result<Self, String> {
        if path.exists() {
            let contents = std::fs::read_to_string(path)
                .map_err(|e| format!("Failed to read settings: {}", e))?;
            serde_json::from_str(&contents)
                .map_err(|e| format!("Failed to parse settings: {}", e))
        } else {
            Ok(Self::default())
        }
    }

    /// Save settings to a JSON file
    pub fn save(&self, path: &PathBuf) -> Result<(), String> {
        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create settings dir: {}", e))?;
        }
        let contents = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize settings: {}", e))?;
        std::fs::write(path, contents)
            .map_err(|e| format!("Failed to write settings: {}", e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env::temp_dir;

    #[test]
    fn test_default_settings() {
        let settings = AppSettings::default();
        assert_eq!(settings.api_url, "https://5.223.84.152.sslip.io/conveneai");
        assert_eq!(settings.hotkey, "Option+R");
    }

    #[test]
    fn test_load_returns_default_if_no_file() {
        let path = temp_dir().join("conveneai-test-nonexistent.json");
        let _ = std::fs::remove_file(&path);
        let settings = AppSettings::load(&path).unwrap();
        assert_eq!(settings.api_url, AppSettings::default().api_url);
    }

    #[test]
    fn test_save_and_load_roundtrip() {
        let path = temp_dir().join("conveneai-test-roundtrip.json");
        let _ = std::fs::remove_file(&path);

        let settings = AppSettings {
            api_url: "http://192.168.1.50:3000".to_string(),
            hotkey: "Cmd+Shift+A".to_string(),
            last_source: "blackhole".to_string(),
        };

        settings.save(&path).unwrap();
        let loaded = AppSettings::load(&path).unwrap();

        assert_eq!(loaded.api_url, "http://192.168.1.50:3000");
        assert_eq!(loaded.hotkey, "Cmd+Shift+A");
        assert_eq!(loaded.last_source, "blackhole");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_serialize_includes_all_fields() {
        let settings = AppSettings::default();
        let json = serde_json::to_string(&settings).unwrap();
        assert!(json.contains("api_url"));
        assert!(json.contains("hotkey"));
        assert!(json.contains("Option+R"));
    }
}
