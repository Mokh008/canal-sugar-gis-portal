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
    // The logged-in user's own Users-sheet row ID (e.g. "USR009").
    id: '',
    // Set via modules/settings.js's Profile tab (avatar.gs's
    // handleUploadAvatar_) — empty until someone uploads a photo, in
    // which case the header/Settings avatar fall back to initials.
    avatarUrl: '',
    // Was already in the login response but never kept anywhere on the
    // client until modules/settings.js's read-only Profile tab needed it.
    username: '',
    email: '',
    // Populated from the login response's Users.EngineerID column (see
    // backend/mk-nexus-core/auth.gs) when this account is tied to a
    // specific engineer — modules/rent.js and modules/expenses.js read
    // this instead of asking for a manually-typed ID when it's set.
    engineerId: '',
    // Org Chart placement, resolved server-side at login (see
    // backend/mk-nexus-core/directory.gs's getLoginOrgInfo_) — NOT read
    // from the Users sheet, which is descriptive only. `managesTeam` is
    // true for anyone who is an administration manager / sector head in
    // the Org Chart; it is what unlocks the Report tabs (Rent/Expenses)
    // and the Attendance module (see core/access.js). `positions` is a
    // list of { level, id, name, path } for display in Settings.
    managesTeam: false,
    positions: [],
  },
  notifications: [
    { title: 'Harvest sync completed — North Minya', time: '2m ago' },
    { title: '3 loads pending rejection review', time: '18m ago' },
  ],
};
