# MK Nexus Backends — Security Review

Four independent Google Apps Script projects power this platform. None
of them are git-tracked before now; the source was shared as plain text
for review. This folder holds corrected versions of the ones reviewed
so far, organized one subfolder per project, each ready to paste back
into its Apps Script editor (or push via `clasp` if you use it).

| Folder | Deployment | Status |
|---|---|---|
| `mk-nexus-core/` | `assets/js/api/config.js`'s `baseUrl` (Geo Intelligence: login, boundaries, KPIs, users, audit) | ✅ Reviewed & fixed |
| `expenses/` | `assets/js/api/expenses-config.js`'s `webAppUrl` | ✅ Reviewed & fixed |
| `rent/` | `assets/js/api/rent-config.js`'s `paymentUrl` only | ✅ Reviewed & fixed |
| `rent-report/` | `rent-config.js`'s `reportUrl` (separate deployment, admin report) | 🆕 `getRentReport` was never implemented there at all — this is a new standalone addition, written without ever having seen that project's actual source (see `rent-report/README.md` for the assumptions it makes); merge by hand, don't paste-overwrite |
| `attendance/` | `assets/js/api/attendance-config.js`'s `webAppUrl` | ⏳ Waiting on the current source — the file initially shared for this turned out to be outdated |

## Priority order, across everything reviewed

1. **Critical — Rent's `printReceipts`/`confirmPayment` have zero
   authentication.** A financial "mark as paid" write anyone can
   trigger, and a PDF containing national ID numbers anyone can
   generate and receive a link to. See `rent/README.md`.
2. **Critical — MK Nexus Core stored/compared passwords in plain
   text.** Fixed via a self-healing hash-on-login migration in
   `mk-nexus-core/auth.gs` — **run `runOneTimePasswordMigration_()`
   once** from the Apps Script editor to migrate everyone immediately.
3. **Critical — MK Nexus Core shipped 8 read actions fully
   unauthenticated**, self-labeled "temporary, revert before
   production." Reverted in `mk-nexus-core/router.gs`.
4. **Critical — Expenses trusted a client-computed reimbursement
   total verbatim.** Fixed: now recomputed server-side from the actual
   checked-day count × a fixed rate. See `expenses/README.md`.
5. **High — Expenses' and Rent's `id`/`engineerId` params have no
   ownership check** (view/act on anyone's records by changing an ID).
   This is the one significant item left open across both — it needs a
   real login/session added to both backends, and the right design
   depends on whether an employee PIN store already exists (Attendance
   implies one might, via its own `login(id, pin)` action). Detailed in
   both READMEs' "Still open" sections with concrete options — happy to
   implement once you pick one.
6. **Bug (not a security item) — both admin Report tabs (Rent, Expenses)
   loaded no data and an empty month dropdown**, because the
   `getRentReport`/`getExpensesReport` actions the frontend has always
   called were never implemented on either live deployment (confirmed by
   calling both directly — each returned an `Invalid action`/`Invalid
   GET` error, not report data). Implemented in `expenses/Code.gs` and
   new `rent-report/Code.gs` — see those two READMEs.

## What wasn't touched, and why

- Working spreadsheet/PDF-generation logic (Expenses' `generateExpensePDF`,
  Rent's `printReceipts`' cell-filling) was left exactly as-is. It's
  intricate, clearly already tuned against real templates, and this
  review has no way to test a rewrite of it — changes here were kept to
  validation/input boundaries around that logic, not the logic itself.
- `mk-nexus-core`'s individual `handleGet*_`/`handleCreate*_`/etc.
  handlers, and whatever file defines `readSheetAsObjects_`,
  `appendRowFromObject_`, `sanitizeString_`/`sanitizeObject_`,
  `AppError_`, `logError_`/`logWarning_`, and `generateId_`, weren't
  shared for this review — send them over if you'd like those covered
  too (the `getGovernorates`/etc. handlers in particular are worth a
  look now that they actually require auth, to make sure they use
  `context.user` for any per-user scoping they should have).
- Drive file-sharing scope (`ANYONE_WITH_LINK` on generated PDFs in
  both Expenses and Rent) wasn't changed unilaterally — narrowing it
  could break the download flow depending on your Google Workspace
  setup. Both READMEs flag it as a recommendation, weighted higher for
  Rent given the national-ID exposure.
