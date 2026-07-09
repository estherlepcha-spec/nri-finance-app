# What the autonomous agent needs BESIDES the prompt

The system prompt (SYSTEM_PROMPT_DRAFT.md) is ~10% of an autonomous business operator. The prompt makes the agent *behave* safely; these tools + guardrails are what let it *act* at all — and what stop it from doing damage. Read this before wiring anything to live systems.

## 1. Run it as a Managed Agent, not a raw API call

Use Anthropic **Managed Agents** (server-side agent loop + sandboxed workspace), model `claude-fable-5`. Reasons: it persists across runs, streams events you can watch, supports **per-tool approval policies** (`always_ask`), and hosts tool execution. A one-shot `messages.create()` can't safely "manage a business."

## 2. Tools — split by risk, gate the dangerous ones

**Auto-allowed (read-only — safe to run without asking):**
- Read Stripe metrics (revenue, subs, churn) — read-only key
- Read Anthropic usage/cost, Supabase usage, Vercel analytics
- Read the production database **read-replica or read-only role** (never the write role)
- Read logs / error signals
- Read support inbox

**Approval-gated (`always_ask` — agent must get your confirmation each time):**
- Any Stripe write: charge, refund, price/plan/subscription change
- Any database write or delete
- Send any email or user/third-party message
- Deploy, roll back, or change infra/config
- Change trial limits or pricing

The prompt already tells the agent to stop and ask — but the **tool permission policy is the real enforcement.** Prompt instructions can be reasoned around; a tool that requires `user.tool_confirmation` cannot.

## 3. Credentials — least privilege, never root

- Stripe: a **restricted key** (read-only for metrics; a separate write key only behind the approval gate, if at all).
- Supabase: a **read-only DB role** for the auto tools; writes only via a gated tool.
- Store all secrets in the Managed Agents **vault**, never in the prompt or messages.
- Never give the agent your account root credentials or the Anthropic key that funds itself.

## 4. Spend controls

- Set a **task budget** per run (beta) so the agent paces itself.
- Cap `max_tokens`, and set an **external kill switch** (you can stop a session).
- Run on a schedule you control (e.g. a daily brief), not an always-on loop, until you trust it.

## 5. Data & compliance guardrails

- The agent must operate within the app's Privacy Policy / AI Disclosure. Do not let it export user financial data to any non-approved destination.
- No full account numbers / IBANs anywhere (matches the app's own redaction rule).
- Deletion/security requests route to the documented human process — the agent drafts, you act.

## 6. Suggested rollout (earn autonomy in stages)

1. **Read-only advisor first.** Same prompt, but ONLY read tools. It briefs you daily; you act. Zero irreversible risk. Run this for a few weeks.
2. **Add gated actions one at a time.** e.g. let it *draft* support replies you send; then let it send low-risk replies with approval; expand only as it proves reliable.
3. **Never fully ungate money, DB writes, or mass email.** For a solo operator these should stay human-approved indefinitely.

## Bottom line

The prompt is ready to review. But "auto-manage my business" safely = Managed Agent + read/gated tool split + least-privilege vault creds + spend caps + staged rollout. Start as a read-only advisor; graduate specific actions as trust builds.
