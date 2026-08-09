# Rent Backend — Security Fixes

Mirrors the Apps Script project behind `assets/js/api/rent-config.js`'s
**`paymentUrl`** deployment (`getAssets`/`confirmPayment`/`printReceipts`).
Paste `Code.gs` into that project, replacing the existing file.

**Note:** `rent-config.js` points at a *second*, separate deployment for
`reportUrl` (the admin `getRentReport` action, gated by the
`reportAdminKey` already flagged as insecure from the frontend side).
That second project's source wasn't included in what you shared, so it
isn't reviewed here — send it over if you'd like it covered too.

## Fixed now

**Low — basic input hygiene.** Added `validateEngineerId_()` (non-empty,
trimmed, length-bounded) and a matching check that `assetName` is
present on `confirmPayment` — both `doGet`/`doPost` now reject an
obviously malformed request before it reaches the sheet-reading/writing
functions, instead of silently matching nothing or throwing a less
useful error deeper in the call stack.

Everything else — `getEngineerAssets`, `getPaidMonths`, `confirmPayment`'s
duplicate-payment check, `printReceipts`'s PDF assembly — is unchanged.
It's working, fairly intricate spreadsheet logic with no injection risk
found in it (writes go through `appendRow`/`setValue`, not
user-input-built formulas); the real issue here isn't in this logic,
it's that nothing calling it is authenticated at all (next section).

## Still open — the most serious items in this whole review

**Critical — `confirmPayment` has no authentication and directly
records "this rent is paid."** Anyone who can reach this URL can call
`confirmPayment` with any `engineerId`/`assetName`/`month` and it
appends a real row to `Rent_Payments` — there's no payment-gateway
integration behind this, it's a direct "mark as paid" write. That means
a bad actor (or just a curious person) can mark a real office's rent as
paid without any money changing hands, causing a genuine financial/audit
discrepancy (the system says paid, the owner never received anything).
This is more serious than a typical IDOR — it's a state-changing action
on a *financial record* with zero identity verification.

**Critical — PII exposure via `printReceipts`.** The generated receipt
PDF embeds `Owner_National_ID` (Egyptian national ID number) — real,
sensitive PII — and `savePDF`... `file.setSharing(DriveApp.Access.
ANYONE_WITH_LINK, ...)` shares it with anyone who has the URL, which is
returned directly to an unauthenticated caller. Combined with no auth
on generating it, someone could enumerate/guess `engineerId` + `month`
combinations and harvest other people's national ID numbers. This is
the single highest-priority item across all four backends reviewed —
higher priority than the Expenses IDOR, specifically because national
ID is more sensitive than an attendance/expense record and the current
design has *no* barrier between "knows an engineerId" and "gets a PDF
with someone's national ID in it."

**Both of the above need the same underlying fix as Expenses' IDOR**
(see `backend/expenses/README.md`'s "Still open" section for the full
options list) — a real login/session for this backend, most naturally
mirroring whatever PIN mechanism the Attendance backend already has.
Once callers carry a verified session, `confirmPayment`/`printReceipts`
should derive `engineerId` from that session (or at minimum verify the
session's engineerId matches the requested one) instead of trusting the
request body.

Given the financial-record and PII severity here specifically, I'd
suggest prioritizing Rent first if you're tackling these one at a time.
