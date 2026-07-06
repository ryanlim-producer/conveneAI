use serde::Serialize;
use std::time::{Duration, Instant};

/// The current state of the recorder
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "state")]
pub enum RecordingState {
    /// Not recording, ready to start
    Idle,
    /// Actively capturing audio
    Recording,
    /// Uploading to API / processing result
    Processing,
}

/// Error types for recorder operations
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecorderError {
    /// Cannot start recording — already in Recording state
    AlreadyRecording,
    /// Cannot stop recording — not currently Recording
    NotRecording,
    /// Cannot transition from Processing state
    Processing,
}

/// Manages recording lifecycle state and timing
pub struct Recorder {
    state: RecordingState,
    /// Timestamp when the current recording started
    recording_start: Option<Instant>,
    /// Elapsed duration (frozen when Processing starts)
    frozen_duration: Option<Duration>,
}

impl Recorder {
    /// Create a new recorder in Idle state
    pub fn new() -> Self {
        Self {
            state: RecordingState::Idle,
            recording_start: None,
            frozen_duration: None,
        }
    }

    /// Get the current recording state
    pub fn state(&self) -> &RecordingState {
        &self.state
    }

    /// Start recording. Transitions Idle → Recording.
    pub fn start_recording(&mut self, device_id: &str) -> Result<(), RecorderError> {
        match self.state {
            RecordingState::Idle => {
                let _ = device_id; // Used later for actual device selection
                self.state = RecordingState::Recording;
                self.recording_start = Some(Instant::now());
                self.frozen_duration = None;
                Ok(())
            }
            RecordingState::Recording => Err(RecorderError::AlreadyRecording),
            RecordingState::Processing => Err(RecorderError::Processing),
        }
    }

    /// Stop recording. Transitions Recording → Processing.
    pub fn stop_recording(&mut self) -> Result<Duration, RecorderError> {
        match self.state {
            RecordingState::Recording => {
                let elapsed = self.elapsed_seconds();
                self.frozen_duration = Some(elapsed);
                self.state = RecordingState::Processing;
                Ok(elapsed)
            }
            RecordingState::Idle => Err(RecorderError::NotRecording),
            RecordingState::Processing => Err(RecorderError::Processing),
        }
    }

    /// Mark processing as complete. Transitions Processing → Idle.
    pub fn processing_complete(&mut self) -> Result<(), RecorderError> {
        match self.state {
            RecordingState::Processing => {
                self.state = RecordingState::Idle;
                self.recording_start = None;
                self.frozen_duration = None;
                Ok(())
            }
            RecordingState::Recording => Err(RecorderError::AlreadyRecording),
            RecordingState::Idle => Err(RecorderError::NotRecording),
        }
    }

    /// Get the elapsed recording time as a Duration.
    /// During Recording: live time since start.
    /// During Processing: frozen duration from when stop was called.
    /// During Idle: returns zero duration.
    pub fn elapsed_seconds(&self) -> Duration {
        match self.state {
            RecordingState::Recording => {
                if let Some(start) = self.recording_start {
                    start.elapsed()
                } else {
                    Duration::ZERO
                }
            }
            RecordingState::Processing => self.frozen_duration.unwrap_or(Duration::ZERO),
            RecordingState::Idle => Duration::ZERO,
        }
    }
}

impl Default for Recorder {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_initial_state_is_idle() {
        let recorder = Recorder::new();
        assert_eq!(*recorder.state(), RecordingState::Idle);
    }

    #[test]
    fn test_transition_idle_to_recording() {
        let mut recorder = Recorder::new();
        let result = recorder.start_recording("mic");
        assert!(result.is_ok());
        assert_eq!(*recorder.state(), RecordingState::Recording);
    }

    #[test]
    fn test_transition_recording_to_processing() {
        let mut recorder = Recorder::new();
        recorder.start_recording("mic").unwrap();
        let result = recorder.stop_recording();
        assert!(result.is_ok());
        assert_eq!(*recorder.state(), RecordingState::Processing);
    }

    #[test]
    fn test_transition_processing_to_idle() {
        let mut recorder = Recorder::new();
        recorder.start_recording("mic").unwrap();
        recorder.stop_recording().unwrap();
        let result = recorder.processing_complete();
        assert!(result.is_ok());
        assert_eq!(*recorder.state(), RecordingState::Idle);
    }

    #[test]
    fn test_cannot_start_while_recording() {
        let mut recorder = Recorder::new();
        recorder.start_recording("mic").unwrap();
        let result = recorder.start_recording("blackhole");
        assert_eq!(result, Err(RecorderError::AlreadyRecording));
    }

    #[test]
    fn test_cannot_start_while_processing() {
        let mut recorder = Recorder::new();
        recorder.start_recording("mic").unwrap();
        recorder.stop_recording().unwrap();
        let result = recorder.start_recording("mic");
        assert_eq!(result, Err(RecorderError::Processing));
    }

    #[test]
    fn test_cannot_stop_while_idle() {
        let mut recorder = Recorder::new();
        let result = recorder.stop_recording();
        assert_eq!(result, Err(RecorderError::NotRecording));
    }

    #[test]
    fn test_cannot_stop_while_processing() {
        let mut recorder = Recorder::new();
        recorder.start_recording("mic").unwrap();
        recorder.stop_recording().unwrap();
        let result = recorder.stop_recording();
        assert_eq!(result, Err(RecorderError::Processing));
    }

    #[test]
    fn test_elapsed_zero_when_idle() {
        let recorder = Recorder::new();
        assert_eq!(recorder.elapsed_seconds(), Duration::ZERO);
    }

    #[test]
    fn test_elapsed_greater_than_zero_when_recording() {
        let mut recorder = Recorder::new();
        recorder.start_recording("mic").unwrap();
        // Even a tiny sleep should give non-zero elapsed
        std::thread::sleep(Duration::from_millis(10));
        assert!(recorder.elapsed_seconds() > Duration::ZERO);
    }

    #[test]
    fn test_stop_recording_returns_elapsed_duration() {
        let mut recorder = Recorder::new();
        recorder.start_recording("mic").unwrap();
        std::thread::sleep(Duration::from_millis(50));
        let elapsed = recorder.stop_recording().unwrap();
        assert!(elapsed >= Duration::from_millis(50));
    }

    #[test]
    fn test_elapsed_frozen_while_processing() {
        let mut recorder = Recorder::new();
        recorder.start_recording("mic").unwrap();
        std::thread::sleep(Duration::from_millis(50));
        recorder.stop_recording().unwrap();
        let frozen = recorder.elapsed_seconds();
        // Should keep the same frozen duration
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(recorder.elapsed_seconds(), frozen);
    }

    #[test]
    fn test_full_lifecycle() {
        let mut recorder = Recorder::new();
        assert_eq!(*recorder.state(), RecordingState::Idle);

        recorder.start_recording("blackhole").unwrap();
        assert_eq!(*recorder.state(), RecordingState::Recording);

        recorder.stop_recording().unwrap();
        assert_eq!(*recorder.state(), RecordingState::Processing);

        recorder.processing_complete().unwrap();
        assert_eq!(*recorder.state(), RecordingState::Idle);
    }

    #[test]
    fn test_recording_state_serialize() {
        let idle = RecordingState::Idle;
        let json = serde_json::to_string(&idle).unwrap();
        assert!(json.contains("Idle"));

        let rec = RecordingState::Recording;
        let json = serde_json::to_string(&rec).unwrap();
        assert!(json.contains("Recording"));

        let proc = RecordingState::Processing;
        let json = serde_json::to_string(&proc).unwrap();
        assert!(json.contains("Processing"));
    }
}
