import { cookies } from "next/headers";
import { validateSession } from "@/lib/auth";
import { AUTH_COOKIE } from "@/lib/with-auth";
import { UserNav } from "@/components/user-nav";
import { Separator } from "@/components/ui/separator";

/** Server component: resolves the signed-in user and renders the shared header. */
export async function AppHeader({ subtitle }: { subtitle?: string }) {
  const token = (await cookies()).get(AUTH_COOKIE)?.value;
  const user = token ? validateSession(token) : null;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">🎙 AsisVoz</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {user && <UserNav email={user.email} />}
      </header>
      <Separator className="my-6" />
    </>
  );
}
