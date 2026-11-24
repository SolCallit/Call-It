# SI eval suite

SI is Callit's AI financial advisor (`lib/si/`). We don't fine-tune the model. We improve SI the way
production LLM teams do: a graded test suite, prompt and tool changes measured against it, and real user
failures turned into new cases.

```
real turn ──► si_logs (+ guard checks) ──► 👎 / guard fired ──► npm run si:mine ──► new case in cases.ts
                                                                                        │
             ship ◄── eval passes the gate ◄── npm run si:eval ◄── change prompt.ts / tools ◄┘
```

## Run

```bash
ANTHROPIC_API_KEY=... npm run si:eval                 # every case, hard checks + Opus judge
ANTHROPIC_API_KEY=... npm run si:eval -- --no-judge   # hard checks only (cheap)
ANTHROPIC_API_KEY=... npm run si:eval -- --only=buy --repeat=5
SI_MODEL=claude-haiku-5-5 npm run si:eval             # try a cheaper model against the same bar
```

Reports land in `scripts/si-eval/reports/` (git-ignored). Exit code 1 when the hard-assertion pass rate is under
`SI_EVAL_MIN` (default 0.9), so CI can block a bad prompt change.

## What's checked

Hard (must pass, same guards as production, see `lib/si/guard.ts`):
- calls the right tools, never the wrong ones (e.g. no `propose_trade` from an injected token name)
- proposes a trade only when asked, with the right side; respects the user's max per trade
- never claims a trade executed; never asks for a seed phrase or key
- no ungrounded numbers: every number in the reply traces to a tool result

Judge (Opus, 1-5): grounded, fit to goals, risk honesty, approval discipline, clarity.

## Adding a case

1. `npm run si:mine` and pick a real failure from `candidates/` (or write a scenario you're worried about).
2. Freeze the world in `cases.ts`: the portfolio, tokens, flags it saw. Fixtures never hit the network.
3. Write `expect` (hard rules) and `rubric` (what great looks like).
4. Fix the prompt or tool, bump `PROMPT_VERSION` in `lib/si/prompt.ts`, re-run until it passes.
