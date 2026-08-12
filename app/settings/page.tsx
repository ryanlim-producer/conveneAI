import { SettingsForm } from "@/components/settings-form";
import { requireUser } from "@/lib/require-user";

export const metadata = { title: "Settings — conveneAI" };

export default async function SettingsPage() {
  const user = await requireUser("/settings");

  return (
    <div className="p-8">
      <SettingsForm email={user.email} />
    </div>
  );
}
