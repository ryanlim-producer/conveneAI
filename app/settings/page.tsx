import { cookies } from "next/headers";
import { AppHeader } from "@/components/app-header";
import { SettingsForm } from "@/components/settings-form";
import { validateSession } from "@/lib/auth";
import { AUTH_COOKIE } from "@/lib/with-auth";

export const metadata = { title: "Settings — AsisVoz" };

export default async function SettingsPage() {
  const token = (await cookies()).get(AUTH_COOKIE)?.value;
  const user = token ? validateSession(token) : null;

  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl p-8">
      <AppHeader subtitle="API keys, models, and account" />
      <SettingsForm email={user?.email ?? ""} />
    </div>
  );
}
