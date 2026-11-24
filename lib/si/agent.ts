/* ---------- SI agent loop ----------
   Model ⇄ tools until the model answers. The same function runs in production (live Toolbox) and in the
   eval suite (fixture Toolbox), so what we measure is exactly what ships.
   - Prompt caching: the static system prompt and the tool specs are cached (they're identical every turn).
   - Tools in one step run in parallel, each with its own timeout; errors go back to the model as data.
   - Hard rules (never claim a trade happened, never ask for keys) are checked on the final reply; a
     violation gets one self-correction pass before anything reaches the user. */

import { PROMPT_VERSION, SYSTEM_STATIC } from './prompt';
import { TOOL_SPECS, type Toolbox } from './tools-spec';
import { check, type Checks } from './guard';

export type Msg = { role: 'user' | 'assistant'; content: string | unknown[] };
type Block = { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> };
type ApiRes = { stop_reason: string; content: Block[]; usage?: Record<string, number> };

export const DEFAULT_MODEL = 'claude-sonnet-5-5';

export type AgentOpts = {
  history: Msg[];
  dynamicSystem: string;
  toolbox: Toolbox;
  model?: string;
  apiKey?: string;
  maxSteps?: number;
  budgetMs?: number;
  maxTokens?: number;
};

export type ToolTrace = { name: string; input: Record<string, unknown>; ms: number; ok: boolean; output?: unknown };
export type AgentResult = {
  reply: string; model: string; prompt_version: string; steps: number; latency_ms: number; stop: string;
  tools: ToolTrace[]; usage: Record<string, number>; checks: Checks; corrected: boolean;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callClaude(o: { apiKey: string; model: string; dynamicSystem: string; messages: Msg[]; maxTokens: number; signal: AbortSignal }): Promise<ApiRes> {
  const tools = TOOL_SPECS.map((t, i) => (i === TOOL_SPECS.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t));
  const body = JSON.stringify({
    model: o.model, max_tokens: o.maxTokens,
    system: [{ type: 'text', text: SYSTEM_STATIC, cache_control: { type: 'ephemeral' } }, { type: 'text', text: o.dynamicSystem }],
    tools, messages: o.messages,
  });
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${(process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`, {
      method: 'POST', signal: o.signal, body,
      headers: { 'content-type': 'application/json', 'x-api-key': o.apiKey, 'anthropic-version': '2023-06-01' },
    });
    if (r.ok) return (await r.json()) as ApiRes;
    // Overloaded / rate limited: one quick retry, then give up.
    if ((r.status === 429 || r.status === 529 || r.status >= 500) && attempt < 1) { await sleep(1200); continue; }
    throw new Error(`anthropic_${r.status}: ${(await r.text()).slice(0, 300)}`);
  }
}

const withTimeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('tool_timeout')), ms))]);
const addUsage = (a: Record<string, number>, u?: Record<string, number>) => { for (const [k, v] of Object.entries(u || {})) if (typeof v === 'number') a[k] = (a[k] || 0) + v; };
const textOf = (c: Block[]) => c.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

export async function runAgent(o: AgentOpts): Promise<AgentResult> {
  const t0 = Date.now();
  const model = o.model || DEFAULT_MODEL;
  const apiKey = o.apiKey || process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) throw new Error('assistant_not_configured');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.budgetMs ?? 50_000);
  const usage: Record<string, number> = {};
  const tools: ToolTrace[] = [];
  const evidence: unknown[] = [];
  let convo = o.history.slice();
  const userText = o.history.filter((m) => m.role === 'user' && typeof m.content === 'string').map((m) => m.content as string).join('\n');
  const maxSteps = o.maxSteps ?? 6;
  let reply = '', stop = '', steps = 0, corrected = false;

  try {
    for (; steps < maxSteps; steps++) {
      const res = await callClaude({ apiKey, model, dynamicSystem: o.dynamicSystem, messages: convo, maxTokens: o.maxTokens ?? 1200, signal: ctl.signal });
      addUsage(usage, res.usage);
      stop = res.stop_reason;
      if (res.stop_reason !== 'tool_use') { reply = textOf(res.content); convo = [...convo, { role: 'assistant', content: res.content }]; break; }
      const calls = res.content.filter((c) => c.type === 'tool_use');
      const results = await Promise.all(calls.map(async (c) => {
        const s = Date.now(), input = c.input || {};
        let out: unknown, ok = true;
        try { out = await withTimeout(o.toolbox.run(c.name || '', input), 15_000); }
        catch (e) { ok = false; out = { error: (e as Error).message === 'tool_timeout' ? 'timed_out' : 'tool_failed' }; }
        if (out && typeof out === 'object' && 'error' in (out as object)) ok = false;
        tools.push({ name: c.name || '', input, ms: Date.now() - s, ok, output: out });
        evidence.push(out);
        return { type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(out), ...(ok ? {} : { is_error: true }) };
      }));
      convo = [...convo, { role: 'assistant', content: res.content }, { role: 'user', content: results }];
    }
    if (!reply && steps >= maxSteps) reply = 'That took more steps than I allow myself. Ask me one thing at a time?';

    // Hard rules: one self-correction pass if broken.
    let ck = check(reply, evidence, userText);
    if ((ck.claims_execution || ck.asks_for_secrets) && !ctl.signal.aborted) {
      const fix = ck.claims_execution
        ? 'Your last reply says a trade already happened. It has not: nothing executes until the user taps Approve and signs. Rewrite the reply so it says the trade is ready to approve, keeping everything else.'
        : 'Your last reply asks for a seed phrase or private key. Never do that. Rewrite it without that request.';
      const res = await callClaude({ apiKey, model, dynamicSystem: o.dynamicSystem, messages: [...convo, { role: 'user', content: `[SI self-check, not from the user] ${fix}` }], maxTokens: 800, signal: ctl.signal });
      addUsage(usage, res.usage);
      const fixed = textOf(res.content);
      if (fixed) { reply = fixed; corrected = true; ck = check(reply, evidence, userText); }
    }
    return { reply: reply || 'Sorry, I didn’t get that. Try again?', model, prompt_version: PROMPT_VERSION, steps: steps + 1, latency_ms: Date.now() - t0, stop, tools, usage, checks: ck, corrected };
  } finally {
    clearTimeout(timer);
  }
}
