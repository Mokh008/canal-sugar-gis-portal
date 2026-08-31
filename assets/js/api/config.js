window.MKNexus = window.MKNexus || {};

/* Single source of truth for the deployed Apps Script API and its router. */
MKNexus.ApiConfig = Object.freeze({
  // Redeployed again (New deployment, hence another URL change) after
  // the setUserPasswordFields_ SPREADSHEET_ID fix + the password
  // migration was successfully run (36 users hashed). See
  // backend/mk-nexus-core/README.md for the full change log.
  baseUrl: 'https://script.google.com/macros/s/AKfycbx_0F4aq5HzkBTrW7NI40cUxRa39piw3uQ8Rf_gSkb1255c_KWTDlMZm43MzeqMt_HvmA/exec',
  actions: Object.freeze([
    'login', 'validateSession', 'logout',
    'getGovernorates', 'getAdministrations', 'getDistricts', 'getZones', 'getPolygon',
    'getKPIs', 'getKPIAggregate', 'getPresentation', 'getSettings', 'getUsers', 'getAuditLog',
    'getTeamDirectory',
    'createGovernorate', 'updateGovernorate', 'deleteGovernorate',
    'createAdministration', 'updateAdministration', 'deleteAdministration',
    'createDistrict', 'updateDistrict', 'deleteDistrict',
    'createZone', 'updateZone', 'deleteZone',
    'createGeoJSON', 'updateGeoJSON', 'deleteGeoJSON',
    'createKPI', 'updateKPI', 'deleteKPI',
    'createPresentation', 'updatePresentation', 'deletePresentation', 'reorderPresentation',
    'createUser', 'updateUser', 'deleteUser', 'activateUser', 'deactivateUser', 'assignRole', 'changePassword',
    'updateSettings', 'uploadAvatar',
  ]),
  postActions: Object.freeze([
    'login',
    'createGovernorate', 'updateGovernorate', 'deleteGovernorate',
    'createAdministration', 'updateAdministration', 'deleteAdministration',
    'createDistrict', 'updateDistrict', 'deleteDistrict',
    'createZone', 'updateZone', 'deleteZone',
    'createGeoJSON', 'updateGeoJSON', 'deleteGeoJSON',
    'createKPI', 'updateKPI', 'deleteKPI',
    'createPresentation', 'updatePresentation', 'deletePresentation', 'reorderPresentation',
    'createUser', 'updateUser', 'deleteUser', 'activateUser', 'deactivateUser', 'assignRole', 'changePassword',
    'updateSettings', 'uploadAvatar',
  ]),
  timeoutMs: 15000,
  sessionStorageKey: 'mknexus_session_token',
});
