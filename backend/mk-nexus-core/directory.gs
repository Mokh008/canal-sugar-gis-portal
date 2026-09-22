/**
 * ============================================================
 * MK NEXUS BACKEND — TEAM SCOPE ("who is on my team")
 *
 * REWRITTEN. This file used to expose getTeamDirectory: a roster carrying
 * every user's SectorID/ManagerID, which the frontend cross-referenced
 * itself. Placement no longer lives on the Users sheet at all — the Org
 * Chart tool writes it to Org_Assignments (see org-structure.gs) — and the
 * "who counts as my team" question is now answered here, on the server,
 * so no client ever receives the whole org tree just to filter it.
 *
 * WHAT DRIVES ACCESS: the position a person holds in the Org Chart, never
 * their Users.Role (which is only a job title):
 *   - manager of an administration -> the engineers of that
 *                                     administration's regions
 *   - head of a sector             -> the engineers of every region of
 *                                     every administration in the sector
 *   - Admin                        -> everyone
 *   - anyone else                  -> an empty team
 * Consumed by Expenses / Rent (report rows are keyed by the engineer's
 * numeric EngineerID) and Attendance (fingerprint rows are keyed by name).
 *
 * NOT a hard security boundary for Rent/Expenses/Attendance's own data:
 * those three are separate deployments with no session concept, so what
 * this scopes is what the portal chooses to show (see their READMEs).
 * ============================================================
 */

/**
 * Loads everything the scope resolver joins, in one place.
 * @returns {Object}
 */
function loadOrgIndex_() {
  return {
    sectors: readSheetAsObjects_(CONFIG.SHEETS.ORG_SECTORS),
    administrations: readSheetAsObjects_(CONFIG.SHEETS.ORG_ADMINISTRATIONS),
    regions: readSheetAsObjects_(CONFIG.SHEETS.ORG_REGIONS),
    assignments: readOrgAssignments_(),
    users: readSheetAsObjects_(CONFIG.SHEETS.USERS)
  };
}

/**
 * The display name of a Users row. The live sheet's name column is read
 * as `FullName` by login, but users.gs's create path writes `Name` — take
 * whichever is filled in.
 * @param {Object} u
 * @returns {string}
 */
function userDisplayName_(u) {
  return String((u && (u.FullName || u.Name)) || '').trim();
}

function isActiveUserRow_(u) {
  return String(u.IsActive).toUpperCase() !== 'FALSE';
}

/**
 * Every position `userId` holds, as human-readable entries, plus the raw
 * node IDs the scope is computed from.
 * @param {string} userId
 * @param {Object} idx - loadOrgIndex_()
 * @returns {{sectorIds: Array<string>, administrationIds: Array<string>, positions: Array<{level: string, id: string, name: string, path: string}>}}
 */
function findOrgPositions_(userId, idx) {
  const byId = rows => rows.reduce((m, r) => { m[String(r.ID)] = r; return m; }, {});
  const sectors = byId(idx.sectors), administrations = byId(idx.administrations), regions = byId(idx.regions);

  const sectorIds = [], administrationIds = [], positions = [];
  idx.assignments.filter(a => String(a.UserID) === String(userId)).forEach(a => {
    const nodeId = String(a.NodeID);
    if (a.Level === CONFIG.ORG_LEVELS.SECTOR && sectors[nodeId]) {
      sectorIds.push(nodeId);
      positions.push({ level: a.Level, id: nodeId, name: sectors[nodeId].Name, path: sectors[nodeId].Name });
    } else if (a.Level === CONFIG.ORG_LEVELS.ADMINISTRATION && administrations[nodeId]) {
      administrationIds.push(nodeId);
      const sector = sectors[String(administrations[nodeId].SectorID)];
      positions.push({
        level: a.Level, id: nodeId, name: administrations[nodeId].Name,
        path: (sector ? sector.Name + ' › ' : '') + administrations[nodeId].Name
      });
    } else if (a.Level === CONFIG.ORG_LEVELS.REGION && regions[nodeId]) {
      const administration = administrations[String(regions[nodeId].AdministrationID)];
      const sector = administration ? sectors[String(administration.SectorID)] : null;
      positions.push({
        level: a.Level, id: nodeId, name: regions[nodeId].Name,
        path: [sector && sector.Name, administration && administration.Name, regions[nodeId].Name].filter(Boolean).join(' › ')
      });
    }
  });
  return { sectorIds: sectorIds, administrationIds: administrationIds, positions: positions };
}

/**
 * The one thing stamped onto the session at login (auth.gs): whether this
 * account manages anyone. Lets the frontend decide which sidebar modules
 * to show (Attendance; the Rent/Expenses Report tab) without waiting on a
 * second round trip.
 *
 * CRITICAL: this reads Org_Assignments and NOTHING else. It used to call
 * the same loadOrgIndex_()/findOrgPositions_() pair getMyScope uses to
 * ALSO build human-readable `positions` (sector/administration/region
 * names, joined into a display path) — which meant every login did five
 * full-sheet reads (Org_Sectors, Org_Administrations, Org_Regions,
 * Org_Assignments, and — pure waste — Users a second time, already read
 * once by handleLogin_ just above) before the login response could go
 * out. That is squarely inside a request the client aborts after 15s
 * (assets/js/api/config.js's timeoutMs), and is the prime suspect for
 * login timeouts reported after this feature shipped — Apps Script's
 * per-sheet read latency plus mobile-network RTT adds up fast across
 * five reads that were never actually login-critical.
 *
 * `positions` (the display list with names) is no longer computed here.
 * It never gated anything — every consumer (Attendance's header badge,
 * Settings' Profile tab) already has a graceful "—" fallback — and it is
 * available with zero extra cost from getMyScope's own `positions` field
 * once TeamDirectory.ensureLoaded() resolves (core/data/team-directory.js),
 * which Attendance already awaits before rendering. Settings' Profile tab
 * now awaits the same thing instead of reading session.profile.positions.
 *
 * Never throws — a broken Org_Assignments sheet must not be able to block
 * a login; treated as "manages nothing" instead.
 * @param {string} userId
 * @returns {{managesTeam: boolean, positions: Array<Object>}}
 */
