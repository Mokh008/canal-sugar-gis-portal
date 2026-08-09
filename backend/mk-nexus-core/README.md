# MK Nexus Core Backend — Security Fixes

This mirrors the Apps Script project behind `assets/js/api/config.js`'s
`baseUrl` (the Geo Intelligence backend — login, boundaries, KPIs, users,
audit log). Paste these files into that project's Apps Script editor,
replacing the existing ones of the same name. Files not listed here
(anything besides config/auth/permissions/response/router/validation/audit
— e.g. wherever `readSheetAsObjects_`, `appendRowFromObject_`,
`sanitizeString_`, `sanitizeObject_`, `AppError_`, `logError_`,
`logWarning_`, `generateId_`, `updateLastLogin_`, and the individual
`handleGet*_`/`handleCreate*_`/etc. handlers live — weren't shared for
this review, so they're untouched and not included here.

## What changed and why

### `auth.gs` — Critical: plaintext passwords
The live `Users` sheet was storing passwords in **plain text** in the
`PasswordHash` column and comparing them with a direct string
equality check, despite the file's own header comment claiming SHA-256
hashing and an unused `hashPassword_()` sitting right there. Anyone with
read access to the sheet could read every user's real password.

Fixed with a **self-healing migration**: `verifyPassword_()` still
accepts a legacy plaintext row (so nobody gets locked out on deploy),
and the instant a login succeeds, `upgradePasswordIfNeeded_()` hashes
that password with a fresh per-user salt and overwrites the plaintext —
automatically, no user action needed.

**Recommended one-time step:** open this project in the Apps Script
editor, select `runOneTimePasswordMigration_` from the function
dropdown, and click Run once. This hashes every user immediately
instead of waiting for each person's next login. Safe to run more than
once (it skips anyone already migrated) and safe to leave in the
project permanently afterward.

No manual sheet changes needed — a `Salt` column is added to `Users`
automatically the first time it's needed.

### `auth.gs` — added `handleLogout_`
There was previously no way to invalidate a session token before its
8-hour TTL expired — the old frontend "logout" only cleared the token
client-side, leaving it valid server-side for up to 8 more hours if it
had ever leaked. `logout` is now a real action (see `router.gs`) that
removes the token from `CacheService` immediately.

**Frontend pairing:** the `canal-sugar-gis-portal` repo's
`assets/js/api/config.js`/`client.js` should add `'logout'` to their
action lists (GET is fine — no request body needed, just the token
already sent as a query param) and `app.js`'s `logout()` should call it
before clearing local storage. Say the word and I'll wire that up too.

### `router.gs` — Critical: temporary public routes
8 read actions (`getGovernorates`, `getAdministrations`, `getDistricts`,
`getZones`, `getPolygon`, `getKPIs`, `getPresentation`, `getSettings`)
shipped with `roles: null` — fully public, no session required at all —
under a comment explicitly labeling it `TEMPORARY DEV CONFIGURATION...
revert before production deploy`. All 8 now require at least `VIEWER`.
If the frontend is still being smoke-tested against live data without
a logged-in session anywhere, that will now 401 — expected, and the
fix for that is logging in, not reopening these routes.

### `config.gs`
Added the `LOGOUT` action constant and `AUDIT_ACTIONS.LOGOUT` (`auth.gs`
logs a `LOGOUT` audit entry symmetrically with the existing `LOGIN` one).

### `permissions.gs`, `response.gs`, `validation.gs`
Reviewed, no issues found — included here unchanged so this folder is a
complete, consistent copy of the project. `permissions.gs`'s hierarchy
check fails closed on an unrecognized role (ranks `-1`); `response.gs`
already never leaks stack traces to the client; `validation.gs`'s
writes all go through `Range#setValue`/`appendRow`, not user-input-built
formulas, so no injection risk found there.

### `audit.gs`
Unchanged functionally — see the header comment for a low-severity,
not-currently-exploitable formula-injection note (Sheets can interpret
a cell value starting with `=`/`+`/`-`/`@` as a formula on some write
paths; `entry.user` here is always the caller's own already-
authenticated username, not free-form attacker input, so this is a
"watch if the trust model ever changes" note, not an active bug).
