import { requireUser } from "@/lib/require-user";
import { AppHeader } from "@/components/app-header";
import { OrganizationsList } from "@/components/organizations-list";

export default async function OrganizationsPage() {
  await requireUser();
  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl p-8">
      <AppHeader subtitle="Manage your organizations" />
      <OrganizationsList />
    </div>
  );
}
