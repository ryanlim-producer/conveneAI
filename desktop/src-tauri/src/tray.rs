/// Represents the current state of the tray icon
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayState {
    Idle,
    Recording,
    Processing,
}

impl TrayState {
    /// Returns the icon filename for this state (relative to icons directory)
    pub fn icon_path(&self) -> &'static str {
        match self {
            TrayState::Idle => "icons/idle.png",
            TrayState::Recording => "icons/recording.png",
            TrayState::Processing => "icons/processing.png",
        }
    }

    /// Returns the tooltip text for this state
    pub fn tooltip(&self) -> &'static str {
        match self {
            TrayState::Idle => "conveneAI — Ready",
            TrayState::Recording => "conveneAI — Recording…",
            TrayState::Processing => "conveneAI — Processing…",
        }
    }
}

/// Well-known menu item identifiers
pub const MENU_START_RECORDING: &str = "start_recording";
pub const MENU_RECENT: &str = "recent";
pub const MENU_SETTINGS: &str = "settings";
pub const MENU_QUIT: &str = "quit";

/// Returns the list of menu item IDs that should appear in the tray dropdown
pub fn menu_item_ids() -> Vec<&'static str> {
    vec![
        MENU_START_RECORDING,
        MENU_RECENT,
        MENU_SETTINGS,
        MENU_QUIT,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tray_state_idle_icon_path() {
        assert_eq!(TrayState::Idle.icon_path(), "icons/idle.png");
    }

    #[test]
    fn test_tray_state_recording_icon_path() {
        assert_eq!(TrayState::Recording.icon_path(), "icons/recording.png");
    }

    #[test]
    fn test_tray_state_processing_icon_path() {
        assert_eq!(TrayState::Processing.icon_path(), "icons/processing.png");
    }

    #[test]
    fn test_tray_state_equality() {
        assert_eq!(TrayState::Idle, TrayState::Idle);
        assert_ne!(TrayState::Idle, TrayState::Recording);
        assert_ne!(TrayState::Recording, TrayState::Processing);
    }

    #[test]
    fn test_menu_contains_start_recording() {
        let ids = menu_item_ids();
        assert!(ids.contains(&MENU_START_RECORDING));
    }

    #[test]
    fn test_menu_contains_recent() {
        let ids = menu_item_ids();
        assert!(ids.contains(&MENU_RECENT));
    }

    #[test]
    fn test_menu_contains_settings() {
        let ids = menu_item_ids();
        assert!(ids.contains(&MENU_SETTINGS));
    }

    #[test]
    fn test_menu_contains_quit() {
        let ids = menu_item_ids();
        assert!(ids.contains(&MENU_QUIT));
    }

    #[test]
    fn test_menu_has_four_items() {
        assert_eq!(menu_item_ids().len(), 4);
    }

    #[test]
    fn test_idle_tooltip() {
        assert!(TrayState::Idle.tooltip().contains("Ready"));
    }

    #[test]
    fn test_recording_tooltip() {
        assert!(TrayState::Recording.tooltip().contains("Recording"));
    }

    #[test]
    fn test_processing_tooltip() {
        assert!(TrayState::Processing.tooltip().contains("Processing"));
    }
}
