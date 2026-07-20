import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_COOKIE = "conveneai-auth";
const PUBLIC_PAGES = ["/login", "/register"];

// Org pages handle their own auth (user cookie, org session cookie, or password gate).
// The middleware must let them through regardless of user auth status.
function isOrgPage(pathname: string): boolean {
  return pathname.startsWith("/org/");
}

// Edge middleware can't hit SQLite, so this only checks cookie presence for
// page navigation UX. Every API route re-validates the token against the DB.
export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Org pages are self-contained — they verify user/org auth and show the
  // password gate for unauthenticated visitors.
  if (isOrgPage(pathname)) return NextResponse.next();

  const hasSession = Boolean(request.cookies.get(AUTH_COOKIE)?.value);
  const isPublicPage = PUBLIC_PAGES.some((p) => pathname.startsWith(p));

  if (!hasSession && !isPublicPage) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    if (pathname !== "/") login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  if (hasSession && isPublicPage) {
    const home = request.nextUrl.clone();
    home.pathname = "/";
    home.search = "";
    return NextResponse.redirect(home);
  }

  return NextResponse.next();
}

export const config = {
  // API routes are excluded entirely: they handle their own auth (401 JSON,
  // not redirects), and keeping them out of middleware avoids request-body
  // buffering/truncation on large uploads.
  matcher: "/((?!api|_next/static|_next/image|favicon.ico).*)",
};
