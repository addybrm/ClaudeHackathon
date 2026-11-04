import { getActiveBusiness, resolvePeriodKey } from "@/lib/business";
import { liveAiAvailable, MODEL } from "@/lib/ai/config";
import { query } from "@/lib/db";
import { previousPeriod } from "@/lib/finance/period";
import { Button, Empty, PageHeader } from "@/components/ui";
import { PeriodPicker } from "@/components/shell";
import { Investigator, type SavedInvestigation } from "./investigator-client";

export default async function InvestigatorPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const b = await getActiveBusiness();
  if (!b) return <Empty title="No business loaded" action={<Button href="/" variant="primary">Get started</Button>}>Load the demo restaurant to try the investigator.</Empty>;
  const sp = await searchParams;
  const { key, available } = await resolvePeriodKey(b, sp.period);
  if (!key) return <Empty title="No sales data yet" action={<Button href="/data">Open Data Centre</Button>}>Import a POS export before investigating.</Empty>;
  const history = await query<{ id: string; question: string; headline: string | null; mode: string; status: string; created_at: string }>(
    `select id, question, headline, mode, status, created_at::text from investigations where business_id = $1 order by created_at desc limit 20`,
    [b.id],
  );
  let saved: SavedInvestigation | null = null;
  if (sp.id) {
    const [r] = await query<Record<string, unknown>>(`select id, question, mode, model, status, report, trace, verification, error_message, duration_ms, period_current, created_at::text from investigations where id = $1 and business_id = $2`, [sp.id, b.id]);
    if (r) saved = r as unknown as SavedInvestigation;
  }
  const live = liveAiAvailable();
  return (
    <>
      <PageHeader
        title="Investigator"
        description="Ask about your numbers. Every answer shows its working."
        actions={<PeriodPicker value={key} available={available} compareLabel={previousPeriod(key).label} />}
      />
      <Investigator
        periodKey={key}
        live={live}
        model={live ? MODEL : null}
        history={history}
        saved={saved}
        autoQuestion={sp.q === "revenue" ? "My revenue increased this month, but my profitability declined. What happened?" : sp.ask ?? null}
      />
    </>
  );
}
