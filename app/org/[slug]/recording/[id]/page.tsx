import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { validateSession } from "@/lib/auth";
import { validateOrgSession, ORG_AUTH_COOKIE } from "@/lib/org-auth";
import { AUTH_COOKIE } from "@/lib/with-auth";
import { OrgRecordingWorkspace } from "@/components/org-recording-workspace";

export default async function OrgRecordingPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id: recordingId } = await params;
  const db = getDb();

  const org = db
    .prepare("SELECT id, name, slug, user_id FROM organizations WHERE slug = ?")
    .get(slug) as { id: string; name: string; slug: string; user_id: string } | undefined;

  if (!org) notFound();

  const cookieStore = await cookies();
  let access: "owner" | "member" | null = null;
  let memberId: string | undefined;

  // Check owner
  const userToken = cookieStore.get(AUTH_COOKIE)?.value;
  const user = userToken ? validateSession(userToken) : null;
  if (user && user.userId === org.user_id) {
    access = "owner";
  }

  // Check org member session
  if (!access) {
    const orgToken = cookieStore.get(ORG_AUTH_COOKIE)?.value;
    const member = orgToken ? validateOrgSession(orgToken) : null;
    if (member && member.orgId === org.id) {
      access = "member";
      memberId = member.memberId;
    }
  }

  // Not authorized — redirect to org gate
  if (!access) {
    redirect(`/org/${slug}`);
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <OrgRecordingWorkspace
        orgId={org.id}
        orgSlug={org.slug}
        recordingId={recordingId}
        isOwner={access === "owner"}
        memberId={memberId}
      />
    </div>
  );
}
