window.MKNexus = window.MKNexus || {};

/* Single source of truth for the deployed Apps Script API and its router. */
MKNexus.ApiConfig = Object.freeze({
  // Redeployed again after adding users.gs to the live project (full user
  // CRUD/role/password handlers — see backend/mk-nexus-core/users.gs's
  // header comment for the account-takeover and IsActive fixes that went
  // in with it). See backend/mk-nexus-core/README.md for the full change log.
  baseUrl: 'https://script.google.com/macros/s/AKfycbw2oF9Sj-lxDTaqF2fiEK4zl2bAKDQt1QSmfM7Y7zSPjG3ToKGiX6ZBP8FYobSL3XycuQ/exec',
  actions: Object.freeze([
    'login', 'validateSession', 'logout',
    'getGovernorates', 'getAdministrations', 'getDistricts', 'getZones', 'getPolygon',
    'getKPIs', 'getKPIAggregate', 'getPresentation', 'getSettings', 'getUsers', 'getAuditLog',
    'getTeamDirectory',
    'getOrgStructure',
    'createOrgSector', 'updateOrgSector', 'deleteOrgSector',
    'createOrgAdministration', 'updateOrgAdministration', 'deleteOrgAdministration',
    'createOrgRegion', 'updateOrgRegion', 'deleteOrgRegion',
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
    'createOrgSector', 'updateOrgSector', 'deleteOrgSector',
    'createOrgAdministration', 'updateOrgAdministration', 'deleteOrgAdministration',
    'createOrgRegion', 'updateOrgRegion', 'deleteOrgRegion',
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
