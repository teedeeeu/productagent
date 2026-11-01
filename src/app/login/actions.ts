"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { config, isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const Credentials = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(8, "Use at least 8 characters for your password").max(200),
});

export async function signInAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  if (!isSupabaseConfigured) redirect("/overview");
  const parsed = Credentials.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return {
      ok: false,
      message: /confirm/i.test(error.message)
        ? "Please confirm your email address first — check your inbox."
        : "Email or password is incorrect.",
    };
  }
  redirect("/overview");
}

export async function signUpAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  if (!isSupabaseConfigured) redirect("/overview");
  const parsed = Credentials.extend({ company: z.string().trim().max(200).optional() }).safeParse(
    Object.fromEntries(formData),
  );
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${config.appUrl}/auth/callback`,
      data: { company: parsed.data.company ?? "" },
    },
  });
  if (error) return { ok: false, message: error.message };
  if (data.session) redirect("/overview"); // email confirmation disabled in Supabase
  return { ok: true, message: "Check your inbox and click the confirmation link to finish signing up." };
}

export async function signOutAction() {
  if (isSupabaseConfigured) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
