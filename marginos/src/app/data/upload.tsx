"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui";

async function handle(res: Response, router: ReturnType<typeof useRouter>, setErr: (s: string | null) => void) {
  const j = await res.json().catch(() => ({}));
  if (res.status === 409 && j.existingId) {
    setErr(j.error);
    return;
  }
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  router.push(`/data/${j.id}`);
}

export function UploadButton({ sourceType, accept }: { sourceType: string; accept: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <input
        ref={input}
        type="file"
        accept={accept}
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusy(true);
          setErr(null);
          const fd = new FormData();
          fd.set("file", f);
          fd.set("sourceType", sourceType);
          try {
            await handle(await fetch("/api/uploads", { method: "POST", body: fd }), router, setErr);
          } catch (x) {
            setErr((x as Error).message);
          } finally {
            setBusy(false);
            if (input.current) input.current.value = "";
          }
        }}
      />
      <Button size="sm" disabled={busy} onClick={() => input.current?.click()}>{busy ? (sourceType === "supplier_invoice" ? "Claude is reading…" : "Parsing…") : "Upload"}</Button>
      {err && <span className="max-w-[240px] text-right text-[11px] text-bad">{err}</span>}
    </div>
  );
}

export function SampleImportButton({ name, done }: { name: string; done: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant={done ? "ghost" : "secondary"}
        disabled={busy || done}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            await handle(await fetch("/api/uploads/sample", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }), router, setErr);
          } catch (x) {
            setErr((x as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {done ? "Uploaded" : busy ? (name.endsWith(".pdf") ? "Claude is reading…" : "Parsing…") : "Upload & review"}
      </Button>
      {err && <span className="max-w-[260px] text-right text-[11px] text-bad">{err}</span>}
    </div>
  );
}
