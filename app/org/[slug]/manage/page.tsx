import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { validateSession } from "@/lib/auth";
import { AUTH_COOKIE } from "@/lib/with-auth";
import { OrgManagePanel } from "@/components/org-manage-panel";
import { AppHeader } from "@/components/app-header";

export default async function OrgManagePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = getDb();

  const org = db
    .prepare("SELECT id, name, slug, user_id FROM organizations WHERE slug = ?")
    .get(slug) as { id: string; name: string; slug: string; user_id: string } | undefined;

  if (!org) notFound();

  const cookieStore = await cookies();
  const userToken = cookieStore.get(AUTH_COOKIE)?.value;
  const user = userToken ? validateSession(userToken) : null;

  if (!user || user.userId !== org.user_id) {
    redirect(`/org/${slug}`);
  }

  return (
    <>
      <AppHeader />
      <OrgManagePanel orgId={org.id} orgName={org.name} orgSlug={org.slug} />
    </>
  );
}
