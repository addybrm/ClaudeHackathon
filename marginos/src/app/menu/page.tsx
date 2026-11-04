import Link from "next/link";
import { getActiveBusiness, resolvePeriodKey } from "@/lib/business";
import { menuProfitability, type ChannelKind } from "@/lib/finance/engine";
import { period, previousPeriod } from "@/lib/finance/period";
import { channelLabel, gbp, gbp2, int, pct, quadrantLabel } from "@/lib/format";
import { PeriodPicker } from "@/components/shell";
import { Badge, Button, Delta, Empty, PageHeader, Panel, cx } from "@/components/ui";
import { MenuScatter } from "./scatter";

const CHANNELS = ["all", "dine_in", "collection", "delivery"] as const;

export default async function MenuPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const b = await getActiveBusiness();
  if (!b) return <Empty title="No business loaded" action={<Button href="/" variant="primary">Get started</Button>} />;
  const sp = await searchParams;
  const { key, available } = await resolvePeriodKey(b, sp.period);
  if (!key) return <Empty title="No sales data yet" action={<Button href="/data">Open Data Centre</Button>} />;
  const channel = (CHANNELS as readonly string[]).includes(sp.channel ?? "") ? (sp.channel as (typeof CHANNELS)[number]) : "all";
  const sort = sp.sort ?? "total";
  const res = await menuProfitability(b, period(key));
  const prev = previousPeriod(key);
  const line = (i: (typeof res.items)[number]) => (channel === "all" ? i.total : i.byChannel[channel as ChannelKind]);
  let rows = res.items.filter((i) => line(i).units > 0 || channel === "all");
  const cpuChange = (i: (typeof rows)[number]) => (channel === "all" && i.total.contributionPerUnit !== null && i.previous?.contributionPerUnit != null ? i.total.contributionPerUnit - i.previous.contributionPerUnit : null);
  const sorters: Record<string, (a: (typeof rows)[number]) => number> = {
    total: (a) => -(line(a).contribution ?? -Infinity),
    margin: (a) => line(a).marginPct ?? Infinity,
    units: (a) => -line(a).units,
    change: (a) => cpuChange(a) ?? Infinity,
  };
  rows = [...rows].sort((a, z) => (sorters[sort] ?? sorters.total)(a) - (sorters[sort] ?? sorters.total)(z));
  const uncosted = res.items.filter((i) => !i.recipeComplete && i.total.units > 0);
  const declining = res.items.filter((i) => (cpuChange(i) ?? 0) < -0.1).sort((a, z) => (cpuChange(a) ?? 0) - (cpuChange(z) ?? 0));
  const qs = (o: Record<string, string>) => `/menu?${new URLSearchParams({ period: key, channel, sort, ...o }).toString()}`;

  return (
    <>
      <PageHeader
        title="Menu analysis"
        description="Contribution per dish after ingredients, packaging, commission and discounts."
        actions={<PeriodPicker value={key} available={available} compareLabel={prev.label} />}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded border border-line-strong bg-surface p-0.5" role="tablist" aria-label="Channel">
          {CHANNELS.map((c) => (
            <Link key={c} href={qs({ channel: c })} role="tab" aria-selected={c === channel} className={cx("rounded-sm px-3 py-1 text-[12px]", c === channel ? "bg-surface-3 text-ink" : "text-ink-2 hover:text-ink")}>{channelLabel[c]}</Link>
          ))}
        </div>
        {declining.length > 0 && channel === "all" && (
          <p className="text-[12px] text-muted">
            <span className="text-warn">{declining.length} dishes</span> earn less per unit than in {prev.short}, led by{" "}
            <Link href={`/menu/${declining[0].id}?period=${key}`} className="text-ink-2 underline decoration-line-strong underline-offset-2">{declining[0].name}</Link>.
          </p>
        )}
      </div>

      <div className="space-y-5">
        <Panel pad={false} title={`${channelLabel[channel]} · ${res.period.label}`} subtitle="Per unit, ex VAT">
          <div className="overflow-x-auto">
            <table className="tbl num">
              <thead>
                <tr>
                  <th>Dish</th>
                  <th className="r">Avg price</th>
                  <th className="r">Ingredients</th>
                  <th className="r">Packaging</th>
                  <th className="r">Commission</th>
                  <th className="r">Discounts</th>
                  <th className="r"><Link href={qs({ sort: "change" })} className={sort === "change" ? "text-ink" : ""}>Contribution / unit</Link></th>
                  <th className="r"><Link href={qs({ sort: "margin" })} className={sort === "margin" ? "text-ink" : ""}>Margin</Link></th>
                  <th className="r"><Link href={qs({ sort: "units" })} className={sort === "units" ? "text-ink" : ""}>Units</Link></th>
                  <th className="r"><Link href={qs({ sort: "total" })} className={sort === "total" ? "text-ink" : ""}>Total contribution</Link></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => {
                  const l = line(i);
                  const per = (v: number) => (l.units ? v / l.units : null);
                  const ch = cpuChange(i);
                  return (
                    <tr key={i.id} className="row-link">
                      <td className="min-w-[260px]">
                        <Link href={`/menu/${i.id}?period=${key}`} className="block">
                          <span className="text-ink">{i.name}</span>
                          <span className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted">
                            {i.category}
                            {!i.hasRecipe && <Badge tone="bad">no recipe</Badge>}
                            {i.hasRecipe && !i.recipeComplete && <Badge tone="bad" title={i.missingCosts.join(", ")}>missing costs</Badge>}
                            {i.recipeEstimated && <Badge tone="warn" title="Includes an ingredient priced from an estimated standard cost">est. cost</Badge>}
                            {channel === "all" && i.quadrant && <span className="text-faint">· {quadrantLabel[i.quadrant]}</span>}
                          </span>
                        </Link>
                      </td>
                      <td className="r">{gbp2(l.avgPriceGross)}</td>
                      <td className="r">{i.recipeCost === null ? <span className="text-bad">—</span> : gbp2(i.recipeCost)}</td>
                      <td className="r">{channel === "dine_in" ? "—" : gbp2(per(l.packaging))}</td>
                      <td className="r">{gbp2(per(l.commission))}</td>
                      <td className="r">{gbp2(per(l.discounts))}</td>
                      <td className="r">
                        <span className="text-ink">{gbp2(l.contributionPerUnit)}</span>
                        {ch !== null && <span className="ml-1.5 text-[11px]"><Delta value={ch} suffix="" dp={2} /></span>}
                      </td>
                      <td className="r">{pct(l.marginPct)}</td>
                      <td className="r">{int(l.units)}</td>
                      <td className="r text-ink">{gbp(l.contribution)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <Panel title="Volume vs contribution per unit" subtitle={`All channels, ${res.period.short}. Dashed lines: 70% of average units and weighted average contribution (£${res.thresholds.contribution.toFixed(2)}). Amber: contribution per unit down 20%+ on ${prev.short}.`}>
            <MenuScatter
              periodKey={key}
              points={res.items.filter((i) => i.total.contributionPerUnit !== null && i.total.units > 0).map((i) => ({ id: i.id, label: i.name, x: i.total.units, y: i.total.contributionPerUnit as number, highlight: i.previous?.contributionPerUnit ? (cpuChange(i) ?? 0) / i.previous.contributionPerUnit < -0.2 : false }))}
              xThreshold={res.thresholds.volume}
              yThreshold={res.thresholds.contribution}
            />
          </Panel>
          <div className="space-y-5">
          {uncosted.length > 0 && (
            <Panel title="Missing or estimated costs" subtitle="These can't be fully assessed. Nothing is assumed to cost zero.">
              <ul className="space-y-2 text-[12px]">
                {uncosted.map((i) => (
                  <li key={i.id} className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-ink">{i.name}</div>
                      <div className="text-muted">{i.hasRecipe ? `Missing: ${i.missingCosts.join(", ")}` : "No recipe on file"} · {int(i.total.units)} sold, {gbp(i.total.netRevenue)} revenue excluded</div>
                    </div>
                    <Link href="/data" className="shrink-0 text-ink-2 hover:text-ink">Import →</Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          </div>
        </div>
      </div>
    </>
  );
}
