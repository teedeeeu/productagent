import { LogOut, ScanSearch } from "lucide-react";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getDataStore } from "@/lib/data";
import { signOutAction } from "@/app/login/actions";

// Always render per request: every page shows the signed-in merchant's live data.
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ds = await getDataStore();
  const store = await ds.getOrCreateStore();
  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <aside className="border-b bg-card md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex flex-col gap-3 p-4 md:gap-6">
          <Link href="/overview" className="flex items-center gap-2 font-semibold">
            <ScanSearch className="size-5" />
            Agent Commerce QA
          </Link>
          <Nav />
        </div>
        <div className="hidden px-4 pb-4 text-xs text-muted-foreground md:block">
          <p className="truncate font-medium text-foreground">{store.name}</p>
          <p className="truncate">{ds.viewer.email}</p>
          {ds.mode === "supabase" && (
            <form action={signOutAction} className="mt-2">
              <Button variant="ghost" size="sm" className="-ml-3">
                <LogOut /> Sign out
              </Button>
            </form>
          )}
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden">
        {ds.mode === "demo" && (
          <Alert role="status" variant="warning" className="rounded-none border-x-0 border-t-0 text-xs">
            Local demo mode: no database is connected, so data is saved on this computer only (<code>.data/demo-db.json</code>).
            Add your Supabase keys to <code>.env.local</code> to enable accounts.
          </Alert>
        )}
        <div className="mx-auto w-full max-w-6xl p-4 md:p-8">{children}</div>
      </main>
    </div>
  );
}
