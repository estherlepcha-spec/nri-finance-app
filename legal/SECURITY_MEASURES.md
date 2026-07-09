# Security Measures

**Last updated:** [DATE]
**Security / incident contact:** [security@yourdomain.com or privacy@yourdomain.com]

This document describes the technical and organizational measures used to protect data in the NRI's & Expat's Personal Finance Manager ("the App"). It reflects the App's current architecture. No system is perfectly secure, and this document is provided in good faith, not as a warranty.

## 1. Authentication and access control

- **Authenticated access only.** Users sign in with email/password or Google OAuth, handled by Supabase Auth. Financial data is accessible only to a signed-in, authenticated user.
- **Per-user data isolation (Row-Level Security).** The database enforces PostgreSQL Row-Level Security so that each user can only read or write rows whose `user_id` matches their authenticated session (`auth.uid()`). One user cannot access another user's data, even if the client were tampered with. The default posture is deny-all until a matching policy applies.
- **Session tokens.** Access is authorized by short-lived JWT session tokens issued by the auth provider. A "sign out of all devices" option revokes active sessions.

## 2. Protection of secrets and API keys

- **Server-side AI key.** The Anthropic API key is stored as a server-side secret and is **never** shipped to the browser bundle. All AI calls go through a server-side proxy (a Supabase Edge Function) that injects the key.
- **Authenticated AI proxy.** The AI proxy requires a valid user session (JWT) before it will process a request, so only signed-in users can use — and spend — AI capacity.
- **Rate limiting.** The AI proxy enforces per-user rate limits (a capped number of requests per time window) to mitigate abuse and runaway usage.
- **Payment secrets** (if billing is enabled) are handled by Stripe; card data is not stored by the App.

## 3. Encryption in transit

- All connections between the browser, our server functions, and third-party providers (Supabase, Anthropic, Google, Stripe) use encrypted HTTPS/TLS.
- Data at rest is stored on managed cloud infrastructure (Supabase/Postgres) which provides encryption at rest per its provider standards.

## 4. Handling of uploaded documents

- Uploaded bank statements and receipts are transmitted over TLS through our authenticated proxy to Anthropic solely for extraction.
- We do **not** persist a separate stored copy of the raw uploaded file after extraction; only the extracted transactions are written to the user's private records.
- A request body size limit is enforced at the proxy to bound the data accepted per request.

## 5. Data minimization

- The AI advisor receives a **summary** of a user's finances, not the full transaction ledger.
- We do not collect government IDs, full card numbers, or plaintext passwords.

## 6. Deletion and data lifecycle

- Users can permanently clear their financial data in-app ("Clear All Data").
- The database schema uses `ON DELETE CASCADE` from the auth user to financial data, so deleting the user account removes the associated financial data automatically.
- See the **Data Deletion Process** document for details.

## 7. Dependencies and updates

- The App is built on maintained platforms (Supabase, Vercel, Anthropic API, React/Vite). We apply updates to address known issues on a reasonable-effort basis.

## 8. Known limitations (transparency)

- Some non-sensitive preferences and trial state are stored in the browser's local storage; these are not encrypted and can be read on the user's own device.
- We rely on third-party sub-processors (see Privacy Policy) and are dependent on their security posture for the portions they handle.
- As a single-operator project, we do not currently maintain formal certifications (e.g. SOC 2, ISO 27001). [Update if this changes.]

## 9. Reporting a vulnerability or incident

If you discover a security vulnerability or suspect a data incident, please contact **[security@yourdomain.com]** with details. Please do not publicly disclose the issue before we have had a reasonable opportunity to respond. See the **Incident Response Contact** document.
