import { RecordingWorkspace } from "@/components/recording-workspace";
import { requireUser } from "@/lib/require-user";

export default async function RecordingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireUser(`/recording/${id}`);
  return (
    <div className="mx-auto min-h-screen w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <RecordingWorkspace recordingId={id} />
    </div>
  );
}
