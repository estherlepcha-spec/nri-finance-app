# NRI Finance App — Architecture

## Tech Stack
- **Frontend:** React 18 + Vite
- **Styling:** Inline CSS-in-JS with theme constants
- **Database:** Supabase (PostgreSQL) for cloud persistence
- **AI:** Anthropic Claude API (claude-sonnet-4-5)
- **Deployment:** Vercel (auto-deploy on git push)
- **Local sync:** Supabase Realtime for cross-device updates

## Folder Structure

```
src/
├── components/
│   ├── shared/       # Reusable UI: Modal, Btn, Card, Input, etc.
│   └── [feature]/    # One folder per app section
├── services/
│   ├── anthropic.js  # All Claude AI API calls
│   └── supabase.js   # Supabase client + sync helpers
├── utils/
│   ├── constants.js  # Colors, categories, default data
│   ├── formatting.js # fmt, fmtDate, uid, Flag component
│   └── calculations.js # recomputeAllBalances, balance helpers
├── styles/
│   ├── App.css
│   └── index.css
├── App.jsx           # Root component + routing
└── main.jsx
```

## Data Flow
1. All state lives in `App.jsx` as React useState
2. `persist()` saves to localStorage AND Supabase on every change
3. On startup, data loads from Supabase (fallback: localStorage)
4. Supabase Realtime syncs changes across devices instantly

## Key Files
- `src/utils/constants.js` — theme colors, all static data
- `src/utils/calculations.js` — pure financial math functions
- `src/services/anthropic.js` — centralised AI API calls
- `src/services/aiPrivacy.js` — masks financial identifiers and limits stored
  account identifiers to their last four digits
- `src/services/estelleSpecialists.js` — Estelle specialist routing, task
  instructions, and scoped financial context
- `src/services/estelleMemory.js` and `estelleMemoryPolicy.js` — authenticated
  per-user memory storage, validation, expiry-aware loading, and specialist
  filtering
- `supabase/migrations/0008_estelle_memory.sql` — private memory settings and
  records with per-user RLS policies
- `database/supabase-setup.sql` — run once to set up the DB table

## AI privacy and account isolation
- Supabase Auth password inputs are masked; passwords are not sent to the AI
  service. Authenticated Supabase user IDs scope database rows through RLS.
- Account-number values are normalized to the last four digits at UI entry,
  cache/database load, and persistence boundaries.
- PII-like sequences in text prompts and text-based document exports are
  masked before the AI request. Binary scans/PDFs cannot be reliably redacted
  in the browser; upload flows require a user review/confirmation and warn the
  user to upload a pre-redacted copy.
- Estelle specialists receive only the financial context required for their
  task and have no tools to modify user data.
- Estelle's application-level dispatcher selects a specialist before composing
  one Claude request; only one chat request runs at a time. Optional memory is
  disabled by default, stored separately from browser cache, and included only
  after an authenticated RLS-protected read confirms the setting is enabled.
  Each turn sends at most eight relevant memories (3,000 characters total);
  records are scoped to general or one specialist and expire after 12 months.
  AI-generated suggestions are drafts only and require user review and an
  explicit save action. The existing Anthropic Edge Function remains the
  provider proxy; no separate agent workers or infrastructure load balancer
  are introduced in this first version.
