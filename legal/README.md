# Legal & Compliance Documents

⚠️ **All documents here are DRAFTS grounded in how the app actually works. They are NOT legal advice and MUST be reviewed by a qualified lawyer before you publish them** — especially because your users are NRIs/expats across multiple jurisdictions (EU/UK GDPR, India DPDP Act, US state laws, GCC rules).

## Documents

| File | Covers |
|---|---|
| [PRIVACY_POLICY.md](./PRIVACY_POLICY.md) | What data is collected, why, sub-processors, rights |
| [TERMS_OF_SERVICE.md](./TERMS_OF_SERVICE.md) | Rules of use, disclaimers, liability, billing |
| [AI_PROCESSING_DISCLOSURE.md](./AI_PROCESSING_DISCLOSURE.md) | Exactly what is sent to Claude/Anthropic and how |
| [DATA_DELETION_PROCESS.md](./DATA_DELETION_PROCESS.md) | How users delete data / accounts |
| [SECURITY_MEASURES.md](./SECURITY_MEASURES.md) | Technical controls (RLS, TLS, server-side keys, etc.) |
| [INCIDENT_RESPONSE_CONTACT.md](./INCIDENT_RESPONSE_CONTACT.md) | Vulnerability reporting + breach notification |

The **user consent checkbox** for uploaded documents is implemented in the app (in the statement/receipt import screen), and links to `/ai-disclosure` and `/privacy`.

## Placeholders to fill before publishing

Search-and-replace across these files:

- `[Your Legal Name]` — your name as the operator
- `[privacy@yourdomain.com]` — your dedicated privacy/deletion contact email
- `[security@yourdomain.com]` — your security/incident email (can be the same)
- `[DATE]` — effective / last-updated dates
- `[jurisdiction]` — governing law / venue
- `[16/18 — confirm]` — minimum age
- `[30]`, `[72 hours]`, `[7 days]` — response timeframes (confirm against your legal obligations)
- Any `[Lawyer to confirm ...]` note — resolve with counsel

## Serving these on the website

The in-app notices link to `/privacy`, `/terms`, and `/ai-disclosure`. You need to serve pages at those routes. Options:
- Render these Markdown files as static pages on your site, **or**
- Paste the finalized text into simple HTML pages hosted at those paths on Vercel.

(This app is a single-page React app; it does not yet have client-side routes for `/privacy` etc. Tell me if you want me to add in-app pages/routes that display these, or a footer with the links.)
