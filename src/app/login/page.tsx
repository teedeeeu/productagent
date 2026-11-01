import { ScanSearch } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { isDemoMode, isSupabaseConfigured } from "@/lib/env";
import { signInAction, signUpAction } from "./actions";

export const metadata = { title: "Sign in · Agent Commerce QA" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ mode?: string; error?: string }> }) {
  if (isDemoMode) redirect("/overview");
  if (!isSupabaseConfigured) redirect("/setup");
  const { mode, error } = await searchParams;
  const signup = mode === "signup";

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <ScanSearch className="mx-auto size-8" />
          <h1 className="text-2xl font-semibold tracking-tight">Agent Commerce QA</h1>
          <p className="text-sm text-muted-foreground">
            Find product information that could confuse AI shopping assistants and cost you sales.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{signup ? "Create your account" : "Sign in"}</CardTitle>
            <CardDescription>
              {signup ? "Free while in early access. No credit card." : "Welcome back."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <p className="mb-3 text-sm text-destructive">
                {error === "confirm" ? "That confirmation link is invalid or expired." : "Please sign in again."}
              </p>
            )}
            <ActionForm action={signup ? signUpAction : signInAction} className="space-y-4">
              {signup && (
                <div className="space-y-2">
                  <Label htmlFor="company">Store or company name</Label>
                  <Input id="company" name="company" autoComplete="organization" />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" autoComplete="email" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  minLength={8}
                  autoComplete={signup ? "new-password" : "current-password"}
                  required
                />
              </div>
              <SubmitButton className="w-full" pendingText={signup ? "Creating account…" : "Signing in…"}>
                {signup ? "Create account" : "Sign in"}
              </SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
        <p className="text-center text-sm text-muted-foreground">
          {signup ? "Already have an account? " : "New here? "}
          <Link href={signup ? "/login" : "/login?mode=signup"} className="font-medium text-foreground underline underline-offset-4">
            {signup ? "Sign in" : "Create an account"}
          </Link>
        </p>
      </div>
    </main>
  );
}
