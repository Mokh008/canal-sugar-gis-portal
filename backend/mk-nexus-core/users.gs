/**
 * ============================================================
 * MK NEXUS BACKEND — USERS
 * Full user CRUD, credential management, role assignment.
 * NEW FILE IN THIS REPO (pasted in from the live Apps Script project,
 * which had it but this repo never did — see README.md's "Files not
 * listed here" note). Two real bugs fixed on the way in, both because
 * this file predates the "ROLES aligned to real Users sheet" pass that
 * already landed in config.gs/permissions.gs/directory.gs/auth.gs:
 *
 *  1. CRITICAL — handleChangePassword_ used to check
 *     `hasMinimumRole_(context.user, CONFIG.ROLES.ADMINISTRATOR)`.
 *     CONFIG.ROLES.ADMINISTRATOR doesn't exist (config.gs only defines
 *     CONFIG.ROLES.ADMIN); the lookup silently evaluated to `undefined`,
 *     and getRoleRank_(undefined) = ROLE_HIERARCHY.indexOf(undefined) =
 *     -1 — which every real role's rank (0..4) is always >= to. So
 *     `isAdmin` was always `true` for *any* logged-in user, regardless
 *     of role, which skipped the "must supply currentPassword" branch
 *     entirely. Net effect: any authenticated user (Supervisor,
 *     Engineer, anyone) could reset any *other* user's password by ID
 *     without knowing their current one — an account-takeover bug.
 *     Fixed by using CONFIG.ROLES.ADMIN, the real constant.
 *
 *  2. Active vs IsActive column mismatch — toSafeUser_/handleCreateUser_/
 *     setUserActiveState_ all read/wrote a column called `Active`, but
 *     directory.gs's report-scoping (and everything downstream of it —
 *     Rent/Expenses admin views) filters on a column called `IsActive`
 *     (see directory.gs's handleGetMyScope_). Two different
 *     columns: activating/deactivating a user here never touched the
 *     one column the rest of the system actually reads, so the
 *     Activate/Deactivate actions were silently no-ops from the
 *     directory/report-scoping's point of view. Fixed to use IsActive
 *     everywhere, matching the sheet's real column and directory.gs's
 *     existing convention (a falsy/blank value counts as active — only
 *     the literal string "FALSE" counts as inactive).
 * ============================================================
 *
 * Sheet columns: ID | Name (or FullName) | Username | Email | PasswordHash |
 *                Salt | Role | IsActive | LastLogin | CreatedAt | UpdatedAt
 *                (plus the descriptive EngineerID | AttendanceName, and the
 *                geo-scoping GovernorateID | AdministrationID | DistrictID
 *                which belong to Geo Intelligence and are left alone; they
 *                pass straight through handleUpdateUser_'s generic payload
 *                since they aren't stripped like password/Role are)
 *
 * THE USERS SHEET IS DESCRIPTIVE ONLY. Org placement (who manages which
 * administration, who is an engineer of which region) is NOT stored here —
 * it lives in Org_Assignments, edited from the Org Chart tool (see
 * org-structure.gs). LEGACY_ORG_PLACEMENT_FIELDS_ below are stripped from
 * every create/update payload so an old client or stale form can't quietly
 * write them back into the sheet.
 */

/**
 * Columns the previous Org Chart implementation wrote onto Users rows.
 * Placement now lives in Org_Assignments; these are never written again
 * (run runOneTimeOrgMigration_() once, then delete these columns).
 */
const LEGACY_ORG_PLACEMENT_FIELDS_ = ['SectorID', 'ManagerID', 'OrgAdministrationID', 'OrgRegionID'];

/**
 * Strips password/salt fields before returning a user to the client.
 * @param {Object} row
 * @returns {Object}
 */
