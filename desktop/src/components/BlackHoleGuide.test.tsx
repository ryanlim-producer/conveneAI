// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BlackHoleGuide } from "./BlackHoleGuide";

describe("BlackHoleGuide", () => {
  it("shows BlackHole install instructions", () => {
    render(<BlackHoleGuide />);
    // Use heading role to disambiguate from description text
    expect(screen.getByRole("heading", { name: /blackhole/i })).toBeDefined();
    expect(screen.getByText(/brew install blackhole-2ch/i)).toBeDefined();
  });

  it("has a 'Check Again' button", () => {
    render(<BlackHoleGuide />);
    expect(screen.getByRole("button", { name: /check again/i })).toBeDefined();
  });

  it("has an 'Open Guide' button", () => {
    render(<BlackHoleGuide />);
    expect(screen.getByRole("button", { name: /open guide/i })).toBeDefined();
  });
});
