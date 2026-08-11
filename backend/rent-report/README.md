# Rent Admin Report Backend — SUPERSEDED

**`getRentReport` now lives directly in `backend/rent/Code.gs`** (the
same project as `paymentUrl`), so `reportUrl` can just point at that same
deployment instead of a second one — one file to paste, like Expenses.
This folder is only useful if you deliberately want the report on its
own, separate deployment from `getAssets`/`confirmPayment`/`printReceipts`
— everything below still applies to that scenario.

# Rent Admin Report Backend — NEW

This covers **`reportUrl`** in `assets/js/api/rent-config.js` — a
*separate* Apps Script deployment from `backend/rent/Code.gs` (which only
covers `paymentUrl`). The only action the frontend ever calls against
this URL is `getRentReport` (`modules/rent.js` / `api/rent-client.js`),
so `Code.gs` in this folder is a complete, self-contained file — paste it
in as a full replacement of whatever's in that project today, the same
way as `backend/expenses/Code.gs`. (If that project turns out to already
serve some other, unrelated action too, check first — this file's `doGet`
doesn't preserve anything it doesn't already know about.)

## Why this was needed

Confirmed live: hitting `reportUrl` with
`?action=getRentReport&adminKey=mk_admin_2025` currently returns
`{"error":"Invalid action"}` — the action the frontend has always called
(`modules/rent.js`, `api/rent-client.js`) simply isn't implemented on
that deployment. The frontend correctly reads a non-array response as
"backend not configured" and shows a warning instead of a report; since
the month `<select>` is built from the report rows' `.month` values,
zero rows also left the month dropdown empty. That's the exact symptom
reported: **"التقرير الإداري فاضي + الشهور مش ظاهرة".**

## What `Code.gs` here assumes

- The reportUrl project's *active* spreadsheet has the same
  `Master_Rent_Contracts` / `Rent_Payments` sheets (same names, same
  column layout) as the paymentUrl project reads from in
  `backend/rent/Code.gs` — confirmed live against the real
  `Rent_Payments` sheet (`Receipt_ID, Engineer_ID, OWNER_NAME,
  AMOUNT_TEXT, OWNER_NATIONAL_ID, Asset_Name, Month, PAYMENT_DATE,
  PDF_URL, Department, Engineer_Name, Month_Key`), which matches the
  positional reads in `getRentReport()` exactly. If this ever points at
  a different spreadsheet or different sheet/column names, adjust
  `RENT_REPORT_MASTER_SHEET`/`RENT_REPORT_PAYMENTS_SHEET` at the top of
  `Code.gs`.
- Report rows cover a rolling 19-month window (6 months back / 12
  ahead of today) — the same window `modules/rent.js`'s `MONTHS_LIST`
  generates client-side for the "pay" month picker, so the two never
  drift apart.
- `Master_Rent_Contracts` has no `Engineer_Name` column in the schema
  `backend/rent/Code.gs` reads (only `Engineer_ID` is used there) — if
  this report's spreadsheet doesn't have one either, `engineerName`
  comes back blank and the frontend already renders that as `—`.

## Security note

Same shape as the other three backends reviewed: `adminKey` is a static
string shipped in the public frontend bundle, not a real secret — this
only stops casual/accidental access, not a determined caller who reads
the frontend source. Real authorization needs the same session-based fix
flagged in `backend/rent/README.md`; not attempted here since that
backend still has no login/session concept at all.
