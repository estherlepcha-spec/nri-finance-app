# Privacy Policy

**⚠️ DRAFT — NOT LEGAL ADVICE. Review by a qualified lawyer is required before publishing.** This template is grounded in how the NRI's & Expat's Personal Finance Manager ("the App") actually works, but it uses placeholders you must complete and does not cover every jurisdiction your users may live in (e.g. EU/UK GDPR, India DPDP Act 2023, US state privacy laws, GCC data-protection rules).

**Operator:** [Your Legal Name], an individual sole operator ("we", "us", "our")
**Contact:** [privacy@yourdomain.com]
**Effective date:** [DATE]
**Last updated:** [DATE]

---

## 1. Who we are

The App is a personal-finance tool for Non-Resident Indians (NRIs) and expats to track money across their home and working countries. It is operated by an individual (not an incorporated company). This policy explains what personal data we collect, why, how it is processed (including by our AI provider), and your rights.

## 2. What data we collect

**You provide:**
- **Account/identity data:** your email address, and — if you sign in with Google — your Google account identifier and basic profile, via our authentication provider (Supabase Auth / Google OAuth).
- **Financial data you enter or import:** accounts, balances, transactions, budgets, loans, investments, goals, remittances, family/beneficiary notes, and any bank statements or receipts you choose to upload.
- **Uploaded documents:** bank-statement PDFs/images/CSV/Excel files and receipts/invoices you submit for AI extraction.

**Collected automatically:**
- **Technical data** needed to run the service: session tokens, and standard request metadata handled by our hosting/auth providers.
- **Local device storage:** some preferences and trial state are stored in your browser's local storage (e.g. currency setup, free-trial start date, AI-upload count).

We do **not** ask for or intentionally store government IDs, full card numbers, or passwords in plaintext (authentication is handled by our provider).

## 3. How we use your data

- To provide the core service: storing and displaying your finances in your private account.
- To extract transactions from documents you upload, using AI (see Section 5).
- To provide the AI advisor ("Estelle") and AI-powered categorization when you use them.
- To manage authentication, subscriptions/trials, and prevent abuse (rate limiting).
- To respond to your support, privacy, or deletion requests.

We do **not** sell your personal data. We do **not** use your data for advertising.

## 4. Legal bases (where applicable, e.g. GDPR)

We process your data to **perform our contract** with you (providing the App), based on your **consent** (for AI processing of uploaded documents — see Section 5), and for our **legitimate interests** (security, fraud/abuse prevention). Where consent is the basis, you may withdraw it at any time.

## 5. AI processing and third-party sub-processors

To read documents you upload and to power AI features, we send the relevant data to **Anthropic, PBC** ("Anthropic"), the provider of the Claude AI model, via Anthropic's commercial API. Full detail is in our separate **AI Processing Disclosure**. In summary:
- Uploaded statements/receipts and, for the AI advisor, a summary of your finances are transmitted **over an encrypted (TLS) connection**, routed **through our own secure server proxy** so our API credentials are never exposed to your browser.
- Under **Anthropic's commercial API terms, your inputs and outputs are not used to train Anthropic's models.**
- Anthropic may retain API data for a limited period for trust-and-safety and operational purposes under its own policies. We do not control Anthropic's internal retention beyond the options its commercial terms provide.

**Our key sub-processors:**

| Sub-processor | Purpose | Data involved |
|---|---|---|
| Supabase (database, auth, functions hosting) | Store your account and financial data; authenticate you; run our server functions | Account data, all financial data you store |
| Anthropic (Claude AI) | Extract transactions from uploads; power AI categorization and the AI advisor | Uploaded documents; summarized financial context; your AI chat messages |
| Google (OAuth, optional) | Sign-in if you choose "Sign in with Google" | Email, Google account identifier |
| Vercel (frontend hosting) | Serve the web app | Standard request metadata |
| Stripe (only if billing is enabled) | Process subscription payments | Billing details handled by Stripe; we do not store card numbers |

We do not send your data to any party other than what is necessary to operate these functions.

## 6. Where your data is processed

Our providers may process data in the United States and other countries. If you are in a region with data-transfer restrictions (e.g. the EEA/UK, India), please review this before using the App. [Lawyer to confirm transfer mechanism / add SCCs or equivalent as needed.]

## 7. How long we keep your data

- **Account and financial data:** retained while your account is active, and deleted when you delete it (see Section 9) or on request.
- **Uploaded documents:** we do not keep a separate stored copy of the raw file after extraction; only the extracted transactions are saved to your account. (Anthropic's transient API retention is governed by its own terms.)
- **Local browser storage:** cleared when you clear your browser data or use the in-app "Clear All Data" function.

## 8. Security

We use the security measures described in our separate **Security Measures** document, including per-user database isolation (Row-Level Security), encrypted connections, server-side handling of API keys, and authentication via a dedicated provider. No system is perfectly secure; we cannot guarantee absolute security.

## 9. Your rights and how to exercise them

Depending on your jurisdiction, you may have rights to access, correct, export, delete, or restrict processing of your data, and to withdraw consent. To exercise any of these:
- **Delete your data in-app:** Settings → "Clear All Data" removes your financial data; deleting your account removes your account. See the **Data Deletion Process** document.
- **Contact us:** email **[privacy@yourdomain.com]**. We aim to respond within [30] days.

## 10. Children

The App is not intended for anyone under [16/18 — confirm]. We do not knowingly collect data from children.

## 11. Changes to this policy

We may update this policy; material changes will be notified in-app or by email. The "Last updated" date reflects the latest version.

## 12. Contact

Privacy questions, requests, or complaints: **[privacy@yourdomain.com]**.
