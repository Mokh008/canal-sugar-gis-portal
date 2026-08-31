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

### `auth.gs` — Critical (found later): the migration above never actually ran
The fix above was correct in design but broken in practice: every place
in this file that identified a user row — `safeUser.id`,
`updateLastLogin_()`, and `setUserPasswordFields_()` (the migration's
own write step) — read/looked up a column called **`UserID`**. That
column doesn't exist anywhere in the real `Users` sheet; its ID column
is named plain **`ID`**. `readSheetAsObjects_` keys its objects by the
sheet's actual headers, so `user.UserID` was always `undefined`, and
`setUserPasswordFields_()`'s `headers.indexOf('UserID')` was always
`-1` — which made it throw ("Users sheet is missing a UserID or
PasswordHash column.") on *every single login*, silently caught and
logged by `upgradePasswordIfNeeded_()`'s try/catch. Net effect: the
plaintext-password fix above never once succeeded since it was written
— passwords have stayed in plain text this whole time despite this
file (and this README) describing it as fixed.

Fixed by changing every `UserID` reference in this file to `ID`,
matching the sheet's real column. **Run `runOneTimePasswordMigration_`
again** after redeploying this fix — it's safe to run repeatedly, and
this time it will actually hash everyone instead of throwing.

This also means `safeUser.id` (used by the audit log, and now by
`directory.gs`'s Manager-level report scoping — see "Role management
update" below) was silently empty for every session until now.

### `auth.gs` — Critical (found later still): `setUserPasswordFields_` threw "Invalid argument: id"
Even after the `ID` fix above, running `runOneTimePasswordMigration_`
threw `Exception: Invalid argument: id` at
`SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)`. This project is bound
directly to the Users spreadsheet (opened via that Sheet's own
**Extensions > Apps Script**, not a standalone script), so
`CONFIG.SPREADSHEET_ID` — sourced from a Script Property that was never
set — was always empty; every *other* function in this codebase reads
the sheet via `readSheetAsObjects_()`, which apparently never needed
that property (it must resolve the bound spreadsheet a different way).
`setUserPasswordFields_` was the one place still hardcoded to
`openById(CONFIG.SPREADSHEET_ID)` specifically. Fixed to try
`SpreadsheetApp.getActiveSpreadsheet()` first (works immediately for a
bound script, no Script Property needed) and fall back to
`openById(CONFIG.SPREADSHEET_ID)` only if that's ever `null` (a
standalone deployment). No Script Property setup needed after this fix.

### `auth.gs` — added `EngineerID` to the login response
`handleLogin_`'s `safeUser` now includes `engineerId` (from a new,
optional `EngineerID` column on the `Users` sheet). `modules/rent.js` and
`modules/expenses.js` use this to fill in the engineer's ID automatically
once they're logged into the shell, instead of asking them to type their
numeric ID by hand on every visit with no way to verify it's really
them. **To wire someone up: add their numeric engineer ID (matching
whatever Rent/Expenses' own sheets use, e.g. `1001777`) in a new
`EngineerID` column on their row in `Users`.** Leave it blank for
accounts that aren't a specific engineer (admins, etc.) — those two
modules fall back to the old manual field exactly as before when it's
empty.

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

## Role management update (module/sector access matrix)

### `config.gs` — roles realigned to the real Users sheet
`CONFIG.ROLES`/`ROLE_HIERARCHY` used to be `Administrator`/`Manager`/
`Viewer` — three values that don't exist anywhere in the live `Users`
sheet. Every real login therefore ranked **-1** ("unrecognized role")
in `getRoleRank_()` and got `FORBIDDEN` on every protected route. Now
`Admin` / `Section Manger` (that spelling is the sheet's own, not a
typo introduced here) / `Manager` / `Engineer` / `Supervisor`, ordered
lowest → highest as `Supervisor < Engineer < Manager < Section Manger <
Admin`. Added `GET_TEAM_DIRECTORY: 'getTeamDirectory'` to `ACTIONS`.

### `permissions.gs` — added `normalizeRole_()`
The sheet mixes casing for the same role (`Manager`/`manager`,
`Engineer`/`engineer`, `Supervisor`/`supervisor`). `getRoleRank_()` does
an exact-string `indexOf`, so without normalizing first, half of those
rows would still rank -1 despite the fix above. `normalizeRole_()`
case-insensitively maps a raw sheet value to one of the five canonical
strings (checked in an order where `Section Manger`/`Admin` win before
the plainer `manager` substring match); called once at login (see
`auth.gs`) so everything downstream — session, permission checks, audit
log, frontend — sees one consistent value per role.

### `auth.gs` — canonicalized role + added `sectorId` to the session
`handleLogin_`'s `safeUser.role` is now `normalizeRole_(user.Role)`
instead of the raw sheet value. Also added `safeUser.sectorId` (from a
new, optional `SectorID` column on `Users`, same pattern as the
existing `EngineerID` column) — a Section Manger/Manager's own row
carries the sector code they head, and every Engineer/Manager/
Supervisor under them carries that same code on their row. Lets the
frontend scope Rent/Expenses report views to "my sector" instead of
only ever an all-or-nothing admin view.

### `router.gs` — role remap + new route
Every route that required the old `VIEWER`/`MANAGER`/`ADMINISTRATOR`
now requires `ADMIN` (the frontend's Geo Intelligence module — the only
caller of any of these actions today — is Admin-only in the new
module-visibility matrix, so the backend now matches). The one
exception: `changePassword` stays open to `SUPERVISOR` (the lowest
role, i.e. any authenticated account), since every user needs to be
able to change their own password regardless of which modules they can
see. Also added the `getTeamDirectory` route, minimum role `MANAGER`
(so Manager/Section Manger/Admin can call it; Engineer/Supervisor
cannot).

### `directory.gs` — new file
Implements `handleGetTeamDirectory_`, a lightweight, non-sensitive
roster read (`EngineerID`/`SectorID`/`ManagerID`/`FullName`/canonical
`Role` only — no email, username, or password fields) used by the
Rent/Expenses frontend to cross-reference a report row's `engineerId`
against the current viewer's scope. See the file's header comment for
why this lives on this backend rather than on Rent/Expenses directly
(those two have no login/session concept at all — see their own
READMEs' "Still open" sections).

## Profile photos (avatar.gs — new file)

Added `uploadAvatar`, a self-service action any authenticated account
can call to set/replace its own profile photo (Settings module's
Profile tab — WhatsApp-style "tap your avatar to change it"). Always
writes to the **caller's own** row (`context.user.id` from the
authenticated session, never a client-supplied id) — nobody can
overwrite someone else's photo this way. Saves the image to a
`MK_Nexus_Avatars` Drive folder (shared "anyone with the link", same
trade-off already made for Rent/Expenses' generated PDFs, lower stakes
here since a profile photo isn't PII the way a national ID number is)
and records the resulting URL — via Drive's `thumbnail?id=...&sz=w512`
endpoint, not the classic `uc?export=view&id=...` form (that one now
often redirects to an HTML viewer page instead of serving raw image
bytes, which silently renders as nothing in an `<img>`/background-image
— found live, fixed before this was documented as working) — in a new
`AvatarUrl` column on `Users`
(added automatically the first time it's needed, same as `Salt` was).
`handleLogin_`'s response now includes `avatarUrl` too. No sheet setup
needed — the column appears on first use.

**To wire someone up (two independent columns on `Users`):**
- `SectorID` — a whole sector's shared code (e.g. `USR001`). Put the
  same code on every row (Manager, Engineer, Supervisor) that belongs
  to a given Section Manger's sector, including the Section Manger's
  own row. A Section Manger sees every row that shares their code.
- `ManagerID` — **new**. A Manager sees only the engineers *directly
  under them*, narrower than their whole sector. Put the Manager's own
  `ID` (the sheet's own `ID` column, e.g. `USR009` — not their
  `EngineerID`) in this column on every Engineer/Supervisor row they
  personally supervise. Leave it blank for anyone with no specific
  Manager (they're still covered by their Section Manger's `SectorID`
  scoping, just not by any Manager's narrower one). A Manager's own row
  still needs `SectorID` filled in like everyone else in their sector,
  but doesn't need a `ManagerID` of its own.

Leave both blank for accounts with no sector/team concept (Admin).
