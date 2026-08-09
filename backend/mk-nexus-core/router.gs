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
 * at least VIEWER. Only login/validateSession stay public by design
 * (they're how a session token is obtained/checked in the first
 * place) — logout is intentionally public-routed too (see auth.gs's
 * handleLogout_, which reads its own token from params/body rather
 * than requiring requireRole_'s pre-authenticated user).
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

    // Reads — VIEWER and above. Previously `roles: null` (fully public,
    // explicitly marked TEMPORARY) — closed.
    [CONFIG.ACTIONS.GET_GOVERNORATES]: { fn: handleGetGovernorates_, roles: [CONFIG.ROLES.VIEWER] },
    [CONFIG.ACTIONS.GET_ADMINISTRATIONS]: { fn: handleGetAdministrations_, roles: [CONFIG.ROLES.VIEWER] },
    [CONFIG.ACTIONS.GET_DISTRICTS]: { fn: handleGetDistricts_, roles: [CONFIG.ROLES.VIEWER] },
    [CONFIG.ACTIONS.GET_ZONES]: { fn: handleGetZones_, roles: [CONFIG.ROLES.VIEWER] },
    [CONFIG.ACTIONS.GET_POLYGON]: { fn: handleGetPolygon_, roles: [CONFIG.ROLES.VIEWER] },
    [CONFIG.ACTIONS.GET_KPIS]: { fn: handleGetKPIs_, roles: [CONFIG.ROLES.VIEWER] },
    [CONFIG.ACTIONS.GET_PRESENTATION]: { fn: handleGetPresentation_, roles: [CONFIG.ROLES.VIEWER] },
    [CONFIG.ACTIONS.GET_SETTINGS]: { fn: handleGetSettings_, roles: [CONFIG.ROLES.VIEWER] },

    // Reads — remain protected (not in the public list)
    [CONFIG.ACTIONS.GET_USERS]: { fn: handleGetUsers_, roles: [CONFIG.ROLES.ADMINISTRATOR] },
    [CONFIG.ACTIONS.GET_AUDIT_LOG]: { fn: handleGetAuditLog_, roles: [CONFIG.ROLES.ADMINISTRATOR] },
    [CONFIG.ACTIONS.GET_KPI_AGGREGATE]: { fn: handleGetKPIAggregate_, roles: [CONFIG.ROLES.VIEWER] },

    // Writes — Manager and above (Administrator implied via hierarchy)
    [CONFIG.ACTIONS.CREATE_GOVERNORATE]: { fn: handleCreateGovernorate_, roles: [CONFIG.ROLES.MANAGER] },
    [CONFIG.ACTIONS.CREATE_ADMINISTRATION]: { fn: handleCreateAdministration_, roles: [CONFIG.ROLES.MANAGER] },
    [CONFIG.ACTIONS.CREATE_DISTRICT]: { fn: handleCreateDistrict_, roles: [CONFIG.ROLES.MANAGER] },
    [CONFIG.ACTIONS.CREATE_ZONE]: { fn: handleCreateZone_, roles: [CONFIG.ROLES.MANAGER] },
    [CONFIG.ACTIONS.CREATE_GEOJSON]: { fn: handleCreateGeoJSON_, roles: [CONFIG.ROLES.MANAGER] },
    [CONFIG.ACTIONS.CREATE_KPI]: { fn: handleCreateKPI_, roles: [CONFIG.ROLES.MANAGER] },
    [CONFIG.ACTIONS.CREATE_USER]: { fn: handleCreateUser_, roles: [CONFIG.ROLES.ADMINISTRATOR] },
    [CONFIG.ACTIONS.CREATE_PRESENTATION]: { fn: handleCreatePresentation_, roles: [CONFIG.ROLES.MANAGER] },

    [CONFIG.ACTIONS.UPDATE_GOVERNORATE]: { fn: handleUpdateGovernorate_, roles: [CONFIG.ROLES.MANAGER] },
    [CONFIG.ACTIONS.UPDATE_ADMINISTRATION]: { fn: handleUpdateAdministration_, roles: [CONFIG.ROLES.MANAGER] },
    [CONFIG.ACTIONS.UPDATE_DISTRICT]: { fn: handleUpdateDistrict_, roles: [CONFIG.ROLES.MANAGER] },
    [CONFIG.ACTIONS.UPDATE_ZONE]: { fn: handleUpdateZone_, roles: [CONFIG.ROLES.MANAGER] },
    [CONFIG.ACTIONS.UPDATE_GEOJSON]: { fn: handleUpdateGeoJSON_, roles: [CONFIG.ROLES.MANAGER] },
    [CONFIG.ACTIONS.UPDATE_KPI]: { fn: handleUpdateKPI_, roles: [CONFIG.ROLES.MANAGER] },
    [CONFIG.ACTIONS.UPDATE_SETTINGS]: { fn: handleUpdateSettings_, roles: [CONFIG.ROLES.ADMINISTRATOR] },
    [CONFIG.ACTIONS.UPDATE_USER]: { fn: handleUpdateUser_, roles: [CONFIG.ROLES.ADMINISTRATOR] },
    [CONFIG.ACTIONS.UPDATE_PRESENTATION]: { fn: handleUpdatePresentation_, roles: [CONFIG.ROLES.MANAGER] },
    [CONFIG.ACTIONS.ACTIVATE_USER]: { fn: handleActivateUser_, roles: [CONFIG.ROLES.ADMINISTRATOR] },
    [CONFIG.ACTIONS.DEACTIVATE_USER]: { fn: handleDeactivateUser_, roles: [CONFIG.ROLES.ADMINISTRATOR] },
    [CONFIG.ACTIONS.ASSIGN_ROLE]: { fn: handleAssignRole_, roles: [CONFIG.ROLES.ADMINISTRATOR] },
    [CONFIG.ACTIONS.CHANGE_PASSWORD]: { fn: handleChangePassword_, roles: [CONFIG.ROLES.VIEWER] },
    [CONFIG.ACTIONS.REORDER_PRESENTATION]: { fn: handleReorderPresentation_, roles: [CONFIG.ROLES.MANAGER] },

    [CONFIG.ACTIONS.DELETE_GOVERNORATE]: { fn: handleDeleteGovernorate_, roles: [CONFIG.ROLES.ADMINISTRATOR] },
    [CONFIG.ACTIONS.DELETE_ADMINISTRATION]: { fn: handleDeleteAdministration_, roles: [CONFIG.ROLES.ADMINISTRATOR] },
    [CONFIG.ACTIONS.DELETE_DISTRICT]: { fn: handleDeleteDistrict_, roles: [CONFIG.ROLES.ADMINISTRATOR] },
    [CONFIG.ACTIONS.DELETE_ZONE]: { fn: handleDeleteZone_, roles: [CONFIG.ROLES.ADMINISTRATOR] },
    [CONFIG.ACTIONS.DELETE_GEOJSON]: { fn: handleDeleteGeoJSON_, roles: [CONFIG.ROLES.ADMINISTRATOR] },
    [CONFIG.ACTIONS.DELETE_KPI]: { fn: handleDeleteKPI_, roles: [CONFIG.ROLES.ADMINISTRATOR] },
    [CONFIG.ACTIONS.DELETE_USER]: { fn: handleDeleteUser_, roles: [CONFIG.ROLES.ADMINISTRATOR] },
    [CONFIG.ACTIONS.DELETE_PRESENTATION]: { fn: handleDeletePresentation_, roles: [CONFIG.ROLES.ADMINISTRATOR] }
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
