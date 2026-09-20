/**
 * ============================================================
 * MK NEXUS BACKEND — ORG STRUCTURE (Org Chart)
 * NEW FILE. CRUD for the organizational reporting hierarchy: Sector ->
 * Administration -> Region, three new sheets (Org_Sectors,
 * Org_Administrations, Org_Regions — see config.gs's CONFIG.SHEETS).
 * Deliberately separate from the geographic Governorate/Administration/
 * District/Agricultural_Zone sheets, which model real land boundaries for
 * the GIS map, not "who reports to whom".
 *
 * SHEET COLUMNS (create these three tabs by hand in the spreadsheet first):
 *   Org_Sectors:        ID | Name | CreatedAt | UpdatedAt
 *   Org_Administrations: ID | Name | SectorID | CreatedAt | UpdatedAt
 *   Org_Regions:        ID | Name | AdministrationID | CreatedAt | UpdatedAt
 *   Org_Assignments:    ID | UserID | Level | NodeID | CreatedAt
 *                       (auto-created — see ensureOrgAssignmentsSheet_)
 *
 * HOW A USER ATTACHES TO THIS TREE: through Org_Assignments, NOT through
 * columns on the Users sheet. The Users sheet is purely descriptive
 * (name, username, email, role, EngineerID...); who is the head of which
 * sector, the manager of which administration, or an engineer of which
 * region lives only here, edited only from the Org Chart tool.
 *   Level 'sector'         -> NodeID is an Org_Sectors.ID        (sector head)
 *   Level 'administration' -> NodeID is an Org_Administrations.ID (manager)
 *   Level 'region'         -> NodeID is an Org_Regions.ID         (engineer)
 * A person is the engineer of at most ONE region (assigning them to a new
 * one moves them); a region can have many engineers, and an
 * administration/sector can have several managers/heads.
 * A person's Users.Role is just their job title and grants nothing here —
 * an "Engineer" can be an administration manager; what they can see in
 * Expenses/Rent/Attendance comes only from the position they hold below.
 *
 * WHO SEES WHOSE DATA (see directory.gs's handleGetMyScope_):
 *   - administration manager -> the engineers of that administration's regions
 *   - sector head            -> the engineers of every region of every
 *                               administration in that sector
 *   - Admin                  -> everyone
 *
 * DELETE PROTECTION: none of the three delete handlers below will remove
 * a node that still has children (an Administration under a Sector, a
 * Region under an Administration) or — for a Region — an engineer still
 * assigned to it. Reassign/delete the children first. This is a
 * deliberate safety choice (orphaned foreign keys would silently break
 * report scoping) and mirrors this codebase's existing fail-closed style
 * (see permissions.gs's header comment). A sector head / administration
 * manager assignment isn't a "child", so those are simply cleaned up
 * together with the node they pointed at.
 * ============================================================
 */

/**
 * Creates the Org_Assignments tab (with its header row) if it doesn't
 * exist yet, so there is no manual sheet setup for it. Resolves the
 * spreadsheet the same way auth.gs's setUserPasswordFields_ does — the
 * bound spreadsheet first, CONFIG.SPREADSHEET_ID only as a fallback for
 * a standalone script.
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function ensureOrgAssignmentsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sheet = ss.getSheetByName(CONFIG.SHEETS.ORG_ASSIGNMENTS);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEETS.ORG_ASSIGNMENTS);
    sheet.getRange(1, 1, 1, 5).setValues([['ID', 'UserID', 'Level', 'NodeID', 'CreatedAt']]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * @returns {Array<Object>} every Org_Assignments row
 */
function readOrgAssignments_() {
  ensureOrgAssignmentsSheet_();
  return readSheetAsObjects_(CONFIG.SHEETS.ORG_ASSIGNMENTS);
}

/**
 * Maps a placement level to the sheet its NodeID points into.
 * @param {string} level - one of CONFIG.ORG_LEVELS
 * @returns {string} sheet name
 * @throws {AppError_} INVALID_LEVEL
 */
