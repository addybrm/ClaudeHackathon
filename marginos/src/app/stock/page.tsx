import Link from "next/link";
import { getActiveBusiness } from "@/lib/business";
import { loadPeriod, wasteSummary } from "@/lib/finance/engine";
import { stockForecast } from "@/lib/finance/operations";
import { addDays, diffDays } from "@/lib/finance/stock";
import { dateLong, dateShort, gbp, qty } from "@/lib/format";
import { Badge, Button, Empty, PageHeader, Panel, Stat, StatRow, cx } from "@/components/ui";

export default async function StockPage() {
  const b = await getActiveBusiness();
  if (!b) return <Empty title="No business loaded" action={<Button href="/" variant="primary">Get started</Button>} />;
  const s = await stockForecast(b);
  if (!s) return <Empty title="No sales data yet" action={<Button href="/data">Open Data Centre</Button>}>Daily usage comes from recipes × sales, so import a POS export first.</Empty>;
  const win = { key: "w", label: "30 days", short: "30d", start: addDays(s.asOf, -29), end: addDays(s.asOf, 1), days: 30 };
  const recorded = await wasteSummary(await loadPeriod(b, win));
  const shown = s.rows.filter((r) => r.onHand > 0.001 || r.expiredLast30Value > 0.5);

  return (
    <>
      <PageHeader
        title="Stock & expiry"
        description={<>What&apos;s likely in the kitchen as of <span className="text-ink-2">{dateLong(s.asOf)}</span> (the latest sales day), and what is likely to go off before it&apos;s used. Modelled from deliveries, use-by dates and recipe usage. This is a prediction, not a stock count.</>}
      />
      <StatRow cols={4}>
        <Stat label="Stock on hand (modelled)" value={gbp(s.totals.stockValue)} sub="at invoice cost" />
        <Stat label="Likely to go to waste" value={gbp(s.totals.atRiskValue)} sub="from stock on hand now" />
        <Stat label="Went off unused, last 30 days" value={gbp(s.totals.expiredLast30Value)} sub={`modelled · you recorded ${gbp(recorded.totalCost)} of waste`} hint="If the model is much higher than recorded waste, waste may be going unrecorded (or usage is under-estimated)." />
        <Stat label="Use-by within 3 days" value={s.totals.expiringIn3Days} sub="ingredients" />
      </StatRow>

      {s.overOrdered.length > 0 && (
        <Panel className="mt-5" title="Deliveries bigger than you can use in time" subtitle="Each usual delivery lasts longer than the product keeps. Smaller, more frequent deliveries would cut waste.">
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {s.overOrdered.slice(0, 6).map((r) => (
              <li key={r.ingredientId} className="rounded border border-line bg-surface-2 p-3 text-[12px]">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] text-ink">{r.ingredient}</span>
                  <span className="num text-bad">{gbp(r.expiredLast30Value + r.atRiskValue)}</span>
                </div>
                <p className="mt-1 text-muted">
                  A usual delivery is <span className="num text-ink-2">{r.typicalDeliveryDays?.toFixed(1)} days</span> of use, but it keeps <span className="num text-ink-2">{r.shelfLifeDays} days</span>. The kitchen uses about <span className="num text-ink-2">{qty(r.dailyUse, r.baseUnit)}</span> a day.
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel className="mt-5" pad={false} title="Stock list" subtitle="First-expiry-first-out. Use a day = recipe usage from the last 28 days of sales. Use-by is printed on the receipt where captured, otherwise delivery date + shelf life.">
        <div className="overflow-x-auto">
          <table className="tbl num">
            <thead>
              <tr><th>Ingredient</th><th>Storage</th><th className="r">In stock</th><th className="r">Use a day</th><th className="r">Days left</th><th>Next use-by</th><th>Latest delivery used in time</th><th className="r">Likely to go to waste</th><th className="r">Went off, 30 days</th></tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const days = r.nextExpiry ? diffDays(r.nextExpiry, s.asOf) : null;
                const used = r.latestDelivery?.pctUsedBeforeExpiry ?? null;
                return (
                  <tr key={r.ingredientId}>
                    <td className="text-ink">{r.ingredient}</td>
                    <td className="text-[12px] text-muted">{r.storage}</td>
                    <td className="r">{qty(r.onHand, r.baseUnit)}</td>
                    <td className="r text-ink-2">{r.dailyUse > 0 ? qty(r.dailyUse, r.baseUnit) : "—"}</td>
                    <td className="r">{r.daysCover === null ? "—" : r.daysCover.toFixed(1)}</td>
                    <td>
                      {r.nextExpiry ? (
                        <span className="inline-flex items-center gap-1.5">
                          {dateShort(r.nextExpiry)}
                          {days !== null && days <= 1 ? <Badge tone="bad">{days <= 0 ? "today" : "tomorrow"}</Badge> : days !== null && days <= 3 ? <Badge tone="warn">{days} days</Badge> : null}
                          {r.latestDelivery?.printedExpiry && <span className="text-[11px] text-faint" title="Use-by date printed on the receipt">printed</span>}
                        </span>
                      ) : <span className="text-faint">—</span>}
                    </td>
                    <td className="min-w-[160px]">
                      {used === null ? "—" : (
                        <div className="flex items-center gap-2" title={`${used}% of the ${dateShort(r.latestDelivery!.date)} delivery is used before ${dateShort(r.latestDelivery!.expiryDate)}`}>
                          <div className="h-1.5 w-20 rounded-sm bg-surface-3"><div className="h-full rounded-sm" style={{ width: `${used}%`, background: used >= 90 ? "var(--good)" : used >= 60 ? "var(--warn)" : "var(--bad)" }} /></div>
                          <span className={cx("text-[12px]", used >= 90 ? "text-good" : used >= 60 ? "text-warn" : "text-bad")}>{used}%</span>
                        </div>
                      )}
                    </td>
                    <td className={cx("r", r.atRiskValue > 0.5 ? "text-bad" : "text-faint")}>{r.atRiskValue > 0.5 ? gbp(r.atRiskValue) : "—"}</td>
                    <td className={cx("r", r.expiredLast30Value > 0.5 ? "text-ink" : "text-faint")}>{r.expiredLast30Value > 0.5 ? gbp(r.expiredLast30Value) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel className="mt-5" title="Where the model can be wrong">
        <ul className="space-y-1.5 text-[12px] text-muted">
          <li>· Usage is an average of the last 28 days. Busier weekends and specials aren&apos;t modelled day by day.</li>
          <li>· Recorded waste isn&apos;t subtracted from stock. Compare the modelled figure with your waste log instead.</li>
          <li>· Shelf lives are typical values per ingredient. Use-by dates printed on receipts are used whenever Claude picked them up.</li>
          <li>· A stock-take would correct the model. <Link href="/investigator?ask=Which%20stock%20is%20likely%20to%20go%20off%20before%20we%20use%20it%3F" className="text-ink-2 underline decoration-line-strong underline-offset-2">Ask the investigator about stock →</Link></li>
        </ul>
        <p className="mt-3 text-[11px] text-faint">Forecast method adapted from the LarderCheck prototype.</p>
      </Panel>
    </>
  );
}
