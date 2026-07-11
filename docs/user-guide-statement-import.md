# User Guide — Uploading a Bank Statement

> This is user-facing help for the statement-import feature. Paste/adapt this into
> the Word user manual (`NRI_Finance_App_User_Manual.docx`) — that file is a binary
> Word document and can't be edited directly in the codebase.

## Uploading to the right account

**Always upload a statement from the account it belongs to.** The easiest way:

1. Go to **Accounts**.
2. Find the account (e.g. *Burgan Current*).
3. Tap **📄 Upload or Scan Document** *on that account's card*.
4. Choose your PDF / Excel / CSV / image and confirm.

The transactions are added to **that** account, and its balance updates to reflect
them. The app uses the account you upload into — it does **not** try to guess the
account from the file. This is why uploading from the correct account's card
matters, especially if you have two accounts at the same bank (e.g. a Current and
a Savings account).

> If you use the **Upload or Scan Document** button on the **Transactions** page
> instead (not tied to one account), the app will ask you to pick the account
> before importing. Pick the correct one.

## "Wrong account for this statement" — currency mismatch

If the statement is in a **different currency** than the account you're uploading
into (for example, an **INR** statement uploaded into a **KWD** account), the app
**stops the import** and shows a warning. **Nothing is imported** — your balances
are left untouched.

This protects you: importing an INR statement into a KWD account would record the
amounts in the wrong currency and make your balance wrong.

**What to do:**
- Upload the statement to an account in the **matching currency** (the message
  lists any you have), **or**
- Add a new account in that currency first, then upload to it, **or**
- If you actually chose the wrong file, go back and pick the correct statement.

## Tips
- Large multi-month statements are processed in parts and may take up to ~2 minutes.
- Excel/CSV exports from your bank import fastest and most reliably.
- Setting your account's **account number** (last 4 digits) helps the app suggest
  the right account automatically when you use the global upload button.
