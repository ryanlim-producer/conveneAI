import { AppHeader } from "@/components/app-header";
import { UploadZone } from "@/components/upload-zone";

export const metadata = { title: "Upload — AsisVoz" };

export default function UploadPage() {
  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl p-8">
      <AppHeader subtitle="Upload an audio file for transcription" />
      <UploadZone />
    </div>
  );
}
