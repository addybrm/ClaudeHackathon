import { redirect } from "next/navigation";
import { Suspense } from "react";
import { currentUser } from "@/lib/auth";
import { AuthForm } from "../login/auth-form";
import { AuthShell } from "../login/auth-shell";

export const metadata = { title: "Create account · MarginOS" };

export default async function SignupPage() {
  if (await currentUser()) redirect("/");
  return (
    <AuthShell title="Create your account" lede="Set up your restaurant, then import your first files.">
      <Suspense>
        <AuthForm mode="signup" />
      </Suspense>
    </AuthShell>
  );
}
