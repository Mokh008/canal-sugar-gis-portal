window.MKNexus = window.MKNexus || {};

MKNexus.SessionData = {
  profile: {
    name: 'M. Farouk',
    role: 'Operations Director',
    initials: 'MF',
    // Populated from the login response's Users.EngineerID column (see
    // backend/mk-nexus-core/auth.gs) when this account is tied to a
    // specific engineer — modules/rent.js and modules/expenses.js read
    // this instead of asking for a manually-typed ID when it's set.
    engineerId: '',
  },
  notifications: [
    { title: 'Harvest sync completed — North Minya', time: '2m ago' },
    { title: '3 loads pending rejection review', time: '18m ago' },
  ],
};
