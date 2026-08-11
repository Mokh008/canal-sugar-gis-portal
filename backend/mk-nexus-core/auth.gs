/**
 * ============================================================
 * MK NEXUS BACKEND — AUTH
 * Login, session issuance, session validation, logout.
 * ============================================================
 *
 * ASSUMPTION: the Users sheet has columns:
 * ID | Name | Username | Email | PasswordHash | Salt | Role | Active
 *
 * NEW: optional EngineerID column, added so a login here can also carry
 * the numeric ID the Rent/Expenses backends key employees by (e.g.
 * "1001777") — those two never had a login of their own, so their
 * frontend modules used to make every engineer type that ID in by hand,
 * every visit, with no verification it was really them. If a user's row
 * has EngineerID filled in, the login response now includes it and
 * modules/rent.js + modules/expenses.js pick it up automatically instead
 * of showing the free-text field. Leave it blank for accounts that
 * aren't tied to a specific engineer (e.g. admins) — those modules fall
 * back to the manual field exactly as before when it's empty.
 *
 * SECURITY FIX (Critical): the live Users sheet was storing passwords
 * in PLAIN TEXT in the PasswordHash column and comparing them with a
 * direct string equality check — despite this file's own original
 * header comment claiming SHA-256(salt + password) hashing, and despite
 * hashPassword_() already existing below, unused. Anyone with read
 * access to the Users sheet (any Sheet editor, or anyone who
 * compromises it) could read every user's real password.
 *
 * Fixed via verifyPassword_()/upgradePasswordIfNeeded_(): a login still
 * succeeds against a legacy plaintext PasswordHash (so this deploys
 * without locking anyone out), but the moment it does, that user's
 * password is immediately re-hashed with a fresh per-user salt and the
 * plaintext is overwritten — a self-healing "hash on next login"
 * migration. runOneTimePasswordMigration_() below does the same thing
 * for every user at once, for anyone who wants it done immediately
 * rather than waiting for each user's next login (recommended — run it
 * once from the Apps Script editor, then this whole migration path
 * becomes a no-op for everyone and can stay in place harmlessly).
 */

const SESSION_CACHE_PREFIX_ = 'MKNEXUS_SESSION_';

/**
 * Handles the login action. Verifies credentials, issues a session
 * token, and returns the token plus a safe (password-free) user object.
 * @param {Object} context - { params, body }
 * @returns {Object} { token, user }
 */
function handleLogin_(context) {
  const username = sanitizeString_(context.body.username || context.params.username);
  const password = context.body.password || context.params.password;

  if (!username || !password) {
    throw new AppError_('MISSING_CREDENTIALS', 'Username and password are required.');
  }

  const users = readSheetAsObjects_(CONFIG.SHEETS.USERS);
  const user = users.find(u => String(u.Username).toLowerCase() === username.toLowerCase());

  if (!user) {
    throw new AppError_('INVALID_CREDENTIALS', 'Invalid username or password.');
  }

  if (String(user.IsActive).toUpperCase() === 'FALSE') {
    throw new AppError_('ACCOUNT_DISABLED', 'This account has been disabled.');
  }

  if (!verifyPassword_(user, password)) {
    throw new AppError_('INVALID_CREDENTIALS', 'Invalid username or password.');
  }

  // Self-healing migration off plaintext passwords — see file header.
  // Runs AFTER a successful verify, while we still have the correct
  // plaintext in hand, and is a no-op for anyone already migrated.
  upgradePasswordIfNeeded_(user, password);

  const safeUser = {
    id: user.UserID,
    name: user.FullName,
    username: user.Username,
    email: user.Email,
    role: user.Role,
    engineerId: user.EngineerID ? String(user.EngineerID).trim() : ''
  };

  const token = createSession_(safeUser);
  updateLastLogin_(user.UserID);

  writeAuditLog_({
    user: safeUser.username,
    action: CONFIG.AUDIT_ACTIONS.LOGIN,
    entity: CONFIG.ENTITY_TYPES.USER,
    entityId: safeUser.id,
    oldValue: null,
    newValue: null
  });

  return { token: token, user: safeUser };
}

/**
 * Handles session validation requests (used by frontend on app load).
 * @param {Object} context
 * @returns {Object} { valid, user }
 */
function handleValidateSession_(context) {
  const token = context.params.token || context.body.token;
  validateIdParam_(token, 'token');

  const user = getSessionUser_(token);
  if (!user) {
    return { valid: false, user: null };
  }
  return { valid: true, user: user };
}

/**
 * Handles logout requests — invalidates the session server-side
 * immediately, rather than leaving it valid in cache for up to its
 * full 8-hour TTL after the client discards its copy of the token
 * (which is all the previous frontend-only "logout" could do). Doesn't
 * throw on a missing/already-invalid token — logging out of a session
 * that's already gone should still read as a successful logout to the
 * caller.
 * @param {Object} context
 * @returns {Object} { success: true }
 */
function handleLogout_(context) {
  const token = context.params.token || context.body.token;
  if (token) {
    const user = getSessionUser_(token);
    CacheService.getScriptCache().remove(SESSION_CACHE_PREFIX_ + token);
    if (user) {
      writeAuditLog_({
        user: user.username,
        action: CONFIG.AUDIT_ACTIONS.LOGOUT,
        entity: CONFIG.ENTITY_TYPES.USER,
        entityId: user.id,
        oldValue: null,
        newValue: null
      });
    }
  }
  return { success: true };
}

/**
 * Creates a new session for a user and stores it in CacheService.
 * @param {Object} safeUser
 * @returns {string} session token
 */
