window.MKNexus = window.MKNexus || {};

/* Single source of truth for the deployed Apps Script API and its router. */
MKNexus.ApiConfig = Object.freeze({
  // Redeployed again after moving org placement off the Users sheet and
  // into Org_Assignments (assignOrgMember/unassignOrgMember/getMyScope —
  // see backend/mk-nexus-core/org-structure.gs, directory.gs and
  // modules/org-chart.js). See backend/mk-nexus-core/README.md for the
  // full change log.
  baseUrl: 'https://script.google.com/macros/s/AKfycbytBzg8oxpeEsugX41kBtorHGU_CFqEFeCFEJbtelb6OTiPFQgbyLHKA5CZ_NemErbIvQ/exec',
  actions: Object.freeze([
    'login', 'validateSession', 'logout',
    'getGovernorates', 'getAdministrations', 'getDistricts', 'getZones', 'getPolygon',
    'getKPIs', 'getKPIAggregate', 'getPresentation', 'getSettings', 'getUsers', 'getAuditLog',
    'getMyScope',
    'getOrgStructure', 'assignOrgMember', 'unassignOrgMember',
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
    'assignOrgMember', 'unassignOrgMember',
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
