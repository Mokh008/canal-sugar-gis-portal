window.MKNexus = window.MKNexus || {};

/* MK NEXUS — Access: role-based module visibility ("Layer 1" of the
   Roles matrix). Single source of truth for "can the logged-in user see
   module X at all" — consumed by sidebar.js (what renders) and
   router.js (what a manually-edited #hash is allowed to open), so the
   two can never drift apart the way two independent copies of the same
   check eventually would.

   NOT a security boundary by itself — same caveat as Utils.isAdmin():
   this only hides/redirects in the client. The actual data behind each
   module is only as protected as that module's own backend (see
   modules/rent.js, modules/expenses.js, and each backend module's own
   README for what is and isn't enforced server-side today).

   Role strings: the Users sheet's Role column is mixed-case
   ("Manager"/"manager", etc.) and mk-nexus-core's login response now
   canonicalizes it (see backend/mk-nexus-core/permissions.gs's
   normalizeRole_) — but normalizeRole() here does the same
   case-insensitive mapping independently, so this still works
   correctly even before that backend redeploy lands, or for any code
   path that sets profile.role from somewhere else. */
MKNexus.Access = (function () {
  // Canonical role labels — must match backend/mk-nexus-core/config.gs's
  // CONFIG.ROLES exactly (including "Section Manger", the sheet's own
  // spelling, not a typo here) and MKNexus.Config.MODULES' `roles` arrays.
  const ROLES = {
    ADMIN: 'Admin',
    SECTION_MANAGER: 'Section Manger',
    MANAGER: 'Manager',
    ENGINEER: 'Engineer',
    SUPERVISOR: 'Supervisor',
  };

  function normalizeRole(role) {
    const lower = String(role || '').trim().toLowerCase();
    if (!lower) return '';
    if (lower.includes('admin')) return ROLES.ADMIN;
    if (lower.includes('section')) return ROLES.SECTION_MANAGER;
    if (lower.includes('supervisor')) return ROLES.SUPERVISOR;
    if (lower.includes('engineer')) return ROLES.ENGINEER;
    if (lower.includes('manager')) return ROLES.MANAGER;
    return String(role).trim();
  }

  function currentRole() {
    return normalizeRole(MKNexus.SessionData?.profile?.role);
  }

  // True for anyone who holds a management position in the Org Chart —
  // manager of an administration or head of a sector — regardless of their
  // Users.Role (a job title only). Resolved server-side at login (see
  // backend/mk-nexus-core/directory.gs) and read from the session profile.
  function managesTeam() {
    return MKNexus.SessionData?.profile?.managesTeam === true;
  }

  // A module with no `roles` array declared is treated as open to
  // everyone — a safe default for anything added later without
  // remembering to update this file, rather than silently vanishing it.
  function canAccessModule(moduleId) {
    const moduleDef = MKNexus.Config.MODULES.find((m) => m.id === moduleId);
    if (!moduleDef) return false;
    if (!Array.isArray(moduleDef.roles) || !moduleDef.roles.length) return true;
    if (moduleDef.roles.includes(currentRole())) return true;
    // `orgManagers` modules (Attendance) are also open to anyone the Org
    // Chart makes a manager, even when their Users.Role is just "Engineer".
    return Boolean(moduleDef.orgManagers) && managesTeam();
  }

  function visibleModules() {
    return MKNexus.Config.MODULES.filter((m) => canAccessModule(m.id));
  }

  // Router's fallback target when the current hash points at a module
  // the session's role can't open — prefers the config-declared default
  // (Geo Intelligence) if it's visible, else the first visible module.
  function defaultModuleId() {
    const visible = visibleModules();
    if (!visible.length) return null;
    return (visible.find((m) => m.default) || visible[0]).id;
  }

  // Rent/Expenses' Report tab — Admin (everyone's data), or anyone the Org
  // Chart makes a manager (their own team's data, scoped by the calling
  // module through core/data/team-directory.js). An engineer with no
  // management position only ever sees/submits their own entries.
  function canViewReports() {
    return isAdmin() || managesTeam();
  }

  function isAdmin() {
    return currentRole() === ROLES.ADMIN;
  }

  return {
    ROLES, normalizeRole, currentRole, managesTeam,
    canAccessModule, visibleModules, defaultModuleId, canViewReports, isAdmin,
  };
})();
