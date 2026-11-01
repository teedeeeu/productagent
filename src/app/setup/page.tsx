import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isDemoMode, isSupabaseConfigured } from "@/lib/env";

export const metadata = { title: "Setup required · Agent Commerce QA" };
export const dynamic = "force-dynamic";

/** Shown in production when the database is not configured yet. */
export default function SetupPage() {
  if (isSupabaseConfigured || isDemoMode) redirect("/overview");
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Database not configured</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in your hosting
            provider&apos;s environment variables, then redeploy. See the README for step-by-step instructions.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
