"use client";

import { api } from "@/lib/api-path";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, SendHorizonal } from "lucide-react";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export function ChatWindow({ recordingId }: { recordingId: string }) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(api(`/api/chat/${recordingId}`))
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((d) => setMessages(d.messages ?? []))
      .catch(() => setMessages([]));
  }, [recordingId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, waiting]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const message = draft.trim();
    if (!message || waiting) return;

    setError(null);
    setDraft("");
    setMessages((prev) => [
      ...(prev ?? []),
      { id: `local-${Date.now()}`, role: "user", content: message },
    ]);
    setWaiting(true);
    try {
      const res = await fetch(api(`/api/chat/${recordingId}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "The assistant couldn't respond. Try again.");
        return;
      }
      setMessages((prev) => [
        ...(prev ?? []),
        { id: body.messageId, role: "assistant", content: body.reply },
      ]);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setWaiting(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="chat-window">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {messages === null ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading conversation…</p>
        ) : messages.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground" data-testid="chat-empty">
            <p className="text-2xl">💬</p>
            <p className="mt-2 font-medium text-foreground">Ask a question about this meeting</p>
            <p className="mt-1">
              e.g. “What did we decide?” or “Summarize the key points.”
            </p>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                m.role === "user"
                  ? "ml-auto bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
              data-testid={`chat-message-${m.role}`}
            >
              {m.content}
            </div>
          ))
        )}
        {waiting && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="chat-thinking">
            <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
          </div>
        )}
        {error && (
          <p className="text-sm text-destructive" data-testid="chat-error">
            {error}
          </p>
        )}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={send} className="mt-3 flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about this meeting…"
          data-testid="chat-input"
        />
        <Button type="submit" disabled={!draft.trim() || waiting} data-testid="chat-send">
          <SendHorizonal className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
