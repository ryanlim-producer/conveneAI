interface RecorderUIProps {
  elapsedSeconds: number;
  audioLevel: number;
  onStop: () => void;
  /** Set after several seconds of a flat-zero input level. */
  noSignal?: boolean;
  volume: number;
  onVolumeChange: (v: number) => void;
}

function formatTime(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function RecorderUI({ elapsedSeconds, audioLevel, onStop, noSignal, volume, onVolumeChange }: RecorderUIProps) {
  const levelPercent = Math.round(audioLevel * 100);

  return (
    <div style={{ padding: "16px", fontFamily: "system-ui, sans-serif" }}>
      {/* Recording indicator */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          marginBottom: "8px",
        }}
      >
        <span
          style={{
            width: "10px",
            height: "10px",
            borderRadius: "50%",
            backgroundColor: "#ef4444",
            display: "inline-block",
            animation: "pulse 1s ease-in-out infinite",
          }}
        />
        <span style={{ fontSize: "14px", fontWeight: 600, color: "#ef4444" }}>
          Recording
        </span>
      </div>

      {/* Timer */}
      <div
        style={{
          textAlign: "center",
          fontSize: "24px",
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          marginBottom: "8px",
          color: "#1f2937",
        }}
      >
        {formatTime(elapsedSeconds)}
      </div>

      {/* Audio level bar */}
      <div
        style={{
          height: "4px",
          backgroundColor: "#e5e7eb",
          borderRadius: "2px",
          marginBottom: "16px",
          overflow: "hidden",
        }}
        data-testid="audio-level-bar"
      >
        <div
          style={{
            height: "100%",
            width: `${levelPercent}%`,
            backgroundColor: levelPercent > 80 ? "#ef4444" : "#3b82f6",
            transition: "width 100ms ease-out",
            borderRadius: "2px",
          }}
        />
      </div>

      {noSignal && (
        <p
          data-testid="no-signal-warning"
          style={{
            margin: "0 0 12px",
            padding: "8px 10px",
            borderRadius: "8px",
            background: "#fef3c7",
            color: "#92400e",
            fontSize: "12px",
            textAlign: "center",
          }}
        >
          ⚠ No audio detected — check your input source. For Internal Audio, your Mac's
          output must be routed into BlackHole; for your own voice, use Microphone.
        </p>
      )}

      {/* Volume slider */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
        <span style={{ fontSize: "12px", color: "#6b7280" }}>🔊</span>
        <input
          type="range"
          min="0"
          max="100"
          value={volume}
          onChange={(e) => onVolumeChange(Number(e.target.value))}
          style={{ flex: 1, accentColor: "#3b82f6" }}
        />
        <span style={{ fontSize: "11px", color: "#6b7280", minWidth: "28px", textAlign: "right" }}>{volume}%</span>
      </div>

      {/* Stop button */}
      <div style={{ textAlign: "center" }}>
        <button
          onClick={onStop}
          style={{
            padding: "8px 24px",
            border: "none",
            borderRadius: "8px",
            backgroundColor: "#ef4444",
            color: "white",
            fontSize: "14px",
            fontWeight: 600,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span style={{ fontSize: "16px" }}>⏹</span>
          Stop Recording
        </button>
      </div>
    </div>
  );
}
