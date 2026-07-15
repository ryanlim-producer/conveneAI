// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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
    group: null,
    groupId: null,
    groupName: null,
    createdAt: "2026-07-02 14:30:00",
  },
  {
    id: "rec-2",
    filename: "cliente.ogg",
    source: "telegram",
    durationSeconds: 45,
    speakerCount: 1,
    actionItemCount: 0,
    group: null,
    groupId: null,
    groupName: null,
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
    expect(screen.getByText(/desktop app, upload here, or send audio/)).toBeDefined();
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

    // Open kebab menu
    await userEvent.click(screen.getByTestId("kebab-rec-1"));

    mockFetch.mockResolvedValueOnce(jsonResponse({ deleted: true, id: "rec-1" }));
    const deleteButton = screen.getByTestId("kebab-delete-rec-1");
    await userEvent.click(deleteButton);

    await waitFor(() => {
      expect(screen.queryByText("standup.mp3")).toBeNull();
    });
    expect(screen.getByText("cliente.ogg")).toBeDefined();
    expect(mockFetch).toHaveBeenCalledWith("/api/history/rec-1", { method: "DELETE" });
  });

  it("always shows Ungrouped section header, even when no groups exist", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ recordings: RECORDINGS, total: 2 }));
    render(<HistoryList />);

    await waitFor(() => {
      expect(screen.getByTestId("group-toggle-ungrouped")).toBeDefined();
    });
  });

  it("groups recordings into sections by groupId", async () => {
    const grouped = [
      { ...RECORDINGS[0], groupId: "g1", groupName: "Team", group: "Team" },
      RECORDINGS[1], // ungrouped
    ];
    mockFetch.mockResolvedValueOnce(jsonResponse({ recordings: grouped, total: 2 }));
    render(<HistoryList />);

    await waitFor(() => {
      expect(screen.getByTestId("group-toggle-Team")).toBeDefined();
    });
    expect(screen.getByTestId("group-toggle-ungrouped")).toBeDefined();
  });

  it("renders empty folders from /api/groups as sections", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes("/api/groups")) {
        return Promise.resolve(
          jsonResponse({ groups: [{ id: "g9", name: "Empty Folder", recordingCount: 0 }] }),
        );
      }
      return Promise.resolve(jsonResponse({ recordings: RECORDINGS, total: 2 }));
    });
    render(<HistoryList />);

    await waitFor(() => {
      expect(screen.getByTestId("group-toggle-Empty Folder")).toBeDefined();
    });
    expect(screen.getByText(/drag recordings here/)).toBeDefined();
  });

  it("moves a recording to a folder via drag and drop", async () => {
    const grouped = [
      { ...RECORDINGS[0], groupId: "g1", groupName: "Team", group: "Team" },
      RECORDINGS[1], // ungrouped
    ];
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes("/api/groups")) {
        return Promise.resolve(
          jsonResponse({ groups: [{ id: "g1", name: "Team", recordingCount: 1 }] }),
        );
      }
      if (init?.method === "PATCH") {
        return Promise.resolve(jsonResponse({ updated: true, id: "rec-2" }));
      }
      return Promise.resolve(jsonResponse({ recordings: grouped, total: 2 }));
    });
    render(<HistoryList />);

    await waitFor(() => {
      expect(screen.getByTestId("drag-handle-rec-2")).toBeDefined();
    });

    // jsdom has no layout — point elementFromPoint at the drop section
    const target = screen.getByTestId("drop-section-Team");
    document.elementFromPoint = vi.fn(() => target);

    const handle = screen.getByTestId("drag-handle-rec-2");
    fireEvent.pointerDown(handle, { clientX: 10, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 60, clientY: 200, pointerId: 1 });
    expect(screen.getByTestId("drag-ghost").textContent).toBe("cliente.ogg");
    fireEvent.pointerUp(handle, { clientX: 60, clientY: 200, pointerId: 1 });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/history/rec-2",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ groupId: "g1" }),
        }),
      );
    });
  });

  it("ungroups a recording when dropped on the Ungrouped section", async () => {
    const grouped = [
      { ...RECORDINGS[0], groupId: "g1", groupName: "Team", group: "Team" },
      RECORDINGS[1], // ungrouped — keeps the Ungrouped section rendered
    ];
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes("/api/groups")) {
        return Promise.resolve(
          jsonResponse({ groups: [{ id: "g1", name: "Team", recordingCount: 1 }] }),
        );
      }
      if (init?.method === "PATCH") {
        return Promise.resolve(jsonResponse({ updated: true, id: "rec-1" }));
      }
      return Promise.resolve(jsonResponse({ recordings: grouped, total: 2 }));
    });
    render(<HistoryList />);

    await waitFor(() => {
      expect(screen.getByTestId("drag-handle-rec-1")).toBeDefined();
    });

    const target = screen.getByTestId("drop-section-ungrouped");
    document.elementFromPoint = vi.fn(() => target);

    const handle = screen.getByTestId("drag-handle-rec-1");
    fireEvent.pointerDown(handle, { clientX: 10, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 60, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 60, clientY: 200, pointerId: 1 });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/history/rec-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ groupId: null }),
        }),
      );
    });
  });

  it("does not PATCH when dropped on the section it is already in", async () => {
    const grouped = [{ ...RECORDINGS[0], groupId: "g1", groupName: "Team", group: "Team" }];
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes("/api/groups")) {
        return Promise.resolve(
          jsonResponse({ groups: [{ id: "g1", name: "Team", recordingCount: 1 }] }),
        );
      }
      return Promise.resolve(jsonResponse({ recordings: grouped, total: 1 }));
    });
    render(<HistoryList />);

    await waitFor(() => {
      expect(screen.getByTestId("drag-handle-rec-1")).toBeDefined();
    });

    const target = screen.getByTestId("drop-section-Team");
    document.elementFromPoint = vi.fn(() => target);

    const handle = screen.getByTestId("drag-handle-rec-1");
    fireEvent.pointerDown(handle, { clientX: 10, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 60, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 60, clientY: 200, pointerId: 1 });

    const patchCalls = mockFetch.mock.calls.filter(
      (call) => (call[1] as RequestInit | undefined)?.method === "PATCH",
    );
    expect(patchCalls).toHaveLength(0);
  });

  it("does not start a drag on a plain tap (below movement threshold)", async () => {
    const grouped = [{ ...RECORDINGS[0], groupId: "g1", groupName: "Team", group: "Team" }];
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes("/api/groups")) {
        return Promise.resolve(
          jsonResponse({ groups: [{ id: "g1", name: "Team", recordingCount: 1 }] }),
        );
      }
      return Promise.resolve(jsonResponse({ recordings: grouped, total: 1 }));
    });
    render(<HistoryList />);

    await waitFor(() => {
      expect(screen.getByTestId("drag-handle-rec-1")).toBeDefined();
    });

    document.elementFromPoint = vi.fn(() => screen.getByTestId("drop-section-Team"));

    const handle = screen.getByTestId("drag-handle-rec-1");
    fireEvent.pointerDown(handle, { clientX: 10, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 12, clientY: 101, pointerId: 1 });
    expect(screen.queryByTestId("drag-ghost")).toBeNull();
    fireEvent.pointerUp(handle, { clientX: 12, clientY: 101, pointerId: 1 });

    const patchCalls = mockFetch.mock.calls.filter(
      (call) => (call[1] as RequestInit | undefined)?.method === "PATCH",
    );
    expect(patchCalls).toHaveLength(0);
  });

  it("collapses and expands a group section when clicked", async () => {
    const grouped = [{ ...RECORDINGS[0], groupId: "g1", groupName: "Team" }];
    mockFetch.mockResolvedValueOnce(jsonResponse({ recordings: grouped, total: 1 }));
    render(<HistoryList />);

    await waitFor(() => {
      expect(screen.getByText("standup.mp3")).toBeDefined();
    });

    // Click to collapse
    await userEvent.click(screen.getByTestId("group-toggle-Team"));
    // The recording should now be hidden
    await waitFor(() => {
      expect(screen.queryByText("standup.mp3")).toBeNull();
    });

    // Click to expand
    await userEvent.click(screen.getByTestId("group-toggle-Team"));
    await waitFor(() => {
      expect(screen.getByText("standup.mp3")).toBeDefined();
    });
  });
});
