// Client-side fetch()/EventSource/anchor URLs are NOT auto-prefixed by
// Next.js basePath (only next/link and router navigation are), so every
// hand-written URL must go through this helper.
export function api(path: string): string {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;
}
