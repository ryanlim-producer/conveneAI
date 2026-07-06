use cpal::traits::{DeviceTrait, HostTrait};
use serde::Serialize;
use std::sync::{Arc, Mutex};

/// Represents an audio input device available on the system
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AudioDevice {
    /// Unique identifier (device name or CoreAudio UID)
    pub id: String,
    /// Human-readable device name
    pub name: String,
    /// Whether this is a BlackHole virtual audio device
    pub is_blackhole: bool,
    /// Whether this is a microphone (input device that is not BlackHole)
    pub is_mic: bool,
}

impl AudioDevice {
    /// Create a new audio device, auto-detecting BlackHole by name
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        let name_str: String = name.into();
        let is_bh = Self::name_is_blackhole(&name_str);
        Self {
            id: id.into(),
            is_blackhole: is_bh,
            is_mic: !is_bh,
            name: name_str,
        }
    }

    /// Check if a device name matches BlackHole (case-insensitive)
    pub fn name_is_blackhole(name: &str) -> bool {
        name.to_lowercase().contains("blackhole")
    }
}

// ── Audio Level Computation ──

/// Compute RMS (root mean square) level from a buffer of f32 samples.
/// Returns a value in range [0.0, 1.0].
pub fn compute_rms_level(samples: &[f32]) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f64 = samples.iter().map(|s| (*s as f64).powi(2)).sum();
    let rms = (sum_sq / samples.len() as f64).sqrt();
    // Scale: typical speech RMS peaks around 0.1–0.3 on f32 normalized audio.
    // Clamp to [0.0, 1.0] with a reasonable ceiling.
    (rms * 4.0).min(1.0)
}

/// A thread-safe buffer for collecting audio samples during recording
pub struct SampleBuffer {
    samples: Arc<Mutex<Vec<f32>>>,
}

