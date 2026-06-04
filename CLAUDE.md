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
- `node sync-server.js` — start the sync server
