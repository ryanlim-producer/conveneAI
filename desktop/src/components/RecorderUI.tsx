interface RecorderUIProps {
  elapsedSeconds: number;
  audioLevel: number;
  onStop: () => void;
}

function formatTime(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function RecorderUI({ elapsedSeconds, audioLevel, onStop }: RecorderUIProps) {
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
