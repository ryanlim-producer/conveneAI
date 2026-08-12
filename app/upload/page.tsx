import { UploadZone } from "@/components/upload-zone";
import { requireUser } from "@/lib/require-user";

export const metadata = { title: "Upload — conveneAI" };

export default async function UploadPage() {
  await requireUser("/upload");
  return (
    <div className="p-8">
      <UploadZone />
    </div>
  );
}
