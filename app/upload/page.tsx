import { AppHeader } from "@/components/app-header";
import { UploadZone } from "@/components/upload-zone";
import { requireUser } from "@/lib/require-user";

export const metadata = { title: "Upload — conveneAI" };

export default async function UploadPage() {
  await requireUser("/upload");
  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl p-8">
      <AppHeader subtitle="Upload an audio file for transcription" />
      <UploadZone />
    </div>
  );
}
