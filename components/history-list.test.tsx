// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HistoryList } from "@/components/history-list";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const RECORDINGS = [
  {
    id: "rec-1",
    filename: "standup.mp3",
    source: "desktop",
    durationSeconds: 125,
    speakerCount: 3,
    actionItemCount: 2,
    createdAt: "2026-07-02 14:30:00",
  },
  {
    id: "rec-2",
    filename: "cliente.ogg",
    source: "telegram",
    durationSeconds: 45,
    speakerCount: 1,
    actionItemCount: 0,
    createdAt: "2026-07-01 09:00:00",
  },
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("HistoryList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading skeletons initially", () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    render(<HistoryList />);
    expect(screen.getByTestId("history-loading")).toBeDefined();
  });

  it("renders empty state when there are no recordings", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ recordings: [], total: 0 }));
    render(<HistoryList />);
    await waitFor(() => {
      expect(screen.getByText(/No recordings yet/)).toBeDefined();
    });
    expect(screen.getByText(/desktop app or send audio to the Telegram bot/)).toBeDefined();
  });

  it("renders recording rows with metadata and source icons", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ recordings: RECORDINGS, total: 2 }));
    render(<HistoryList />);

    await waitFor(() => {
      expect(screen.getByText("standup.mp3")).toBeDefined();
    });
    expect(screen.getByText("cliente.ogg")).toBeDefined();
    expect(screen.getByText("🎤")).toBeDefined();
    expect(screen.getByText("📱")).toBeDefined();
    expect(screen.getByText(/3 speakers/)).toBeDefined();
    expect(screen.getByText(/2 action items/)).toBeDefined();
    // Duration 125s → 2:05
    expect(screen.getByText(/2:05/)).toBeDefined();
  });

  it("links each row to its detail page", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ recordings: RECORDINGS, total: 2 }));
    render(<HistoryList />);

    await waitFor(() => {
      expect(screen.getByTestId("recording-link-rec-1")).toBeDefined();
    });
    expect(screen.getByTestId("recording-link-rec-1").getAttribute("href")).toBe(
      "/recording/rec-1",
    );
  });

  it("shows error state with retry on server failure", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "DB exploded" }, 500));
    render(<HistoryList />);

    await waitFor(() => {
      expect(screen.getByText(/DB exploded/)).toBeDefined();
    });

    // Retry re-fetches and succeeds
    mockFetch.mockResolvedValueOnce(jsonResponse({ recordings: RECORDINGS, total: 2 }));
    await userEvent.click(screen.getByRole("button", { name: /Retry/ }));
    await waitFor(() => {
      expect(screen.getByText("standup.mp3")).toBeDefined();
    });
  });

  it("deletes a recording and removes it from the list", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ recordings: RECORDINGS, total: 2 }));
    render(<HistoryList />);

    await waitFor(() => {
      expect(screen.getByText("standup.mp3")).toBeDefined();
    });

    mockFetch.mockResolvedValueOnce(jsonResponse({ deleted: true, id: "rec-1" }));
    const deleteButtons = screen.getAllByTitle("Delete recording");
    await userEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(screen.queryByText("standup.mp3")).toBeNull();
    });
    expect(screen.getByText("cliente.ogg")).toBeDefined();
    expect(mockFetch).toHaveBeenCalledWith("/api/history/rec-1", { method: "DELETE" });
  });
});
