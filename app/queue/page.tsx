import { AppHeader } from "@/components/app-header";
import { QueueDashboard } from "@/components/queue-dashboard";
import { requireUser } from "@/lib/require-user";

export const metadata = { title: "Queue — conveneAI" };

export default async function QueuePage() {
  await requireUser("/queue");
  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl p-8">
      <AppHeader subtitle="Processing queue — live status of your recordings" />
      <QueueDashboard />
    </div>
  );
}
