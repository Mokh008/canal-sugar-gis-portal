window.MKNexus = window.MKNexus || {};

/* Single source of truth for the deployed Apps Script API and its router. */
MKNexus.ApiConfig = Object.freeze({
  // Redeployed again (New deployment, hence another URL change) after
  // switching avatar.gs's photo URL to Drive's thumbnail endpoint. See
  // backend/mk-nexus-core/README.md for the full change log.
  baseUrl: 'https://script.google.com/macros/s/AKfycbwlaIpRn2zVqih4M8AYvWMLls1dMTi1q7VfIFZ_QHyZbXxuTdwxB-tlbUUUb3nBm_dq6w/exec',
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
