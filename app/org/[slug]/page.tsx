import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { validateSession } from "@/lib/auth";
import { validateOrgSession, ORG_AUTH_COOKIE } from "@/lib/org-auth";
import { AUTH_COOKIE } from "@/lib/with-auth";
import { OrgGate } from "@/components/org-gate";
import { OrgWorkspace } from "@/components/org-workspace";

export default async function OrgPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = getDb();

  const org = db
    .prepare("SELECT id, name, slug, user_id FROM organizations WHERE slug = ?")
    .get(slug) as { id: string; name: string; slug: string; user_id: string } | undefined;

  if (!org) notFound();

  const cookieStore = await cookies();

  // Check if logged-in user is the owner
  const userToken = cookieStore.get(AUTH_COOKIE)?.value;
  const user = userToken ? validateSession(userToken) : null;
  if (user && user.userId === org.user_id) {
    return <OrgWorkspace orgId={org.id} orgName={org.name} orgSlug={org.slug} isOwner />;
  }

  // Check if has active org session
  const orgToken = cookieStore.get(ORG_AUTH_COOKIE)?.value;
  const member = orgToken ? validateOrgSession(orgToken) : null;
  if (member && member.orgId === org.id) {
    return <OrgWorkspace orgId={org.id} orgName={org.name} orgSlug={org.slug} isOwner={false} memberId={member.memberId} />;
  }

  // Neither — show password gate
  return <OrgGate orgSlug={org.slug} />;
}
