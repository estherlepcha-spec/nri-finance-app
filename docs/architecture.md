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
- `database/supabase-setup.sql` — run once to set up the DB table
