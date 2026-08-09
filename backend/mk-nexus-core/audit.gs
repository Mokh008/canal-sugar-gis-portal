/**
 * ============================================================
 * MK NEXUS BACKEND — AUDIT
 * Writes an Audit_Log row for every Create/Update/Delete/Login/Logout.
 * ============================================================
 *
 * ASSUMPTION: the Audit_Log sheet has columns:
 * ID | Timestamp | User | Action | Entity | EntityID | OldValue | NewValue
 *
 * Low-severity note (not changed here — see explanation): Google Sheets
 * treats a cell value starting with certain characters (=, +, -, @) as
 * a formula when written through some Sheets write paths, which is the
 * classic "CSV/Sheet formula injection" vector if an attacker-
 * influenced string (e.g. a username) ever reached appendRowFromObject_
 * unescaped. In this codebase `entry.user` is always an already-
 * authenticated session's own username (sourced from the Users sheet
 * via auth.gs, not arbitrary attacker-supplied text at request time),
 * so practical exploitability is low — but if self-service account
 * creation or any other path ever lets a user set their own username/
 * display name freely, prefix values written here that start with
 * =/+/-/@ with a leading apostrophe (or use a RichTextValue) before
 * they reach whatever appendRowFromObject_ does under the hood.
 */

/**
 * Writes a single audit log entry. Old/new values are JSON-stringified
 * so arbitrary object shapes can be logged without schema changes.
 * @param {Object} entry
 * @param {string} entry.user - username or user ID performing the action
 * @param {string} entry.action - one of CONFIG.AUDIT_ACTIONS
 * @param {string} entry.entity - one of CONFIG.ENTITY_TYPES
 * @param {string} entry.entityId
 * @param {Object|null} entry.oldValue
 * @param {Object|null} entry.newValue
 */
function writeAuditLog_(entry) {
  const row = {
    ID: generateId_('AUD'),
    Timestamp: new Date().toISOString(),
    User: entry.user || 'unknown',
    Action: entry.action,
    Entity: entry.entity,
    EntityID: entry.entityId || '',
    OldValue: entry.oldValue ? JSON.stringify(entry.oldValue) : '',
    NewValue: entry.newValue ? JSON.stringify(entry.newValue) : ''
  };
  appendRowFromObject_(CONFIG.SHEETS.AUDIT_LOG, row);
}

/**
 * Convenience wrapper for logging a CREATE.
 */
function auditCreate_(user, entityType, entityId, newValue) {
  writeAuditLog_({
    user: user,
    action: CONFIG.AUDIT_ACTIONS.CREATE,
    entity: entityType,
    entityId: entityId,
    oldValue: null,
    newValue: newValue
  });
}

/**
 * Convenience wrapper for logging an UPDATE.
 */
function auditUpdate_(user, entityType, entityId, oldValue, newValue) {
  writeAuditLog_({
    user: user,
    action: CONFIG.AUDIT_ACTIONS.UPDATE,
    entity: entityType,
    entityId: entityId,
    oldValue: oldValue,
    newValue: newValue
  });
}

/**
 * Convenience wrapper for logging a DELETE.
 */
function auditDelete_(user, entityType, entityId, oldValue) {
  writeAuditLog_({
    user: user,
    action: CONFIG.AUDIT_ACTIONS.DELETE,
    entity: entityType,
    entityId: entityId,
    oldValue: oldValue,
    newValue: null
  });
}

/**
 * Handler for the getAuditLog action (Administrator only, per router.gs).
 * Returns log entries, most recent first.
 * @param {Object} context
 * @returns {Array<Object>}
 */
function handleGetAuditLog_(context) {
  const rows = readSheetAsObjects_(CONFIG.SHEETS.AUDIT_LOG);
  return rows.sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp));
}
