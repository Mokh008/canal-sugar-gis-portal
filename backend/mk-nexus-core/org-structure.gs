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
 *
 * HOW A USER ATTACHES TO THIS TREE (Users sheet, see directory.gs):
 *   - Section Manger: Users.SectorID = an Org_Sectors.ID
 *   - Manager:        Users.OrgAdministrationID = an Org_Administrations.ID
 *   - Engineer/Supervisor: Users.OrgRegionID = an Org_Regions.ID
 *   These are set the same way every other user field is — a normal
 *   updateUser call from the Settings > "إدارة المستخدمين" admin UI
 *   (handleUpdateUser_ in users.gs passes any extra field straight
 *   through to the sheet, no schema change needed there).
 *
 * DELETE PROTECTION: none of the three delete handlers below will remove
 * a node that still has children (an Administration under a Sector, a
 * Region under an Administration) or — for a Region — a user still
 * assigned to it. Reassign/delete the children first. This is a
 * deliberate safety choice (orphaned foreign keys would silently break
 * report scoping) and mirrors this codebase's existing fail-closed style
 * (see permissions.gs's header comment).
 * ============================================================
 */

/**
 * Route handler: GET_ORG_STRUCTURE. Returns the three levels flat (not
 * nested) — the frontend already has to cross-reference these against
 * the Users roster (getTeamDirectory) to compute scope, so a flat shape
 * keyed by ID is more directly useful there than a pre-nested tree.
 * @returns {{sectors: Array<Object>, administrations: Array<Object>, regions: Array<Object>}}
 */
function handleGetOrgStructure_(context) {
  return {
    sectors: readSheetAsObjects_(CONFIG.SHEETS.ORG_SECTORS),
    administrations: readSheetAsObjects_(CONFIG.SHEETS.ORG_ADMINISTRATIONS),
    regions: readSheetAsObjects_(CONFIG.SHEETS.ORG_REGIONS)
  };
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
 * user is still assigned to this Region (Users.OrgRegionID) — see
 * file header. A Region is a leaf, so no grandchild sheet to check.
 */
function handleDeleteOrgRegion_(context) {
  const id = context.params.id || context.body.id;
  validateIdParam_(id, 'id');

  const users = readSheetAsObjects_(CONFIG.SHEETS.USERS);
  const hasMembers = users.some(u => String(u.OrgRegionID) === String(id));
  if (hasMembers) {
    throw new AppError_('HAS_DEPENDENTS', 'Reassign this Region\'s users first.');
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
