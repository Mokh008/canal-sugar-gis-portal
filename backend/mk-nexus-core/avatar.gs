/**
 * ============================================================
 * MK NEXUS BACKEND — AVATAR
 * NEW FILE. One action (uploadAvatar, wired in router.gs/config.gs) —
 * a self-service profile photo for the Settings module's Profile tab
 * (modules/settings.js), styled after a WhatsApp-style "tap your own
 * avatar to change it" flow.
 *
 * Always writes to the CALLER'S OWN row — `context.user.id` comes from
 * the already-authenticated session (see router.gs's routeRequest_,
 * which sets context.user before this handler ever runs), never a
 * client-supplied id. Nobody can overwrite someone else's avatar this
 * way, unlike the Users-tab create/update actions this backend already
 * has, which do trust a client-supplied id (by design — those are
 * Admin-only account management, this is "change my own photo").
 * ============================================================
 */

// Defense-in-depth ceiling on the *decoded* image size — the frontend
// already resizes/compresses to a small JPEG before sending (see
// modules/settings.js), but this backend can't trust that a request
// actually came from that code path.
const AVATAR_MAX_BYTES_ = 2 * 1024 * 1024; // 2 MB

/**
 * Accepts a base64-encoded image, saves it to Drive, and records the
 * resulting URL on the caller's own Users row (adding an AvatarUrl
 * column the first time it's needed).
 * @param {Object} context - context.user is the authenticated session
 * @returns {Object} { avatarUrl }
 */
function handleUploadAvatar_(context) {
  const base64 = context.body.imageBase64;
  const mimeType = String(context.body.mimeType || 'image/jpeg');

  if (!base64 || typeof base64 !== 'string') {
    throw new AppError_('MISSING_FIELDS', 'No image data received.');
  }
  if (!/^image\/(jpeg|jpg|png|webp)$/.test(mimeType)) {
    throw new AppError_('INVALID_IMAGE_TYPE', 'Only JPEG, PNG, or WebP images are allowed.');
  }

  let bytes;
  try {
    bytes = Utilities.base64Decode(base64);
  } catch (err) {
    throw new AppError_('INVALID_IMAGE_DATA', 'Image data could not be decoded.');
  }
  if (bytes.length > AVATAR_MAX_BYTES_) {
    throw new AppError_('FILE_TOO_LARGE', 'Image is too large (max 2 MB).');
  }

  const ext = mimeType.split('/')[1].replace('jpeg', 'jpg');
  const blob = Utilities.newBlob(bytes, mimeType, `avatar_${context.user.id}.${ext}`);

  const folderName = 'MK_Nexus_Avatars';
  const existingFolders = DriveApp.getFoldersByName(folderName);
  const folder = existingFolders.hasNext() ? existingFolders.next() : DriveApp.createFolder(folderName);

  const file = folder.createFile(blob);
  // Same sharing trade-off already made (and documented) for Rent's
  // receipts and Expenses' PDFs — "anyone with the link" is what lets
  // the resulting URL work as a plain <img src> without a second auth
  // hop. A profile photo is far lower-sensitivity than those PDFs
  // (which embed national ID numbers), so this is a reasonable default
  // here even though it wasn't for those.
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  // Drive's normal file URL isn't reliably embeddable as an <img src>;
  // this export/view form is.
  const avatarUrl = 'https://drive.google.com/uc?export=view&id=' + file.getId();

  writeAvatarUrl_(context.user.id, avatarUrl);

  writeAuditLog_({
    user: context.user.username,
    action: CONFIG.AUDIT_ACTIONS.UPDATE,
    entity: CONFIG.ENTITY_TYPES.USER,
    entityId: context.user.id,
    oldValue: null,
    newValue: 'avatar updated'
  });

  return { avatarUrl: avatarUrl };
}

/**
 * Writes AvatarUrl for a single user row, adding the column first if it
 * doesn't exist yet — same pattern as auth.gs's setUserPasswordFields_
 * (bound-spreadsheet first, CONFIG.SPREADSHEET_ID only as a fallback;
 * see that function's comment for why).
 * @param {string} userId
 * @param {string} url
 */
function writeAvatarUrl_(userId, url) {
  const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEETS.USERS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];

  let idCol = headers.indexOf('ID');
  let avatarCol = headers.indexOf('AvatarUrl');

  if (avatarCol === -1) {
    avatarCol = headers.length;
    sheet.getRange(1, avatarCol + 1).setValue('AvatarUrl');
  }
  if (idCol === -1) {
    throw new Error('Users sheet is missing an ID column.');
  }

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idCol]) === String(userId)) {
      sheet.getRange(i + 1, avatarCol + 1).setValue(url);
      return;
    }
  }
  throw new Error('User ' + userId + ' not found while writing avatar URL.');
}
