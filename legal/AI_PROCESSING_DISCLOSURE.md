# AI Processing Disclosure

**⚠️ DRAFT — informational; have a lawyer confirm alongside your Privacy Policy.**

**Effective date:** [DATE]
**Contact:** [privacy@yourdomain.com]

This disclosure explains, plainly, how the NRI's & Expat's Personal Finance Manager ("the App") uses artificial intelligence, what data is sent to the AI provider, and your choices.

## 1. Which AI we use

The App uses **Claude**, a large language model provided by **Anthropic, PBC** ("Anthropic"), through Anthropic's commercial API. We do not run our own AI model, and no AI parsing happens locally in your browser.

## 2. When data is sent to the AI (and when it is not)

Data is sent to Anthropic **only when you actively use an AI feature.** It is **never** sent for ordinary actions like viewing your dashboard, editing a transaction by hand, or setting a budget.

AI is used in these features:

| Feature | What is sent to Claude |
|---|---|
| **Bank statement import** | The statement file you upload — a PDF or image (as encoded data), or the text of a CSV/Excel export (up to ~30,000 characters). |
| **Transaction categorization** | The extracted transactions (date, description, amount) to assign categories. |
| **Receipt / invoice scan** | The receipt or invoice file you upload. |
| **AI advisor ("Estelle")** | Your chat messages, any photo you attach, and a **summary** of your finances (e.g. country, goals, loans, upcoming bills, current month) — not your full transaction ledger. |
| **Other document extraction** (loans, investments) | The document you upload for that feature. |

## 3. How it is sent — the security path

Your data does not go directly from your browser to Anthropic. It follows this path:

```
Your browser  →  our secure server (Supabase Edge Function)  →  Anthropic's Claude API
```

- The connection is encrypted in transit (TLS/HTTPS) at every hop.
- The server proxy exists so our Anthropic API key is kept server-side and never exposed in your browser, and so only signed-in users can use AI features.
- We forward only the data needed for the requested feature.

## 4. How your data is used by the AI provider

- Under **Anthropic's commercial API terms, your inputs and outputs are NOT used to train Anthropic's AI models.**
- Anthropic may retain API data for a limited time for operational and trust-and-safety purposes under its own policies. This retention is controlled by Anthropic, not by us. (Zero-retention arrangements exist as an option under Anthropic's commercial terms; we will document any change if we adopt one.)
- We do not keep a separate stored copy of your uploaded file after extraction — only the extracted transactions are saved to your private account.

## 5. Accuracy — please review AI output

AI extraction and categorization can be wrong. The App shows you the extracted transactions and assigned categories **before** anything is imported, so you can review, edit, or reject them. Do not treat AI output as verified financial advice.

## 6. Your consent and choices

- Before any document is processed by AI, you must **check a consent box** confirming you agree to this disclosure.
- You can avoid AI entirely by **entering transactions manually** — all core tracking features work without AI.
- You may withdraw consent at any time by not using AI features and by contacting **[privacy@yourdomain.com]**.

## 7. More information

- Anthropic's privacy and usage policies: see anthropic.com.
- Our overall data practices: see our **Privacy Policy** and **Security Measures** documents.
