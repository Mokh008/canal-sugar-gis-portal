# Expenses Backend — Security Fixes

Mirrors the Apps Script project behind `assets/js/api/expenses-config.js`'s
`webAppUrl`. Paste `Code.gs` into that project, replacing the existing
file — every function name and the PDF-generation logic are preserved
exactly, only the sections below actually changed behavior.

## Fixed now

**Bug — admin Report tab showed no data and an empty month dropdown.**
The frontend (`modules/expenses.js`, `api/expenses-client.js`) has always
called `action=getExpensesReport`, but this backend never implemented
it — every call fell through to the `Invalid GET` response, which reads
to the frontend as "not an array" and shows the config-warning message
instead of a report (and since the month `<select>` is built from the
report rows themselves, no rows meant no months either). Added
`getExpensesReport()` — reads every row `saveExpense()` has ever
appended to `Expenses_Data` (one row per Per Diem/Transportation/
Electricity entry) and reshapes it into what the report view expects,
gated by the same `adminKey` the frontend already sends. See the code
comment above `getExpensesReport()` for the one known limitation this
carries over unchanged: `month` is stored as a bare 1–12 number with no
year, so multi-year reports for the same month number will merge under
one label until a real year column is added — worth fixing at the
source (the month `<select>` in `modules/expenses.js`) if this becomes
a real problem, not something this patch invents a workaround for.

## Fixed earlier

**Critical — client-computed reimbursement total, trusted verbatim.**
`saveExpense()` used to read `Number(d.total) || 0` straight from the
request body — a modified request could claim any per-diem amount for
the same set of checked days. It's now recomputed server-side: the
actual checked-day count is derived from `d.breakdown` (itself only
ever populated from real attendance records via `getAttendanceDays()`)
and multiplied by a fixed `PER_DIEM_RATE_PER_DAY` constant (`200`,
matching the frontend's `livingRatePerDay`). The client-supplied
`d.total` is no longer read anywhere. **If you ever change the rate,
update `PER_DIEM_RATE_PER_DAY` in this file too** — the frontend's copy
only affects what the user previews before submitting.

**Medium — no upper bound on transport/electricity amounts.** These
don't have a fixed formula to recompute server-side the way per-diem
does (real transport cost varies by person/route), so they're still
client-supplied — but now capped at `MAX_TRANSPORT_PER_DAY` (2000 EGP)
and `MAX_ELECTRICITY_AMOUNT` (100,000 EGP) as sanity ceilings, rejecting
an obvious typo or deliberately absurd figure rather than silently
saving and PDF-ing it. Adjust both constants to whatever's realistic
for your actual routes/bills.

**Low — basic input hygiene.** `doPost` now rejects a request with a
missing/empty `id` or an out-of-range `month` before it reaches
`saveExpense()`/`generateExpensePDF()`, instead of silently producing a
PDF with a blank employee name.

## Still open — needs a decision, not a guess

**IDOR: `id`/`engineerId` is free-text client input with no ownership
check**, on both `getDays` (read another employee's attendance days)
and the submit flow (submit a claim under any employee's ID). This is
the same shape of issue on the Rent backend (see `backend/rent/README.md`)
and was already flagged from the frontend side.

This backend has no login/session concept at all today — unlike the
Attendance backend, which (per what was shared) already has a `login(id,
pin)` action, implying employee PINs are recorded *somewhere*. Closing
this IDOR properly means giving Expenses (and Rent) the same kind of
real authentication, which is a genuine feature addition, not a
one-line fix — and it depends on information this review doesn't have:

1. **Is there already a PIN/credential store for these employees**
   (the same one Attendance's `login()` uses, or a separate one)? If
   yes, the fix is: add a `login` action here mirroring Attendance's,
   have the Expenses frontend module prompt for id+PIN once and store a
   session token (same `CacheService` pattern as `mk-nexus-core/auth.gs`),
   and require that token on `getDays`/submit instead of trusting the
   bare `id`.
2. **If no PIN store exists for Expenses/Rent specifically**, the
   options are: (a) provision one (short numeric PINs, hashed at rest,
   same as Attendance presumably does), or (b) have these two modules
   piggyback on the *shell's* MK Nexus login instead (the session token
   from `mk-nexus-core`) — which requires a way to map a shell user to
   their `engineerId`, e.g. a column on the `Users` sheet.

Happy to implement either once you confirm which applies — didn't want
to invent a login system against data this review can't see.

## Not changed, worth knowing about

`savePDF()` shares every generated PDF as "anyone with the link" —
reasonable for a simple share link, but means anyone who ever obtains
that URL (browser history, a forwarded link, a compromised client) can
view it indefinitely with no further auth. Left unchanged since
narrowing it (e.g. to `DriveApp.Access.DOMAIN` if you're on Google
Workspace) could break the download flow if you're not on Workspace —
your call on whether that trade-off is worth it.
