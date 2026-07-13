import { AppHeader } from "@/components/app-header";
import { SettingsForm } from "@/components/settings-form";
import { requireUser } from "@/lib/require-user";

export const metadata = { title: "Settings — conveneAI" };

export default async function SettingsPage() {
  const user = await requireUser("/settings");

  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl p-8">
      <AppHeader subtitle="API keys, models, and account" />
      <SettingsForm email={user.email} />
    </div>
  );
}