function orgLevelSheet_(level) {
  if (level === CONFIG.ORG_LEVELS.SECTOR) return CONFIG.SHEETS.ORG_SECTORS;
  if (level === CONFIG.ORG_LEVELS.ADMINISTRATION) return CONFIG.SHEETS.ORG_ADMINISTRATIONS;
  if (level === CONFIG.ORG_LEVELS.REGION) return CONFIG.SHEETS.ORG_REGIONS;
  throw new AppError_('INVALID_LEVEL', `Level must be one of: ${Object.keys(CONFIG.ORG_LEVELS).map(k => CONFIG.ORG_LEVELS[k]).join(', ')}.`);
}

/**
 * Deletes every Org_Assignments row matching `predicate`, auditing each.
 * @param {function(Object): boolean} predicate
 * @param {string} actorUsername
 * @returns {number} how many rows were removed
 */
function removeOrgAssignmentsWhere_(predicate, actorUsername) {
  const doomed = readOrgAssignments_().filter(predicate);
  doomed.forEach(a => {
    deleteRowById_(CONFIG.SHEETS.ORG_ASSIGNMENTS, 'ID', a.ID);
    auditDelete_(actorUsername, CONFIG.ENTITY_TYPES.ORG_ASSIGNMENT, a.ID, a);
  });
  return doomed.length;
}

/**
 * Route handler: GET_ORG_STRUCTURE (Admin only). Returns the three levels
 * plus every placement, flat (not nested) — the Org Chart tool joins them
 * against getUsers itself. Everyone else gets a pre-filtered view through
 * getMyScope (directory.gs) instead of the raw tree.
 * @returns {{sectors: Array<Object>, administrations: Array<Object>, regions: Array<Object>, assignments: Array<Object>}}
 */
function handleGetOrgStructure_(context) {
  return {
    sectors: readSheetAsObjects_(CONFIG.SHEETS.ORG_SECTORS),
    administrations: readSheetAsObjects_(CONFIG.SHEETS.ORG_ADMINISTRATIONS),
    regions: readSheetAsObjects_(CONFIG.SHEETS.ORG_REGIONS),
    assignments: readOrgAssignments_()
  };
}

/**
 * Route handler: ASSIGN_ORG_MEMBER (Admin only). Places a user at a node:
 * body = { userId, level, nodeId }. Idempotent (re-assigning someone to
 * a node they already hold is a no-op). A user can only be the engineer
 * of one region, so a 'region' assignment first drops that user's
 * previous region — i.e. it MOVES them.
 * @returns {Object} the Org_Assignments row
 */
function handleAssignOrgMember_(context) {
  const body = sanitizeObject_(context.body);
  const userId = body.userId;
  const nodeId = body.nodeId;
  const level = body.level;
  validateIdParam_(userId, 'userId');
  validateIdParam_(nodeId, 'nodeId');
  validateIdExists_(orgLevelSheet_(level), 'ID', nodeId);
  validateIdExists_(CONFIG.SHEETS.USERS, 'ID', userId);

  const assignments = readOrgAssignments_();
  const already = assignments.find(a =>
    String(a.UserID) === String(userId) && a.Level === level && String(a.NodeID) === String(nodeId));
  if (already) return already;

  if (level === CONFIG.ORG_LEVELS.REGION) {
    removeOrgAssignmentsWhere_(
      a => String(a.UserID) === String(userId) && a.Level === CONFIG.ORG_LEVELS.REGION,
      context.user.username
    );
  }

  const row = {
    ID: generateId_('ASN'),
    UserID: String(userId),
    Level: level,
    NodeID: String(nodeId),
    CreatedAt: new Date().toISOString()
  };
  appendRowFromObject_(CONFIG.SHEETS.ORG_ASSIGNMENTS, row);
  auditCreate_(context.user.username, CONFIG.ENTITY_TYPES.ORG_ASSIGNMENT, row.ID, row);
  return row;
}

/**
 * Route handler: UNASSIGN_ORG_MEMBER (Admin only). body = { userId,
 * level, nodeId }. Removing a placement that doesn't exist is a no-op.
 * @returns {{removed: number}}
 */
function handleUnassignOrgMember_(context) {
  const body = sanitizeObject_(context.body);
  validateIdParam_(body.userId, 'userId');
  validateIdParam_(body.nodeId, 'nodeId');
  orgLevelSheet_(body.level); // validates `level`

  const removed = removeOrgAssignmentsWhere_(
    a => String(a.UserID) === String(body.userId) && a.Level === body.level && String(a.NodeID) === String(body.nodeId),
    context.user.username
  );
  return { removed: removed };
}

