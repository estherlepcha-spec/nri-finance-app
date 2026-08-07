# NRI Finance App — Manual Test Checklist

Click through the running app (`npm run dev` → http://localhost:3000) and tick each box.
Do a full pass before any deploy. Money math is also covered automatically by `npm test`.

> Tip: test with a throwaway account (or the primary `estherlepcha@gmail.com` account),
> and keep a couple of real sample statements handy for the import section.

---

## 0. Auth & Session
- [ ] Google sign-in works and lands back in the app (account chooser shows)
- [ ] Email sign-up sends a verification email; unverified user can't sign in
- [ ] Password reset email arrives and works
- [ ] Sign out returns to the landing/login screen
- [ ] "Sign out everywhere" invalidates the session on a second device/browser
- [ ] Signed-out state loads/writes nothing (no data leaks to a shared id)

### 0a. Cross-user isolation on a shared device (CRITICAL — regression guard)
> Guards the fixed leak where a new user saw the previous user's accounts (at 0 balance).
> Automated coverage: `npm test` (tests/user-isolation.test.js). Confirm live too:
- [ ] Sign in as **User A** → create 2+ accounts with balances → sign out
- [ ] Sign in as **User B** (different account) → sees **NO accounts/data of A** (clean slate, or B's own only)
- [ ] Check DevTools → Application → Local Storage: no `nri_accounts`/etc. from A remain under B
- [ ] Sign back in as **User A** → A's accounts and balances are **fully intact**
- [ ] Repeat A→B switch **without** closing the tab (in-page switch also isolates)

## 1. Setup Wizard (first run)
- [ ] Fresh account shows the setup wizard
- [ ] Home + foreign currency selection persists
- [ ] Exchange rate is prefilled from live rates and editable
- [ ] Completing setup lands on the Dashboard; re-login skips the wizard

## 2. Dashboard
- [ ] Net worth = sum of account balances (converted to primary currency)
- [ ] Monthly income/expense snapshot matches this month's transactions
- [ ] Currency toggle (home/foreign) reconverts all figures correctly
- [ ] Empty state renders sensibly with no accounts/transactions

## 3. Accounts (multi-currency)
- [ ] Add a home-currency account (e.g. INR Savings) → appears in list
- [ ] Add a foreign-currency account (e.g. KWD Current) → appears in list
- [ ] Add two Burgan accounts (Current + Savings) — both distinguishable by card
- [ ] Set an opening balance → reflected in balance
- [ ] Edit / delete an account behaves correctly
- [ ] Credit-card account: charges increase balance, payments decrease it

## 4. Transactions
- [ ] Manual income entry increases the account balance
- [ ] Manual expense entry decreases it
- [ ] Edit a transaction → balance recomputes
- [ ] Delete a transaction → balance recomputes
- [ ] Transfer between accounts is counted as expense (per categorization rule)
- [ ] Filter/search by account, category, date works

## 5. Statement Import (the highest-risk flow — test carefully)
- [ ] Upload a PDF statement **into a specific account card** → transactions land in THAT account
- [ ] Currency follows the account, not the file
- [ ] **Currency-mismatch guard:** upload an INR statement into a KWD account → import is BLOCKED with a modal (no transactions/balance written)
- [ ] Blank/unknown file currency does NOT falsely block
- [ ] **Duplicate detection:** re-upload the same statement (rename the file) → duplicates skipped via `ref`
- [ ] Rows without a ref → fuzzy match (date + amount ± + description) skips dupes
- [ ] **Opening balance:** latest statement anchors balance; uploading an OLDER one after doesn't move the anchor backward
- [ ] Gap warning shows when an older statement doesn't connect to the anchor
- [ ] Pending-transaction warning shows before import (verify prompt)
- [ ] Excel/CSV/image formats import as well as PDF

## 6. Smart Categorization (AI + rules)
- [ ] Exchange company → categorized as Transfer
- [ ] CC interest → Fees & Charges
- [ ] CC payment → Transfer (not expense)
- [ ] EMI detected and matched to a loan
- [ ] UPI person-payment triggers a confirmation
- [ ] Transport/Travel and Groceries/Shopping split correctly
- [ ] A learned smart rule persists and reapplies on next import

## 7. Remittances
- [ ] Log a remittance (send home) with amount + rate → recorded
- [ ] Efficiency tracker updates
- [ ] Remittance is NOT double-counted against expenses (no double-count rule)
- [ ] Unlinked remittance appears in the home-account audit total

## 8. Bills
- [ ] Add a bill with a due date → shows in upcoming
- [ ] Recurring bill regenerates for the next period
- [ ] Bill month-matching lines up with the correct budget month
- [ ] Mark bill paid → reflected

## 9. Investments
- [ ] Add each type (MF, FD, stock, gold) → shows in portfolio
- [ ] Foreign-currency holding converts to primary currency correctly
- [ ] AI portfolio extraction from a document populates holdings (eyeball accuracy)

## 10. Goals
- [ ] Create a savings goal with a target → progress bar at 0
- [ ] Add a contribution → progress updates and math is right
- [ ] Goal completion state renders

## 11. Loans & EMIs
- [ ] Add a loan → shows with balance
- [ ] EMI payment reduces the loan balance
- [ ] Payoff calculator produces a sane schedule
- [ ] Foreign-currency loan converts to INR (covered by `npm test` too)
- [ ] AI loan-document extraction populates fields (eyeball accuracy)

## 12. Budget (working + home)
- [ ] Set monthly budgets per category → saved
- [ ] Actual vs budget bars reflect real transactions
- [ ] Budget forecast / delayed-salary handling behaves
- [ ] Switching budget month shows the right period

## 13. Trends
- [ ] 6-month income/expense chart renders with real data
- [ ] Numbers match the underlying transactions

## 14. Tax Estimator
- [ ] Pick each of a few of the 13 countries → estimate changes
- [ ] Worldwide income input produces a plausible figure

## 15. What-If Simulator
- [ ] Create a scenario (e.g. salary change) → projected impact shown
- [ ] Save a scenario → persists and reloads
- [ ] Allocation planner / smart learning behaves

## 16. Family
- [ ] Add a family member → appears
- [ ] Edit/remove works
- [ ] "Estelle hide" behaves as intended

## 17. Estelle (AI advisor)
- [ ] Ask a question → gets a Claude-powered answer (via server-side proxy)
- [ ] Purchase-analysis ("can I afford X?") uses real account data
- [ ] Response references correct balances/goals
- [ ] Rate-limit / not-authenticated paths fail gracefully

## 18. Settings & Data Management
- [ ] Change currencies / exchange rate → app-wide reconversion
- [ ] Export all data → file downloads with correct contents
- [ ] Data deletion flow works (and re-auth gate prompts on sensitive actions)
- [ ] Billing toggle (if enabled) shows plan state

## 19. Sync (multi-device)
- [ ] Open the app in two browsers signed into the same account
- [ ] A change in one appears in the other (real-time)
- [ ] Empty server state does NOT wipe local data on reconnect

## 20. Cross-cutting
- [ ] Hard-refresh clears any stale cache and app still loads (cache rule)
- [ ] No secrets in the browser (DevTools → Sources: no sk-ant / sk_live / service-role)
- [ ] Console has no uncaught errors during a normal session
- [ ] Mobile / narrow viewport is usable

---

### How to run the automated pieces
- **Math:** `npm test` (7+ tests, Node built-in runner)
- **E2E (browser):** `npm run test:e2e` *(added when Playwright specs are set up)*
