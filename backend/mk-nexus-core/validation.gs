/**
 * ============================================================
 * MK NEXUS BACKEND — VALIDATION
 * Field validation, duplicate checks, hierarchy checks.
 * Never trust frontend data — everything routes through here.
 * Unchanged in this review — no injection risk found (values go
 * through Range#setValue/appendRow, not formula construction from
 * user input) and the required-field/hierarchy checks are sound.
 * ============================================================
 */

/**
 * Field schemas per entity type. Defines required fields and,
 * where relevant, which field points to the parent entity's ID
 * (for hierarchy validation).
 */
const VALIDATION_SCHEMAS_ = {
  [CONFIG.ENTITY_TYPES.GOVERNORATE]: {
    required: ['Name', 'Code'],
    parent: null
  },
  [CONFIG.ENTITY_TYPES.ADMINISTRATION]: {
    required: ['Name', 'Code', 'GovernorateID'],
    parent: { field: 'GovernorateID', sheet: CONFIG.SHEETS.GOVERNORATES, idColumn: 'ID' }
  },
  [CONFIG.ENTITY_TYPES.DISTRICT]: {
    required: ['Name', 'Code', 'AdministrationID'],
    parent: { field: 'AdministrationID', sheet: CONFIG.SHEETS.ADMINISTRATIONS, idColumn: 'ID' }
  },
  [CONFIG.ENTITY_TYPES.ZONE]: {
    required: ['Name', 'DistrictID'],
    parent: { field: 'DistrictID', sheet: CONFIG.SHEETS.DISTRICTS, idColumn: 'ID' }
  },
  [CONFIG.ENTITY_TYPES.GEOJSON]: {
    required: ['EntityType', 'EntityID', 'Geometry'],
    parent: null
  },
  [CONFIG.ENTITY_TYPES.KPI]: {
    required: ['BoundaryID', 'BoundaryType'],
    parent: null
  },
  [CONFIG.ENTITY_TYPES.USER]: {
    required: ['Name', 'Username', 'Email', 'Role'],
    parent: null
  },
  [CONFIG.ENTITY_TYPES.PRESENTATION]: {
    required: ['Title', 'Order'],
    parent: null
  }
};

/**
 * Validates that all required fields are present and non-empty.
 * @param {string} entityType - one of CONFIG.ENTITY_TYPES
 * @param {Object} payload
 * @throws {AppError_} on missing fields
 */
function validateRequiredFields_(entityType, payload) {
  const schema = VALIDATION_SCHEMAS_[entityType];
  if (!schema) {
    throw new AppError_('UNKNOWN_ENTITY_TYPE', `No validation schema for entity type "${entityType}".`);
  }

  const missing = schema.required.filter(field => {
    const val = payload[field];
    return val === undefined || val === null || String(val).trim() === '';
  });

  if (missing.length > 0) {
    throw new AppError_('MISSING_FIELDS', `Missing required field(s): ${missing.join(', ')}`);
  }
}

/**
 * Validates that no existing row already has the given ID.
 * Used before every CREATE.
 * @param {string} sheetName
 * @param {string} idColumn
 * @param {string} idValue
 * @throws {AppError_} if a duplicate is found
 */
function validateNoDuplicateId_(sheetName, idColumn, idValue) {
  if (!idValue) return; // IDs are generated server-side for creates without a supplied ID
  const rows = readSheetAsObjects_(sheetName);
  const exists = rows.some(row => String(row[idColumn]) === String(idValue));
  if (exists) {
    throw new AppError_('DUPLICATE_ID', `ID "${idValue}" already exists in "${sheetName}".`);
  }
}

/**
 * Validates that a required ID exists in the sheet it references.
 * @param {string} idValue
 * @throws {AppError_} if the ID cannot be found
 */
function validateIdExists_(sheetName, idColumn, idValue) {
  const rows = readSheetAsObjects_(sheetName);
  const exists = rows.some(row => String(row[idColumn]) === String(idValue));
  if (!exists) {
    throw new AppError_('NOT_FOUND', `ID "${idValue}" not found in "${sheetName}".`);
  }
  return exists;
}

