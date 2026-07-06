use serde::{Deserialize, Serialize};

/// Hotkey configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HotkeyConfig {
    /// The keyboard shortcut string (e.g., "Ctrl+Shift+R")
    pub shortcut: String,
}

impl Default for HotkeyConfig {
    fn default() -> Self {
        Self {
            shortcut: "Option+R".to_string(),
        }
    }
}

impl HotkeyConfig {
    pub fn new(shortcut: impl Into<String>) -> Self {
        Self {
            shortcut: shortcut.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_hotkey_is_option_r() {
        let config = HotkeyConfig::default();
        assert_eq!(config.shortcut, "Option+R");
    }

    #[test]
    fn test_custom_hotkey_config() {
        let config = HotkeyConfig::new("Cmd+Shift+A");
        assert_eq!(config.shortcut, "Cmd+Shift+A");
    }

    #[test]
    fn test_hotkey_config_serialize() {
        let config = HotkeyConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("Option+R"));
    }

    #[test]
    fn test_hotkey_config_deserialize() {
        let json = r#"{"shortcut":"Cmd+Option+R"}"#;
        let config: HotkeyConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.shortcut, "Cmd+Option+R");
    }
}
