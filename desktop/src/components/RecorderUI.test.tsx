// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecorderUI } from "./RecorderUI";

describe("RecorderUI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders recording indicator", () => {
    render(<RecorderUI elapsedSeconds={42} audioLevel={0.5} onStop={vi.fn()} />);
    expect(screen.getByText("Recording")).toBeDefined();
  });

  it("displays elapsed time in MM:SS format", () => {
    render(<RecorderUI elapsedSeconds={65} audioLevel={0.3} onStop={vi.fn()} />);
    // 65 seconds = 01:05
    expect(screen.getByText("01:05")).toBeDefined();
  });

  it("displays elapsed time under 1 minute", () => {
    render(<RecorderUI elapsedSeconds={7} audioLevel={0.3} onStop={vi.fn()} />);
    expect(screen.getByText("00:07")).toBeDefined();
  });

  it("renders audio level bar", () => {
    render(<RecorderUI elapsedSeconds={10} audioLevel={0.6} onStop={vi.fn()} />);
    const levelBar = screen.getByTestId("audio-level-bar");
    expect(levelBar).toBeDefined();
  });

  it("renders stop button", () => {
    render(<RecorderUI elapsedSeconds={10} audioLevel={0.3} onStop={vi.fn()} />);
    const stopBtn = screen.getByRole("button", { name: /stop recording/i });
    expect(stopBtn).toBeDefined();
  });

  it("calls onStop when stop button clicked", async () => {
    const onStop = vi.fn();
    const user = userEvent.setup();
    render(<RecorderUI elapsedSeconds={10} audioLevel={0.3} onStop={onStop} />);

    await user.click(screen.getByRole("button", { name: /stop recording/i }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("renders at 00:00 for zero seconds", () => {
    render(<RecorderUI elapsedSeconds={0} audioLevel={0} onStop={vi.fn()} />);
    expect(screen.getByText("00:00")).toBeDefined();
  });
});

describe("RecorderUI no-signal warning", () => {
  it("shows a warning when no signal has been detected", () => {
    render(<RecorderUI elapsedSeconds={8} audioLevel={0} onStop={vi.fn()} noSignal />);
    expect(screen.getByTestId("no-signal-warning").textContent).toMatch(/no audio detected/i);
  });

  it("shows no warning during a normal recording", () => {
    render(<RecorderUI elapsedSeconds={8} audioLevel={0.4} onStop={vi.fn()} />);
    expect(screen.queryByTestId("no-signal-warning")).toBeNull();
  });
});
