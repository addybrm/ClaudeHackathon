import { redirect } from "next/navigation";
import { Suspense } from "react";
import { currentUser } from "@/lib/auth";
import { AuthForm } from "./auth-form";
import { AuthShell } from "./auth-shell";

export const metadata = { title: "Sign in · MarginOS" };

export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  return (
    <AuthShell title="Sign in" lede="Welcome back. Sign in to see this month's numbers.">
      <Suspense>
        <AuthForm mode="login" />
      </Suspense>
    </AuthShell>
  );
}
