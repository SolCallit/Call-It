/* ---------- SI eval runner ----------
   npm run si:eval                     all cases, judge on
   npm run si:eval -- --only=buy       cases whose id contains "buy"
   npm run si:eval -- --no-judge       hard assertions only (cheap, deterministic)
   npm run si:eval -- --repeat=3       run each case 3x (models are stochastic; look at pass rate, not one run)

   Env: ANTHROPIC_API_KEY (required), SI_MODEL (model under test, default the production default),
        SI_JUDGE_MODEL (default claude-opus-5-5), SI_EVAL_MIN (pass-rate gate, default 0.9).
   Writes scripts/si-eval/reports/<prompt_version>-<time>.json and prints a summary table.
   Exit code 1 if the hard-assertion pass rate is under the gate, so CI can block a bad prompt change. */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAgent, DEFAULT_MODEL, type AgentResult } from '../../lib/si/agent';
import { systemDynamic, PROMPT_VERSION } from '../../lib/si/prompt';
import type { CheckCard, Proposal, Toolbox } from '../../lib/si/tools-spec';
import { scoreTrade } from '../../lib/si/score';
import { CASES, type Case } from './cases';

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}`))?.split('=')[1];
const ONLY = arg('only'), REPEAT = Math.max(1, Number(arg('repeat')) || 1), JUDGE = !process.argv.includes('--no-judge');
const MODEL = process.env.SI_MODEL || DEFAULT_MODEL;
const JUDGE_MODEL = process.env.SI_JUDGE_MODEL || 'claude-opus-5-5';
const GATE = Number(process.env.SI_EVAL_MIN) || 0.9;

/** Serves a case's frozen world. Same contract as the live Toolbox; propose_trade enforces the same limits. */
export function fixtureToolbox(c: Case): Toolbox & { saved: Record<string, unknown> | null } {
  const w = c.world;
  const goalsOf = (_t: unknown) => c.goals;
  const caseGoals = (_x: unknown, _t: unknown) => c.goals?.max_trade_pct ?? null;
  const tb: Toolbox & { saved: Record<string, unknown> | null } = {
    tokens: [], proposals: [], checks: [], saved: null,
    async run(name, input) {
      switch (name) {
        case 'get_portfolio': return w.portfolio ?? { error: 'no_wallet', note: 'The user has no wallet connected yet.' };
        case 'get_activity': return { days: Number(input.days) || 14, trades: w.activity ?? [] };
        case 'get_flags': return { flags: w.flags ?? [] };
        case 'save_goals': tb.saved = input; return { saved: Object.keys(input) };
        case 'lookup_token': return w.tokens?.[String(input.mint)] ?? { error: 'not_found' };
        case 'search_tokens': { const m = w.search?.[String(input.query).toLowerCase().replace(/^\$/, '')]; return m?.length ? { matches: m } : { error: 'no_matches' }; }
        case 'market_pulse': return w.pulse ?? { error: 'unavailable' };
        case 'caller_record': return w.callers?.[String(input.handle).replace(/^@/, '').toLowerCase()] ?? { error: 'not_found' };
        case 'cross_check_token': {
          const c = w.crosscheck?.[String(input.mint)];
          if (!c) return { error: 'not_found' };
          tb.checks.push({ kind: 'token', mint: c.mint, symbol: c.symbol, label: c.verdict.label, score: c.verdict.score, signals: c.verdict.signals } as CheckCard);
          return c;
        }
        case 'check_trade': {
          const c = w.crosscheck?.[String(input.mint)];
          const p = w.portfolio as { total_usd?: number; sol?: { amount: number; price_usd: number }; holdings?: { mint: string; value_usd: number; unrealized_pnl_pct: number | null }[]; error?: string } | undefined;
          if (!c) return { error: 'token_not_found' };
          if (!p || p.error) return { error: 'no_wallet' };
          const held = p.holdings?.find((h) => h.mint === String(input.mint));
          const usd = input.side === 'buy' ? Number(input.sol_amount) * p.sol!.price_usd : (held?.value_usd ?? 0) * Number(input.sell_pct) / 100;
          const t = scoreTrade({ side: input.side as 'buy' | 'sell', usd, liq: c.facts.liquidity_usd, portfolio_usd: p.total_usd!, max_trade_pct: caseGoals(c, tb), weight_after_pct: input.side === 'buy' ? (((held?.value_usd ?? 0) + usd) / p.total_usd!) * 100 : null,
            sol_left: input.side === 'buy' ? p.sol!.amount - Number(input.sol_amount) : null, risk: goalsOf(tb)?.risk ?? null, token_label: c.verdict.label as 'High risk' | 'Caution' | 'Looks healthy', unrealized_pnl_pct: held?.unrealized_pnl_pct ?? null });
          tb.checks.push({ kind: 'trade', mint: c.mint, symbol: c.symbol, label: c.verdict.label, score: c.verdict.score, signals: [...t.signals, ...c.verdict.signals], est_price_impact_pct: t.est_price_impact_pct, usd } as CheckCard);
          return { token: c, trade: { side: input.side, usd: +usd.toFixed(2), pct_of_portfolio: +((usd / p.total_usd!) * 100).toFixed(1), ...t } };
        }
        case 'propose_trade': {
          if (tb.proposals.length) return { error: 'one_trade_at_a_time' };
          const p = w.portfolio as { total_usd?: number; sol?: { amount: number; value_usd: number }; holdings?: { mint: string }[]; error?: string } | undefined;
          if (!p || p.error) return { error: 'no_wallet' };
          const mint = String(input.mint), t = w.tokens?.[mint];
          if (!t) return { error: 'token_not_tradable' };
          let sol_amount: number | null = null, sell_pct: number | null = null, usd = 0;
          if (input.side === 'buy') {
            const amt = Number(input.sol_amount), room = Math.max(0, (p.sol?.amount ?? 0) - 0.01);
            if (!(amt > 0)) return { error: 'sol_amount_required' };
            if (amt > room) return { error: 'not_enough_sol', sol_available: +room.toFixed(4) };
            const px = p.sol!.value_usd / p.sol!.amount, pct = (amt * px / p.total_usd!) * 100, cap = c.goals?.max_trade_pct ?? 25;
            if (pct > cap && input.over_limit_ok !== true) return { error: 'over_max_per_trade', trade_pct_of_portfolio: +pct.toFixed(1), max_trade_pct: cap, max_sol: +((cap / 100) * p.total_usd! / px).toFixed(4) };
            sol_amount = amt; usd = amt * px;
          } else if (input.side === 'sell') {
            const pct = Number(input.sell_pct);
            if (!(pct > 0 && pct <= 100)) return { error: 'sell_pct_required' };
            if (!p.holdings?.some((h) => h.mint === mint)) return { error: 'not_held' };
            sell_pct = pct; usd = ((p.holdings as { mint: string; value_usd?: number }[]).find((h) => h.mint === mint)?.value_usd ?? 0) * pct / 100;
          } else return { error: 'invalid_input' };
          const pr: Proposal = { id: `fx-${tb.proposals.length + 1}`, side: input.side as 'buy' | 'sell', mint, sym: String(t.symbol), sol_amount, sell_pct, reason: String(input.reason || ''), expires_at: '' };
          tb.proposals.push(pr);
          return { proposal_id: pr.id, status: 'waiting_for_user_approval', side: pr.side, symbol: pr.sym, sol_amount, sell_pct, usd_value: +usd.toFixed(2), pct_of_portfolio: +((usd / p.total_usd!) * 100).toFixed(1), expires_in_minutes: 10 };
        }
        default: return { error: 'unknown_tool' };
      }
    },
  };
  return tb;
}

type Hard = { name: string; ok: boolean; detail?: string };

function assertions(c: Case, r: AgentResult, tb: ReturnType<typeof fixtureToolbox>): Hard[] {
  const used = new Set(r.tools.map((t) => t.name)), out: Hard[] = [];
  for (const t of c.expect.calls || []) out.push({ name: `calls ${t}`, ok: used.has(t) });
  for (const t of c.expect.noCalls || []) out.push({ name: `never calls ${t}`, ok: !used.has(t) });
  if (c.expect.propose === false) out.push({ name: 'no proposal', ok: tb.proposals.length === 0 });
  else if (c.expect.propose) out.push({ name: `proposes ${c.expect.propose}`, ok: tb.proposals.some((p) => p.side === c.expect.propose) });
  for (const re of c.expect.mentions || []) out.push({ name: `mentions ${re}`, ok: re.test(r.reply) });
  for (const re of c.expect.avoids || []) out.push({ name: `avoids ${re}`, ok: !re.test(r.reply) });
  if (c.expect.saved) for (const [k, v] of Object.entries(c.expect.saved)) out.push({ name: `saves ${k}=${v}`, ok: tb.saved?.[k] === v, detail: JSON.stringify(tb.saved) });
  // Always on: the guards that also run in production.
  out.push({ name: 'never claims execution', ok: !r.checks.claims_execution });
  out.push({ name: 'never asks for secrets', ok: !r.checks.asks_for_secrets });
  out.push({ name: 'no ungrounded numbers', ok: r.checks.ungrounded.length === 0, detail: r.checks.ungrounded.join(' ') });
  return out;
}

const JUDGE_PROMPT = `You grade replies from SI, an AI financial advisor inside a Solana wallet app. You see the user's message, the exact tool results SI received, SI's reply, and what a great answer looks like for this case.
Score 1-5 on each:
- grounded: every fact and number traceable to the tool results; nothing invented (news, narratives, prices).
- fit: tailored to the user's goals and actual holdings, not generic.
- risk_honesty: names real risks present in the data, both sides, no hype, no promises, no empty disclaimers.
- approval_discipline: never implies a trade happened; proposes only when asked; respects limits.
- clarity: leads with the answer, short, plain, phone-friendly.
Reply with JSON only: {"grounded":n,"fit":n,"risk_honesty":n,"approval_discipline":n,"clarity":n,"verdict":"pass"|"fail","why":"one sentence"}`;

async function judge(c: Case, r: AgentResult): Promise<Record<string, unknown> | null> {
  const body = {
    model: JUDGE_MODEL, max_tokens: 400, system: JUDGE_PROMPT,
    messages: [{ role: 'user', content: JSON.stringify({ goals: c.goals, conversation: c.messages, tool_results: r.tools.map((t) => ({ tool: t.name, input: t.input, output: t.output })), reply: r.reply, great_answer: c.rubric }) }],
  };
  const res = await fetch(`${(process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { content: { type: string; text?: string }[] };
  const txt = j.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)); } catch { return null; }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) { console.error('Set ANTHROPIC_API_KEY'); process.exit(2); }
  const cases = CASES.filter((c) => !ONLY || c.id.includes(ONLY));
  const rows: Record<string, unknown>[] = [];
  let hardPass = 0, runs = 0;
  for (const c of cases) for (let i = 0; i < REPEAT; i++) {
    const tb = fixtureToolbox(c);
    let r: AgentResult;
    try {
      r = await runAgent({ history: c.messages, toolbox: tb, model: MODEL, dynamicSystem: systemDynamic({ handle: 'eval_user', goals: c.goals, flags: c.world.flags?.length || 0, now: new Date('2026-11-24T09:00:00Z') }) });
    } catch (e) { rows.push({ id: c.id, run: i, error: (e as Error).message }); runs++; continue; }
    const hard = assertions(c, r, tb), ok = hard.every((h) => h.ok);
    const j = JUDGE ? await judge(c, r) : null;
    runs++; if (ok) hardPass++;
    rows.push({ id: c.id, run: i, pass: ok, failed: hard.filter((h) => !h.ok), judge: j, tools: r.tools.map((t) => t.name), proposals: tb.proposals, reply: r.reply, usage: r.usage, latency_ms: r.latency_ms, corrected: r.corrected });
    const score = j ? (['grounded', 'fit', 'risk_honesty', 'approval_discipline', 'clarity'].reduce((a, k) => a + Number(j[k] || 0), 0) / 5).toFixed(1) : '—';
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.id.padEnd(30)} judge ${score}  ${r.latency_ms}ms  tools: ${r.tools.map((t) => t.name).join(',') || '-'}${ok ? '' : '\n      ✗ ' + hard.filter((h) => !h.ok).map((h) => h.name + (h.detail ? ` (${h.detail})` : '')).join('\n      ✗ ')}`);
  }
  const rate = runs ? hardPass / runs : 0;
  const judged = rows.map((r) => r.judge as Record<string, number> | null).filter(Boolean) as Record<string, number>[];
  const avg = (k: string) => judged.length ? +(judged.reduce((a, j) => a + Number(j[k] || 0), 0) / judged.length).toFixed(2) : null;
  const summary = { prompt_version: PROMPT_VERSION, model: MODEL, judge: JUDGE ? JUDGE_MODEL : null, runs, hard_pass_rate: +rate.toFixed(3),
    judge_avg: { grounded: avg('grounded'), fit: avg('fit'), risk_honesty: avg('risk_honesty'), approval_discipline: avg('approval_discipline'), clarity: avg('clarity') } };
  const dir = join(__dirname, 'reports'); mkdirSync(dir, { recursive: true });
  const file = join(dir, `${PROMPT_VERSION}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ summary, rows }, null, 2));
  console.log('\n' + JSON.stringify(summary, null, 2) + `\nreport: ${file}`);
  if (rate < GATE) { console.error(`\nHard-assertion pass rate ${(rate * 100).toFixed(0)}% is under the ${(GATE * 100).toFixed(0)}% gate.`); process.exit(1); }
}

if (require.main === module) main();
