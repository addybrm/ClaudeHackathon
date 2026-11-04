import { getActiveBusiness, resolvePeriodKey } from "@/lib/business";
import { labourAnalysis, loadPeriod, wasteSummary } from "@/lib/finance/engine";
import { pctChange } from "@/lib/finance/formulas";
import { period, previousPeriod } from "@/lib/finance/period";
import { dateShort, gbp, gbp2, pct, qty } from "@/lib/format";
import { HBars, LineCompare } from "@/components/charts";
import { PeriodPicker } from "@/components/shell";
import { Button, Delta, Empty, PageHeader, Panel, Stat, StatRow } from "@/components/ui";

const REASON: Record<string, string> = { spoilage: "Spoilage / out of date", overproduction: "Over-production", prep_trim: "Prep & trim", plate_waste: "Plate waste & remakes", damaged: "Damaged", other: "Other" };

export default async function WasteLabourPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const b = await getActiveBusiness();
  if (!b) return <Empty title="No business loaded" action={<Button href="/" variant="primary">Get started</Button>} />;
  const sp = await searchParams;
  const { key, available } = await resolvePeriodKey(b, sp.period);
  if (!key) return <Empty title="No sales data yet" action={<Button href="/data">Open Data Centre</Button>} />;
  const cur = period(key);
  const prev = previousPeriod(key);
  const [mc, mp] = await Promise.all([loadPeriod(b, cur), loadPeriod(b, prev)]);
  const [wc, wp, lc, lp] = await Promise.all([wasteSummary(mc), wasteSummary(mp), labourAnalysis(b, cur), labourAnalysis(b, prev)]);
  const fill = (p: typeof cur, rows: { day: string; cost: number }[]) => {
    const m = new Map(rows.map((r) => [r.day, r.cost]));
    return Array.from({ length: p.days }, (_, i) => {
      const d = new Date(Date.parse(p.start) + i * 86400000).toISOString().slice(0, 10);
      return { day: d, value: m.get(d) ?? 0 };
    });
  };
  const prevItems = new Map(wp.byItem.map((i) => [i.name, i.cost]));

  return (
    <>
      <PageHeader title="Waste & labour" description="Recorded food waste priced at this month's ingredient costs, and wage cost against revenue. Only recorded data is shown; nothing is inferred." actions={<PeriodPicker value={key} available={available} compareLabel={prev.label} />} />

      <h2 className="mb-2 text-[13px] font-medium text-ink-2">Food waste</h2>
      {wc.records === 0 ? (
        <Empty title={`No waste recorded for ${cur.label}`} action={<Button href="/data">Import a waste log</Button>}>Waste cost can only be calculated from recorded waste. MarginOS doesn&apos;t estimate unrecorded waste.</Empty>
      ) : (
        <>
          <StatRow cols={4}>
            <Stat label="Recorded waste cost" value={gbp(wc.totalCost)} delta={<Delta value={pctChange(wc.totalCost, wp.totalCost)} goodWhen="down" />} sub={`${prev.short}: ${gbp(wp.totalCost)}`} />
            <Stat label="Waste as % of food cost" value={pct(sumFood(mc) > 0 ? (wc.totalCost / sumFood(mc)) * 100 : null)} sub="recorded waste ÷ theoretical food cost" />
            <Stat label="Records" value={wc.records} sub={wc.uncostedRecords ? `${wc.uncostedRecords} could not be costed` : "all costed"} />
            <Stat label="Largest item" value={<span className="text-[16px]">{wc.byItem[0]?.name ?? "—"}</span>} sub={wc.byItem[0] ? gbp(wc.byItem[0].cost) : undefined} />
          </StatRow>
          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            <Panel pad={false} title="Most wasted" subtitle="Cost at this month's unit cost (dishes: portions × recipe cost)">
              <table className="tbl num">
                <thead><tr><th>Item</th><th className="r">Records</th><th className="r">Quantity</th><th className="r">{cur.short}</th><th className="r">{prev.short}</th><th className="r">Change</th></tr></thead>
                <tbody>
                  {wc.byItem.slice(0, 10).map((i) => (
                    <tr key={i.name}>
                      <td><span className="text-ink">{i.name}</span><span className="ml-2 text-[11px] text-muted">{i.kind === "menu_item" ? "prepared dish" : "ingredient"}</span></td>
                      <td className="r">{i.records}</td>
                      <td className="r">{qty(i.quantity, i.unit)}</td>
                      <td className="r text-ink">{gbp2(i.cost)}</td>
                      <td className="r text-ink-2">{prevItems.has(i.name) ? gbp2(prevItems.get(i.name)!) : "—"}</td>
                      <td className="r"><Delta value={prevItems.get(i.name) ? pctChange(i.cost, prevItems.get(i.name)!) : null} goodWhen="down" dp={0} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
            <Panel title="By reason" subtitle={`${cur.short}; marker shows ${prev.short}`}>
              <HBars rows={wc.byReason.map((r) => ({ label: REASON[r.reason] ?? r.reason, value: r.cost, previous: wp.byReason.find((x) => x.reason === r.reason)?.cost ?? 0 }))} color="var(--warn)" compare={prev.short} />
            </Panel>
          </div>
          <Panel className="mt-5" title="Waste cost by day">
            <LineCompare current={fill(cur, wc.byDay).filter((d) => !wc.byDay.length || d.day <= wc.byDay[wc.byDay.length - 1].day)} previous={fill(prev, wp.byDay)} currentLabel={cur.label} previousLabel={prev.label} height={180} metric="Waste cost" />
          </Panel>
        </>
      )}

      <h2 className="mb-2 mt-8 text-[13px] font-medium text-ink-2">Labour</h2>
      {lc.records === 0 ? (
        <Empty title={`No labour records for ${cur.label}`} action={<Button href="/data">Import rota hours</Button>}>Import worked hours and rates to compare wage cost with revenue.</Empty>
      ) : (
        <>
          <StatRow cols={4}>
            <Stat label="Wage cost" value={gbp(lc.totalCost)} delta={<Delta value={pctChange(lc.totalCost, lp.totalCost)} goodWhen="down" />} sub={`${prev.short}: ${gbp(lp.totalCost)}`} hint="Hours × hourly rate. Excludes employer NI, pension and holiday accrual." />
            <Stat label="Wage cost % of net revenue" value={pct(lc.labourPctOfRevenue)} delta={<Delta value={lc.labourPctOfRevenue !== null && lp.labourPctOfRevenue !== null ? lc.labourPctOfRevenue - lp.labourPctOfRevenue : null} suffix=" pts" goodWhen="down" />} />
            <Stat label="Hours worked" value={Math.round(lc.totalHours).toLocaleString("en-GB")} delta={<Delta value={pctChange(lc.totalHours, lp.totalHours)} goodWhen="none" />} />
            <Stat label="Revenue per labour hour" value={gbp2(lc.totalHours ? lc.revenue / lc.totalHours : null)} sub={`${prev.short}: ${gbp2(lp.totalHours ? lp.revenue / lp.totalHours : null)}`} />
          </StatRow>
          <div className="mt-5 grid gap-5 xl:grid-cols-3">
            <Panel title="By role" subtitle={`${cur.short}; marker shows ${prev.short}`}>
              <HBars rows={lc.byRole.map((r) => ({ label: r.role, sub: `${Math.round(r.hours)} h`, value: r.cost, previous: lp.byRole.find((x) => x.role === r.role)?.cost ?? 0 }))} compare={prev.short} />
            </Panel>
            <Panel pad={false} title="By weekday" subtitle="Wage cost as % of that weekday's net revenue">
              <table className="tbl num">
                <thead><tr><th>Day</th><th className="r">Wage cost</th><th className="r">Revenue</th><th className="r">Wage %</th></tr></thead>
                <tbody>
                  {[1, 2, 3, 4, 5, 6, 0].map((i) => lc.byWeekday[i]).map((w) => (
                    <tr key={w.weekday}><td className="text-ink">{w.weekday}</td><td className="r">{gbp(w.cost)}</td><td className="r">{gbp(w.revenue)}</td><td className={`r ${(w.labourPct ?? 0) > (lc.labourPctOfRevenue ?? 0) + 5 ? "text-warn" : ""}`}>{pct(w.labourPct)}</td></tr>
                  ))}
                </tbody>
              </table>
            </Panel>
            <Panel title="Days to investigate" subtitle={`Wage cost % more than 8 pts above the ${cur.short} average (${pct(lc.labourPctOfRevenue)})`}>
              {lc.flaggedDays.length === 0 ? <p className="text-[12px] text-muted">No outlier days.</p> : (
                <ul className="space-y-2 text-[12px]">
                  {lc.flaggedDays.map((d) => (
                    <li key={d.day} className="flex items-baseline justify-between gap-3">
                      <span className="text-ink">{new Date(d.day).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })} {dateShort(d.day)}</span>
                      <span className="num text-muted">{gbp(d.cost)} on {gbp(d.revenue)} · <span className="text-warn">{pct(d.labourPct)}</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}
    </>
  );
}

function sumFood(m: Awaited<ReturnType<typeof loadPeriod>>) {
  let f = 0;
  for (const x of m.facts) {
    const rc = m.recipeCosts.get(x.menuItemId);
    if (rc?.complete) f += rc.cost * x.units;
  }
  return f;
}
