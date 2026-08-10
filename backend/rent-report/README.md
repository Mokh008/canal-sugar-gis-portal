# Rent Admin Report Backend — NEW

This covers **`reportUrl`** in `assets/js/api/rent-config.js` — a
*separate* Apps Script deployment from `backend/rent/Code.gs` (which only
covers `paymentUrl`). Its existing source was never shared for review, so
`Code.gs` in this folder is written standalone and needs to be merged into
that project by hand (don't overwrite blindly if it already has other
code in it) rather than pasted in wholesale like the other backend fixes.

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
  `backend/rent/Code.gs`. This is the most likely setup (one workbook,
  two deployments reading/writing it), but wasn't verifiable without
  that project's source — if it turns out to point at a different
  spreadsheet or different sheet/column names, adjust
  `RENT_REPORT_MASTER_SHEET`/`RENT_REPORT_PAYMENTS_SHEET` at the top of
  `Code.gs` (or send over the actual project source and this gets
  tailored to match exactly).
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
