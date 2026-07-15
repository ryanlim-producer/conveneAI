import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Login } from "./Login";
import { SourceSelector } from "./components/SourceSelector";
import { RecorderUI } from "./components/RecorderUI";
import { BlackHoleGuide } from "./components/BlackHoleGuide";
import type { AudioSource, AuthStatus, RecorderState, AppSettings } from "./types";

type Banner = { kind: "success" | "error"; text: string } | null;

function App() {
  const [auth, setAuth] = useState<"checking" | "anonymous" | "authenticated">("checking");
  const [apiUrl, setApiUrl] = useState("https://5.223.84.152.sslip.io/conveneai");
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [source, setSource] = useState<AudioSource>("mic");
  const [elapsed, setElapsed] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [banner, setBanner] = useState<Banner>(null);
  const [noSignal, setNoSignal] = useState(false);
  const [namingJobId, setNamingJobId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [showBlackHoleGuide, setShowBlackHoleGuide] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [hotkey, setHotkey] = useState("Option+R");
  const [volume, setVolume] = useState(56);

  // Session check on launch
  useEffect(() => {
    (async () => {
      try {
        const status = await invoke<AuthStatus>("cmd_auth_status");
        setApiUrl(status.api_url);
        setAuth(status.authenticated ? "authenticated" : "anonymous");
        const settings = await invoke<AppSettings>("cmd_get_settings");
        if (["blackhole", "mic", "meeting"].includes(settings.last_source)) {
          setSource(settings.last_source as AudioSource);
        }
        setHotkey(settings.hotkey);
      } catch {
        setAuth("anonymous");
      }
    })();
  }, []);

  // Fetch current output volume from the audio router
  useEffect(() => {
    if (auth !== "authenticated") return;
    (async () => {
      try {
        const v = await invoke<number>("cmd_get_output_volume");
        if (v >= 0) setVolume(Math.round(v * 100));
      } catch { /* audio router may not be installed */ }
    })();
  }, [auth]);

  // Keep the view in sync with the Rust recorder (hotkey/tray can change it)
  useEffect(() => {
    if (auth !== "authenticated") return;
    const sync = async () => {
      try {
        const status = await invoke<{ state: RecorderState; elapsed_seconds: number }>(
          "cmd_get_recorder_state",
        );
        setRecorderState(status.state);
        setElapsed(status.elapsed_seconds);
      } catch {
        // Backend not ready — keep last state
      }
    };
    sync();
    const interval = setInterval(sync, 500);
    return () => clearInterval(interval);
  }, [auth]);

  // Poll the input level while recording; warn after ~5s of flat zero
  useEffect(() => {
    if (recorderState !== "recording") {
      setNoSignal(false);
      return;
    }
    let silentPolls = 0;
    const SILENT_POLLS_FOR_WARNING = 33; // ≈5s at 150ms
    const interval = setInterval(async () => {
      try {
        const level = await invoke<number>("cmd_get_audio_level");
        setAudioLevel(level);
        if (level < 0.005) {
          silentPolls += 1;
          if (silentPolls >= SILENT_POLLS_FOR_WARNING) setNoSignal(true);
        } else {
          silentPolls = 0;
          setNoSignal(false);
        }
      } catch {
        // keep last level
      }
    }, 150);
    return () => clearInterval(interval);
  }, [recorderState]);

  // Upload outcome events from the Rust background task
  useEffect(() => {
    const unlistenDone = listen<string>("upload-complete", (event) => {
      setBanner({ kind: "success", text: "✓ Uploaded — processing on the server" });
      setNamingJobId(event.payload);
      setNameDraft("");
      setTimeout(() => setBanner(null), 6000);
    });
    const unlistenError = listen<string>("upload-error", (event) => {
      setBanner({ kind: "error", text: event.payload });
    });
    return () => {
      unlistenDone.then((fn) => fn());
      unlistenError.then((fn) => fn());
    };
  }, []);

  const handleSourceChange = useCallback(async (next: AudioSource) => {
    setShowBlackHoleGuide(false);
    if (next === "blackhole") {
      const available = await invoke<boolean>("cmd_blackhole_available").catch(() => false);
      if (!available) {
        setShowBlackHoleGuide(true);
        return;
      }
    }
    if (next === "meeting") {
      const available = await invoke<boolean>("cmd_meeting_input_available").catch(() => false);
      if (!available) {
        setBanner({
          kind: "error",
          text:
            "Meeting input device not found. Run desktop/macos-audio-router/install.sh " +
            "once to enable combined mic + internal audio recording.",
        });
        return;
      }
    }
    setSource(next);
    try {
      const settings = await invoke<AppSettings>("cmd_get_settings");
      await invoke("cmd_save_settings", { settings: { ...settings, last_source: next } });
    } catch {
      // persistence is best-effort
    }
  }, []);

  const handleRecord = async () => {
    setBanner(null);
    try {
      await invoke("cmd_start_recording", { source });
      setElapsed(0);
      setAudioLevel(0);
      setRecorderState("recording");
    } catch (err) {
      const message = String(err);
      if (message.includes("AlreadyRecording")) {
        setRecorderState("recording");
        return;
      }
      setBanner({ kind: "error", text: message });
    }
  };

  const handleStop = async () => {
    try {
      await invoke("cmd_stop_recording");
      setRecorderState("processing");
    } catch (err) {
      setBanner({ kind: "error", text: String(err) });
    }
  };

  const saveRecordingName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!namingJobId || !nameDraft.trim()) return;
    try {
      await invoke("cmd_rename_job", { jobId: namingJobId, filename: nameDraft.trim() });
      setBanner({ kind: "success", text: `✓ Named "${nameDraft.trim()}"` });
      setNamingJobId(null);
      setTimeout(() => setBanner(null), 4000);
    } catch (err) {
      setBanner({ kind: "error", text: String(err) });
    }
  };

  const toggleAlwaysOnTop = async () => {
    const next = !alwaysOnTop;
    setAlwaysOnTop(next);
    await invoke("cmd_set_always_on_top", { onTop: next }).catch(() => {});
  };

  const handleVolumeChange = async (v: number) => {
    setVolume(v);
    try { await invoke("cmd_set_output_volume", { volumePct: v }); } catch {}
  };

  if (auth === "checking") {
    return (
      <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af", fontFamily: "system-ui" }}>
        Loading…
      </div>
    );
  }

  if (auth === "anonymous") {
    return <Login defaultApiUrl={apiUrl} onLoggedIn={() => setAuth("authenticated")} />;
  }

  if (showBlackHoleGuide) {
    return (
      <div style={{ fontFamily: "system-ui, sans-serif" }}>
        <BlackHoleGuide />
        <div style={{ textAlign: "center", paddingBottom: "16px" }}>
          <button
            onClick={() => setShowBlackHoleGuide(false)}
            style={{
              padding: "6px 16px",
              border: "1px solid #d1d5db",
              borderRadius: "6px",
              background: "#f9fafb",
              cursor: "pointer",
              fontSize: "12px",
            }}
            data-testid="blackhole-back"
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  if (recorderState === "recording") {
    return (
      <RecorderUI
        elapsedSeconds={elapsed}
        audioLevel={audioLevel}
        onStop={handleStop}
        noSignal={noSignal}
        volume={volume}
        onVolumeChange={handleVolumeChange}
      />
    );
  }

  return (
    <div style={{ padding: "20px", fontFamily: "system-ui, sans-serif" }}>
      <h2 style={{ fontSize: "16px", fontWeight: 700, margin: "0 0 14px", textAlign: "center" }}>
        🎙 conveneAI
      </h2>

      <SourceSelector value={source} onChange={handleSourceChange} disabled={recorderState !== "idle"} />

      <div style={{ marginTop: "16px", textAlign: "center" }}>
        <button
          onClick={handleRecord}
          disabled={recorderState === "processing"}
          data-testid="record-button"
          style={{
            width: "100%",
            padding: "14px",
            border: "none",
            borderRadius: "10px",
            background: recorderState === "processing" ? "#d1d5db" : "#ef4444",
            color: "white",
            fontSize: "15px",
            fontWeight: 700,
            cursor: recorderState === "processing" ? "default" : "pointer",
          }}
        >
          {recorderState === "processing" ? "⚙ Uploading…" : "● Record"}
        </button>
        <p style={{ fontSize: "11px", color: "#9ca3af", marginTop: "8px" }}>
          {hotkey} starts/stops recording from anywhere
        </p>
      </div>

      {namingJobId && (
        <form
          onSubmit={saveRecordingName}
          style={{ marginTop: "12px", display: "flex", gap: "6px" }}
          data-testid="naming-form"
        >
          <input
            autoFocus
            placeholder="Name this recording…"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            style={{
              flex: 1,
              padding: "8px 10px",
              border: "1px solid #d1d5db",
              borderRadius: "8px",
              fontSize: "12px",
            }}
            data-testid="naming-input"
          />
          <button
            type="submit"
            disabled={!nameDraft.trim()}
            style={{
              padding: "8px 12px",
              border: "none",
              borderRadius: "8px",
              background: nameDraft.trim() ? "#3b82f6" : "#d1d5db",
              color: "white",
              fontSize: "12px",
              fontWeight: 600,
              cursor: nameDraft.trim() ? "pointer" : "default",
            }}
            data-testid="naming-save"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setNamingJobId(null)}
            title="Keep the automatic name"
            style={{
              padding: "8px 10px",
              border: "1px solid #d1d5db",
              borderRadius: "8px",
              background: "#f9fafb",
              fontSize: "12px",
              cursor: "pointer",
            }}
            data-testid="naming-skip"
          >
            Skip
          </button>
        </form>
      )}

      {banner && (
        <p
          data-testid={banner.kind === "success" ? "upload-confirmation" : "upload-error"}
          style={{
            marginTop: "12px",
            padding: "8px 10px",
            borderRadius: "8px",
            fontSize: "12px",
            background: banner.kind === "success" ? "#ecfdf5" : "#fef2f2",
            color: banner.kind === "success" ? "#047857" : "#b91c1c",
          }}
        >
          {banner.text}
        </p>
      )}

      <div style={{ marginTop: "16px", borderTop: "1px solid #e5e7eb", paddingTop: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
          <span style={{ fontSize: "11px", color: "#6b7280", minWidth: "36px" }}>🔊</span>
          <input
            type="range"
            min="0"
            max="100"
            value={volume}
            onChange={async (e) => {
              const v = Number(e.target.value);
              setVolume(v);
              try { await invoke("cmd_set_output_volume", { volumePct: v }); } catch {}
            }}
            style={{ flex: 1, accentColor: "#3b82f6" }}
            data-testid="volume-slider"
          />
          <span style={{ fontSize: "11px", color: "#6b7280", minWidth: "28px", textAlign: "right" }}>{volume}%</span>
        </div>
        <label style={{ fontSize: "12px", color: "#6b7280", display: "flex", alignItems: "center", gap: "6px" }}>
          <input
            type="checkbox"
            checked={alwaysOnTop}
            onChange={toggleAlwaysOnTop}
            data-testid="always-on-top"
          />
          Keep window on top
        </label>
      </div>
    </div>
  );
}

export default App;
