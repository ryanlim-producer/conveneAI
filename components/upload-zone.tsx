"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { UploadCloud, FileAudio } from "lucide-react";

const ACCEPTED = ".mp3,.wav,.webm,.ogg,.oga,.m4a,.mp4,audio/*";

const LANGUAGES = [
  { value: "es", label: "Español" },
  { value: "en", label: "English" },
  { value: "pt", label: "Português" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
];

export function UploadZone() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState("es");
  const [uploading, setUploading] = useState(false);

  const pickFile = useCallback((candidate: File | undefined | null) => {
    if (!candidate) return;
    if (!/\.(mp3|wav|webm|ogg|oga|m4a|mp4)$/i.test(candidate.name) && !candidate.type.startsWith("audio/")) {
      toast.error("Please choose an audio file (MP3, WAV, WebM, OGG, M4A).");
      return;
    }
    setFile(candidate);
  }, []);

  async function upload() {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("language", language);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (res.status !== 202) {
        toast.error(body.error || "Upload failed. Please try again.");
        return;
      }
      toast.success("Uploaded — processing queued");
      router.push("/queue");
    } catch {
      toast.error("Could not reach the server. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div
          data-testid="upload-dropzone"
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
            dragOver ? "border-primary bg-accent/40" : "border-muted-foreground/25"
          }`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            pickFile(e.dataTransfer.files?.[0]);
          }}
        >
          {file ? (
            <>
              <FileAudio className="h-10 w-10 text-primary" />
              <p className="mt-3 font-medium">{file.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {(file.size / (1024 * 1024)).toFixed(1)} MB — click to choose a different file
              </p>
            </>
          ) : (
            <>
              <UploadCloud className="h-10 w-10 text-muted-foreground" />
              <p className="mt-3 font-medium">Drag & drop an audio file</p>
              <p className="mt-1 text-xs text-muted-foreground">
                or click to browse — MP3, WAV, WebM, OGG, M4A
              </p>
            </>
          )}
          <input
            ref={inputRef}
            data-testid="upload-input"
            type="file"
            accept={ACCEPTED}
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="language">Audio language</Label>
            <select
              id="language"
              data-testid="language-select"
              className="block h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <Button onClick={upload} disabled={!file || uploading} data-testid="upload-submit">
            {uploading ? "Uploading…" : "Upload & transcribe"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
