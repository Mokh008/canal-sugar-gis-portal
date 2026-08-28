/**
 * ============================================================
 * MK NEXUS BACKEND — TEAM DIRECTORY
 * NEW FILE. One lightweight read action (getTeamDirectory, wired in
 * router.gs / config.gs) so the Rent/Expenses frontend modules can scope
 * their admin-report views to "my sector" for Section Manger/Manager
 * accounts, instead of the all-or-nothing choice that existed before
 * (isAdmin() ? show every sector's data : show nothing).
 *
 * WHY THIS LIVES HERE, NOT ON THE RENT/EXPENSES BACKENDS: those two are
 * separate Apps Script deployments with no login/session concept at all
 * (see backend/rent/README.md and backend/expenses/README.md's "Still
 * open" sections) — their report rows only carry a bare `engineerId`
 * with no sector info and no way to verify who's asking. Rather than
 * build a second authentication system for them, this mirrors the
 * pattern already used for the per-engineer ID lock (Users.EngineerID
 * on the session, see auth.gs): the one backend that *does* have real
 * login/sessions exposes the Users-sheet roster, and the Rent/Expenses
 * frontend modules cross-reference a report row's engineerId against it
 * client-side. Not a hard security boundary for Rent/Expenses' own data
 * (nothing can be, until those two backends get real auth — a bigger,
 * separately-scoped fix) but it does correctly restrict who sees what
 * inside the one piece of this system that IS authenticated.
 * ============================================================
 */

/**
 * Returns the active-user roster, non-sensitive fields only (no email,
 * username, or password/salt) — just enough to group people by sector:
 * EngineerID (matches Rent/Expenses' own engineerId field), SectorID,
 * FullName, and the canonicalized Role. Restricted to Manager and above
 * (see router.gs) since this is only ever consumed by report-scoping
 * logic those roles need; Engineer/Supervisor accounts have no use for
 * it and don't get it.
 * @param {Object} context
 * @returns {Array<Object>}
 */
function handleGetTeamDirectory_(context) {
  const users = readSheetAsObjects_(CONFIG.SHEETS.USERS);

  return users
    .filter(u => String(u.IsActive).toUpperCase() !== 'FALSE')
    .map(u => ({
      engineerId: u.EngineerID ? String(u.EngineerID).trim() : '',
      sectorId: u.SectorID ? String(u.SectorID).trim() : '',
      name: u.FullName || '',
      role: normalizeRole_(u.Role)
    }))
    // A row with no EngineerID can't be cross-referenced against a
    // Rent/Expenses report row (which is always keyed by engineerId), so
    // it's dead weight for this endpoint's one purpose — drop it rather
    // than making every caller filter it out themselves.
    .filter(row => row.engineerId !== '');
}