function toSafeUser_(row) {
  if (!row) return null;
  const fullName = row.FullName || row.Name;
  return {
    ID: row.ID,
    // Both spellings, whichever the sheet actually has filled in: the
    // Settings/Org Chart modules read `FullName` (as login does), the
    // create path writes `Name`. Before, only `Name` came back, so those
    // modules showed every name as blank.
    Name: fullName,
    FullName: fullName,
    Username: row.Username,
    Email: row.Email,
    Role: row.Role,
    // Descriptive identity fields the Org Chart / Settings screens show
    // (never placement — that lives in Org_Assignments, org-structure.gs).
    EngineerID: row.EngineerID,
    AttendanceName: row.AttendanceName,
    // Geo Intelligence's own per-user fields — untouched by the Org Chart,
    // returned here only so the Settings edit form can round-trip them.
    // Without this the form loaded them blank and, on save, wrote those
    // blanks back over the real values.
    GovernorateID: row.GovernorateID,
    AdministrationID: row.AdministrationID,
    DistrictID: row.DistrictID,
    IsActive: row.IsActive,
    LastLogin: row.LastLogin || null,
    CreatedAt: row.CreatedAt,
    UpdatedAt: row.UpdatedAt
  };
}

/**
 * Route handler: GET_USERS (Administrator only, per router.gs).
 * @returns {Array<Object>} password-free user list
 */
function handleGetUsers_(context) {
  const rows = readSheetAsObjects_(CONFIG.SHEETS.USERS);
  return rows.map(toSafeUser_);
}

/**
 * Route handler: CREATE_USER. Generates a salt, hashes the supplied
 * password, and stores the account. Defaults to IsActive=true.
 *
 * ALSO FIXED — the descriptive/geo fields (EngineerID/AttendanceName/
 * GovernorateID/AdministrationID/DistrictID) that settings.js's "add
 * user" form sends are built into `row` below via an `extra`
 * passthrough; before this they were silently dropped (the original
 * `row` literal only ever listed the core account fields), so you'd have
 * to immediately follow up with a separate updateUser call to set them.
 * Mirrors handleUpdateUser_'s existing passthrough, minus the fields that
 * are either handled explicitly above or must never come from client
 * input — including the legacy Org placement columns
 * (LEGACY_ORG_PLACEMENT_FIELDS_): where someone sits in the org is set
 * from the Org Chart, never here.
 */
function handleCreateUser_(context) {
  const payload = validateCreatePayload_(CONFIG.ENTITY_TYPES.USER, context.body);

  if (!context.body.password) {
    throw new AppError_('MISSING_FIELDS', 'Missing required field: password');
  }
  if (!CONFIG.ROLE_HIERARCHY.includes(payload.Role)) {
    throw new AppError_('INVALID_ROLE', `"${payload.Role}" is not a recognized role.`);
  }

  const users = readSheetAsObjects_(CONFIG.SHEETS.USERS);
  const usernameTaken = users.some(u => String(u.Username).toLowerCase() === payload.Username.toLowerCase());
  if (usernameTaken) {
    throw new AppError_('DUPLICATE_USERNAME', `Username "${payload.Username}" is already taken.`);
  }

  const id = generateId_('USR');
  const salt = Utilities.getUuid();
  const passwordHash = hashPassword_(context.body.password, salt);
  const now = new Date().toISOString();

  const row = {
    ID: id,
    Name: payload.Name,
    Username: payload.Username,
    Email: payload.Email,
    PasswordHash: passwordHash,
    Salt: salt,
    Role: payload.Role,
    IsActive: true,
    LastLogin: '',
    CreatedAt: now,
    UpdatedAt: now
  };

  const extra = sanitizeObject_(context.body);
  ['password', 'Name', 'Username', 'Email', 'Role', 'PasswordHash', 'Salt',
    'ID', 'IsActive', 'LastLogin', 'CreatedAt', 'UpdatedAt'].forEach(k => delete extra[k]);
  LEGACY_ORG_PLACEMENT_FIELDS_.forEach(k => delete extra[k]);
  Object.assign(row, extra);

  appendRowFromObject_(CONFIG.SHEETS.USERS, row);
  auditCreate_(context.user.username, CONFIG.ENTITY_TYPES.USER, id, toSafeUser_(row));

  return toSafeUser_(row);
}

