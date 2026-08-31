/**
 * ============================================================
 * MK NEXUS BACKEND — ROUTER
 * Single entry point for all API traffic. Maps `action` to handlers.
 *
 * SECURITY FIX (Critical): the "TEMPORARY DEV CONFIGURATION" block that
 * used to live here shipped 8 read actions — getGovernorates,
 * getAdministrations, getDistricts, getZones, getPolygon, getKPIs,
 * getPresentation, getSettings — with `roles: null`, i.e. no
 * authentication at all, self-labeled "revert before production
 * deploy." That revert is done below: every one of those now requires
 * at least ADMIN (see the ROLE MODEL UPDATE note further down — this
 * used to say VIEWER, a role that no longer exists in this file). Only
 * login/validateSession stay public by design
 * (they're how a session token is obtained/checked in the first
 * place) — logout is intentionally public-routed too (see auth.gs's
 * handleLogout_, which reads its own token from params/body rather
 * than requiring requireRole_'s pre-authenticated user).
 *
 * ROLE MODEL UPDATE: every route below that used to require VIEWER/
 * MANAGER/ADMINISTRATOR (roles that don't exist in the real Users
 * sheet — see config.gs) now requires ADMIN. The frontend's Geo
 * Intelligence module — the only caller of any of these actions today
 * (governorates/administrations/districts/zones/polygons/KPIs/
 * presentation/settings/users/audit log) — is gated to Admin-only in
 * the module-visibility matrix, so this just matches the backend to
 * what the frontend already restricts. changePassword is the one
 * exception: kept open to the lowest role (SUPERVISOR, i.e. any
 * authenticated user) since every account — not just Admins — needs to
 * be able to change its own password.
 * ============================================================
 */

/**
 * Route table: action name -> handler function reference.
 * Populated lazily so it can reference handlers defined in
 * other files regardless of file load order in the editor.
 */
function getRouteTable_() {
  return {
    // Auth — always protected (except the three below, public by design)
    [CONFIG.ACTIONS.LOGIN]: { fn: handleLogin_, roles: null }, // public by design (issues the token)
    [CONFIG.ACTIONS.VALIDATE_SESSION]: { fn: handleValidateSession_, roles: null }, // public by design
    [CONFIG.ACTIONS.LOGOUT]: { fn: handleLogout_, roles: null }, // public by design (must work even with an already-expired token)

    // Reads — ADMIN only (see ROLE MODEL UPDATE above). Previously
    // `roles: null` (fully public, explicitly marked TEMPORARY) — closed.
    [CONFIG.ACTIONS.GET_GOVERNORATES]: { fn: handleGetGovernorates_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.GET_ADMINISTRATIONS]: { fn: handleGetAdministrations_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.GET_DISTRICTS]: { fn: handleGetDistricts_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.GET_ZONES]: { fn: handleGetZones_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.GET_POLYGON]: { fn: handleGetPolygon_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.GET_KPIS]: { fn: handleGetKPIs_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.GET_PRESENTATION]: { fn: handleGetPresentation_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.GET_SETTINGS]: { fn: handleGetSettings_, roles: [CONFIG.ROLES.ADMIN] },

    // Reads — remain protected (not in the public list)
    [CONFIG.ACTIONS.GET_USERS]: { fn: handleGetUsers_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.GET_AUDIT_LOG]: { fn: handleGetAuditLog_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.GET_KPI_AGGREGATE]: { fn: handleGetKPIAggregate_, roles: [CONFIG.ROLES.ADMIN] },

    // New — see directory.gs. Lightweight, non-sensitive roster (no
    // email/username/password) so the Rent/Expenses frontend modules can
    // scope their admin-report views to "my sector" for Section
    // Manger/Manager instead of only ever showing everyone (Admin) or
    // nobody. Minimum role MANAGER means Manager, Section Manger, and
    // Admin can all call it (ROLE_HIERARCHY ranks Section Manger/Admin
    // above Manager) — Engineer/Supervisor cannot.
    [CONFIG.ACTIONS.GET_TEAM_DIRECTORY]: { fn: handleGetTeamDirectory_, roles: [CONFIG.ROLES.MANAGER] },

    // Writes — ADMIN only (see ROLE MODEL UPDATE above)
    [CONFIG.ACTIONS.CREATE_GOVERNORATE]: { fn: handleCreateGovernorate_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.CREATE_ADMINISTRATION]: { fn: handleCreateAdministration_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.CREATE_DISTRICT]: { fn: handleCreateDistrict_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.CREATE_ZONE]: { fn: handleCreateZone_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.CREATE_GEOJSON]: { fn: handleCreateGeoJSON_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.CREATE_KPI]: { fn: handleCreateKPI_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.CREATE_USER]: { fn: handleCreateUser_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.CREATE_PRESENTATION]: { fn: handleCreatePresentation_, roles: [CONFIG.ROLES.ADMIN] },

    [CONFIG.ACTIONS.UPDATE_GOVERNORATE]: { fn: handleUpdateGovernorate_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.UPDATE_ADMINISTRATION]: { fn: handleUpdateAdministration_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.UPDATE_DISTRICT]: { fn: handleUpdateDistrict_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.UPDATE_ZONE]: { fn: handleUpdateZone_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.UPDATE_GEOJSON]: { fn: handleUpdateGeoJSON_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.UPDATE_KPI]: { fn: handleUpdateKPI_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.UPDATE_SETTINGS]: { fn: handleUpdateSettings_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.UPDATE_USER]: { fn: handleUpdateUser_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.UPDATE_PRESENTATION]: { fn: handleUpdatePresentation_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.ACTIVATE_USER]: { fn: handleActivateUser_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.DEACTIVATE_USER]: { fn: handleDeactivateUser_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.ASSIGN_ROLE]: { fn: handleAssignRole_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.CHANGE_PASSWORD]: { fn: handleChangePassword_, roles: [CONFIG.ROLES.SUPERVISOR] },
    // New — see avatar.gs. Any authenticated account can set its own
    // profile photo (SUPERVISOR = lowest rank = everyone); the handler
    // always writes to the caller's own row (context.user.id from the
    // session), never a client-supplied id, so nobody can overwrite
    // someone else's avatar.
    [CONFIG.ACTIONS.UPLOAD_AVATAR]: { fn: handleUploadAvatar_, roles: [CONFIG.ROLES.SUPERVISOR] },
    [CONFIG.ACTIONS.REORDER_PRESENTATION]: { fn: handleReorderPresentation_, roles: [CONFIG.ROLES.ADMIN] },

    [CONFIG.ACTIONS.DELETE_GOVERNORATE]: { fn: handleDeleteGovernorate_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.DELETE_ADMINISTRATION]: { fn: handleDeleteAdministration_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.DELETE_DISTRICT]: { fn: handleDeleteDistrict_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.DELETE_ZONE]: { fn: handleDeleteZone_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.DELETE_GEOJSON]: { fn: handleDeleteGeoJSON_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.DELETE_KPI]: { fn: handleDeleteKPI_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.DELETE_USER]: { fn: handleDeleteUser_, roles: [CONFIG.ROLES.ADMIN] },
    [CONFIG.ACTIONS.DELETE_PRESENTATION]: { fn: handleDeletePresentation_, roles: [CONFIG.ROLES.ADMIN] }
  };
}

