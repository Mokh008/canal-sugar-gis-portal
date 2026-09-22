window.MKNexus = window.MKNexus || {};

/* Single source of truth for the deployed Apps Script API and its router. */
MKNexus.ApiConfig = Object.freeze({
  // Redeployed again after moving org placement off the Users sheet and
  // into Org_Assignments (assignOrgMember/unassignOrgMember/getMyScope —
  // see backend/mk-nexus-core/org-structure.gs, directory.gs and
  // modules/org-chart.js). See backend/mk-nexus-core/README.md for the
  // full change log.
  baseUrl: 'https://script.google.com/macros/s/AKfycbzls5AoesPNKU7r40P7pUhESK2LIfST05TOaATWRldx3QNTz80BdspgrpY0ND2c0lVOhA/exec',
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
  // Was 15000 — raised after a reported login timeout ("Backend request
  // timed out.", the login screen's own error banner) on mobile data.
  // getLoginOrgInfo_ (backend/mk-nexus-core/directory.gs) has since been
  // cut from 5 sheet reads to 1, which was the likely main cause, but
  // Apps Script web apps still have real cold-start latency independent
  // of that — this is headroom against a slow network + a cold start
  // landing on the same request, not a fix for a specific slow handler.
  timeoutMs: 30000,
  sessionStorageKey: 'mknexus_session_token',
});