/**
 * Route handler: UPDATE_USER. Updates profile fields only —
 * never password or role (those go through dedicated endpoints
 * so they get their own explicit audit trail entries). Everything
 * else in the payload (including EngineerID/AttendanceName/
 * GovernorateID/AdministrationID/DistrictID) passes straight through
 * to updateRowById_ so the fields the Settings UI edits actually get
 * written. Org placement is deliberately NOT one of them — see
 * LEGACY_ORG_PLACEMENT_FIELDS_ above.
 */
function handleUpdateUser_(context) {
  const id = context.params.id || context.body.id;
  validateIdParam_(id, 'id');
  validateIdExists_(CONFIG.SHEETS.USERS, 'ID', id);

  const payload = sanitizeObject_(context.body);
  delete payload.password;
  delete payload.Role;
  delete payload.PasswordHash;
  delete payload.Salt;
  delete payload.ID;
  LEGACY_ORG_PLACEMENT_FIELDS_.forEach(k => delete payload[k]);

  const existingRows = readSheetAsObjects_(CONFIG.SHEETS.USERS);
  const oldValue = existingRows.find(r => String(r.ID) === String(id));

  const updates = Object.assign({}, payload, { UpdatedAt: new Date().toISOString() });
  updateRowById_(CONFIG.SHEETS.USERS, 'ID', id, updates);

  const newValue = Object.assign({}, oldValue, updates);
  auditUpdate_(context.user.username, CONFIG.ENTITY_TYPES.USER, id, toSafeUser_(oldValue), toSafeUser_(newValue));

  return toSafeUser_(newValue);
}

/**
 * Route handler: DELETE_USER.
 */
function handleDeleteUser_(context) {
  const id = context.params.id || context.body.id;
  validateIdParam_(id, 'id');

  const existingRows = readSheetAsObjects_(CONFIG.SHEETS.USERS);
  const oldValue = existingRows.find(r => String(r.ID) === String(id));
  if (!oldValue) {
    throw new AppError_('NOT_FOUND', `User with ID "${id}" not found.`);
  }

  deleteRowById_(CONFIG.SHEETS.USERS, 'ID', id);
  auditDelete_(context.user.username, CONFIG.ENTITY_TYPES.USER, id, toSafeUser_(oldValue));
  // Don't leave a deleted account still counted as some administration's
  // manager / some region's engineer.
  removeOrgAssignmentsForUser_(id, context.user.username);

  return { deleted: true, id: id };
}

/**
 * Route handler: ACTIVATE_USER.
 */
function handleActivateUser_(context) {
  return setUserActiveState_(context, true);
}

/**
 * Route handler: DEACTIVATE_USER.
 */
function handleDeactivateUser_(context) {
  return setUserActiveState_(context, false);
}

/**
 * Shared implementation for activate/deactivate. Writes IsActive (the
 * column directory.gs's report-scoping actually reads) — NOT `Active`.
 * @param {Object} context
 * @param {boolean} activeState
 */
function setUserActiveState_(context, activeState) {
  const id = context.params.id || context.body.id;
  validateIdParam_(id, 'id');

  const existingRows = readSheetAsObjects_(CONFIG.SHEETS.USERS);
  const oldValue = existingRows.find(r => String(r.ID) === String(id));
  if (!oldValue) {
    throw new AppError_('NOT_FOUND', `User with ID "${id}" not found.`);
  }

  const updates = { IsActive: activeState, UpdatedAt: new Date().toISOString() };
  updateRowById_(CONFIG.SHEETS.USERS, 'ID', id, updates);

  const newValue = Object.assign({}, oldValue, updates);
  auditUpdate_(context.user.username, CONFIG.ENTITY_TYPES.USER, id, toSafeUser_(oldValue), toSafeUser_(newValue));

  return toSafeUser_(newValue);
}

/**
 * Route handler: ASSIGN_ROLE. Administrator-only (per router.gs).
 * Logged separately from a generic profile update for a clear
 * security-relevant audit trail.
 */
