window.MKNexus = window.MKNexus || {};

MKNexus.SessionData = {
  // Placeholder profile, overwritten by login.js's applySessionProfile()
  // on a real login. Only ever seen as-is via the login screen's "demo"
  // bypass (app.js/login.js — offered solely when the backend is
  // unreachable, never on a rejected password). `role: 'Admin'` keeps
  // that fallback showing every module, matching its pre-Roles-matrix
  // behavior — see core/access.js, which would otherwise hide
  // everything from an unrecognized role string.
  profile: {
    name: 'M. Farouk',
    role: 'Admin',
    initials: 'MF',
    // Populated from the login response's Users.EngineerID column (see
    // backend/mk-nexus-core/auth.gs) when this account is tied to a
    // specific engineer — modules/rent.js and modules/expenses.js read
    // this instead of asking for a manually-typed ID when it's set.
    engineerId: '',
    // Populated from the login response's Users.SectorID column (see
    // backend/mk-nexus-core/auth.gs) — a Section Manger/Manager's own
    // sector code, used by modules/rent.js and modules/expenses.js to
    // scope their report views to "my sector" instead of everyone's via
    // core/data/team-directory.js. Empty for roles with no sector
    // concept (Admin) or before the backend redeploy that adds it.
    sectorId: '',
  },
  notifications: [
    { title: 'Harvest sync completed — North Minya', time: '2m ago' },
    { title: '3 loads pending rejection review', time: '18m ago' },
  ],
};
