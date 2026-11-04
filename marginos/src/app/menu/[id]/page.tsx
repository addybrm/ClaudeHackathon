import Link from "next/link";
import { notFound } from "next/navigation";
import { getActiveBusiness, resolvePeriodKey } from "@/lib/business";
import { menuItemDetail, type ChannelKind } from "@/lib/finance/engine";
import { period } from "@/lib/finance/period";
import { channelLabel, costSourceLabel, gbp, gbp2, int, pct } from "@/lib/format";
import { Badge, Delta, Empty, PageHeader, Panel } from "@/components/ui";
import { PeriodPicker } from "@/components/shell";
import { PriceScenario } from "./scenario";

export default async function MenuItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const b = await getActiveBusiness();
  if (!b) notFound();
  const { id } = await params;
  const sp = await searchParams;
  const { key, available } = await resolvePeriodKey(b, sp.period);
  if (!key) return <Empty title="No sales data" />;
  const d = await menuItemDetail(b, period(key), id);
  if (!d) notFound();
  const { item, current, previous, lines } = d;
  const rcCur = lines.every((l) => l.cost !== null) && lines.length ? lines.reduce((s, l) => s + (l.cost ?? 0), 0) : null;
  const rcPrev = lines.every((l) => l.previousCost !== null) && lines.length ? lines.reduce((s, l) => s + (l.previousCost ?? 0), 0) : null;
  const chans: ChannelKind[] = ["dine_in", "collection", "delivery"];

  return (
    <>
      <div className="mb-2 text-[12px] text-muted"><Link href={`/menu?period=${key}`} className="hover:text-ink">Menu analysis</Link> / {item.category}</div>
      <PageHeader
        title={item.name}
        description={<>In-house {gbp2(item.priceGross)}{item.deliveryPriceGross !== null && <> · delivery platforms {gbp2(item.deliveryPriceGross)}</>} · VAT inclusive. Packaging {gbp2(item.packagingCost)}{item.packagingIsEstimate && " (estimate)"} on collection and delivery.</>}
        actions={<PeriodPicker value={key} available={available} compareLabel={d.previousPeriod.label} />}
      />

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          <Panel pad={false} title="Recipe costing" subtitle={`Per portion. ${d.previousPeriod.short} → ${d.period.short} unit costs from supplier invoices.`}>
            {lines.length === 0 ? (
              <div className="p-4"><Empty title="No recipe on file">Import a menu &amp; recipes CSV to cost this dish. Until then it is excluded from contribution, never treated as zero cost.</Empty></div>
            ) : (
              <table className="tbl num">
                <thead><tr><th>Ingredient</th><th className="r">Quantity</th><th className="r">Unit cost {d.previousPeriod.short}</th><th className="r">Unit cost {d.period.short}</th><th className="r">Cost / portion</th><th className="r">Change</th><th>Source</th></tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.ingredientId}>
                      <td className="text-ink">{l.name}</td>
                      <td className="r">{l.quantity} {l.unit}</td>
                      <td className="r text-ink-2">{l.previousUnitCost === null ? "—" : `${gbp2(l.previousUnitCost)}/${l.baseUnit}`}</td>
                      <td className="r">{l.unitCost === null ? <span className="text-bad">missing</span> : `${gbp2(l.unitCost)}/${l.baseUnit}`}</td>
                      <td className="r text-ink">{l.cost === null ? "—" : `£${l.cost.toFixed(3)}`}</td>
                      <td className="r">{l.cost !== null && l.previousCost !== null && Math.abs(l.cost - l.previousCost) > 0.0005 ? <span className={l.cost > l.previousCost ? "text-bad" : "text-good"}>{l.cost > l.previousCost ? "+" : "−"}£{Math.abs(l.cost - l.previousCost).toFixed(3)}</span> : <span className="text-faint">—</span>}</td>
                      <td>{l.costSource === "standard_estimate" ? <Badge tone="warn">{costSourceLabel[l.costSource]}</Badge> : l.costSource === "missing" ? <Badge tone="bad">No cost</Badge> : <span className="whitespace-nowrap text-[12px] text-muted">{costSourceLabel[l.costSource]}</span>}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="font-medium text-ink">Recipe cost</td><td /><td /><td />
                    <td className="r font-medium text-ink">{rcCur === null ? "incomplete" : gbp2(rcCur)}</td>
                    <td className="r">{rcCur !== null && rcPrev !== null ? <span className={rcCur > rcPrev ? "text-bad" : "text-good"}>{rcCur >= rcPrev ? "+" : "−"}£{Math.abs(rcCur - rcPrev).toFixed(2)}</span> : "—"}</td>
                    <td className="text-[12px] text-muted">{rcPrev !== null && `was ${gbp2(rcPrev)}`}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </Panel>

          <Panel pad={false} title="Economics by channel" subtitle={`${d.period.label}, per unit sold, ex VAT`}>
            <div className="overflow-x-auto">
              <table className="tbl num">
                <thead><tr><th>Channel</th><th className="r">Units</th><th className="r">Avg price (inc VAT)</th><th className="r">Net revenue</th><th className="r">Ingredients</th><th className="r">Packaging</th><th className="r">Commission</th><th className="r">Discounts</th><th className="r">Contribution</th><th className="r">Margin</th><th className="r">vs {d.previousPeriod.short}</th></tr></thead>
                <tbody>
                  {chans.map((c) => {
                    const l = current.byChannel[c];
                    const p = previous.byChannel[c];
                    if (!l.units && !p.units) return null;
                    const per = (v: number | null) => (v === null || !l.units ? null : v / l.units);
                    return (
                      <tr key={c}>
                        <td className="text-ink">{channelLabel[c]}</td>
                        <td className="r">{int(l.units)}</td>
                        <td className="r">{gbp2(l.avgPriceGross)}</td>
                        <td className="r">{gbp2(per(l.netRevenue))}</td>
                        <td className="r">{gbp2(per(l.foodCost))}</td>
                        <td className="r">{gbp2(per(l.packaging))}</td>
                        <td className="r">{gbp2(per(l.commission))}{l.commissionEstimated > 0 && <Badge tone="warn" className="ml-1">est.</Badge>}</td>
                        <td className="r">{gbp2(per(l.discounts))}</td>
                        <td className="r font-medium text-ink">{gbp2(l.contributionPerUnit)}</td>
                        <td className="r">{pct(l.marginPct)}</td>
                        <td className="r"><Delta value={l.contributionPerUnit !== null && p.contributionPerUnit !== null ? l.contributionPerUnit - p.contributionPerUnit : null} suffix="" dp={2} /></td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td className="font-medium text-ink">All channels</td>
                    <td className="r">{int(current.total.units)}</td><td className="r">{gbp2(current.total.avgPriceGross)}</td><td /><td /><td /><td /><td />
                    <td className="r font-medium text-ink">{gbp2(current.total.contributionPerUnit)}</td>
                    <td className="r">{pct(current.total.marginPct)}</td>
                    <td className="r text-ink">{gbp(current.total.contribution)} total</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-1 2xl:content-start">
          {rcCur !== null ? (
            <PriceScenario periodKey={key} menuItemId={item.id} prices={{ dine_in: item.priceGross, collection: item.priceGross, delivery: item.deliveryPriceGross ?? item.priceGross }} available={chans.filter((c) => current.byChannel[c].units > 0)} />
          ) : (
            <Panel title="Price scenario"><p className="text-[12px] text-muted">Needs a complete recipe cost. A scenario without it would be guesswork.</p></Panel>
          )}
          <Panel title="Ask the investigator">
            <Link href={`/investigator?period=${key}&ask=${encodeURIComponent(`Why did the contribution of ${item.name} change, and what should I do about it?`)}`} className="text-[12px] text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink">
              Why did {item.name}&apos;s contribution change?
            </Link>
          </Panel>
        </div>
      </div>
    </>
  );
}
