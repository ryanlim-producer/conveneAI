import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface LoginProps {
  defaultApiUrl: string;
  onLoggedIn: () => void;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #d1d5db",
  borderRadius: "8px",
  fontSize: "13px",
  boxSizing: "border-box",
};

export function Login({ defaultApiUrl, onLoggedIn }: LoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [apiUrl, setApiUrl] = useState(defaultApiUrl);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await invoke("cmd_login", { email, password, apiUrl });
      onLoggedIn();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: "24px", fontFamily: "system-ui, sans-serif" }}>
      <h2 style={{ fontSize: "18px", fontWeight: 700, margin: "0 0 4px", textAlign: "center" }}>
        🎙 AsisVoz
      </h2>
      <p style={{ fontSize: "12px", color: "#6b7280", margin: "0 0 16px", textAlign: "center" }}>
        Sign in with your AsisVoz account
      </p>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
          style={inputStyle}
          data-testid="login-email"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={inputStyle}
          data-testid="login-password"
        />
        <input
          type="url"
          placeholder="Server URL"
          value={apiUrl}
          onChange={(e) => setApiUrl(e.target.value)}
          required
          style={{ ...inputStyle, fontSize: "12px", color: "#6b7280" }}
          data-testid="login-api-url"
        />
        {error && (
          <p style={{ fontSize: "12px", color: "#ef4444", margin: 0 }} data-testid="login-error">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          style={{
            padding: "10px",
            border: "none",
            borderRadius: "8px",
            background: busy ? "#93c5fd" : "#3b82f6",
            color: "white",
            fontSize: "13px",
            fontWeight: 600,
            cursor: busy ? "default" : "pointer",
          }}
          data-testid="login-submit"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p style={{ fontSize: "11px", color: "#9ca3af", marginTop: "14px", textAlign: "center" }}>
        No account yet? Register in the web UI first.
      </p>
    </div>
  );
}
