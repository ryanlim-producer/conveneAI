import type { AudioSource } from "../types";

interface SourceSelectorProps {
  value: AudioSource;
  onChange: (source: AudioSource) => void;
  disabled?: boolean;
}

const SOURCES: { id: AudioSource; icon: string; label: string }[] = [
  { id: "mic", icon: "🎤", label: "Microphone" },
  { id: "blackhole", icon: "🎧", label: "Internal Audio" },
];

/** Persistent-window source toggle — the selected source is used by both the
 *  Record button and the global hotkey. */
export function SourceSelector({ value, onChange, disabled }: SourceSelectorProps) {
  return (
    <div style={{ display: "flex", gap: "8px" }} role="radiogroup" aria-label="Audio source">
      {SOURCES.map((source) => {
        const selected = value === source.id;
        return (
          <button
            key={source.id}
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(source.id)}
            data-testid={`source-${source.id}`}
            style={{
              flex: 1,
              padding: "10px 8px",
              border: selected ? "2px solid #3b82f6" : "1px solid #d1d5db",
              borderRadius: "8px",
              background: selected ? "#eff6ff" : "#f9fafb",
              cursor: disabled ? "default" : "pointer",
              fontSize: "13px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "4px",
              fontWeight: selected ? 600 : 400,
            }}
          >
            <span role="img" aria-label={source.label} style={{ fontSize: "18px" }}>
              {source.icon}
            </span>
            {source.label}
          </button>
        );
      })}
    </div>
  );
}
