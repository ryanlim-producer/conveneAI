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
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [source, setSource] = useState<AudioSource>("mic");
  const [elapsed, setElapsed] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [banner, setBanner] = useState<Banner>(null);
  const [showBlackHoleGuide, setShowBlackHoleGuide] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [hotkey, setHotkey] = useState("Option+R");

  // Session check on launch
  useEffect(() => {
    (async () => {
      try {
        const status = await invoke<AuthStatus>("cmd_auth_status");
        setApiUrl(status.api_url);
        setAuth(status.authenticated ? "authenticated" : "anonymous");
        const settings = await invoke<AppSettings>("cmd_get_settings");
        if (settings.last_source === "blackhole" || settings.last_source === "mic") {
          setSource(settings.last_source);
        }
        setHotkey(settings.hotkey);
      } catch {
        setAuth("anonymous");
      }
    })();
  }, []);

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

  // Poll the input level while recording
  useEffect(() => {
    if (recorderState !== "recording") return;
    const interval = setInterval(async () => {
      try {
        setAudioLevel(await invoke<number>("cmd_get_audio_level"));
      } catch {
        // keep last level
      }
    }, 150);
    return () => clearInterval(interval);
  }, [recorderState]);

  // Upload outcome events from the Rust background task
  useEffect(() => {
    const unlistenDone = listen<string>("upload-complete", () => {
      setBanner({ kind: "success", text: "✓ Uploaded — processing on the server" });
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

  const toggleAlwaysOnTop = async () => {
    const next = !alwaysOnTop;
    setAlwaysOnTop(next);
    await invoke("cmd_set_always_on_top", { onTop: next }).catch(() => {});
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
    return <RecorderUI elapsedSeconds={elapsed} audioLevel={audioLevel} onStop={handleStop} />;
  }

  return (
    <div style={{ padding: "20px", fontFamily: "system-ui, sans-serif" }}>
      <h2 style={{ fontSize: "16px", fontWeight: 700, margin: "0 0 14px", textAlign: "center" }}>
        🎙 AsisVoz
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
