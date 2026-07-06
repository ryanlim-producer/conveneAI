import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_COOKIE = "asisvoz-auth";
const PUBLIC_PAGES = ["/login", "/register"];

// Edge middleware can't hit SQLite, so this only checks cookie presence for
// page navigation UX. Every API route re-validates the token against the DB.
export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // API routes handle their own auth (401 JSON, not redirects)
  if (pathname.startsWith("/api")) {
    return NextResponse.next();
  }

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
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
