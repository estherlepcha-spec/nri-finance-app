# Data Deletion Process

**Contact for deletion requests:** [privacy@yourdomain.com]
**Last updated:** [DATE]

This document explains how you (or we, on your request) can delete your data from the NRI's & Expat's Personal Finance Manager ("the App").

## 1. What you can delete yourself, in the App

**Clear all financial data (keeps your login):**
1. Open **Settings**.
2. Click **🗑️ Clear All Data**.
3. Confirm. This permanently deletes your accounts, transactions, loans, investments, goals, budgets, remittances, and related records. **This cannot be undone.**

This removes the financial data associated with your account from our database. Because access is enforced by per-user Row-Level Security, only you can trigger this for your own account.

**Export first (recommended):** before clearing, use **Settings → Export** to download a backup (JSON) of your data.

**Local device data:** clearing your browser's site data for the App removes locally stored preferences and trial state.

## 2. Deleting your entire account

To delete your **account** (login + all associated data), email **[privacy@yourdomain.com]** from the email address registered to your account, with the subject **"Account deletion request."** We will:
1. Verify the request comes from the account owner.
2. Delete your financial data and your account record.
3. Confirm completion by email.

We aim to complete verified deletion requests within **[30] days**.

> If a self-service "Delete my account" button is not yet available in-app, the email process above is the current method. [Optional future work: add an in-app account-deletion button that removes the auth user and all data.]

## 3. Uploaded documents and AI provider

- We do **not** keep a separate stored copy of uploaded bank statements or receipts after extraction; only the extracted transactions are saved (and are removed when you delete your data).
- Data transiently processed by our AI provider (Anthropic) is subject to Anthropic's own retention policies, which we do not control. We do not send deletion requests to Anthropic for individual API calls, because we do not store references to them; if this matters to you, review Anthropic's policies and our AI Processing Disclosure.

## 4. Backups and legal retention

- Provider-level backups may persist for a short period before rotation. We do not use these to reconstruct deleted accounts.
- We may retain limited records where required by law (e.g. tax or fraud-prevention obligations, if any apply). [Lawyer to confirm whether any statutory retention applies to you.]

## 5. Your rights

Depending on your jurisdiction (e.g. GDPR "right to erasure", India DPDP), you may have a formal right to deletion. Exercise it via the process above. If you believe a request was not honored, contact **[privacy@yourdomain.com]**.