/**
 * Called from users.gs's handleDeleteUser_ so a deleted account never
 * leaves a dangling placement behind (it would otherwise still count as
 * an administration's manager / a region's engineer).
 * @param {string} userId
 * @param {string} actorUsername
 */
function removeOrgAssignmentsForUser_(userId, actorUsername) {
  removeOrgAssignmentsWhere_(a => String(a.UserID) === String(userId), actorUsername);
}

/**
 * ONE-TIME MIGRATION — run once manually from the Apps Script editor
 * (select this function, click Run), BEFORE deleting the old placement
 * columns from the Users sheet. Copies whatever the previous version of
 * the Org Chart tool wrote onto Users rows into Org_Assignments:
 *   Users.OrgRegionID         -> a 'region' assignment
 *   Users.OrgAdministrationID -> an 'administration' assignment
 *   Users.SectorID (Section Manger rows only, and only when it is a real
 *                   Org_Sectors.ID rather than an old free-text code)
 *                             -> a 'sector' assignment
 * Values that don't match a real node are skipped. Safe to run more than
 * once (existing placements are skipped). Logs a summary.
 * Users.ManagerID is not migrated: it was only ever an auto-stamped copy
 * of "the sole manager of that administration", i.e. derivable from the
 * two placements above.
 */
function runOneTimeOrgMigration_() {
  const users = readSheetAsObjects_(CONFIG.SHEETS.USERS);
  const sectorIds = {}, administrationIds = {}, regionIds = {};
  readSheetAsObjects_(CONFIG.SHEETS.ORG_SECTORS).forEach(r => { sectorIds[String(r.ID)] = true; });
  readSheetAsObjects_(CONFIG.SHEETS.ORG_ADMINISTRATIONS).forEach(r => { administrationIds[String(r.ID)] = true; });
  readSheetAsObjects_(CONFIG.SHEETS.ORG_REGIONS).forEach(r => { regionIds[String(r.ID)] = true; });

  const existing = readOrgAssignments_();
  const has = (userId, level, nodeId) => existing.some(a =>
    String(a.UserID) === String(userId) && a.Level === level && String(a.NodeID) === String(nodeId));

  let created = 0, skipped = 0;
  const add = (userId, level, nodeId) => {
    if (has(userId, level, nodeId)) { skipped++; return; }
    const row = { ID: generateId_('ASN'), UserID: String(userId), Level: level, NodeID: String(nodeId), CreatedAt: new Date().toISOString() };
    appendRowFromObject_(CONFIG.SHEETS.ORG_ASSIGNMENTS, row);
    existing.push(row);
    created++;
  };

  users.forEach(u => {
    const regionId = u.OrgRegionID ? String(u.OrgRegionID).trim() : '';
    const administrationId = u.OrgAdministrationID ? String(u.OrgAdministrationID).trim() : '';
    const sectorId = u.SectorID ? String(u.SectorID).trim() : '';
    if (regionId && regionIds[regionId]) add(u.ID, CONFIG.ORG_LEVELS.REGION, regionId);
    if (administrationId && administrationIds[administrationId]) add(u.ID, CONFIG.ORG_LEVELS.ADMINISTRATION, administrationId);
    if (sectorId && sectorIds[sectorId] && normalizeRole_(u.Role) === CONFIG.ROLES.SECTION_MANAGER) add(u.ID, CONFIG.ORG_LEVELS.SECTOR, sectorId);
  });

  Logger.log('Org migration complete: %s placements created, %s already present.', created, skipped);
}

/**
 * Route handler: CREATE_ORG_SECTOR (Admin only, per router.gs).
 */
function handleCreateOrgSector_(context) {
  const payload = validateCreatePayload_(CONFIG.ENTITY_TYPES.ORG_SECTOR, context.body);
  const id = generateId_('SEC');
  const now = new Date().toISOString();
  const row = { ID: id, Name: payload.Name, CreatedAt: now, UpdatedAt: now };

  appendRowFromObject_(CONFIG.SHEETS.ORG_SECTORS, row);
  auditCreate_(context.user.username, CONFIG.ENTITY_TYPES.ORG_SECTOR, id, row);
  return row;
}

/**
 * Route handler: UPDATE_ORG_SECTOR (Admin only). Rename only — a
 * Sector has no parent to reparent it under.
 */
