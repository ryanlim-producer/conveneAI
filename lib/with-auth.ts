import { NextRequest, NextResponse } from "next/server";
import { validateSession, SessionUser } from "./auth";

export const AUTH_COOKIE = "asisvoz-auth";

export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

type AuthedHandler<P = Record<string, string>> = (
  req: NextRequest,
  ctx: { user: SessionUser; params?: P },
) => Promise<NextResponse>;

export function withAuth<P = Record<string, string>>(handler: AuthedHandler<P>) {
  return async (
    req: NextRequest,
    routeCtx?: { params: Promise<P> },
  ): Promise<NextResponse> => {
    const token = req.cookies.get(AUTH_COOKIE)?.value;
    const user = token ? validateSession(token) : null;
    if (!user) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    try {
      const params = routeCtx ? await routeCtx.params : undefined;
      return await handler(req, { user, params });
    } catch (error) {
      console.error("API handler error:", error);
      return NextResponse.json({ error: "Internal server error." }, { status: 500 });
    }
  };
}
