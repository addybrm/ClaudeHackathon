import Link from "next/link";
import { getActiveBusiness, resolvePeriodKey } from "@/lib/business";
import { query } from "@/lib/db";
import * as engine from "@/lib/finance/engine";
import { pctChange } from "@/lib/finance/formulas";
import { period, previousPeriod } from "@/lib/finance/period";
import { dateLong, dateTime, gbp, pct, signed } from "@/lib/format";
import { LineCompare, Waterfall } from "@/components/charts";
import { PeriodPicker } from "@/components/shell";
import { Badge, Button, Delta, Empty, PageHeader, Panel, SeverityDot, Stat, StatRow } from "@/components/ui";
import { CreateWorkspaceForm, LoadDemoButton } from "@/components/actions";
import { invoiceChecks, stockForecast } from "@/lib/finance/operations";
import { Wordmark } from "@/components/logo";

export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const b = await getActiveBusiness();
  if (!b) return <Welcome />;
  const sp = await searchParams;
  const { key, available } = await resolvePeriodKey(b, sp.period);
  if (!key) {
    return (
      <>
        <PageHeader title="Overview" description={`${b.name} has no sales data yet.`} />
        <Empty title="Import your first POS export" action={<Button href="/data" variant="primary">Open Data Centre</Button>}>
          Start with a menu &amp; recipes CSV, then a POS sales export. Contribution needs both.
        </Empty>
      </>
    );
  }
  const cur = period(key);
  const prev = previousPeriod(key);
  const [mc, mp] = await Promise.all([engine.loadPeriod(b, cur), engine.loadPeriod(b, prev)]);
  const [sc, spv, dc, dp, inv, baseAlerts, health, recent, billing, stock] = await Promise.all([
    engine.periodSummary(b, cur, mc),
    engine.periodSummary(b, prev, mp),
    engine.dailySeries(b, cur, mc),
    engine.dailySeries(b, prev, mp),
    engine.investigateProfitChange(b, key),
    engine.alerts(b, key),
    engine.dataHealth(b),
    query<{ id: string; question: string; headline: string | null; mode: string; status: string; created_at: string }>(`select id, question, headline, mode, status, created_at::text from investigations where business_id = $1 order by created_at desc limit 5`, [b.id]),
    invoiceChecks(b, cur.start, cur.end),
    stockForecast(b),
  ]);
  const alerts = [...baseAlerts];
  if (billing.summary.atStake > 0) alerts.splice(1, 0, { severity: "warning" as const, title: `${gbp(billing.summary.atStake, 2)} billed above supplier orders`, detail: `${billing.summary.discrepancies} of ${billing.summary.invoices} ${cur.short} invoices differ from the order confirmation. Potentially recoverable as credit.`, href: "/costs" });
  if (stock && stock.overOrdered[0]) {
    const o = stock.overOrdered[0];
    alerts.push({ severity: "warning" as const, title: `${o.ingredient} deliveries outlast their shelf life`, detail: `A usual delivery is ${o.typicalDeliveryDays?.toFixed(1)} days of use but keeps ${o.shelfLifeDays} days. About ${gbp(o.expiredLast30Value)} went off unused in 30 days (modelled).`, href: "/stock" });
  }
  const hasPrev = spv.orders > 0;
  const foodPct = sc.netRevenue ? (sc.foodCost / (sc.netRevenue - sc.revenueWithoutRecipeCost)) * 100 : null;
  const foodPctPrev = spv.netRevenue ? (spv.foodCost / (spv.netRevenue - spv.revenueWithoutRecipeCost)) * 100 : null;
  const labourPct = sc.netRevenue ? (sc.labour.totalCost / sc.netRevenue) * 100 : null;
  const labourPctPrev = spv.netRevenue ? (spv.labour.totalCost / spv.netRevenue) * 100 : null;
  const bridge = inv.contributionBridge.effects.filter((e) => Math.abs(e.impact) >= 1);

  return (
    <>
      <PageHeader
        title="Overview"
        description={<>How {b.name} performed in <span className="text-ink-2">{cur.label}</span>, and what needs your attention. Figures are ex VAT.</>}
        actions={<PeriodPicker value={key} available={available} compareLabel={hasPrev ? prev.label : undefined} />}
      />

      <StatRow>
        <Stat label="Net revenue" value={gbp(sc.netRevenue)} delta={hasPrev && <Delta value={pctChange(sc.netRevenue, spv.netRevenue)} />} sub={`${sc.orders.toLocaleString("en-GB")} orders`} hint="Gross sales less restaurant-funded discounts and refunds, ex VAT" />
        <Stat label="Food cost" value={gbp(sc.foodCost)} delta={hasPrev && <Delta value={foodPct !== null && foodPctPrev !== null ? foodPct - foodPctPrev : null} suffix=" pts" goodWhen="down" />} sub={`${pct(foodPct)} of revenue`} hint="Theoretical: recipe cost × units sold, priced from supplier invoices" />
        <Stat label="Contribution" value={gbp(sc.contribution)} delta={hasPrev && <Delta value={pctChange(sc.contribution, spv.contribution)} />} sub="after food, packaging, commission" hint="Net revenue − food cost − packaging − platform commission. Not net profit." />
        <Stat label="Contribution margin" value={pct(sc.contributionMarginPct)} delta={hasPrev && <Delta value={sc.contributionMarginPct !== null && spv.contributionMarginPct !== null ? sc.contributionMarginPct - spv.contributionMarginPct : null} suffix=" pts" />} sub={hasPrev ? `was ${pct(spv.contributionMarginPct)}` : undefined} />
        <Stat label="Recorded waste" value={sc.waste.records ? gbp(sc.waste.totalCost) : "—"} delta={hasPrev && sc.waste.records > 0 && <Delta value={pctChange(sc.waste.totalCost, spv.waste.totalCost)} goodWhen="down" />} sub={sc.waste.records ? `${sc.waste.records} records` : "no records"} />
        <Stat label="Wage cost" value={sc.labour.records ? gbp(sc.labour.totalCost) : "—"} delta={hasPrev && sc.labour.records > 0 && <Delta value={labourPct !== null && labourPctPrev !== null ? labourPct - labourPctPrev : null} suffix=" pts" goodWhen="down" />} sub={sc.labour.records ? `${pct(labourPct)} of revenue` : "no records"} hint="Hours × hourly rate. Excludes employer NI and pension." />
      </StatRow>

      {sc.revenueWithoutRecipeCost > 0 && (
        <p className="mt-2 text-[12px] text-muted">
          <Badge tone="warn">Incomplete</Badge> {gbp(sc.revenueWithoutRecipeCost)} of net revenue comes from items without a recipe cost and is excluded from contribution and margin. <Link href="/menu" className="text-ink-2 underline decoration-line-strong underline-offset-2">See menu</Link>
        </p>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          {hasPrev && (
            <Panel
              title="What changed in contribution"
              subtitle={`${prev.label} → ${cur.label}. Effects are additive and do not overlap; hover for the basis of each.`}
              actions={<Button href={`/investigator?period=${key}&q=revenue`} size="sm" variant="primary">Investigate why</Button>}
            >
              <Waterfall
                start={inv.contributionBridge.effects.length ? sc.contribution - inv.contributionBridge.totalChange : spv.contribution}
                end={sc.contribution}
                startLabel={prev.short}
                endLabel={cur.short}
                steps={bridge.map((e) => ({ label: e.label, value: e.impact, note: `${e.basis}. Confidence: ${e.confidence}.` }))}
              />
            </Panel>
          )}
          <Panel title="Net revenue by day" subtitle={`Ex VAT, after discounts and refunds${health.sales.latest && health.sales.latest.slice(0, 10) < cur.end && new Date(health.sales.latest).getTime() < Date.parse(cur.end) - 86400000 ? ` · sales imported to ${dateLong(health.sales.latest)}` : ""}`}>
            <LineCompare current={trimToData(dc, health.sales.latest).map((d) => ({ day: d.day, value: d.revenue }))} previous={dp.map((d) => ({ day: d.day, value: d.revenue }))} currentLabel={cur.label} previousLabel={prev.label} />
          </Panel>
          <Panel title="Channels" subtitle="Contribution after discounts, platform commission, packaging and food cost" pad={false} actions={<Link href={`/menu?period=${key}&channel=delivery`} className="text-[12px] text-ink-2 hover:text-ink">Delivery dishes →</Link>}>
            <table className="tbl num">
              <thead>
                <tr><th>Channel</th><th className="r">Orders</th><th className="r">Net revenue</th><th className="r">Discounts</th><th className="r">Commission</th><th className="r">Contribution</th><th className="r">Margin</th><th className="r">vs {prev.short}</th></tr>
              </thead>
              <tbody>
                {inv.channels.current.map((c) => {
                  const p = inv.channels.previous.find((x) => x.channel === c.channel);
                  return (
                    <tr key={c.channel}>
                      <td className="text-ink">{c.channel}{c.commissionEstimated > 0 && <Badge tone="warn" className="ml-2" title="Some orders have no settlement record yet; commission estimated from the contractual rate">est.</Badge>}</td>
                      <td className="r">{c.orders.toLocaleString("en-GB")}</td>
                      <td className="r">{gbp(c.netRevenue)}</td>
                      <td className="r">{gbp(c.discounts)}</td>
                      <td className="r">{c.kind === "delivery" ? gbp(c.commission) : "—"}</td>
                      <td className="r text-ink">{gbp(c.contribution)}</td>
                      <td className="r">{pct(c.marginPct)}</td>
                      <td className="r"><Delta value={c.marginPct !== null && p?.marginPct != null ? c.marginPct - p.marginPct : null} suffix=" pts" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Needs attention" subtitle="Rules over your data, not AI">
            {alerts.length === 0 ? (
              <p className="text-[12px] text-muted">Nothing unusual against {prev.label}.</p>
            ) : (
              <ul className="space-y-3">
                {alerts.map((a, i) => (
                  <li key={i}>
                    <Link href={`${a.href}${a.href.includes("?") ? "&" : "?"}period=${key}`} className="group flex gap-2.5">
                      <SeverityDot severity={a.severity} />
                      <div className="min-w-0">
                        <div className="text-[13px] text-ink group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-2">{a.title}</div>
                        <div className="mt-0.5 text-[12px] text-muted">{a.detail}</div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Recent investigations" actions={<Link href="/investigator" className="text-[12px] text-ink-2 hover:text-ink">Open →</Link>}>
            {recent.length === 0 ? (
              <div className="text-[12px] text-muted">
                No investigations yet. Ask <Link href={`/investigator?period=${key}&q=revenue`} className="text-ink-2 underline decoration-line-strong underline-offset-2">“Revenue increased, so why did my profitability decline?”</Link>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {recent.map((r) => (
                  <li key={r.id} className="py-2 first:pt-0 last:pb-0">
                    <Link href={`/investigator?id=${r.id}`} className="block hover:text-ink">
                      <div className="flex items-center gap-2 text-[12px] text-muted">
                        {dateTime(r.created_at)}
                        <Badge tone={r.mode === "live" ? "good" : "warn"}>{r.mode === "live" ? "Claude" : "Demo mode"}</Badge>
                        {r.status === "failed" && <Badge tone="bad">failed</Badge>}
                      </div>
                      <div className="mt-0.5 truncate text-[13px] text-ink">{r.question}</div>
                      {r.headline && <div className="mt-0.5 line-clamp-2 text-[12px] text-muted">{r.headline}</div>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Data freshness" subtitle="What the figures above are built from" actions={<Link href="/data" className="text-[12px] text-ink-2 hover:text-ink">Data centre →</Link>}>
            <ul className="space-y-2 text-[12px]">
              <Fresh label="POS sales" ok={health.sales.count > 0} detail={health.sales.count ? `${health.sales.count.toLocaleString("en-GB")} orders · latest ${dateLong(health.sales.latest)}` : "none"} />
              <Fresh label="Supplier invoices" ok={health.invoices.count > 0} detail={health.invoices.count ? `${health.invoices.count} invoices · latest ${dateLong(health.invoices.latest)}` : "none"} />
              <Fresh label="Recipes" ok={health.menu.recipes >= health.menu.items && health.menu.items > 0} warn={health.menu.recipes < health.menu.items} detail={`${health.menu.recipes} of ${health.menu.items} menu items costed`} />
              <Fresh label="Delivery settlements" ok={health.delivery.settled >= health.delivery.orders} warn={health.delivery.settled < health.delivery.orders} detail={`${health.delivery.settled.toLocaleString("en-GB")} of ${health.delivery.orders.toLocaleString("en-GB")} delivery orders settled${health.delivery.settled < health.delivery.orders ? " — rest estimated" : ""}`} />
              <Fresh label="Waste log" ok={health.waste.count > 0} detail={health.waste.count ? `${health.waste.count} records · latest ${dateLong(health.waste.latest)}` : "none recorded"} />
              <Fresh label="Supplier order checks" ok={billing.summary.invoices > 0 && billing.summary.noOrder === 0} warn={billing.summary.noOrder > 0} detail={billing.summary.invoices ? `${billing.summary.invoices - billing.summary.noOrder} of ${billing.summary.invoices} ${cur.short} invoices have an order to check against` : "no invoices this month"} />
              <Fresh label="Labour" ok={health.labour.count > 0} detail={health.labour.count ? `${health.labour.count} shifts · latest ${dateLong(health.labour.latest)}` : "none recorded"} />
            </ul>
            {sc.commissionEstimatedShare > 0 && <p className="mt-3 text-[12px] text-muted">{signed(sc.commissionEstimatedShare * 100, "%", 0).replace("+", "")} of {cur.short} commission is estimated.</p>}
          </Panel>
        </div>
      </div>
    </>
  );
}

/** Stop the current-period line at the last day with sales instead of drawing missing days as zero. */
function trimToData<T extends { day: string }>(rows: T[], latest: string | null) {
  if (!latest) return rows;
  const last = latest.slice(0, 10);
  return rows.filter((r) => r.day <= last);
}

function Fresh({ label, detail, ok, warn }: { label: string; detail: string; ok: boolean; warn?: boolean }) {
  return (
    <li className="flex gap-2.5">
      <SeverityDot severity={warn ? "warning" : ok ? "good" : "info"} />
      <div className="min-w-0">
        <div className="text-ink">{label}</div>
        <div className="text-muted">{detail}</div>
      </div>
    </li>
  );
}

function Welcome() {
  return (
    <div className="mx-auto max-w-4xl py-10">
      <div className="mb-8">
        <Wordmark size={18} />
        <h1 className="mt-6 text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">Understand where your restaurant&apos;s money is going, why profitability is changing, and what to do next.</h1>
        <p className="mt-3 max-w-2xl text-[14px] text-ink-2">
          MarginOS connects POS exports, supplier invoices, recipes, delivery statements, waste logs and rotas, then investigates changes in contribution with evidence you can check, line by line.
        </p>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <Panel title="Explore with demo data" subtitle="The Copper Table · a fictional Newcastle restaurant">
          <ul className="mb-4 space-y-1.5 text-[12px] text-ink-2">
            <li>· Two months of sales across dine-in, collection and two delivery platforms</li>
            <li>· 40+ supplier invoices with a chicken and frying-oil price rise</li>
            <li>· A restaurant-funded delivery promotion, waste logs and rotas</li>
            <li>· Clearly labelled as demo data throughout</li>
          </ul>
          <LoadDemoButton />
        </Panel>
        <Panel title="Start with your own data" subtitle="Creates an empty workspace; import CSVs and invoices next">
          <CreateWorkspaceForm />
        </Panel>
      </div>
    </div>
  );
}
