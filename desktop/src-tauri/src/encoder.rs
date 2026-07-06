use std::path::Path;

/// Errors that can occur during MP3 encoding
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EncodeError {
    /// The input WAV file doesn't exist
    InputNotFound(String),
    /// ffmpeg is not installed or not found in PATH
    FfmpegNotFound,
    /// ffmpeg ran but returned an error
    EncodeFailed(String),
}

/// Build the ffmpeg arguments for WAV → MP3 encoding at a given bitrate (bps).
/// Returns the argument list as strings (excluding the "ffmpeg" binary name).
pub fn build_ffmpeg_args(input_wav: &str, output_mp3: &str, bitrate_bps: u32) -> Vec<String> {
    vec![
        "-y".to_string(),
        "-i".to_string(),
        input_wav.to_string(),
        "-codec:a".to_string(),
        "libmp3lame".to_string(),
        "-b:a".to_string(),
        format!("{}k", bitrate_bps / 1000),
        output_mp3.to_string(),
    ]
}

/// Check if ffmpeg is available on the system PATH
pub fn ffmpeg_available() -> bool {
    std::process::Command::new("ffmpeg")
        .arg("-version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Encode a WAV file to MP3 using ffmpeg.
/// Returns the path to the output MP3 file on success.
pub fn encode_mp3(input_wav: &str, output_mp3: &str, bitrate_bps: u32) -> Result<String, EncodeError> {
    // Verify input exists
    if !Path::new(input_wav).exists() {
        return Err(EncodeError::InputNotFound(input_wav.to_string()));
    }

    // Verify ffmpeg is available
    if !ffmpeg_available() {
        return Err(EncodeError::FfmpegNotFound);
    }

    let args = build_ffmpeg_args(input_wav, output_mp3, bitrate_bps);
    let output = std::process::Command::new("ffmpeg")
        .args(&args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|_| EncodeError::FfmpegNotFound)?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(EncodeError::EncodeFailed(stderr));
    }

    Ok(output_mp3.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_ffmpeg_args_128kbps() {
        let args = build_ffmpeg_args("/tmp/input.wav", "/tmp/output.mp3", 128_000);
        assert_eq!(args[0], "-y");
        assert_eq!(args[1], "-i");
        assert_eq!(args[2], "/tmp/input.wav");
        assert_eq!(args[3], "-codec:a");
        assert_eq!(args[4], "libmp3lame");
        assert_eq!(args[5], "-b:a");
        assert_eq!(args[6], "128k");
        assert_eq!(args[7], "/tmp/output.mp3");
    }

    #[test]
    fn test_build_ffmpeg_args_256kbps() {
        let args = build_ffmpeg_args("/tmp/in.wav", "/tmp/out.mp3", 256_000);
        assert_eq!(args[6], "256k");
    }

    #[test]
    fn test_build_ffmpeg_args_has_eight_arguments() {
        let args = build_ffmpeg_args("in.wav", "out.mp3", 128_000);
        assert_eq!(args.len(), 8);
    }

    #[test]
    fn test_encode_input_not_found() {
        let result = encode_mp3("/nonexistent/path.wav", "/tmp/out.mp3", 128_000);
        assert!(matches!(result, Err(EncodeError::InputNotFound(_))));
    }

    #[test]
    fn test_encode_error_types_are_different() {
        assert_ne!(
            EncodeError::FfmpegNotFound,
            EncodeError::InputNotFound("test".into())
        );
        assert_ne!(
            EncodeError::EncodeFailed("err".into()),
            EncodeError::FfmpegNotFound
        );
    }
}
