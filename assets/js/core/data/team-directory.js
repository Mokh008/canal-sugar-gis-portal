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
  // WHOSE scope the cache above holds (Users-sheet ID). Logging out and
  // signing in as someone else does NOT reload the page, so a cache that
  // isn't tied to a person would hand the previous account's team (an
  // Admin's = everyone) to the next one. Everything below checks it.
  let loadedFor = null;

  function currentKey() {
    return String(MKNexus.SessionData?.profile?.id || '');
  }

  function emptyScope() {
    return { isAdmin: false, managesTeam: false, positions: [], team: [], unassigned: [] };
  }

  // Fetched once per signed-in person — the Org Chart is edited rarely, and
  // every module opening shouldn't refetch it. Refetched automatically when
  // a different account signs in (see loadedFor), on reset() (login/logout),
  // or with { force: true }.
  function ensureLoaded({ force = false } = {}) {
    const key = currentKey();
    if (loadPromise && !force && loadedFor === key) return loadPromise;
    loadedFor = key;
    scope = null; // never serve the previous account's scope while this one loads
    const request = MKNexus.ApiClient.getMyScope()
      .then((data) => {
        if (loadedFor !== key) return; // someone else signed in while this was in flight
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
        if (loadedFor !== key) return;
        scope = emptyScope();
        loadPromise = null;
        console.warn('[MK Nexus] Team scope unavailable — scoped views will show no rows until this succeeds.', error);
      });
    loadPromise = request;
    return request;
  }

  // Forget everything — called on login and logout so no account ever
  // starts from another account's cached team.
  function reset() {
    loadPromise = null;
    scope = null;
    loadedFor = null;
  }

  function getScope() {
    // Belt and braces: a scope that belongs to a different account than the
    // one signed in now is treated as "not loaded", i.e. an empty team.
    return scope && loadedFor === currentKey() ? scope : emptyScope();
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

  return { ensureLoaded, getScope, reset, myEngineerIds, filterToMyScope };
})();
