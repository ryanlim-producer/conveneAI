/// Represents the current state of the tray icon
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayState {
    Idle,
    Recording,
    Processing,
}

/// Returns the emoji for a given audio source.
/// Mic (external) shows a microphone; internal audio (blackhole/meeting)
/// shows headphones so the user can tell at a glance what the hotkey will record.
pub fn source_emoji(source: &str) -> &'static str {
    match source {
        "mic" => "🎙",
        _ => "🎧", // blackhole, meeting → headphone (internal audio)
    }
}

/// Returns the human-readable label for a given audio source.
pub fn source_label(source: &str) -> &'static str {
    match source {
        "mic" => "Microphone",
        "blackhole" => "Internal Audio",
        "meeting" => "Meeting (Mic + Internal)",
        _ => "Audio",
    }
}

/// Builds the tray title emoji by combining state and audio source.
/// Idle → source emoji only; Recording → source emoji + 🔴;
/// Processing → ⚙ (no source dependency).
pub fn format_title(state: TrayState, source: &str) -> String {
    match state {
        TrayState::Idle => source_emoji(source).to_string(),
        TrayState::Recording => format!("{}🔴", source_emoji(source)),
        TrayState::Processing => "⚙".to_string(),
    }
}

/// Builds the tray tooltip by combining state and audio source.
pub fn format_tooltip(state: TrayState, source: &str) -> String {
    let label = source_label(source);
    match state {
        TrayState::Idle => format!("conveneAI — {} (Ready)", label),
        TrayState::Recording => format!("conveneAI — {} (Recording…)", label),
        TrayState::Processing => "conveneAI — Processing…".to_string(),
    }
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

    /// Returns the tooltip text for this state (without source context).
    /// Prefer `format_tooltip(state, source)` for source-aware tooltips.
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

    // ── source_emoji ──

    #[test]
    fn test_source_emoji_mic() {
        assert_eq!(source_emoji("mic"), "🎙");
    }

    #[test]
    fn test_source_emoji_blackhole() {
        assert_eq!(source_emoji("blackhole"), "🎧");
    }

    #[test]
    fn test_source_emoji_meeting() {
        assert_eq!(source_emoji("meeting"), "🎧");
    }

    #[test]
    fn test_source_emoji_unknown_falls_back_to_headphone() {
        assert_eq!(source_emoji("bluetooth"), "🎧");
    }

    // ── source_label ──

    #[test]
    fn test_source_label_mic() {
        assert_eq!(source_label("mic"), "Microphone");
    }

    #[test]
    fn test_source_label_blackhole() {
        assert_eq!(source_label("blackhole"), "Internal Audio");
    }

    #[test]
    fn test_source_label_meeting() {
        assert_eq!(source_label("meeting"), "Meeting (Mic + Internal)");
    }

    // ── format_title ──

    #[test]
    fn test_format_title_idle_mic() {
        assert_eq!(format_title(TrayState::Idle, "mic"), "🎙");
    }

    #[test]
    fn test_format_title_idle_internal() {
        assert_eq!(format_title(TrayState::Idle, "blackhole"), "🎧");
    }

    #[test]
    fn test_format_title_recording_mic() {
        assert_eq!(format_title(TrayState::Recording, "mic"), "🎙🔴");
    }

    #[test]
    fn test_format_title_recording_internal() {
        assert_eq!(format_title(TrayState::Recording, "blackhole"), "🎧🔴");
    }

    #[test]
    fn test_format_title_processing_is_always_gear() {
        assert_eq!(format_title(TrayState::Processing, "mic"), "⚙");
        assert_eq!(format_title(TrayState::Processing, "blackhole"), "⚙");
    }

    // ── format_tooltip ──

    #[test]
    fn test_format_tooltip_idle_includes_source() {
        let tip = format_tooltip(TrayState::Idle, "mic");
        assert!(tip.contains("Ready"));
        assert!(tip.contains("Microphone"));
    }

    #[test]
    fn test_format_tooltip_recording_includes_source() {
        let tip = format_tooltip(TrayState::Recording, "blackhole");
        assert!(tip.contains("Recording"));
        assert!(tip.contains("Internal Audio"));
    }

    #[test]
    fn test_format_tooltip_processing_no_source() {
        let tip = format_tooltip(TrayState::Processing, "mic");
        assert!(tip.contains("Processing"));
        assert!(!tip.contains("Microphone")); // processing doesn't show source
    }
}
