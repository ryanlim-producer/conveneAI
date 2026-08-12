import { requireUser } from "@/lib/require-user";
import { OrganizationsList } from "@/components/organizations-list";

export default async function OrganizationsPage() {
  await requireUser();
  return (
    <div className="p-8">
      <OrganizationsList />
    </div>
  );
}
