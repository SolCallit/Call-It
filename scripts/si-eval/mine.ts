/* ---------- Mine real SI failures into eval candidates ----------
   npm run si:mine            last 7 days of thumbs-down turns + turns the guards flagged
   npm run si:mine -- --days=30

   Env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY.
   Writes scripts/si-eval/candidates/<date>.json: the question, what SI did and said, the user's note, and
   which guard fired. A human turns the good ones into cases in cases.ts (freeze the world they saw,
   write the expectation). That's the loop: real failure → case → prompt/tool change → eval passes → ship. */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const days = Number(process.argv.find((a) => a.startsWith('--days='))?.split('=')[1]) || 7;

async function main() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'); process.exit(2); }
  const db = createClient(url, key, { auth: { persistSession: false } });
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const { data: bad } = await db.from('si_feedback').select('note, created_at, si_logs!inner(id, prompt_version, model, question, reply, tools, checks, created_at)').eq('rating', -1).gte('created_at', since).limit(500);
  const { data: flagged } = await db.from('si_logs').select('id, prompt_version, model, question, reply, tools, checks, created_at').gte('created_at', since)
    .or('checks->>claims_execution.eq.true,checks->>asks_for_secrets.eq.true,checks->>corrected.eq.true').limit(500);
  const { data: ungrounded } = await db.from('si_logs').select('id, prompt_version, model, question, reply, tools, checks, created_at').gte('created_at', since)
    .not('checks->ungrounded', 'eq', '[]').limit(500);
  // Never export who asked: candidates carry the turn, not the account.
  const rows: Record<string, unknown>[] = [
    ...(bad || []).map((b) => ({ source: 'thumbs_down', note: b.note, ...(b as unknown as { si_logs: Record<string, unknown> }).si_logs })),
    ...(flagged || []).map((l) => ({ source: 'guard', ...l })),
    ...(ungrounded || []).map((l) => ({ source: 'ungrounded', ...l })),
  ];
  const uniq = [...new Map(rows.map((r) => [r.id as string, r])).values()];
  const dir = join(__dirname, 'candidates'); mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(file, JSON.stringify(uniq, null, 2));
  const by = uniq.reduce<Record<string, number>>((a, r) => ((a[r.source as string] = (a[r.source as string] || 0) + 1), a), {});
  console.log(`${uniq.length} candidates (${Object.entries(by).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'}) → ${file}`);
}

main();