/**
 * Entry point for GET requests.
 * @param {Object} e
 * @returns {TextOutput}
 */
function doGet(e) {
  return routeRequest_(e, 'GET');
}

/**
 * Entry point for POST requests.
 * @param {Object} e
 * @returns {TextOutput}
 */
function doPost(e) {
  return routeRequest_(e, 'POST');
}

/**
 * Central dispatcher. Every request — success or failure —
 * passes through here exactly once.
 * @param {Object} e
 * @param {string} method
 * @returns {TextOutput}
 */
function routeRequest_(e, method) {
  try {
    const action = e && e.parameter && e.parameter.action;

    if (!action) {
      return sendJsonResponse(buildErrorResponse('Missing required "action" parameter.', []));
    }

    const routeTable = getRouteTable_();
    const route = routeTable[action];

    if (!route) {
      return sendJsonResponse(buildErrorResponse(`Unknown action: "${action}".`, []));
    }

    // Build the request context (query params + parsed body, if POST)
    const context = {
      method: method,
      params: e.parameter || {},
      body: (method === 'POST') ? safeParseBody_(e) : {}
    };

    // Auth/permission check (auth.gs / permissions.gs), skipped only for
    // the three explicitly public routes above (login/validateSession/logout).
    let currentUser = null;
    if (route.roles !== null) {
      currentUser = authenticateRequest_(context); // throws AppError_ on failure
      requireRole_(currentUser, route.roles);       // throws AppError_ on failure
    }
    context.user = currentUser;

    const result = route.fn(context);
    return sendJsonResponse(buildSuccessResponse(result, 'Request successful.'));

  } catch (err) {
    return sendJsonResponse(handleErrorToResponse_(err));
  }
}

/**
 * Safely parses the POST body; returns {} instead of throwing
 * for actions that don't require one (kept isolated from parseRequestBody_
 * so a missing body on POST doesn't crash routing before the handler
 * has a chance to validate what it actually needs).
 */
function safeParseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    throw new AppError_('INVALID_JSON', 'Request body is not valid JSON.');
  }
}

/**
 * Converts any thrown error into a clean error response envelope.
 * Never exposes stack traces to the client.
 * @param {Error} err
 * @returns {Object}
 */
function handleErrorToResponse_(err) {
  if (err && err.isAppError) {
    logWarning_(err.message, { code: err.code });
    return buildErrorResponse(err.message, [err.code]);
  }
  // Unexpected/internal error — log full detail server-side only.
  logError_(err && err.message ? err.message : String(err), { stack: err && err.stack });
  return buildErrorResponse('An unexpected server error occurred.', ['INTERNAL_ERROR']);
}
