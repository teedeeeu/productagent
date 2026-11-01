import "server-only";
import { join } from "node:path";
import { redirect } from "next/navigation";
import { cache } from "react";
import { isDemoMode, isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DemoStore } from "./demo-store";
import { SupabaseStore } from "./supabase-store";
import type { DataStore } from "./types";

let demoStore: DemoStore | undefined;

/**
 * The data access layer for the current request. Verifies the user's session
 * on every call (pages AND server actions), and redirects to /login when the
 * visitor is not signed in.
 */
export const getDataStore = cache(async (): Promise<DataStore> => {
  if (isDemoMode) {
    demoStore ??= new DemoStore(join(process.cwd(), ".data", "demo-db.json"));
    return demoStore;
  }
  if (!isSupabaseConfigured) redirect("/setup");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("organization_id, email")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) redirect("/login?error=profile");

  return new SupabaseStore(supabase, {
    userId,
    organizationId: profile.organization_id as string,
    email: (profile.email as string | null) ?? null,
  });
});
