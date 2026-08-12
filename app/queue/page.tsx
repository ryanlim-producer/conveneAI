import { QueueDashboard } from "@/components/queue-dashboard";
import { requireUser } from "@/lib/require-user";

export const metadata = { title: "Queue — conveneAI" };

export default async function QueuePage() {
  await requireUser("/queue");
  return (
    <div className="p-8">
      <QueueDashboard />
    </div>
  );
}