impl SampleBuffer {
    pub fn new() -> Self {
        Self {
            samples: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn push_samples(&self, data: &[f32]) {
        if let Ok(mut guard) = self.samples.lock() {
            guard.extend_from_slice(data);
        }
    }

    pub fn level(&self) -> f64 {
        let guard = self.samples.lock().unwrap();
        // Compute level from the last ~100ms worth of samples (approx 4410 at 44.1kHz)
        let window_size = 4410.min(guard.len());
        if window_size == 0 {
            return 0.0;
        }
        let start = guard.len() - window_size;
        compute_rms_level(&guard[start..])
    }

    pub fn sample_count(&self) -> usize {
        self.samples.lock().unwrap().len()
    }

    pub fn clone_samples(&self) -> Vec<f32> {
        self.samples.lock().unwrap().clone()
    }

    pub fn clear(&self) {
        self.samples.lock().unwrap().clear();
    }

    /// Get reference to inner Arc<Mutex<Vec<f32>>> for use in cpal callbacks
    pub fn inner(&self) -> Arc<Mutex<Vec<f32>>> {
        Arc::clone(&self.samples)
    }
}

impl Default for SampleBuffer {
    fn default() -> Self {
        Self::new()
    }
}

// ── Device Enumeration ──

/// Enumerate available input audio devices using cpal
pub fn enumerate_input_devices() -> Vec<AudioDevice> {
    let mut devices = Vec::new();

    let host = cpal::default_host();
    if let Ok(input_devices) = host.input_devices() {
        for device in input_devices {
            if let Ok(name) = device.name() {
                devices.push(AudioDevice::new(name.clone(), name));
            }
        }
    }

    devices
}

/// Check if any BlackHole device is available
pub fn blackhole_available() -> bool {
    enumerate_input_devices().iter().any(|d| d.is_blackhole)
}

/// Find the first BlackHole device (if any)
pub fn find_blackhole_device() -> Option<AudioDevice> {
    enumerate_input_devices().into_iter().find(|d| d.is_blackhole)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Device tests ──

    #[test]
    fn test_blackhole_detected_by_name() {
        assert!(AudioDevice::name_is_blackhole("BlackHole 2ch"));
        assert!(AudioDevice::name_is_blackhole("blackhole 2ch"));
        assert!(AudioDevice::name_is_blackhole("BLACKHOLE"));
        assert!(AudioDevice::name_is_blackhole("my blackhole device"));
    }

    #[test]
    fn test_microphone_not_detected_as_blackhole() {
        assert!(!AudioDevice::name_is_blackhole("MacBook Pro Microphone"));
        assert!(!AudioDevice::name_is_blackhole("Built-in Microphone"));
        assert!(!AudioDevice::name_is_blackhole("External USB Mic"));
    }

    #[test]
    fn test_audio_device_new_blackhole() {
        let device = AudioDevice::new("bh1", "BlackHole 2ch");
        assert!(device.is_blackhole);
        assert!(!device.is_mic);
        assert_eq!(device.id, "bh1");
    }

    #[test]
    fn test_audio_device_new_mic() {
        let device = AudioDevice::new("mic1", "MacBook Pro Microphone");
        assert!(!device.is_blackhole);
        assert!(device.is_mic);
        assert_eq!(device.name, "MacBook Pro Microphone");
    }

    #[test]
    fn test_audio_device_serialize() {
        let device = AudioDevice::new("bh1", "BlackHole 2ch");
        let json = serde_json::to_string(&device).unwrap();
        assert!(json.contains("BlackHole"));
        assert!(json.contains("\"is_blackhole\":true"));
    }

    // ── RMS level tests ──

    #[test]
    fn test_rms_level_empty_slice() {
        assert_eq!(compute_rms_level(&[]), 0.0);
    }

    #[test]
    fn test_rms_level_silence() {
        let samples = vec![0.0_f32; 4410];
        assert_eq!(compute_rms_level(&samples), 0.0);
    }

    #[test]
    fn test_rms_level_non_zero() {
        let samples = vec![0.25_f32; 4410];
        let level = compute_rms_level(&samples);
        // RMS of 0.25 = 0.25, scaled by 4.0 = 1.0 (clamped)
        assert!(level > 0.0);
        assert!(level <= 1.0);
    }

    #[test]
    fn test_rms_level_clamped_to_one() {
        let samples = vec![1.0_f32; 4410];
        let level = compute_rms_level(&samples);
        // RMS = 1.0, scaled by 4.0 = 4.0, clamped to 1.0
        assert_eq!(level, 1.0);
    }

    #[test]
    fn test_rms_level_increases_with_amplitude() {
        let quiet = vec![0.05_f32; 4410];
        let loud = vec![0.5_f32; 4410];
        assert!(compute_rms_level(&quiet) < compute_rms_level(&loud));
    }

    // ── SampleBuffer tests ──

    #[test]
    fn test_sample_buffer_starts_empty() {
        let buf = SampleBuffer::new();
        assert_eq!(buf.sample_count(), 0);
        assert_eq!(buf.level(), 0.0);
    }

    #[test]
    fn test_sample_buffer_pushes_samples() {
        let buf = SampleBuffer::new();
        buf.push_samples(&[0.1, 0.2, 0.3]);
        assert_eq!(buf.sample_count(), 3);
    }

    #[test]
    fn test_sample_buffer_level_computed() {
        let buf = SampleBuffer::new();
        // Push enough samples to exceed window_size
        let samples = vec![0.25_f32; 5000];
        buf.push_samples(&samples);
        assert!(buf.level() > 0.0);
    }

    #[test]
    fn test_sample_buffer_clone_returns_all_samples() {
        let buf = SampleBuffer::new();
        buf.push_samples(&[1.0, 2.0, 3.0]);
        let cloned = buf.clone_samples();
        assert_eq!(cloned, vec![1.0, 2.0, 3.0]);
    }

    #[test]
    fn test_sample_buffer_clear() {
        let buf = SampleBuffer::new();
        buf.push_samples(&[1.0, 2.0]);
        buf.clear();
        assert_eq!(buf.sample_count(), 0);
    }
}
