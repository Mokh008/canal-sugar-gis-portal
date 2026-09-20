window.MKNexus = window.MKNexus || {};

/* MK NEXUS — Team Directory: "who is on my team", for the Rent/Expenses
   report views and the Attendance dashboard.

   The answer comes from the server (mk-nexus-core's getMyScope, see
   backend/mk-nexus-core/directory.gs), which works it out from the Org
   Chart for whoever is logged in — this file just fetches it once per
   session and offers the matching helpers. Placement is NOT read from the
   Users sheet (that stays descriptive only); it is set exclusively in the
   Org Chart module:
     - manager of an administration -> the engineers of that
       administration's regions
     - head of a sector             -> the engineers of every region of
       every administration in that sector
     - Admin                        -> everyone, unfiltered
     - anyone else                  -> nobody

   Each team member carries what the consumers key on: `engineerId`
   (Rent/Expenses report rows are keyed by it) and `name`/`attendanceName`
   (Attendance fingerprint rows are keyed by name), plus the region /
   administration / sector the person sits in.

   NOT a hard security boundary — Rent/Expenses/Attendance are separate
   deployments with no session concept of their own (see modules/rent.js,
   modules/expenses.js and the backend READMEs). This decides what the
   portal shows; the report endpoints themselves still return every row to
   whoever calls them directly. */
MKNexus.TeamDirectory = (function () {
  let loadPromise = null;
  let scope = null; // last getMyScope() response, or an empty fail-safe

  function emptyScope() {
    return { isAdmin: false, managesTeam: false, positions: [], team: [], unassigned: [] };
  }

  // Fetched once per session (login reloads the page state) — the Org
  // Chart is edited rarely, and every module opening shouldn't refetch it.
  // Pass { force: true } to refetch, e.g. after the user asks to refresh.
  function ensureLoaded({ force = false } = {}) {
    if (loadPromise && !force) return loadPromise;
    loadPromise = MKNexus.ApiClient.getMyScope()
      .then((data) => {
        scope = {
          ...emptyScope(),
          ...(data || {}),
          team: Array.isArray(data?.team) ? data.team : [],
          unassigned: Array.isArray(data?.unassigned) ? data.unassigned : [],
        };
      })
      .catch((error) => {
        // Fails safe: an unreachable scope means non-admins see no rows
        // rather than falling back to "show everyone" — a broken lookup
        // should never widen access. Drop the cached promise so the next
        // module open retries instead of staying broken for the session.
        scope = emptyScope();
        loadPromise = null;
        console.warn('[MK Nexus] Team scope unavailable — scoped views will show no rows until this succeeds.', error);
      });
    return loadPromise;
  }

  function getScope() {
    return scope || emptyScope();
  }

  function trimmed(value) {
    return String(value ?? '').trim();
  }

  // engineerIds of everyone on the caller's team — what Rent/Expenses
  // report rows are matched against.
  function myEngineerIds() {
    return new Set(getScope().team.map((m) => trimmed(m.engineerId)).filter(Boolean));
  }

  // Admins see every row unfiltered. Everyone else sees only rows whose
  // `engineerId` belongs to their team. Call ensureLoaded() first for
  // non-admins so the team is populated.
  function filterToMyScope(rows) {
    if (MKNexus.Access.isAdmin()) return rows;
    const allowed = myEngineerIds();
    return (Array.isArray(rows) ? rows : []).filter((row) => allowed.has(trimmed(row?.engineerId)));
  }

  return { ensureLoaded, getScope, myEngineerIds, filterToMyScope };
})();