function handleUpdateOrgSector_(context) {
  const id = context.params.id || context.body.id;
  validateIdParam_(id, 'id');
  validateIdExists_(CONFIG.SHEETS.ORG_SECTORS, 'ID', id);

  const existingRows = readSheetAsObjects_(CONFIG.SHEETS.ORG_SECTORS);
  const oldValue = existingRows.find(r => String(r.ID) === String(id));

  const payload = sanitizeObject_(context.body);
  delete payload.ID;
  const updates = Object.assign({}, payload, { UpdatedAt: new Date().toISOString() });
  updateRowById_(CONFIG.SHEETS.ORG_SECTORS, 'ID', id, updates);

  const newValue = Object.assign({}, oldValue, updates);
  auditUpdate_(context.user.username, CONFIG.ENTITY_TYPES.ORG_SECTOR, id, oldValue, newValue);
  return newValue;
}

/**
 * Route handler: DELETE_ORG_SECTOR (Admin only). Refuses while any
 * Administration still points at this Sector — see file header.
 */
function handleDeleteOrgSector_(context) {
  const id = context.params.id || context.body.id;
  validateIdParam_(id, 'id');

  const administrations = readSheetAsObjects_(CONFIG.SHEETS.ORG_ADMINISTRATIONS);
  const hasChildren = administrations.some(a => String(a.SectorID) === String(id));
  if (hasChildren) {
    throw new AppError_('HAS_DEPENDENTS', 'Move or delete this Sector\'s Administrations first.');
  }

  const existingRows = readSheetAsObjects_(CONFIG.SHEETS.ORG_SECTORS);
  const oldValue = existingRows.find(r => String(r.ID) === String(id));
  if (!oldValue) {
    throw new AppError_('NOT_FOUND', `OrgSector with ID "${id}" not found.`);
  }

  deleteRowById_(CONFIG.SHEETS.ORG_SECTORS, 'ID', id);
  auditDelete_(context.user.username, CONFIG.ENTITY_TYPES.ORG_SECTOR, id, oldValue);
  removeOrgAssignmentsWhere_(
    a => a.Level === CONFIG.ORG_LEVELS.SECTOR && String(a.NodeID) === String(id),
    context.user.username
  );
  return { deleted: true, id: id };
}

/**
 * Route handler: CREATE_ORG_ADMINISTRATION (Admin only).
 */
function handleCreateOrgAdministration_(context) {
  const payload = validateCreatePayload_(CONFIG.ENTITY_TYPES.ORG_ADMINISTRATION, context.body);
  const id = generateId_('ADM');
  const now = new Date().toISOString();
  const row = { ID: id, Name: payload.Name, SectorID: payload.SectorID, CreatedAt: now, UpdatedAt: now };

  appendRowFromObject_(CONFIG.SHEETS.ORG_ADMINISTRATIONS, row);
  auditCreate_(context.user.username, CONFIG.ENTITY_TYPES.ORG_ADMINISTRATION, id, row);
  return row;
}

/**
 * Route handler: UPDATE_ORG_ADMINISTRATION (Admin only). Supports
 * both renaming and reparenting to a different Sector (SectorID is
 * re-validated against Org_Sectors if supplied, via validateUpdatePayload_).
 */
function handleUpdateOrgAdministration_(context) {
  const id = context.params.id || context.body.id;
  validateIdParam_(id, 'id');
  validateIdExists_(CONFIG.SHEETS.ORG_ADMINISTRATIONS, 'ID', id);

  const existingRows = readSheetAsObjects_(CONFIG.SHEETS.ORG_ADMINISTRATIONS);
  const oldValue = existingRows.find(r => String(r.ID) === String(id));

  const payload = validateUpdatePayload_(CONFIG.ENTITY_TYPES.ORG_ADMINISTRATION, context.body);
  delete payload.ID;
  const updates = Object.assign({}, payload, { UpdatedAt: new Date().toISOString() });
  updateRowById_(CONFIG.SHEETS.ORG_ADMINISTRATIONS, 'ID', id, updates);

  const newValue = Object.assign({}, oldValue, updates);
  auditUpdate_(context.user.username, CONFIG.ENTITY_TYPES.ORG_ADMINISTRATION, id, oldValue, newValue);
  return newValue;
}

/**
 * Route handler: DELETE_ORG_ADMINISTRATION (Admin only). Refuses while
 * any Region still points at this Administration — see file header.
 */
