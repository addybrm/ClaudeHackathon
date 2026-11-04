"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "./ui";

export function LoadDemoButton({ label = "Load demo restaurant", variant = "primary" as const, confirmReset = false }: { label?: string; variant?: "primary" | "secondary"; confirmReset?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="inline-flex flex-col items-start gap-1">
      <Button
        variant={variant}
        disabled={busy}
        onClick={async () => {
          if (confirmReset && !window.confirm("Reset the demo restaurant? Imports and investigations made on the demo data will be removed.")) return;
          setBusy(true);
          setErr(null);
          try {
            const r = await fetch("/api/demo", { method: "POST" });
            if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
            router.push("/");
            router.refresh();
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Generating ~6,000 orders…" : label}
      </Button>
      {err && <span className="text-[12px] text-bad">{err}</span>}
    </div>
  );
}

export function CreateWorkspaceForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [platform, setPlatform] = useState("");
  const [rate, setRate] = useState("30");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        const platforms = platform.trim() ? [{ name: platform.trim(), commission_rate: Number(rate) / 100 }] : [];
        const r = await fetch("/api/business", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, location: location || undefined, platforms }) });
        setBusy(false);
        if (!r.ok) return setErr((await r.json().catch(() => ({}))).error ?? "Could not create workspace");
        router.push("/data");
        router.refresh();
      }}
    >
      <Field label="Restaurant name"><input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="e.g. The Quayside Kitchen" /></Field>
      <Field label="Location (optional)"><input value={location} onChange={(e) => setLocation(e.target.value)} className="input" placeholder="Town, UK" /></Field>
      <div className="grid grid-cols-[1fr_110px] gap-2">
        <Field label="Delivery platform (optional)"><input value={platform} onChange={(e) => setPlatform(e.target.value)} className="input" placeholder="Platform name" /></Field>
        <Field label="Commission %"><input type="number" min={0} max={60} step="0.5" value={rate} onChange={(e) => setRate(e.target.value)} className="input" /></Field>
      </div>
      {err && <p className="text-[12px] text-bad">{err}</p>}
      <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create empty workspace"}</Button>
    </form>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] text-muted">{label}</span>
      {children}
    </label>
  );
}