/**
 * Validates the parent reference declared in an entity's schema,
 * if one exists. Rejects invalid hierarchy (e.g. an Administration
 * pointing at a Governorate ID that doesn't exist).
 * @param {string} entityType
 * @param {Object} payload
 * @throws {AppError_} if parent ID is missing or invalid
 */
function validateHierarchy_(entityType, payload) {
  const schema = VALIDATION_SCHEMAS_[entityType];
  if (!schema || !schema.parent) return;

  const parentId = payload[schema.parent.field];
  validateIdExists_(schema.parent.sheet, schema.parent.idColumn, parentId);
}

/**
 * Validates that a required ID param was supplied (used for
 * update/delete/get-by-id operations coming from request params).
 * @param {*} idValue
 * @param {string} paramName
 * @throws {AppError_} if missing
 */
function validateIdParam_(idValue, paramName) {
  if (!idValue || String(idValue).trim() === '') {
    throw new AppError_('MISSING_ID', `Required parameter "${paramName || 'id'}" is missing.`);
  }
}

/**
 * Validates that a string is well-formed JSON (used for Geometry payloads).
 * @param {string} value
 * @throws {AppError_} if invalid JSON
 * @returns {Object} parsed JSON
 */
function validateJsonString_(value, fieldName) {
  try {
    return JSON.parse(value);
  } catch (err) {
    throw new AppError_('INVALID_JSON_FIELD', `Field "${fieldName}" is not valid JSON.`);
  }
}

/**
 * Validates that a boundary type string is one of the three
 * supported KPI boundary levels.
 * @param {string} boundaryType
 * @throws {AppError_} if not recognized
 */
function validateBoundaryType_(boundaryType) {
  const valid = [
    CONFIG.ENTITY_TYPES.GOVERNORATE,
    CONFIG.ENTITY_TYPES.ADMINISTRATION,
    CONFIG.ENTITY_TYPES.DISTRICT
  ];
  if (valid.indexOf(boundaryType) === -1) {
    throw new AppError_(
      'INVALID_BOUNDARY_TYPE',
      `BoundaryType must be one of: ${valid.join(', ')}.`
    );
  }
}

/**
 * Validates that a BoundaryID actually exists in the sheet
 * corresponding to its declared BoundaryType.
 * @param {string} boundaryId
 * @param {string} boundaryType
 * @throws {AppError_} if the boundary cannot be found
 */
function validateBoundaryExists_(boundaryId, boundaryType) {
  const sheetByType = {
    [CONFIG.ENTITY_TYPES.GOVERNORATE]: CONFIG.SHEETS.GOVERNORATES,
    [CONFIG.ENTITY_TYPES.ADMINISTRATION]: CONFIG.SHEETS.ADMINISTRATIONS,
    [CONFIG.ENTITY_TYPES.DISTRICT]: CONFIG.SHEETS.DISTRICTS
  };
  const sheetName = sheetByType[boundaryType];
  if (!sheetName) {
    throw new AppError_('INVALID_BOUNDARY_TYPE', `Unrecognized BoundaryType "${boundaryType}".`);
  }
  validateIdExists_(sheetName, 'ID', boundaryId);
}

/**
 * Full validation pipeline for a CREATE request: sanitize, check
 * required fields, check hierarchy. Returns the sanitized payload.
 * @param {string} entityType
 * @param {Object} rawPayload
 * @returns {Object} sanitized payload
 */
function validateCreatePayload_(entityType, rawPayload) {
  const payload = sanitizeObject_(rawPayload);
  validateRequiredFields_(entityType, payload);
  validateHierarchy_(entityType, payload);
  return payload;
}

/**
 * Full validation pipeline for an UPDATE request: sanitize only
 * the fields that were actually supplied, then re-check hierarchy
 * if a parent field was among them.
 * @param {string} entityType
 * @param {Object} rawPayload
 * @returns {Object} sanitized partial payload
 */
function validateUpdatePayload_(entityType, rawPayload) {
  const payload = sanitizeObject_(rawPayload);
  const schema = VALIDATION_SCHEMAS_[entityType];
  if (schema && schema.parent && payload[schema.parent.field] !== undefined) {
    validateHierarchy_(entityType, payload);
  }
  return payload;
}
