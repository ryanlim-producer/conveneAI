// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SourceSelector } from "./SourceSelector";

describe("SourceSelector", () => {
  it("renders all three sources with the current one selected", () => {
    render(<SourceSelector value="mic" onChange={() => {}} />);

    expect(screen.getByTestId("source-mic").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("source-blackhole").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("source-meeting").getAttribute("aria-checked")).toBe("false");
  });

  it("calls onChange with the picked source", async () => {
    const onChange = vi.fn();
    render(<SourceSelector value="mic" onChange={onChange} />);

    await userEvent.click(screen.getByTestId("source-blackhole"));
    expect(onChange).toHaveBeenCalledWith("blackhole");
  });

  it("does not fire while disabled", async () => {
    const onChange = vi.fn();
    render(<SourceSelector value="mic" onChange={onChange} disabled />);

    await userEvent.click(screen.getByTestId("source-blackhole"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
