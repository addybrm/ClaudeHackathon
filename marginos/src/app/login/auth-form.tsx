"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signup = mode === "signup";

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        const body = Object.fromEntries(new FormData(e.currentTarget).entries());
        try {
          const r = await fetch(signup ? "/api/auth/signup" : "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error ?? "Something went wrong. Try again.");
          const next = sp.get("next");
          router.push(signup ? "/data" : next && next.startsWith("/") ? next : "/");
          router.refresh();
        } catch (x) {
          setErr((x as Error).message);
          setBusy(false);
        }
      }}
    >
      {signup && (
        <>
          <Field label="Your name" name="name" autoComplete="name" required />
          <Field label="Restaurant name" name="restaurant" autoComplete="organization" required />
        </>
      )}
      <Field label="Work email" name="email" type="email" autoComplete="email" required />
      <Field label="Password" name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} required minLength={signup ? 10 : undefined} hint={signup ? "At least 10 characters" : undefined} />
      {err && <p role="alert" className="rounded-md bg-[var(--bad-bg)] px-3 py-2 text-[13px] text-bad">{err}</p>}
      <button type="submit" disabled={busy} className="h-10 w-full rounded-md bg-ink text-[14px] font-medium text-white hover:bg-[#2b2b2b] disabled:opacity-60">
        {busy ? (signup ? "Creating your account…" : "Signing in…") : signup ? "Create account" : "Sign in"}
      </button>
      <p className="text-center text-[13px] text-muted">
        {signup ? <>Already have an account? <Link href="/login" className="font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">Sign in</Link></> : <>New to MarginOS? <Link href="/signup" className="font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">Create an account</Link></>}
      </p>
    </form>
  );
}

function Field({ label, hint, ...props }: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between text-[13px] font-medium text-ink-2">
        {label}
        {hint && <span className="font-normal text-muted">{hint}</span>}
      </span>
      <input {...props} className="input h-10" />
    </label>
  );
}
