export function BlackHoleGuide() {
  return (
    <div style={{ padding: "16px", fontFamily: "system-ui, sans-serif" }}>
      <h3 style={{ fontSize: "14px", fontWeight: 600, margin: "0 0 8px 0" }}>
        BlackHole Not Detected
      </h3>

      <p style={{ fontSize: "12px", color: "#6b7280", margin: "0 0 12px 0" }}>
        BlackHole is a virtual audio driver needed to capture internal audio (e.g., Zoom calls, system audio).
      </p>

      <div
        style={{
          backgroundColor: "#1f2937",
          color: "#f9fafb",
          padding: "8px 12px",
          borderRadius: "6px",
          fontSize: "12px",
          fontFamily: "monospace",
          marginBottom: "12px",
        }}
      >
        brew install blackhole-2ch
      </div>

      <div style={{ display: "flex", gap: "8px" }}>
        <button
          style={{
            padding: "6px 12px",
            border: "1px solid #d1d5db",
            borderRadius: "6px",
            background: "#f9fafb",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          Open Guide
        </button>
        <button
          style={{
            padding: "6px 12px",
            border: "1px solid #d1d5db",
            borderRadius: "6px",
            background: "#f9fafb",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          Check Again
        </button>
      </div>
    </div>
  );
}
