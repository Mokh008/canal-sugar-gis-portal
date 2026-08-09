/**
 * ============================================================
 * MK NEXUS BACKEND — RESPONSE
 * Standardized response envelope for every API call.
 * Unchanged in this review — buildErrorResponse() already never leaks
 * stack traces, and router.gs's handleErrorToResponse_() already routes
 * unexpected errors through the generic "internal server error"
 * message rather than exposing err.message/stack to the client.
 * ============================================================
 */

/**
 * Builds a successful response envelope.
 * @param {*} data - Payload to return.
 * @param {string} message - Human-readable message.
 * @returns {Object} standardized response object
 */
function buildSuccessResponse(data, message) {
  return {
    success: true,
    message: message || 'OK',
    timestamp: new Date().toISOString(),
    version: CONFIG.VERSION,
    data: (data === undefined) ? null : data,
    errors: []
  };
}

/**
 * Builds an error response envelope. Never leaks stack traces.
 * @param {string} message - Human-readable error message.
 * @param {Array<string>|string} errors - Specific error details.
 * @returns {Object} standardized response object
 */
function buildErrorResponse(message, errors) {
  let errorList = [];
  if (Array.isArray(errors)) {
    errorList = errors;
  } else if (errors) {
    errorList = [String(errors)];
  }

  return {
    success: false,
    message: message || 'An error occurred',
    timestamp: new Date().toISOString(),
    version: CONFIG.VERSION,
    data: null,
    errors: errorList
  };
}

/**
 * Wraps a response object into a Google Apps Script TextOutput
 * with correct MIME type and JSON serialization.
 * @param {Object} responseObj - Envelope from buildSuccessResponse/buildErrorResponse.
 * @returns {TextOutput}
 */
function sendJsonResponse(responseObj) {
  return ContentService
    .createTextOutput(JSON.stringify(responseObj))
    .setMimeType(ContentService.MimeType.JSON);
}
