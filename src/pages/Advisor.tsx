import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2, RotateCcw, Send, Sparkles } from 'lucide-react';
import { askAdvisor, type AdvisorReply } from '../api';
import { useApp } from '../app-context';
import { Delta, PageHeader, Panel, Pill, money, pct } from '../ui';

type Msg = { role: 'user' | 'assistant'; text: string; reply?: AdvisorReply; error?: boolean };

const GROUPS: { title: string; qs: string[] }[] = [
  { title: 'Profit', qs: ['Why is my profit falling?', 'Where am I losing the most money?'] },
  { title: 'Menu', qs: ['Which dishes should I promote?', 'Which dishes need repricing?'] },
  { title: 'Suppliers', qs: ['Which supplier price rise should I deal with first?', 'Are there cheaper suppliers I should consider?'] },
  { title: 'What if', qs: ['What if cod goes up 10%?', 'What if I raise fish and chips to £17.50?'] },
  { title: 'Waste and outlook', qs: ['Where is food being wasted?', 'What will happen to my costs next month?'] },
];

/** Renders plain advisor text as paragraphs, numbered steps and bullets. */
function Rich({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    out.push(<Tag key={out.length} className={list.ordered ? 'steps' : 'dots'}>{list.items.map((t, i) => <li key={i}>{t}</li>)}</Tag>);
    list = null;
  };
  text.split('\n').map(l => l.trim()).filter(Boolean).forEach(line => {
    const num = /^\d+[.)]\s+(.*)$/.exec(line), dot = /^[-•]\s+(.*)$/.exec(line);
    if (num || dot) {
      const ordered = !!num;
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push((num ?? dot)![1]);
    } else { flush(); out.push(line.endsWith(':') ? <h4 key={out.length}>{line}</h4> : <p key={out.length}>{line}</p>); }
  });
  flush();
  return <div className="rich">{out}</div>;
}

function ScenarioCard({ s, cur }: { s: any; cur: string }) {
  const rows: [string, number, number, 'money' | 'pct'][] = [
    ['Weekly revenue', s.baseline.weekly_revenue, s.scenario.weekly_revenue, 'money'],
    ['Weekly ingredient cost', s.baseline.weekly_ingredient_cost, s.scenario.weekly_ingredient_cost, 'money'],
    ['Weekly gross profit', s.baseline.weekly_gross_profit, s.scenario.weekly_gross_profit, 'money'],
    ['Gross margin', s.baseline.gross_margin_pct, s.scenario.gross_margin_pct, 'pct'],
    ['Food cost', s.baseline.food_cost_pct, s.scenario.food_cost_pct, 'pct'],
  ];
  const f = (v: number, k: 'money' | 'pct') => (k === 'money' ? money(v, cur) : pct(v));
  return (
    <div className="scenario">
      <div className="scenario-h"><b>Scenario result</b><Pill tone="warn">Projection, not actuals</Pill></div>
      <table className="tbl compact">
        <thead><tr><th /><th className="r">Now</th><th className="r">Scenario</th></tr></thead>
        <tbody>{rows.map(([l, a, b, k]) => <tr key={l}><td>{l}</td><td className="r num">{f(a, k)}</td><td className="r num strong">{f(b, k)}</td></tr>)}</tbody>
      </table>
      <p className="scenario-f"><Delta value={s.weekly_gross_profit_change} suffix="" goodWhen="up" /> {money(s.weekly_gross_profit_change, cur)} a week · about {money(s.annualised_gross_profit_change, cur)} a year. <span className="muted">{s.basis}.</span></p>
    </div>
  );
}

export function AdvisorPage() {
  const { core, params, live } = useApp();
  const cur = core.restaurant.currency;
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' }); }, [msgs, busy]);

  const send = async (text = q) => {
    const question = text.trim();
    if (question.length < 3 || busy) return;
    setMsgs(m => [...m, { role: 'user', text: question }]);
    setQ(''); setBusy(true);
    try {
      const reply = await askAdvisor(question, params);
      setMsgs(m => [...m, { role: 'assistant', text: reply.answer, reply }]);
    } catch (e: any) {
      setMsgs(m => [...m, { role: 'assistant', text: e.message ?? 'The advisor could not answer. Try again.', error: true }]);
    } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader eyebrow="Assist" title="AI Business Advisor" subtitle="Ask about costs, dishes and suppliers. Every figure in an answer comes from your verified numbers."
        actions={msgs.length > 0 ? <button className="btn sm" onClick={() => setMsgs([])}><RotateCcw size={13} aria-hidden /> New conversation</button> : undefined} />
      <div className="grid g-chat">
        <Panel className="chat" flush>
          <div className="chat-scope">
            <Sparkles size={14} aria-hidden />
            <span>{live && core.period ? <>Answering from <b>{core.period.location}</b>, {new Date(core.period.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} to {new Date(core.period.end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</> : <>Offline sample: answers are fixed examples</>}</span>
          </div>
          <div className="chat-body" ref={box} aria-live="polite">
            {msgs.length === 0 && (
              <div className="chat-empty">
                <b>What would you like to know?</b>
                <p>Pick a question, or type your own. The advisor explains what is happening, then suggests what to do first.</p>
              </div>
            )}
            {msgs.map((m, i) => m.role === 'user' ? (
              <div className="msg user" key={i}><div className="bubble">{m.text}</div></div>
            ) : (
              <div className={`msg ai${m.error ? ' error' : ''}`} key={i}>
                {m.reply && (
                  <div className="prov">
                    <Pill tone={m.reply.live ? 'brand' : 'warn'} dot>{m.reply.label}</Pill>
                    {m.reply.intent === 'simulation' && <Pill tone="neu">What-if</Pill>}
                  </div>
                )}
                <div className="card-msg">
                  <Rich text={m.text} />
                  {m.reply?.scenario && <ScenarioCard s={m.reply.scenario} cur={cur} />}
                </div>
                {m.reply?.notice && <small className="prov-note">{m.reply.notice}</small>}
              </div>
            ))}
            {busy && <div className="msg ai"><div className="card-msg thinking"><Loader2 size={15} className="spin" aria-hidden /> Reviewing your figures…</div></div>}
          </div>
          <form className="chat-in" onSubmit={e => { e.preventDefault(); void send(); }}>
            <input className="input" aria-label="Ask a question" placeholder="Ask about your restaurant…" value={q} maxLength={1000} onChange={e => setQ(e.target.value)} />
            <button className="btn primary" disabled={q.trim().length < 3 || busy} aria-label="Send question"><Send size={15} aria-hidden /> Ask</button>
          </form>
        </Panel>

        <div className="stack">
          <Panel title="Suggested questions">
            <div className="qgroups">
              {GROUPS.map(g => (
                <div key={g.title}>
                  <div className="mini-h">{g.title}</div>
                  {g.qs.map(s => <button key={s} className="qbtn" disabled={busy} onClick={() => void send(s)}>{s}</button>)}
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="How answers are produced">
            <p className="muted small">MarginOS calculates every figure with fixed formulas. The advisor only explains those figures and never invents numbers. The label on each answer shows whether it came from live Claude or from the built-in demo advisor.</p>
          </Panel>
        </div>
      </div>
    </>
  );
}