function handleAssignRole_(context) {
  const id = context.params.id || context.body.id;
  const newRole = context.body.role;
  validateIdParam_(id, 'id');

  if (!CONFIG.ROLE_HIERARCHY.includes(newRole)) {
    throw new AppError_('INVALID_ROLE', `"${newRole}" is not a recognized role.`);
  }

  const existingRows = readSheetAsObjects_(CONFIG.SHEETS.USERS);
  const oldValue = existingRows.find(r => String(r.ID) === String(id));
  if (!oldValue) {
    throw new AppError_('NOT_FOUND', `User with ID "${id}" not found.`);
  }

  const updates = { Role: newRole, UpdatedAt: new Date().toISOString() };
  updateRowById_(CONFIG.SHEETS.USERS, 'ID', id, updates);

  const newValue = Object.assign({}, oldValue, updates);
  auditUpdate_(
    context.user.username,
    CONFIG.ENTITY_TYPES.USER,
    id,
    { Role: oldValue.Role },
    { Role: newRole }
  );

  return toSafeUser_(newValue);
}

/**
 * Route handler: CHANGE_PASSWORD. A user may change their own password
 * (requires currentPassword); an Administrator may reset any user's
 * password without supplying the current one.
 *
 * FIXED — was `hasMinimumRole_(context.user, CONFIG.ROLES.ADMINISTRATOR)`.
 * CONFIG.ROLES.ADMINISTRATOR does not exist (config.gs defines
 * CONFIG.ROLES.ADMIN), so that lookup was always `undefined`, and
 * getRoleRank_(undefined) === -1 — a rank every real role is always
 * `>=` to. isAdmin was therefore always `true`, for every caller
 * regardless of role, which skipped the "must supply currentPassword"
 * branch below unconditionally. Any authenticated user could reset any
 * other user's password by ID with no knowledge of the current one.
 * Now correctly checks CONFIG.ROLES.ADMIN.
 */
function handleChangePassword_(context) {
  const targetId = context.body.id || context.user.id;
  const newPassword = context.body.newPassword;

  if (!newPassword || String(newPassword).length < 8) {
    throw new AppError_('WEAK_PASSWORD', 'New password must be at least 8 characters.');
  }

  const users = readSheetAsObjects_(CONFIG.SHEETS.USERS);
  const target = users.find(u => String(u.ID) === String(targetId));
  if (!target) {
    throw new AppError_('NOT_FOUND', `User with ID "${targetId}" not found.`);
  }

  const isSelfChange = String(targetId) === String(context.user.id);
  const isAdmin = hasMinimumRole_(context.user, CONFIG.ROLES.ADMIN);

  if (!isAdmin) {
    if (!isSelfChange) {
      throw new AppError_('FORBIDDEN', 'You may only change your own password.');
    }
    const currentPassword = context.body.currentPassword;
    if (!currentPassword || hashPassword_(currentPassword, target.Salt) !== target.PasswordHash) {
      throw new AppError_('INVALID_CREDENTIALS', 'Current password is incorrect.');
    }
  }

  const newSalt = Utilities.getUuid();
  const newHash = hashPassword_(newPassword, newSalt);

  updateRowById_(CONFIG.SHEETS.USERS, 'ID', targetId, {
    PasswordHash: newHash,
    Salt: newSalt,
    UpdatedAt: new Date().toISOString()
  });

  auditUpdate_(
    context.user.username,
    CONFIG.ENTITY_TYPES.USER,
    targetId,
    { PasswordHash: '[REDACTED]' },
    { PasswordHash: '[REDACTED]' }
  );

  return { success: true, id: targetId };
}

/**
 * Updates the LastLogin timestamp for a user. Called from auth.gs
 * immediately after a successful login.
 * @param {string} userId
 */
function updateLastLogin_(userId) {
  updateRowById_(CONFIG.SHEETS.USERS, 'ID', userId, {
    LastLogin: new Date().toISOString()
  });
}
