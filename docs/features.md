# NRI Finance App — Features

## Core Sections
| Section | Description |
|---|---|
| Dashboard | Monthly snapshot, net worth, income/expense overview |
| Accounts | Multi-currency accounts (working + home country) |
| Transactions | Import bank statements, manual entry, smart categorisation |
| Remittances | Track money sent home, exchange rates, efficiency tracker |
| Bills | Upcoming bills, due dates, recurring payments |
| Investments | Portfolio tracking (MF, FD, stocks, gold, etc.) |
| Goals | Savings goals with progress tracking |
| Loans & EMIs | Loan tracking, EMI history, payoff calculator |
| Budget | Monthly budget planner (working + home country) |
| Trends | 6-month income/expense trends |
| Tax Estimator | Worldwide tax calculator (13 countries) |
| What-If Simulator | Scenario planning for financial decisions |
| Family | Family member tracking |
| Estelle (AI) | AI finance advisor powered by Claude |
| Settings | Currencies, exchange rate, data management |

## Smart Import Features
- Bank statement import (PDF, Excel, CSV, images)
- Auto-categorisation with smart rules
- Exchange company detection → Transfer
- CC interest detection → Fees & Charges
- CC payment detection → Transfer (not expense)
- EMI detection with loan matching
- UPI person-payment confirmation
- Duplicate detection and auto-skip
- Opening balance carry-forward

## Statement Import — Account & Currency Rules

These rules govern which account an imported statement belongs to and guard
against balance-distorting mistakes. Implemented in `src/App.jsx` (`doImport`,
`resolveImportAccount`, `handleImport`).

**1. The uploaded-into account is authoritative.**
The account the user uploads into owns the imported transactions and its balance
reflects them. We do **not** infer the account from the statement file. When the
user starts the import from an account card's "Upload or Scan Document" button,
that account is pre-selected (`preAccountId`) and used as-is. The file-based
resolver (`resolveImportAccount`: last-4 account number → bank name → unique
currency) runs **only** as a fallback for the global upload button when no
account was chosen, and even then it just suggests a value the user confirms.

**2. Currency follows the account, not the file.**
The transaction currency is the chosen account's currency, never the file's.

**3. Currency-mismatch guard (terminates the import).**
Before writing anything, `doImport` compares the statement's detected currency
against the chosen account's currency. If the file has a *confident, known*
currency code (in `KNOWN_CURRENCIES`) that differs from the account's currency,
the import is **terminated** — no transactions are written and no balance/opening
balance is touched — and a blocking modal tells the user to upload to the correct
account (or add one in that currency). This prevents e.g. an INR statement being
recorded as KWD amounts, which would corrupt the account balance and the
file's opening-balance carry-forward. A blank or unrecognised file currency is
**not** treated as a mismatch (we don't block on low-confidence signals).

Rationale: because the account is authoritative (rule 1) and its opening balance
can be set from the statement, a wrong-account/wrong-currency upload is the one
case that could silently distort real balances — so it is the case we hard-stop.

## AI Features (Claude-powered)
- Bank statement extraction
- Investment portfolio extraction
- Loan document extraction
- Remittance receipt scanning
- Invoice/receipt scanning
- Estelle AI financial advisor with purchase analysis
