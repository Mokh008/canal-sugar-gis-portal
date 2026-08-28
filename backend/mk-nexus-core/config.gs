/**
 * ============================================================
 * MK NEXUS BACKEND — CONFIG
 * Central configuration object. Every sheet name, action name,
 * role, and system constant lives here. No magic strings anywhere else.
 * ============================================================
 */

const CONFIG = {

  VERSION: '1.0.0',

  SPREADSHEET_ID: PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'),

  SHEETS: {
    USERS: 'Users',
    GOVERNORATES: 'Governorates',
    ADMINISTRATIONS: 'Administrations',
    DISTRICTS: 'Districts',
    AGRICULTURAL_ZONES: 'Agricultural_Zones',
    GEOJSON: 'GeoJSON',
    KPI: 'KPI',
    PRESENTATION: 'Presentation',
    SETTINGS: 'Settings',
    AUDIT_LOG: 'Audit_Log'
  },

  // ROLES ALIGNED TO THE REAL USERS SHEET (was 'Administrator'/'Manager'/
  // 'Viewer' — three roles that don't exist anywhere in the live sheet,
  // so getRoleRank_() ranked every real login -1 ("unrecognized role")
  // and 403'd every protected route unconditionally). The five values
  // below are the ones actually stored in Users.Role. 'Section Manger'
  // keeps that exact spelling (not a typo introduced here) because it's
  // what the sheet itself uses consistently for that role — changing it
  // here without also changing every row would just reintroduce the
  // same "unrecognized role" failure for that role specifically. Casing
  // in the sheet is inconsistent (e.g. "manager"/"Manager", "engineer"/
  // "Engineer") — normalizeRole_() in permissions.gs canonicalizes a raw
  // sheet value to one of these five before it's ever compared, so
  // ROLE_HIERARCHY.indexOf() below always sees a canonical string.
  ROLES: {
    ADMIN: 'Admin',
    SECTION_MANAGER: 'Section Manger',
    MANAGER: 'Manager',
    ENGINEER: 'Engineer',
    SUPERVISOR: 'Supervisor'
  },

  // Ordered lowest -> highest privilege. Used by permissions.gs
  // for hierarchical comparisons instead of hardcoded checks.
  ROLE_HIERARCHY: ['Supervisor', 'Engineer', 'Manager', 'Section Manger', 'Admin'],

  ACTIONS: {
    // Auth
    LOGIN: 'login',
    VALIDATE_SESSION: 'validateSession',
    LOGOUT: 'logout', // added — see auth.gs's handleLogout_(); server-side session revocation (there was previously no way to invalidate a token before its 8h TTL expired)

    // Read
    GET_GOVERNORATES: 'getGovernorates',
    GET_ADMINISTRATIONS: 'getAdministrations',
    GET_DISTRICTS: 'getDistricts',
    GET_ZONES: 'getZones',
    GET_POLYGON: 'getPolygon',
    GET_KPIS: 'getKPIs',
    GET_PRESENTATION: 'getPresentation',
    GET_SETTINGS: 'getSettings',
    GET_USERS: 'getUsers',
    GET_AUDIT_LOG: 'getAuditLog',
    GET_TEAM_DIRECTORY: 'getTeamDirectory', // see directory.gs — sector-scoping roster for Rent/Expenses reports

    // Create
    CREATE_GOVERNORATE: 'createGovernorate',
    CREATE_ADMINISTRATION: 'createAdministration',
    CREATE_DISTRICT: 'createDistrict',
    CREATE_ZONE: 'createZone',
    CREATE_GEOJSON: 'createGeoJSON',
    CREATE_KPI: 'createKPI',

    // Update
    UPDATE_GOVERNORATE: 'updateGovernorate',
    UPDATE_ADMINISTRATION: 'updateAdministration',
    UPDATE_DISTRICT: 'updateDistrict',
    UPDATE_ZONE: 'updateZone',
    UPDATE_GEOJSON: 'updateGeoJSON',
    UPDATE_KPI: 'updateKPI',
    UPDATE_SETTINGS: 'updateSettings',

    // Delete
    DELETE_GOVERNORATE: 'deleteGovernorate',
    DELETE_ADMINISTRATION: 'deleteAdministration',
    DELETE_DISTRICT: 'deleteDistrict',
    DELETE_ZONE: 'deleteZone',
    DELETE_GEOJSON: 'deleteGeoJSON',
    DELETE_KPI: 'deleteKPI',

    // Users
    CREATE_USER: 'createUser',
    UPDATE_USER: 'updateUser',
    DELETE_USER: 'deleteUser',
    ACTIVATE_USER: 'activateUser',
    DEACTIVATE_USER: 'deactivateUser',
    CHANGE_PASSWORD: 'changePassword',
    ASSIGN_ROLE: 'assignRole',

    // KPI
    GET_KPI_AGGREGATE: 'getKPIAggregate',

    // Presentation
    CREATE_PRESENTATION: 'createPresentation',
    UPDATE_PRESENTATION: 'updatePresentation',
    DELETE_PRESENTATION: 'deletePresentation',
    REORDER_PRESENTATION: 'reorderPresentation'
  },

  ENTITY_TYPES: {
    GOVERNORATE: 'Governorate',
    ADMINISTRATION: 'Administration',
    DISTRICT: 'District',
    ZONE: 'Agricultural_Zone',
    GEOJSON: 'GeoJSON',
    KPI: 'KPI',
    USER: 'User',
    SETTINGS: 'Settings',
    PRESENTATION: 'Presentation'
  },

  AUDIT_ACTIONS: {
    CREATE: 'CREATE',
    UPDATE: 'UPDATE',
    DELETE: 'DELETE',
    LOGIN: 'LOGIN',
    LOGOUT: 'LOGOUT'
  },

  SYSTEM: {
    MAX_BATCH_SIZE: 500,
    SESSION_DURATION_MINUTES: 480, // 8 hours
    GEOJSON_KEEP_VERSIONS: 20      // how many historical versions to retain per geometry
  },

  HTTP_STATUS: {
    OK: 200,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    SERVER_ERROR: 500
  }
};
