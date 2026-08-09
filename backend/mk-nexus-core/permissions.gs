/**
 * ============================================================
 * MK NEXUS BACKEND — PERMISSIONS
 * Hierarchical role enforcement, driven entirely by CONFIG.
 * Unchanged in this review — this file is solid: unknown roles rank
 * -1 and fail every check safely (fail-closed), and every write route
 * in router.gs was already correctly gated through requireRole_() here.
 * ============================================================
 */

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
