import { AppHeader } from "@/components/app-header";
import { QueueDashboard } from "@/components/queue-dashboard";

export const metadata = { title: "Queue — AsisVoz" };

export default function QueuePage() {
  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl p-8">
      <AppHeader subtitle="Processing queue — live status of your recordings" />
      <QueueDashboard />
    </div>
  );
}