function getLoginOrgInfo_(userId) {
  try {
    const managesTeam = readOrgAssignments_().some(a =>
      String(a.UserID) === String(userId) &&
      (a.Level === CONFIG.ORG_LEVELS.SECTOR || a.Level === CONFIG.ORG_LEVELS.ADMINISTRATION));
    // `positions: []` kept in the shape (not dropped) so a frontend build
    // that still reads session.profile.positions before this deploy lands
    // gets an empty list rather than `undefined`.
    return { managesTeam: managesTeam, positions: [] };
  } catch (err) {
    logError_('Org info lookup failed at login for user ' + userId, { message: err && err.message });
    return { managesTeam: false, positions: [] };
  }
}

/**
 * Route handler: GET_MY_SCOPE (any authenticated account). Returns the
 * caller's positions and the team they may see:
 *   team       - people placed in a region within the caller's scope
 *   unassigned - Admin only: active Engineer/Supervisor accounts that hold
 *                no position anywhere yet (so a gap shows up instead of
 *                silently missing from every report)
 * Each member carries what the three consumers key on: `engineerId`
 * (Expenses/Rent report rows), `name`/`attendanceName` (Attendance
 * fingerprint rows), and the region/administration/sector they sit in.
 * Inactive accounts are never included.
 * @param {Object} context
 * @returns {{isAdmin: boolean, managesTeam: boolean, positions: Array<Object>, team: Array<Object>, unassigned: Array<Object>}}
 */
function handleGetMyScope_(context) {
  const idx = loadOrgIndex_();
  const isAdmin = context.user.role === CONFIG.ROLES.ADMIN;
  const mine = findOrgPositions_(context.user.id, idx);

  const inScopeAdministrations = {};
  if (isAdmin) {
    idx.administrations.forEach(a => { inScopeAdministrations[String(a.ID)] = true; });
  } else {
    mine.administrationIds.forEach(id => { inScopeAdministrations[id] = true; });
    idx.administrations.forEach(a => {
      if (mine.sectorIds.indexOf(String(a.SectorID)) !== -1) inScopeAdministrations[String(a.ID)] = true;
    });
  }

  const byId = rows => rows.reduce((m, r) => { m[String(r.ID)] = r; return m; }, {});
  const sectors = byId(idx.sectors), administrations = byId(idx.administrations), regions = byId(idx.regions);
  const users = byId(idx.users);

  const toMember = (user, region) => {
    const administration = region ? administrations[String(region.AdministrationID)] : null;
    const sector = administration ? sectors[String(administration.SectorID)] : null;
    return {
      userId: String(user.ID),
      engineerId: user.EngineerID ? String(user.EngineerID).trim() : '',
      name: userDisplayName_(user),
      attendanceName: user.AttendanceName ? String(user.AttendanceName).trim() : '',
      role: normalizeRole_(user.Role),
      regionId: region ? String(region.ID) : '',
      regionName: region ? String(region.Name) : '',
      administrationId: administration ? String(administration.ID) : '',
      administrationName: administration ? String(administration.Name) : '',
      sectorId: sector ? String(sector.ID) : '',
      sectorName: sector ? String(sector.Name) : ''
    };
  };

  const team = [];
  idx.assignments.forEach(a => {
    if (a.Level !== CONFIG.ORG_LEVELS.REGION) return;
    const region = regions[String(a.NodeID)];
    const user = users[String(a.UserID)];
    if (!region || !user || !isActiveUserRow_(user)) return;
    if (!inScopeAdministrations[String(region.AdministrationID)]) return;
    team.push(toMember(user, region));
  });

  // "Unassigned" = holds NO position anywhere in the Org Chart. Someone who
  // manages an administration or heads a sector is placed, even if they
  // aren't the engineer of any particular region.
  const holdsAnyPosition = {};
  idx.assignments.forEach(a => { holdsAnyPosition[String(a.UserID)] = true; });

  const unassigned = [];
  if (isAdmin) {
    idx.users.forEach(u => {
      if (!isActiveUserRow_(u) || holdsAnyPosition[String(u.ID)]) return;
      const role = normalizeRole_(u.Role);
      if (role === CONFIG.ROLES.ENGINEER || role === CONFIG.ROLES.SUPERVISOR) unassigned.push(toMember(u, null));
    });
  }

  return {
    isAdmin: isAdmin,
    managesTeam: isAdmin || mine.sectorIds.length + mine.administrationIds.length > 0,
    positions: mine.positions,
    team: team,
    unassigned: unassigned
  };
}
