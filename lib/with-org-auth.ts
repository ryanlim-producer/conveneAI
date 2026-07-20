import { NextRequest, NextResponse } from "next/server";
import { validateOrgSession, ORG_AUTH_COOKIE, type OrgSessionMember } from "./org-auth";
import { validateSession, type SessionUser } from "./auth";
import { AUTH_COOKIE } from "./with-auth";
import { getDb } from "./db";

export interface OrgMemberContext extends OrgSessionMember {
  type: "member";
}

export interface OrgOwnerContext {
  type: "owner";
  userId: string;
  email: string;
  orgId: string;
}

export type OrgContext = OrgMemberContext | OrgOwnerContext;

type OrgAuthedHandler<P = Record<string, string>> = (
  req: NextRequest,
  ctx: { orgContext: OrgContext; params?: P },
) => Promise<NextResponse>;

function getOrgOwner(orgId: string): string | undefined {
  const row = getDb()
    .prepare("SELECT user_id FROM organizations WHERE id = ?")
    .get(orgId) as { user_id: string } | undefined;
  return row?.user_id;
}

export function withOrgAuth<P = Record<string, string>>(
  handler: OrgAuthedHandler<P>,
) {
  return async (
    req: NextRequest,
    routeCtx?: { params: Promise<P> },
  ): Promise<NextResponse> => {
    const params = routeCtx ? await routeCtx.params : ({} as P);
    const orgId = (params as Record<string, string>)?.orgId;

    if (!orgId) {
      return NextResponse.json({ error: "Missing orgId." }, { status: 400 });
    }

    // 1. Check org session cookie
    const orgToken = req.cookies.get(ORG_AUTH_COOKIE)?.value;
    if (orgToken) {
      const member = validateOrgSession(orgToken);
      if (member && member.orgId === orgId) {
        try {
          return await handler(req, {
            orgContext: {
              type: "member",
              memberId: member.memberId,
              orgId: member.orgId,
            },
            params,
          });
        } catch (error) {
          console.error("Org API handler error:", error);
          return NextResponse.json({ error: "Internal server error." }, { status: 500 });
        }
      }
      // Invalid org session or wrong org → fall through to 401
    }

    // 2. Check user auth cookie for ownership
    const userToken = req.cookies.get(AUTH_COOKIE)?.value;
    if (userToken) {
      const user = validateSession(userToken);
      if (user) {
        const ownerUserId = getOrgOwner(orgId);
        if (ownerUserId === user.userId) {
          try {
            return await handler(req, {
              orgContext: {
                type: "owner",
                userId: user.userId,
                email: user.email,
                orgId,
              },
              params,
            });
          } catch (error) {
            console.error("Org API handler error:", error);
            return NextResponse.json({ error: "Internal server error." }, { status: 500 });
          }
        }
        // Authenticated user is not the owner
        return NextResponse.json(
          { error: "You do not have access to this organization." },
          { status: 403 },
        );
      }
    }

    // 3. Neither valid
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  };
}
