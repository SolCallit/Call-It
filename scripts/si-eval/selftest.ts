/* ---------- SI offline self-test ----------
   npm run si:test
   Runs the real agent loop against a scripted mock of the Messages API (no key, no network) and checks
   the mechanics the evals depend on: tool round-trips, proposals, the self-correction pass, guards,
   per-trade limits, and that prompt caching is requested. */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { runAgent } from '../../lib/si/agent';
import { systemDynamic } from '../../lib/si/prompt';
import { numbersSaid, ungroundedNumbers, claimsExecution } from '../../lib/si/guard';
import { CASES } from './cases';
import { fixtureToolbox } from './run';

type Step = { tool?: { name: string; input: Record<string, unknown> }; text?: string };
let script: Step[] = [];
const seen: Record<string, unknown>[] = [];

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const j = JSON.parse(body); seen.push(j);
    const s = script.shift() || { text: 'ok' };
    const content = s.tool ? [{ type: 'tool_use', id: 'tu_' + seen.length, name: s.tool.name, input: s.tool.input }] : [{ type: 'text', text: s.text }];
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ stop_reason: s.tool ? 'tool_use' : 'end_turn', content, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: seen.length > 1 ? 3000 : 0 } }));
  });
});

let fails = 0;
const ok = (name: string, cond: boolean, detail = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond || !detail ? '' : ` (${detail})`}`); if (!cond) fails++; };
const caseOf = (id: string) => CASES.find((c) => c.id === id)!;
const run = (id: string) => {
  const c = caseOf(id), tb = fixtureToolbox(c);
  return runAgent({ history: c.messages, toolbox: tb, apiKey: 'test', dynamicSystem: systemDynamic({ handle: 't', goals: c.goals, flags: 0 }) }).then((r) => ({ r, tb }));
};

async function main() {
  await new Promise<void>((r) => server.listen(0, r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', WIF = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';

  // 1. Tool round-trip + proposal
  script = [{ tool: { name: 'get_portfolio', input: {} } }, { tool: { name: 'propose_trade', input: { side: 'buy', mint: BONK, sol_amount: 0.5, reason: 'Small add' } } },
    { text: 'Ready to approve below: buy BONK with 0.5 SOL. That’s about $65, inside your 10% max.' }];
  let { r, tb } = await run('buy-within-limit');
  ok('proposal created', tb.proposals.length === 1 && tb.proposals[0].side === 'buy');
  ok('tools traced in order', r.tools.map((t) => t.name).join(',') === 'get_portfolio,propose_trade');
  ok('tool results go back to the model', JSON.stringify(seen[1]).includes('tool_result'));
  ok('prompt caching: system + tools', JSON.stringify((seen[0] as { system: unknown[] }).system[0]).includes('ephemeral') && JSON.stringify((seen[0] as { tools: unknown[] }).tools.slice(-1)).includes('ephemeral'));
  ok('usage aggregated', r.usage.input_tokens === 300 && r.usage.cache_read_input_tokens === 6000);
  ok('no false execution claim', !r.checks.claims_execution);

  // 2. Execution claim → self-correction
  seen.length = 0;
  script = [{ tool: { name: 'propose_trade', input: { side: 'sell', mint: WIF, sell_pct: 50, reason: 'Take half off' } } },
    { text: 'Done! I have sold half your WIF.' }, { text: 'Selling half your WIF is ready to approve below. Nothing moves until you sign.' }];
  ({ r, tb } = await run('take-profit-half'));
  ok('self-correction fired', r.corrected && !r.checks.claims_execution, r.reply);
  ok('self-check marked as not from the user', JSON.stringify(seen[seen.length - 1]).includes('SI self-check, not from the user'));

  // 3. Over the user's limit → tool refuses with the max that fits
  script = [{ tool: { name: 'propose_trade', input: { side: 'buy', mint: WIF, sol_amount: 5, reason: 'Big add' } } }, { text: 'That’s over your 5% max. The most that fits is about 0.94 SOL.' }];
  ({ r, tb } = await run('buy-over-limit'));
  const out = r.tools[0].output as { error?: string; max_sol?: number };
  ok('over-limit refused', tb.proposals.length === 0 && out.error === 'over_max_per_trade' && (out.max_sol ?? 0) > 0.9 && (out.max_sol ?? 0) < 1, JSON.stringify(out));

  // 4. Ungrounded number detection on a made-up price
  script = [{ tool: { name: 'get_portfolio', input: {} } }, { text: 'Your wallet is $2.45K. WIF is trading at $3.40 and you hold 1,500 of it.' }];
  ({ r } = await run('overview-concentration'));
  ok('flags made-up $3.40, accepts $2.45K and 1,500', r.checks.ungrounded.includes('$3.40') && !r.checks.ungrounded.some((x) => /2\.45|1,500/.test(x)), r.checks.ungrounded.join(' '));

  // 5. Guard units
  ok('numbersSaid normalizes $1.2K / 34.5% / $34.5M', JSON.stringify(numbersSaid('$1.2K, 34.5% and $34.5M').map((n) => n.value)) === JSON.stringify([1200, 34.5, 34500000]));
  ok('ungrounded: derived difference allowed', ungroundedNumbers('You’re up $300', [{ value: 1200, cost: 900 }]).length === 0);
  ok('claimsExecution catches "I have bought"', claimsExecution('I have bought 2 SOL of BONK for you') && !claimsExecution('Tap Approve and I’ll line up the buy'));

  server.close();
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
}

main();
