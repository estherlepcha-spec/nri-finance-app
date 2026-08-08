# NRI Finance App — Claude Instructions

## Project Overview
A React + Vite finance application for NRI (Non-Resident Indian) users, with currency sync support via `sync-server.js` and live rate data in `sync-data.json`.

## Git & GitHub Workflow

**This is the most important rule in this file.**

After completing any meaningful unit of work — a feature, a fix, a refactor, a config change — commit and push to GitHub before moving on. Never leave the repository in a state where work could be lost.

### Rules
- Commit after every task or logical change, not just at the end of a session.
- Push to `origin/master` after every commit so the remote is always up to date.
- Write clean, descriptive commit messages that explain *what changed and why*, not just "update file".
- Stage specific files by name — never use `git add -A` blindly (risk of committing secrets or large binaries).
- `.env` is excluded from git — never commit it.

### Commit message format
```
<short summary in present tense, under 72 chars>

<optional body: what changed and why, if non-obvious>

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

### Remote
- Repo: https://github.com/estherlepcha-spec/nri-finance-app
- Branch: `master`
- Git user: `estherlepcha-spec`

## Dev Commands
- `npm run dev` — start Vite dev server
- `npm run build` — production build
- `npm test` — unit tests (financial math, user-isolation, bill recurrence; Node's built-in runner)
- `npm run test:e2e` — Playwright end-to-end tests
- `node sync-server.js` — start the sync server

Run `npx vite build` + `npm test` before committing changes to `src/App.jsx`.
Note: the `tests/` dir is gitignored — add new test files with `git add -f`.

## Testing & go-live
- Manual test checklist: `docs/TESTING_CHECKLIST.md` (walk before any deploy).
- **Do NOT enable billing in Vercel prod / go live until tests for ALL features
  are finished** (owner's rule). Billing is gated by `VITE_ENABLE_BILLING`
  (currently on locally for the trial-reminder UI; not set in prod).
