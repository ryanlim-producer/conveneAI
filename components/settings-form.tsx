"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ModelPicker } from "@/components/model-picker";
import { DEEPGRAM_MODELS, LLM_MODELS } from "@/lib/models";
import { KeyRound, Send } from "lucide-react";

interface Settings {
  deepgramModel: string;
  actionsLlmModel: string;
  chatbotLlmModel: string;
}

function KeyField({
  provider,
  label,
  placeholder,
  savedMask,
  onSaved,
}: {
  provider: "deepgram" | "vercel-ai-gateway";
  label: string;
  placeholder: string;
  savedMask?: string;
  onSaved: () => void;
}) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!value.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, key: value.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error || "Could not save the key.");
        return;
      }
      toast.success(`${label} saved`);
      setValue("");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`key-${provider}`}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={`key-${provider}`}
          type="password"
          placeholder={savedMask ? `Saved: ${savedMask} — paste to replace` : placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button onClick={save} disabled={!value.trim() || saving} data-testid={`save-key-${provider}`}>
          {saving ? "Validating…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function TelegramLinkSection() {
  const [linked, setLinked] = useState<boolean | null>(null);
  const [code, setCode] = useState<{ code: string; botUsername: string } | null>(null);

  useEffect(() => {
    fetch("/api/telegram/link-code")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setLinked(d?.linked ?? false))
      .catch(() => setLinked(false));
  }, []);

  async function generate() {
    const res = await fetch("/api/telegram/link-code", { method: "POST" });
    if (res.ok) setCode(await res.json());
    else toast.error("Could not generate a link code.");
  }

  return (
    <div className="space-y-2">
      <p className="text-sm">
        {linked === null ? "Checking…" : linked ? "✅ Telegram linked" : "Not linked yet"}
      </p>
      {code ? (
        <p className="text-sm" data-testid="telegram-code">
          Send <code className="rounded bg-muted px-1.5 py-0.5 font-mono">/link {code.code}</code>{" "}
          to <span className="font-medium">@{code.botUsername}</span> within 15 minutes.
        </p>
      ) : (
        <Button variant="outline" size="sm" onClick={generate} data-testid="telegram-generate">
          <Send className="mr-1 h-4 w-4" />
          {linked ? "Re-link Telegram" : "Link Telegram"}
        </Button>
      )}
    </div>
  );
}

export function SettingsForm({ email }: { email: string }) {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const loadKeys = () =>
    fetch("/api/keys")
      .then((r) => (r.ok ? r.json() : { keys: {} }))
      .then((d) => setKeys(d.keys ?? {}))
      .catch(() => {});

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(setSettings)
      .catch(() => toast.error("Could not load settings."));
    loadKeys();
  }, []);

  async function saveModels() {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (res.ok) toast.success("Model preferences saved");
      else toast.error((await res.json()).error || "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <h2 className="flex items-center gap-2 font-semibold">
            <KeyRound className="h-4 w-4" /> API Keys
          </h2>
          <p className="text-sm text-muted-foreground">
            Bring your own keys — they're validated on save and stored encrypted.
          </p>
          <KeyField
            provider="deepgram"
            label="Deepgram API key"
            placeholder="dg_…"
            savedMask={keys["deepgram"]}
            onSaved={loadKeys}
          />
          <KeyField
            provider="vercel-ai-gateway"
            label="Vercel AI Gateway key"
            placeholder="vck_…"
            savedMask={keys["vercel-ai-gateway"]}
            onSaved={loadKeys}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <h2 className="font-semibold">Models</h2>
          {settings ? (
            <>
              <ModelPicker
                id="deepgram-model"
                label="Transcription model (Deepgram)"
                options={DEEPGRAM_MODELS}
                value={settings.deepgramModel}
                onChange={(v) => setSettings({ ...settings, deepgramModel: v })}
              />
              <ModelPicker
                id="actions-model"
                label="Action items model (LLM)"
                options={LLM_MODELS}
                value={settings.actionsLlmModel}
                onChange={(v) => setSettings({ ...settings, actionsLlmModel: v })}
              />
              <ModelPicker
                id="chatbot-model"
                label="Meeting chatbot model (LLM)"
                options={LLM_MODELS}
                value={settings.chatbotLlmModel}
                onChange={(v) => setSettings({ ...settings, chatbotLlmModel: v })}
              />
              <Button onClick={saveModels} disabled={saving} data-testid="save-models">
                {saving ? "Saving…" : "Save model preferences"}
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <h2 className="font-semibold">Telegram</h2>
          <TelegramLinkSection />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <h2 className="font-semibold">Account</h2>
          <p className="text-sm text-muted-foreground">Signed in as {email}</p>
          <Separator />
          <Button variant="outline" onClick={logout} data-testid="settings-logout">
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
