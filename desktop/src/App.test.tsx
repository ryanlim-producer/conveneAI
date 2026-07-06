// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockInvoke, mockListen } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockListen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mockListen,
}));

import App from "./App";

const DEFAULT_SETTINGS = {
  api_url: "http://localhost:3000",
  hotkey: "Option+R",
  last_source: "mic",
};

function mockBackend(overrides: Record<string, unknown> = {}) {
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd in overrides) {
      const value = overrides[cmd];
      if (value instanceof Error) throw value;
      return value;
    }
    switch (cmd) {
      case "cmd_auth_status":
        return { authenticated: false, api_url: "http://localhost:3000" };
      case "cmd_get_settings":
        return DEFAULT_SETTINGS;
      case "cmd_get_recorder_state":
        return { state: "idle", elapsed_seconds: 0 };
      case "cmd_get_audio_level":
        return 0.2;
      case "cmd_blackhole_available":
        return true;
      default:
        return undefined;
    }
  });
}

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListen.mockResolvedValue(() => {});
  });

  it("shows the login screen when not authenticated", async () => {
    mockBackend();
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId("login-email")).toBeDefined();
    });
  });

  it("shows the record view when already authenticated", async () => {
    mockBackend({ cmd_auth_status: { authenticated: true, api_url: "http://x" } });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId("record-button")).toBeDefined();
    });
    expect(screen.getByTestId("source-mic")).toBeDefined();
    expect(screen.getByTestId("source-blackhole")).toBeDefined();
  });

  it("logs in via cmd_login and transitions to the record view", async () => {
    mockBackend();
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("login-email")).toBeDefined());

    await userEvent.type(screen.getByTestId("login-email"), "alice@example.com");
    await userEvent.type(screen.getByTestId("login-password"), "hunter2secret");
    await userEvent.click(screen.getByTestId("login-submit"));

    expect(mockInvoke).toHaveBeenCalledWith("cmd_login", {
      email: "alice@example.com",
      password: "hunter2secret",
      apiUrl: "http://localhost:3000",
    });
    await waitFor(() => expect(screen.getByTestId("record-button")).toBeDefined());
  });

  it("shows the login error when credentials are rejected", async () => {
    mockBackend({ cmd_login: new Error("Invalid email or password.") });
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("login-email")).toBeDefined());

    await userEvent.type(screen.getByTestId("login-email"), "alice@example.com");
    await userEvent.type(screen.getByTestId("login-password"), "wrong-password");
    await userEvent.click(screen.getByTestId("login-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("login-error").textContent).toContain("Invalid email");
    });
  });

  it("starts recording with the selected source and shows the recorder", async () => {
    mockBackend({ cmd_auth_status: { authenticated: true, api_url: "http://x" } });
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("record-button")).toBeDefined());

    await userEvent.click(screen.getByTestId("record-button"));

    expect(mockInvoke).toHaveBeenCalledWith("cmd_start_recording", { source: "mic" });
    await waitFor(() => {
      expect(screen.getByText("Stop Recording")).toBeDefined();
    });
  });

  it("shows the BlackHole guide when internal audio is picked but unavailable", async () => {
    mockBackend({
      cmd_auth_status: { authenticated: true, api_url: "http://x" },
      cmd_blackhole_available: false,
    });
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("record-button")).toBeDefined());

    await userEvent.click(screen.getByTestId("source-blackhole"));
    await waitFor(() => {
      expect(screen.getByTestId("blackhole-back")).toBeDefined();
    });
  });

  it("stops recording via cmd_stop_recording", async () => {
    mockBackend({
      cmd_auth_status: { authenticated: true, api_url: "http://x" },
      cmd_get_recorder_state: { state: "recording", elapsed_seconds: 12 },
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText("Stop Recording")).toBeDefined());

    await userEvent.click(screen.getByText("Stop Recording"));
    expect(mockInvoke).toHaveBeenCalledWith("cmd_stop_recording");
  });

  it("shows the upload confirmation when the backend reports success", async () => {
    mockBackend({ cmd_auth_status: { authenticated: true, api_url: "http://x" } });

    let uploadCompleteHandler: ((event: { payload: string }) => void) | undefined;
    mockListen.mockImplementation(async (name: string, handler: never) => {
      if (name === "upload-complete") uploadCompleteHandler = handler;
      return () => {};
    });

    render(<App />);
    await waitFor(() => expect(screen.getByTestId("record-button")).toBeDefined());

    uploadCompleteHandler?.({ payload: "job-123" });
    await waitFor(() => {
      expect(screen.getByTestId("upload-confirmation").textContent).toContain("Uploaded");
    });
  });
});