function createSession_(safeUser) {
  const token = Utilities.getUuid();
  const cache = CacheService.getScriptCache();
  const ttlSeconds = CONFIG.SYSTEM.SESSION_DURATION_MINUTES * 60;
  cache.put(SESSION_CACHE_PREFIX_ + token, JSON.stringify(safeUser), ttlSeconds);
  return token;
}

/**
 * Retrieves the user object associated with a session token.
 * Returns null if the token is missing, invalid, or expired.
 * @param {string} token
 * @returns {Object|null}
 */
function getSessionUser_(token) {
  if (!token) return null;
  const cache = CacheService.getScriptCache();
  const raw = cache.get(SESSION_CACHE_PREFIX_ + token);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

/**
 * Authenticates an incoming request. Called by the router for every
 * protected route. Throws on failure — never returns a falsy value
 * for a route that requires auth.
 * @param {Object} context
 * @returns {Object} the authenticated user
 * @throws {AppError_} UNAUTHORIZED
 */
function authenticateRequest_(context) {
  const token = context.params.token || context.body.token;
  if (!token) {
    throw new AppError_('UNAUTHORIZED', 'Missing session token.');
  }
  const user = getSessionUser_(token);
  if (!user) {
    throw new AppError_('UNAUTHORIZED', 'Session is invalid or has expired.');
  }
  return user;
}

/**
 * Hashes a password with its salt using SHA-256, returned as hex.
 * @param {string} password
 * @param {string} salt
 * @returns {string} hex-encoded hash
 */
function hashPassword_(password, salt) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    salt + password
  );
  return digest.map(byte => {
    const v = (byte < 0 ? byte + 256 : byte).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

/**
 * True if `password` matches the user's stored credential — via a
 * salted hash comparison if the user has already been migrated
 * (Salt column populated), or via a direct plaintext comparison for a
 * not-yet-migrated legacy row. Never throws; a mismatch is just `false`.
 * @param {Object} user - row object from the Users sheet (readSheetAsObjects_)
 * @param {string} password
 * @returns {boolean}
 */
function verifyPassword_(user, password) {
  const salt = user.Salt ? String(user.Salt).trim() : '';
  if (salt) {
    return hashPassword_(String(password), salt) === String(user.PasswordHash);
  }
  // Legacy, not-yet-migrated row: PasswordHash currently holds the
  // plaintext password directly.
  return String(password) === String(user.PasswordHash);
}

/**
 * If `user` hasn't been migrated to a salted hash yet, hashes the
 * (just-verified-correct) plaintext `password` with a fresh salt and
 * overwrites PasswordHash/Salt in the sheet. No-op for an already-
 * migrated user. Never throws — a migration failure here shouldn't
 * fail the login that triggered it; it's logged and retried next login.
 * @param {Object} user
 * @param {string} password
 */
function upgradePasswordIfNeeded_(user, password) {
  const salt = user.Salt ? String(user.Salt).trim() : '';
  if (salt) return; // already migrated

  try {
    const newSalt = Utilities.getUuid();
    const newHash = hashPassword_(String(password), newSalt);
    setUserPasswordFields_(user.UserID, newHash, newSalt);
  } catch (err) {
    logError_('Password migration failed for user ' + user.UserID, { message: err && err.message });
  }
}

/**
 * Writes PasswordHash + Salt for a single user row, adding the Salt
 * column to the Users sheet first if it doesn't exist yet. Written
 * against raw SpreadsheetApp calls (not readSheetAsObjects_'s sibling
 * write helper, whatever that's named in your sheets.gs) so this file
 * doesn't depend on a write-helper signature this review couldn't see —
 * wire it to your existing helper instead if you have an equivalent
 * "update one row's field" utility already.
 * @param {string} userId
 * @param {string} hash
 * @param {string} salt
 */
function setUserPasswordFields_(userId, hash, salt) {
  const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.SHEETS.USERS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];

  let idCol = headers.indexOf('UserID');
  let hashCol = headers.indexOf('PasswordHash');
  let saltCol = headers.indexOf('Salt');

  if (saltCol === -1) {
    saltCol = headers.length;
    sheet.getRange(1, saltCol + 1).setValue('Salt');
  }
  if (idCol === -1 || hashCol === -1) {
    throw new Error('Users sheet is missing a UserID or PasswordHash column.');
  }

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idCol]) === String(userId)) {
      const row = i + 1; // 1-indexed, +1 for header row already accounted for by loop starting at 1
      sheet.getRange(row, hashCol + 1).setValue(hash);
      sheet.getRange(row, saltCol + 1).setValue(salt);
      return;
    }
  }
  throw new Error('User ' + userId + ' not found while writing migrated password.');
}

/**
 * ONE-TIME MIGRATION — run this once manually from the Apps Script
 * editor (select this function, click Run) to hash every still-
 * plaintext password immediately, instead of waiting for each user's
 * next login. Safe to run more than once: any row that already has a
 * Salt value is skipped. Logs a summary to the execution log.
 */
function runOneTimePasswordMigration_() {
  const users = readSheetAsObjects_(CONFIG.SHEETS.USERS);
  let migrated = 0;
  let skipped = 0;

  users.forEach(user => {
    const salt = user.Salt ? String(user.Salt).trim() : '';
    if (salt) { skipped++; return; }

    const plaintext = String(user.PasswordHash);
    const newSalt = Utilities.getUuid();
    const newHash = hashPassword_(plaintext, newSalt);
    setUserPasswordFields_(user.UserID, newHash, newSalt);
    migrated++;
  });

  Logger.log('Password migration complete: %s migrated, %s already hashed.', migrated, skipped);
}
