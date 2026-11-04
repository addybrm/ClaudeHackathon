"use client";

import { useEffect, useState } from "react";
import { Field } from "@/components/actions";
import { Panel } from "@/components/ui";

type Channel = "dine_in" | "collection" | "delivery";
interface Result {
  ok: boolean;
  reason?: string;
  currentPriceGross: number;
  newPriceGross: number;
  contributionPerUnitBefore: number;
  contributionPerUnitAfter: number;
  unitsBefore: number;
  unitsAfter: number;
  change: number;
  breakEvenDemandChangePct: number | null;
  assumptions: { commissionRate: number; discountRate: number; foodCostPerUnit: number; packagingPerUnit: number };
}

const money = (n: number) => `${n < 0 ? "−" : ""}£${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PriceScenario({ periodKey, menuItemId, prices, available }: { periodKey: string; menuItemId: string; prices: Record<Channel, number>; available: Channel[] }) {
  const [channel, setChannel] = useState<Channel>(available[0] ?? "dine_in");
  const [price, setPrice] = useState((prices[available[0] ?? "dine_in"] + 1).toFixed(2));
  const [demand, setDemand] = useState("0");
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const p = Number(price);
    const dm = Number(demand);
    if (!(p > 0) || !Number.isFinite(dm)) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch("/api/scenario", { method: "POST", signal: ctl.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ period: periodKey, menuItemId, newPriceGross: p, channel, demandChangePct: dm }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        setRes(j);
        setErr(j.ok ? null : j.reason);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setErr((e as Error).message);
      }
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [price, demand, channel, periodKey, menuItemId]);

  return (
    <Panel title="Price scenario" subtitle="Deterministic: uses this dish's recipe cost and the channel's actual commission and discount rates for the month.">
      <div className="grid grid-cols-3 gap-2">
        <Field label="Channel">
          <select className="input" value={channel} onChange={(e) => { const c = e.target.value as Channel; setChannel(c); setPrice((prices[c] + 1).toFixed(2)); }}>
            {available.map((c) => <option key={c} value={c}>{c === "dine_in" ? "Dine-in" : c === "collection" ? "Collection" : "Delivery"}</option>)}
          </select>
        </Field>
        <Field label="New price £"><input className="input num" type="number" step="0.05" min="0.5" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        <Field label="Demand change %"><input className="input num" type="number" step="1" min="-100" max="200" value={demand} onChange={(e) => setDemand(e.target.value)} /></Field>
      </div>
      {err && <p className="mt-3 text-[12px] text-bad">{err}</p>}
      {res?.ok && (
        <div className="num mt-4 space-y-1 text-[12px]">
          <Row k="Price (inc VAT)" a={money(res.currentPriceGross)} b={money(res.newPriceGross)} />
          <Row k="Contribution / unit" a={money(res.contributionPerUnitBefore)} b={money(res.contributionPerUnitAfter)} />
          <Row k="Units per month" a={Math.round(res.unitsBefore).toString()} b={Math.round(res.unitsAfter).toString()} />
          <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2">
            <span className="text-ink-2">Change in monthly contribution</span>
            <span className={`text-[15px] font-semibold ${res.change >= 0 ? "text-good" : "text-bad"}`}>{res.change >= 0 ? "+" : ""}{money(res.change)}</span>
          </div>
          {res.breakEvenDemandChangePct !== null && (
            <p className="pt-1 text-muted">
              {res.breakEvenDemandChangePct < 0
                ? `Break-even: units could fall ${Math.abs(res.breakEvenDemandChangePct).toFixed(1)}% before this price change reduces total contribution.`
                : `Break-even: units would need to rise ${res.breakEvenDemandChangePct.toFixed(1)}% to keep total contribution unchanged.`}
            </p>
          )}
          <p className="pt-1 text-faint">
            Assumes food cost £{res.assumptions.foodCostPerUnit.toFixed(2)}, packaging £{res.assumptions.packagingPerUnit.toFixed(2)}, commission {(res.assumptions.commissionRate * 100).toFixed(1)}%, discounts {(res.assumptions.discountRate * 100).toFixed(1)}% of gross. Demand response is your assumption.
          </p>
        </div>
      )}
    </Panel>
  );
}

function Row({ k, a, b }: { k: string; a: string; b: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3">
      <span className="text-muted">{k}</span>
      <span className="text-right text-ink-2">{a}</span>
      <span className="w-20 text-right text-ink">→ {b}</span>
    </div>
  );
}
