use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use crate::audio::find_blackhole_device;

/// Result of a finished capture: interleaved f32 samples plus format info.
pub struct CapturedAudio {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub channels: u16,
}

/// Handle to an in-progress capture. The cpal stream is !Send, so it lives on
/// a dedicated thread; this handle owns the shared buffer and the stop signal.
pub struct CaptureHandle {
    buffer: Arc<Mutex<Vec<f32>>>,
    sample_rate: u32,
    channels: u16,
    stop_flag: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl CaptureHandle {
    /// RMS level of the most recent ~100ms window, range [0.0, 1.0].
    pub fn level(&self) -> f64 {
        let guard = self.buffer.lock().unwrap();
        let window = (self.sample_rate as usize / 10 * self.channels as usize).min(guard.len());
        if window == 0 {
            return 0.0;
        }
        crate::audio::compute_rms_level(&guard[guard.len() - window..])
    }

    /// Stop the stream and collect all captured samples.
    pub fn stop(mut self) -> CapturedAudio {
        self.stop_flag.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        let samples = self.buffer.lock().unwrap().clone();
        CapturedAudio {
            samples,
            sample_rate: self.sample_rate,
            channels: self.channels,
        }
    }
}

/// Start capturing from the requested source ("blackhole" or "mic").
pub fn start_capture(source: &str) -> Result<CaptureHandle, String> {
    let host = cpal::default_host();

    let device = if source == "blackhole" {
        let bh = find_blackhole_device()
            .ok_or_else(|| "BlackHole device not found. Install it with: brew install blackhole-2ch".to_string())?;
        host.input_devices()
            .map_err(|e| format!("Cannot enumerate audio devices: {e}"))?
            .find(|d| d.name().map(|n| n == bh.name).unwrap_or(false))
            .ok_or_else(|| "BlackHole device disappeared".to_string())?
    } else {
        host.default_input_device()
            .ok_or_else(|| "No default microphone found".to_string())?
    };

    let config = device
        .default_input_config()
        .map_err(|e| format!("Cannot read device config: {e}"))?;

    let sample_rate = config.sample_rate().0;
    let channels = config.channels();
    let sample_format = config.sample_format();
    let stream_config: cpal::StreamConfig = config.into();

    let buffer: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
    let stop_flag = Arc::new(AtomicBool::new(false));

    let buffer_for_thread = Arc::clone(&buffer);
    let stop_for_thread = Arc::clone(&stop_flag);

    // The thread reports stream-build success/failure back before we return.
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();

    let thread = std::thread::spawn(move || {
        let buf = buffer_for_thread;
        let err_fn = |e| log::error!("Audio stream error: {e}");

        let stream_result = match sample_format {
            cpal::SampleFormat::F32 => device.build_input_stream(
                &stream_config,
                move |data: &[f32], _| {
                    if let Ok(mut guard) = buf.lock() {
                        guard.extend_from_slice(data);
                    }
                },
                err_fn,
                None,
            ),
            cpal::SampleFormat::I16 => device.build_input_stream(
                &stream_config,
                move |data: &[i16], _| {
                    if let Ok(mut guard) = buf.lock() {
                        guard.extend(data.iter().map(|s| *s as f32 / i16::MAX as f32));
                    }
                },
                err_fn,
                None,
            ),
            other => {
                let _ = ready_tx.send(Err(format!("Unsupported sample format: {other}")));
                return;
            }
        };

        let stream = match stream_result {
            Ok(s) => s,
            Err(e) => {
                let _ = ready_tx.send(Err(format!("Cannot open audio stream: {e}")));
                return;
            }
        };

        if let Err(e) = stream.play() {
            let _ = ready_tx.send(Err(format!("Cannot start audio stream: {e}")));
            return;
        }
        let _ = ready_tx.send(Ok(()));

        while !stop_for_thread.load(Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        drop(stream);
    });

    match ready_rx.recv() {
        Ok(Ok(())) => Ok(CaptureHandle {
            buffer,
            sample_rate,
            channels,
            stop_flag,
            thread: Some(thread),
        }),
        Ok(Err(e)) => {
            let _ = thread.join();
            Err(e)
        }
        Err(_) => Err("Audio capture thread died unexpectedly".to_string()),
    }
}

/// Write captured f32 samples as a 16-bit PCM WAV file.
pub fn write_wav(audio: &CapturedAudio, path: &std::path::Path) -> Result<(), String> {
    let spec = hound::WavSpec {
        channels: audio.channels,
        sample_rate: audio.sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer =
        hound::WavWriter::create(path, spec).map_err(|e| format!("Cannot create WAV: {e}"))?;
    for s in &audio.samples {
        let clamped = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        writer
            .write_sample(clamped)
            .map_err(|e| format!("Cannot write WAV sample: {e}"))?;
    }
    writer.finalize().map_err(|e| format!("Cannot finalize WAV: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_write_wav_roundtrip() {
        let audio = CapturedAudio {
            samples: vec![0.0, 0.5, -0.5, 1.0, -1.0],
            sample_rate: 44100,
            channels: 1,
        };
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.wav");
        write_wav(&audio, &path).unwrap();

        let reader = hound::WavReader::open(&path).unwrap();
        let spec = reader.spec();
        assert_eq!(spec.sample_rate, 44100);
        assert_eq!(spec.channels, 1);
        assert_eq!(spec.bits_per_sample, 16);
        assert_eq!(reader.len(), 5);
    }

    #[test]
    fn test_write_wav_clamps_out_of_range() {
        let audio = CapturedAudio {
            samples: vec![2.0, -2.0],
            sample_rate: 48000,
            channels: 1,
        };
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("clamp.wav");
        write_wav(&audio, &path).unwrap();

        let mut reader = hound::WavReader::open(&path).unwrap();
        let samples: Vec<i16> = reader.samples::<i16>().map(|s| s.unwrap()).collect();
        assert_eq!(samples[0], i16::MAX);
        assert_eq!(samples[1], i16::MIN + 1); // -1.0 * MAX = MIN+1
    }

    #[test]
    fn test_start_capture_unknown_blackhole_errors_cleanly() {
        // On machines without BlackHole this returns a helpful error rather
        // than panicking. If BlackHole IS installed, capture starts and we
        // stop it immediately.
        match start_capture("blackhole") {
            Ok(handle) => {
                let audio = handle.stop();
                assert!(audio.sample_rate > 0);
            }
            Err(e) => assert!(e.contains("BlackHole")),
        }
    }
}
