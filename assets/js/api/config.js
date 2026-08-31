window.MKNexus = window.MKNexus || {};

/* Single source of truth for the deployed Apps Script API and its router. */
MKNexus.ApiConfig = Object.freeze({
  // Redeployed again (New deployment, hence another URL change) after
  // the auth.gs UserID->ID fix. See backend/mk-nexus-core/README.md's
  // "Role management update" section for the backend changes this
  // deployment carries.
  baseUrl: 'https://script.google.com/macros/s/AKfycbzJCA_5O01f_ud-Yn_beT6qwh2OUB6CeJ1M421GDNobr23dc8nZflcbUDSwAtAzpUSPSw/exec',
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
    'updateSettings',
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
    'updateSettings',
  ]),
  timeoutMs: 15000,
  sessionStorageKey: 'mknexus_session_token',
});
