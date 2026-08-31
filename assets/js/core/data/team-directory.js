window.MKNexus = window.MKNexus || {};

/* MK NEXUS — Team Directory: "Layer 2" scoping for the Rent/Expenses
   report views. Fetches the lightweight EngineerID/SectorID/ManagerID
   roster from mk-nexus-core's getTeamDirectory action (see
   backend/mk-nexus-core/directory.gs) and uses it to cross-reference a
   Rent/Expenses report row's bare `engineerId` against the current
   viewer — those two backends have no login/session concept of their
   own (see their READMEs' "Still open" sections), so this is the only
   place that identity check can happen today.

   Two scopes, narrowest wins:
     - Manager: only the engineers whose ManagerID names this Manager's
       own user ID (MKNexus.Access.currentUserId()).
     - Section Manger: every row in this Section Manger's whole sector
       (SectorID match) — broader, since a sector can contain several
       Managers' teams.
     - Admin: everyone, unfiltered (unchanged from before this feature).

   NOT a hard security boundary — see modules/rent.js/expenses.js's own
   comments and both backends' READMEs. This hides rows outside the
   viewer's scope in the client; the report endpoint itself still
   returns every row to whoever calls it with the (client-visible)
   adminKey, same as before this feature existed. */
MKNexus.TeamDirectory = (function () {
  let loadPromise = null;
  let bySector = null; // Map<sectorId, Set<engineerId>>
  let byManager = null; // Map<managerId, Set<engineerId>>

  function ensureLoaded() {
    if (loadPromise) return loadPromise;
    loadPromise = MKNexus.ApiClient.getTeamDirectory()
      .then((rows) => {
        bySector = new Map();
        byManager = new Map();
        (Array.isArray(rows) ? rows : []).forEach((row) => {
          const sectorId = String(row?.sectorId || '').trim();
          const managerId = String(row?.managerId || '').trim();
          const engineerId = String(row?.engineerId || '').trim();
          if (!engineerId) return;
          if (sectorId) {
            if (!bySector.has(sectorId)) bySector.set(sectorId, new Set());
            bySector.get(sectorId).add(engineerId);
          }
          if (managerId) {
            if (!byManager.has(managerId)) byManager.set(managerId, new Set());
            byManager.get(managerId).add(engineerId);
          }
        });
      })
      .catch((error) => {
        // Fails safe: an empty directory means filterToMyScope() below
        // shows nothing rather than falling back to "show everyone" —
        // a broken/unreachable directory should never widen access.
        bySector = new Map();
        byManager = new Map();
        console.warn('[MK Nexus] Team directory unavailable — scoped reports will show no rows until this succeeds.', error);
      });
    return loadPromise;
  }

  function mySectorEngineerIds() {
    const sectorId = MKNexus.Access.currentSectorId();
    if (!sectorId || !bySector) return new Set();
    return bySector.get(sectorId) || new Set();
  }

  function myManagedEngineerIds() {
    const userId = MKNexus.Access.currentUserId();
    if (!userId || !byManager) return new Set();
    return byManager.get(userId) || new Set();
  }

  // Admins see every row unfiltered (same as before this feature
  // existed). Manager gets the narrowest scope (their own engineers
  // only, via ManagerID). Everyone else who reaches a report view at
  // all — practically just Section Manger — gets the whole-sector scope.
  // Call ensureLoaded() first for non-admins so the maps are populated.
  function filterToMyScope(rows) {
    if (MKNexus.Access.isAdmin()) return rows;
    const allowed = MKNexus.Access.currentRole() === MKNexus.Access.ROLES.MANAGER
      ? myManagedEngineerIds()
      : mySectorEngineerIds();
    return (Array.isArray(rows) ? rows : []).filter((row) => allowed.has(String(row?.engineerId || '').trim()));
  }

  return { ensureLoaded, mySectorEngineerIds, myManagedEngineerIds, filterToMyScope };
})();
