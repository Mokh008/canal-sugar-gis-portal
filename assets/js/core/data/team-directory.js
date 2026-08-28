window.MKNexus = window.MKNexus || {};

/* MK NEXUS — Team Directory: "Layer 2" sector scoping for the Rent/
   Expenses report views. Fetches the lightweight EngineerID/SectorID
   roster from mk-nexus-core's new getTeamDirectory action (see
   backend/mk-nexus-core/directory.gs) and uses it to cross-reference a
   Rent/Expenses report row's bare `engineerId` against the current
   Section Manger/Manager's own sector — those two backends have no
   login/session concept of their own (see their READMEs' "Still open"
   sections), so this is the only place that identity check can happen
   today.

   NOT a hard security boundary — see modules/rent.js/expenses.js's own
   comments and both backends' READMEs. This hides rows outside the
   viewer's sector in the client; the report endpoint itself still
   returns every row to whoever calls it with the (client-visible)
   adminKey, same as before this feature existed. */
MKNexus.TeamDirectory = (function () {
  let loadPromise = null;
  let bySector = null; // Map<sectorId, Set<engineerId>>

  function ensureLoaded() {
    if (loadPromise) return loadPromise;
    loadPromise = MKNexus.ApiClient.getTeamDirectory()
      .then((rows) => {
        bySector = new Map();
        (Array.isArray(rows) ? rows : []).forEach((row) => {
          const sectorId = String(row?.sectorId || '').trim();
          const engineerId = String(row?.engineerId || '').trim();
          if (!sectorId || !engineerId) return;
          if (!bySector.has(sectorId)) bySector.set(sectorId, new Set());
          bySector.get(sectorId).add(engineerId);
        });
      })
      .catch((error) => {
        // Fails safe: an empty directory means filterToMySector() below
        // shows nothing rather than falling back to "show everyone" —
        // a broken/unreachable directory should never widen access.
        bySector = new Map();
        console.warn('[MK Nexus] Team directory unavailable — sector-scoped reports will show no rows until this succeeds.', error);
      });
    return loadPromise;
  }

  function mySectorEngineerIds() {
    const sectorId = MKNexus.Access.currentSectorId();
    if (!sectorId || !bySector) return new Set();
    return bySector.get(sectorId) || new Set();
  }

  // Admins see every row unfiltered (same as before this feature
  // existed); everyone else who reaches a report view at all (Section
  // Manger/Manager — see MKNexus.Access.canViewReports()) sees only
  // rows whose `engineerId` belongs to their own sector. Call
  // ensureLoaded() first for non-admins so `bySector` is populated.
  function filterToMySector(rows) {
    if (MKNexus.Access.isAdmin()) return rows;
    const allowed = mySectorEngineerIds();
    return (Array.isArray(rows) ? rows : []).filter((row) => allowed.has(String(row?.engineerId || '').trim()));
  }

  return { ensureLoaded, mySectorEngineerIds, filterToMySector };
})();
