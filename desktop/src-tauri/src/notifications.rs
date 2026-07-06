use crate::api::UploadResult;

/// Notification title when an upload is accepted by the server.
pub fn build_notification_title() -> String {
    "AsisVoz — Recording Uploaded".to_string()
}

/// Notification body when an upload is accepted: processing happens
/// server-side, so all we confirm here is that the audio is safely queued.
pub fn build_notification_body(result: &UploadResult) -> String {
    format!(
        "Your recording is queued for transcription (job {}). Action items will arrive in the web UI and Telegram.",
        &result.job_id.chars().take(8).collect::<String>()
    )
}

/// Notification body when processing fails.
pub fn build_error_body(error: &str) -> String {
    let preview: String = error.chars().take(120).collect();
    format!("Upload failed: {preview}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> UploadResult {
        UploadResult {
            job_id: "abcdef12-3456".to_string(),
            status: "queued".to_string(),
        }
    }

    #[test]
    fn test_title_mentions_upload() {
        assert!(build_notification_title().contains("Uploaded"));
    }

    #[test]
    fn test_body_includes_short_job_id() {
        let body = build_notification_body(&sample());
        assert!(body.contains("abcdef12"));
        assert!(!body.contains("abcdef12-3456")); // shortened
    }

    #[test]
    fn test_error_body_truncates() {
        let long = "x".repeat(500);
        let body = build_error_body(&long);
        assert!(body.len() < 200);
    }
}