function handleDeleteOrgAdministration_(context) {
  const id = context.params.id || context.body.id;
  validateIdParam_(id, 'id');

  const regions = readSheetAsObjects_(CONFIG.SHEETS.ORG_REGIONS);
  const hasChildren = regions.some(r => String(r.AdministrationID) === String(id));
  if (hasChildren) {
    throw new AppError_('HAS_DEPENDENTS', 'Move or delete this Administration\'s Regions first.');
  }

  const existingRows = readSheetAsObjects_(CONFIG.SHEETS.ORG_ADMINISTRATIONS);
  const oldValue = existingRows.find(r => String(r.ID) === String(id));
  if (!oldValue) {
    throw new AppError_('NOT_FOUND', `OrgAdministration with ID "${id}" not found.`);
  }

  deleteRowById_(CONFIG.SHEETS.ORG_ADMINISTRATIONS, 'ID', id);
  auditDelete_(context.user.username, CONFIG.ENTITY_TYPES.ORG_ADMINISTRATION, id, oldValue);
  removeOrgAssignmentsWhere_(
    a => a.Level === CONFIG.ORG_LEVELS.ADMINISTRATION && String(a.NodeID) === String(id),
    context.user.username
  );
  return { deleted: true, id: id };
}

/**
 * Route handler: CREATE_ORG_REGION (Admin only).
 */
function handleCreateOrgRegion_(context) {
  const payload = validateCreatePayload_(CONFIG.ENTITY_TYPES.ORG_REGION, context.body);
  const id = generateId_('REG');
  const now = new Date().toISOString();
  const row = { ID: id, Name: payload.Name, AdministrationID: payload.AdministrationID, CreatedAt: now, UpdatedAt: now };

  appendRowFromObject_(CONFIG.SHEETS.ORG_REGIONS, row);
  auditCreate_(context.user.username, CONFIG.ENTITY_TYPES.ORG_REGION, id, row);
  return row;
}

/**
 * Route handler: UPDATE_ORG_REGION (Admin only). Supports renaming and
 * reparenting to a different Administration.
 */
function handleUpdateOrgRegion_(context) {
  const id = context.params.id || context.body.id;
  validateIdParam_(id, 'id');
  validateIdExists_(CONFIG.SHEETS.ORG_REGIONS, 'ID', id);

  const existingRows = readSheetAsObjects_(CONFIG.SHEETS.ORG_REGIONS);
  const oldValue = existingRows.find(r => String(r.ID) === String(id));

  const payload = validateUpdatePayload_(CONFIG.ENTITY_TYPES.ORG_REGION, context.body);
  delete payload.ID;
  const updates = Object.assign({}, payload, { UpdatedAt: new Date().toISOString() });
  updateRowById_(CONFIG.SHEETS.ORG_REGIONS, 'ID', id, updates);

  const newValue = Object.assign({}, oldValue, updates);
  auditUpdate_(context.user.username, CONFIG.ENTITY_TYPES.ORG_REGION, id, oldValue, newValue);
  return newValue;
}

/**
 * Route handler: DELETE_ORG_REGION (Admin only). Refuses while any
 * engineer is still assigned to this Region (an Org_Assignments row) —
 * see file header. A Region is a leaf, so no grandchild sheet to check.
 */
function handleDeleteOrgRegion_(context) {
  const id = context.params.id || context.body.id;
  validateIdParam_(id, 'id');

  const hasMembers = readOrgAssignments_().some(a =>
    a.Level === CONFIG.ORG_LEVELS.REGION && String(a.NodeID) === String(id));
  if (hasMembers) {
    throw new AppError_('HAS_DEPENDENTS', 'Reassign or remove this Region\'s engineers first.');
  }

  const existingRows = readSheetAsObjects_(CONFIG.SHEETS.ORG_REGIONS);
  const oldValue = existingRows.find(r => String(r.ID) === String(id));
  if (!oldValue) {
    throw new AppError_('NOT_FOUND', `OrgRegion with ID "${id}" not found.`);
  }

  deleteRowById_(CONFIG.SHEETS.ORG_REGIONS, 'ID', id);
  auditDelete_(context.user.username, CONFIG.ENTITY_TYPES.ORG_REGION, id, oldValue);
  return { deleted: true, id: id };
}
