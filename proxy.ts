import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_COOKIE = "asisvoz-auth";
const PUBLIC_PAGES = ["/login", "/register"];

// Edge middleware can't hit SQLite, so this only checks cookie presence for
// page navigation UX. Every API route re-validates the token against the DB.
export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const hasSession = Boolean(request.cookies.get(AUTH_COOKIE)?.value);
  const isPublicPage = PUBLIC_PAGES.some((p) => pathname.startsWith(p));

  if (!hasSession && !isPublicPage) {
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  if (hasSession && isPublicPage) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // API routes are excluded entirely: they handle their own auth (401 JSON,
  // not redirects), and keeping them out of middleware avoids request-body
  // buffering/truncation on large uploads.
  matcher: "/((?!api|_next/static|_next/image|favicon.ico).*)",
};
