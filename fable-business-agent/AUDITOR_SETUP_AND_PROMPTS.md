# How to make Fable 5 your app's auditor — steps + the exact prompts

This is the run guide. `AUDITOR_SYSTEM_PROMPT.md` is *who the agent is*; this file is *how you start it and what you paste*.

---

## The short version

1. Run Fable 5 as an **Anthropic Managed Agent** (model `claude-fable-5`), not a one-shot API call — you want persistence, streamed events, per-tool approval policies, and a sandboxed workspace.
2. Give it the **repo** (so it can read code and open PRs) and, for the live-metrics audit, **read-only** credentials only.
3. Paste `AUDITOR_SYSTEM_PROMPT.md` as the **system prompt**.
4. Kick off a run with one of the **task prompts** below.
5. It fixes repo issues on branches/PRs you merge; it proposes anything touching live systems for your approval.

---

## STEP 1 — Where it runs

Use **Managed Agents** on `claude-fable-5`. Configure two things that matter for an auditor:

- **Workspace = a clone of your repo** (`estherlepcha-spec/nri-finance-app`, branch `master`), so it can read code, run the build, and open PRs. Make sure git is configured to **push to a new branch and open a PR**, never to `master`.
- **Per-tool approval policy** = `always_ask` on every write/live tool (see Tier 2 below). This is the *real* enforcement — the prompt tells it to stop and ask, but the tool policy is what makes it physically unable to act.

## STEP 2 — Tools & credentials (split by tier)

**Auto-allowed (read-only — the audit itself):**
- Read the repo / filesystem; run `npx vite build`, `npm test`, `eslint` **read-only** (no auto-commit to master).
- Read Stripe metrics via a **restricted, read-only** key.
- Read Anthropic usage/cost, Supabase usage, Vercel analytics.
- Read the production DB via a **read-only role or read replica** (never the write role).
- Read logs / error signals.

**Approval-gated (`always_ask`) or simply not granted:**
- Git **push to master** / deploy / rollback → not granted at all.
- Opening a **PR** from an `audit/fix-*` branch → allow (this is the Tier-1 fix path; a PR is safe, you merge it).
- Any Stripe write, DB write/delete, sending email, changing pricing/trial limits → `always_ask` or not granted.

Store every secret in the Managed Agents **vault**. Never put a key in the system prompt or a message. Never give it your Anthropic key that funds itself, or any root credential.

## STEP 3 — Spend + safety controls

- Set a **per-run task budget** so it paces itself; cap `max_tokens`.
- Keep it on a **schedule you trigger** (e.g. a weekly audit) or manual runs — not an always-on loop — until you trust it.
- Know where the **stop/kill** control is for a running session.

---

## THE PROMPTS

Paste `AUDITOR_SYSTEM_PROMPT.md` as the system prompt once. Then start a run with one of these as the first user message.

### Prompt 1 — Full audit, propose-only (safest first run; nothing gets changed)

```
Run a full audit of the NRI Finance App across all four domains: code & security,
financial correctness, compliance & privacy, and product/business health.

This is a READ-ONLY run — do not fix anything, do not open any PR, do not touch any
live system. Just find and report.

Deliver a single ranked findings list: severity (Critical/High/Medium/Low) · domain ·
tier (Repo / Live) · one-line summary · evidence (file:line, metric, or log) ·
recommended fix. Lead with the worst finding. If you found nothing Critical, say so.
```

### Prompt 2 — Audit + fix the repo issues (your "let it also fix" ask, done safely)

```
Audit the NRI Finance App. For every Tier-1 (Repo) issue you're confident in — code
bugs, security holes in the repo, wrong financial formulas/rules, redaction regexes
that miss cases — FIX IT: one branch per fix named audit/fix-<slug>, minimal diff, add
or adjust a unit test that proves the fix, run `npx vite build` before committing any
front-end change, and open a PR. Never commit to master, never deploy.

For every Tier-2 (Live) issue — anything touching the production DB, Stripe, the
deployed app, real user data, config in a dashboard, or user emails — do NOT act.
Write it up as a proposal for my approval.

Report back: top findings by severity, the PRs you opened (with links), and the Tier-2
items awaiting my approval.
```

### Prompt 3 — Just the money math (financial correctness)

```
Audit only financial correctness. Verify: currency conversion against sync-data.json
rates; allocation planners; budget forecast; delayed-salary handling; the simulator;
and the categorization rules (Transport vs Travel, Groceries vs Shopping, transfers
count as expense, no double-counted remittances, bills matched to the right month).
Confirm the totals and balances the app shows users are arithmetically correct.

Where the CODE has a wrong formula or rule, fix it on an audit/fix-<slug> branch WITH a
unit test that pins the correct number, run the build, and open a PR. Where PRODUCTION
DATA is already wrong, do not write to the DB — propose the correction for my approval.
```

### Prompt 4 — Compliance & privacy sweep

```
Audit compliance & privacy only. Verify the app actually enforces its own commitments:
only last-4 of account numbers stored, IBANs redacted on statement import, the
AI-upload consent gate present and honored, user financial data sent only to approved
sub-processors (Anthropic, Supabase, Vercel, Stripe), and that /privacy, /terms, and
/ai-disclosure match real behavior.

If a fix is a code change in the repo (e.g. a redaction regex that misses a format),
fix it on a branch with a test and open a PR. If a fix touches live data, dashboard
config, or user-facing legal copy, propose it for my approval — do not act.
Flag any secret committed to the repo as Critical (name the file, do NOT paste the value).
```

### Prompt 5 — Recurring weekly audit (once you trust it)

```
Weekly audit run. Since the last run, re-audit all four domains, focusing on anything
that changed in the repo or in the metrics. Same rules: fix Tier-1 repo issues via
audit/fix-<slug> branches + PRs with tests; propose Tier-2 live issues for approval.
Keep the report short — new/changed findings first, then a one-line status per domain.
```

---

## Suggested rollout

1. **Prompt 1 (read-only) first.** Let it audit and report a few times. Zero risk. Confirm its findings are real and its severity calls are sane.
2. **Then Prompt 2 (audit + repo fixes).** Review its PRs like any contributor's. Merge the good ones. This is where "let it also fix" is safe.
3. **Keep Tier-2 (live systems, money, user data, deploys) human-approved indefinitely.** For a solo operator that's the right call — the auditor drafts the fix, you pull the trigger.

## Bottom line

Fable 5 as an auditor is the safe, high-value version of the earlier "business operator" idea. It reads everything, ranks what's wrong, fixes the repo through PRs you merge, and never touches money, user data, or production on its own.
