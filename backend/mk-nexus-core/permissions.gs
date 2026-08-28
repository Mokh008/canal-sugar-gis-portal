/**
 * ============================================================
 * MK NEXUS BACKEND — PERMISSIONS
 * Hierarchical role enforcement, driven entirely by CONFIG.
 * This file's fail-closed design (unknown roles rank -1) is unchanged;
 * added normalizeRole_() below to canonicalize the real sheet's mixed-
 * case role values before they ever reach getRoleRank_() — see its
 * header comment and config.gs's ROLES/ROLE_HIERARCHY.
 * ============================================================
 */

/**
 * Canonicalizes a raw Users.Role sheet value to one of CONFIG.ROLES'
 * exact strings, case-insensitively. The live sheet mixes casing for
 * the same role ("Manager"/"manager", "Engineer"/"engineer",
 * "Supervisor"/"supervisor") — without this, getRoleRank_()'s exact-
 * string indexOf() would rank those rows -1 ("unrecognized role") and
 * fail-closed on every protected route, even though the role is
 * perfectly valid. Call this once, right after reading Users.Role
 * (see auth.gs's handleLogin_), so every canonicalized role from then
 * on — session, permission checks, audit log, the frontend — is
 * consistent. Matches on a case-insensitive "contains" basis in
 * highest-privilege-first order so e.g. "Section Manger" isn't
 * mistaken for plain "Manager" (it contains "manager" as a substring
 * too). Returns the raw, trimmed value unchanged if nothing matches —
 * getRoleRank_() still ranks that -1 and fails closed, exactly as
 * before for a truly unrecognized role.
 * @param {string} rawRole
 * @returns {string}
 */
function normalizeRole_(rawRole) {
  const value = String(rawRole || '').trim();
  const lower = value.toLowerCase();
  if (lower.indexOf('admin') !== -1) return CONFIG.ROLES.ADMIN;
  if (lower.indexOf('section') !== -1) return CONFIG.ROLES.SECTION_MANAGER;
  if (lower.indexOf('supervisor') !== -1) return CONFIG.ROLES.SUPERVISOR;
  if (lower.indexOf('engineer') !== -1) return CONFIG.ROLES.ENGINEER;
  if (lower.indexOf('manager') !== -1) return CONFIG.ROLES.MANAGER;
  return value;
}

/**
 * Returns the numeric rank of a role (higher = more privileged).
 * Unknown roles rank lowest (-1), so they fail every check safely.
 * @param {string} role
 * @returns {number}
 */
function getRoleRank_(role) {
  return CONFIG.ROLE_HIERARCHY.indexOf(role);
}

/**
 * Throws unless the user's role meets or exceeds the minimum
 * required role for the route. `requiredRoles` is the array set
 * on the route table entry — its first element is treated as the
 * minimum privilege threshold.
 * @param {Object} user - authenticated user object (must have .role)
 * @param {Array<string>} requiredRoles
 * @throws {AppError_} FORBIDDEN
 */
function requireRole_(user, requiredRoles) {
  if (!requiredRoles || requiredRoles.length === 0) return; // no restriction

  if (!user || !user.role) {
    throw new AppError_('FORBIDDEN', 'No role associated with this session.');
  }

  const userRank = getRoleRank_(user.role);
  const minRequiredRank = Math.min(...requiredRoles.map(getRoleRank_));

  if (userRank === -1) {
    throw new AppError_('FORBIDDEN', `Unrecognized role: "${user.role}".`);
  }

  if (userRank < minRequiredRank) {
    throw new AppError_(
      'FORBIDDEN',
      `This action requires at least "${requiredRoles[0]}" privileges.`
    );
  }
}

/**
 * Boolean convenience check (non-throwing), useful inside handlers
 * that need conditional logic rather than a hard reject.
 * @param {Object} user
 * @param {string} minRole
 * @returns {boolean}
 */
function hasMinimumRole_(user, minRole) {
  if (!user || !user.role) return false;
  return getRoleRank_(user.role) >= getRoleRank_(minRole);
}
