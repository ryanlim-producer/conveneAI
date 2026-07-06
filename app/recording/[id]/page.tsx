import { RecordingWorkspace } from "@/components/recording-workspace";

export default async function RecordingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="mx-auto min-h-screen w-full max-w-5xl p-8">
      <RecordingWorkspace recordingId={id} />
    </div>
  );
}
