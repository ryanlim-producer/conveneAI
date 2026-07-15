// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecorderUI } from "./RecorderUI";

function defaultProps(overrides = {}) {
  return {
    elapsedSeconds: 10,
    audioLevel: 0.3,
    onStop: vi.fn(),
    volume: 56,
    onVolumeChange: vi.fn(),
    ...overrides,
  };
}

describe("RecorderUI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders recording indicator", () => {
    render(<RecorderUI {...defaultProps()} />);
    expect(screen.getByText("Recording")).toBeDefined();
  });

  it("displays elapsed time in MM:SS format", () => {
    render(<RecorderUI {...defaultProps({ elapsedSeconds: 65, audioLevel: 0.3 })} />);
    expect(screen.getByText("01:05")).toBeDefined();
  });

  it("displays elapsed time under 1 minute", () => {
    render(<RecorderUI {...defaultProps({ elapsedSeconds: 7, audioLevel: 0.3 })} />);
    expect(screen.getByText("00:07")).toBeDefined();
  });

  it("renders audio level bar", () => {
    render(<RecorderUI {...defaultProps({ audioLevel: 0.6 })} />);
    const levelBar = screen.getByTestId("audio-level-bar");
    expect(levelBar).toBeDefined();
  });

  it("renders stop button", () => {
    render(<RecorderUI {...defaultProps()} />);
    const stopBtn = screen.getByRole("button", { name: /stop recording/i });
    expect(stopBtn).toBeDefined();
  });

  it("calls onStop when stop button clicked", async () => {
    const onStop = vi.fn();
    const user = userEvent.setup();
    render(<RecorderUI {...defaultProps({ onStop })} />);

    await user.click(screen.getByRole("button", { name: /stop recording/i }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("renders at 00:00 for zero seconds", () => {
    render(<RecorderUI {...defaultProps({ elapsedSeconds: 0, audioLevel: 0 })} />);
    expect(screen.getByText("00:00")).toBeDefined();
  });
});

describe("RecorderUI no-signal warning", () => {
  it("shows a warning when no signal has been detected", () => {
    render(<RecorderUI {...defaultProps({ elapsedSeconds: 8, audioLevel: 0, noSignal: true })} />);
    expect(screen.getByTestId("no-signal-warning").textContent).toMatch(/no audio detected/i);
  });

  it("shows no warning during a normal recording", () => {
    render(<RecorderUI {...defaultProps({ audioLevel: 0.4 })} />);
    expect(screen.queryByTestId("no-signal-warning")).toBeNull();
  });
});
