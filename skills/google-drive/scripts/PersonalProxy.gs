// PersonalProxy.gs — Personal Gmail Apps Script
// Deployed as web app on personal Gmail account.
// Reads/writes Google Spreadsheet as proxy for Google Drive.
// Claude Code calls this via HTTP; WorkSync.gs handles the actual Drive API.

// ── Configuration ──────────────────────────────────────────────────────────────

var CONFIG = {
  SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID_HERE',
  API_KEY: 'YOUR_API_KEY_HERE',
  SHEET_NAMES: {
    FILES: 'Files',
    COMMAND_QUEUE: 'CommandQueue',
    SYNC_META: 'SyncMeta'
  }
};

// Column indices for Files sheet (0-based)
var FIL = {
  SHEET_FILE_ID: 0,
  GOOGLE_FILE_ID: 1,
  NAME: 2,
  MIME_TYPE: 3,
  SIZE: 4,
  SHEET_PARENT_ID: 5,
  GOOGLE_PARENT_ID: 6,
  DESCRIPTION: 7,
  STARRED: 8,
  TRASHED: 9,
  WEB_VIEW_LINK: 10,
  WEB_CONTENT_LINK: 11,
  OWNERS: 12,
  MODIFIED_TIME: 13,
  CREATED_TIME: 14,
  SYNC_STATUS: 15,
  UPDATED_AT: 16,
  SYNCED_AT: 17,
  UPDATED_BY: 18,
  GOOGLE_MODIFIED: 19,
  EXTRA_PROPS_JSON: 20
};

// ── Web App Entry Points ───────────────────────────────────────────────────────

function doPost(e) {
  try {
    var params = JSON.parse(e.postData.contents);
    if (params.key !== CONFIG.API_KEY) {
      return jsonResponse_({ error: 'Unauthorized' }, 401);
    }
    var action = params.action;
    var handler = ACTIONS[action];
    if (!handler) {
      return jsonResponse_({ error: 'Unknown action: ' + action }, 400);
    }
    var result = handler(params);
    return jsonResponse_(result);
  } catch (err) {
    return jsonResponse_({ error: err.message, stack: err.stack }, 500);
  }
}

function doGet(e) {
  return jsonResponse_({ status: 'ok', message: 'Google Drive Proxy is running' });
}

// ── Action Router ──────────────────────────────────────────────────────────────

var ACTIONS = {
  // Read from sheet cache
  listFiles: listFiles_,
  getFile: getFile_,
  listRecentFiles: listRecentFiles_,
  listFolders: listFolders_,
  // Write to sheet (sync pushes to Drive)
  createFolder: createFolder_,
  createFile: createFile_,
  createDocument: createDocument_,
  createSpreadsheet: createSpreadsheet_,
  createPresentation: createPresentation_,
  renameFile: renameFile_,
  updateDescription: updateDescription_,
  starFile: starFile_,
  unstarFile: unstarFile_,
  trashFile: trashFile_,
  restoreFile: restoreFile_,
  // Async (via CommandQueue)
  searchFiles: searchFiles_,
  listFolderContents: listFolderContents_,
  moveFile: moveFile_,
  copyFile: copyFile_,
  shareFile: shareFile_,
  unshareFile: unshareFile_,
  getPermissions: getPermissions_,
  setPublicAccess: setPublicAccess_,
  removePublicAccess: removePublicAccess_,
  exportFile: exportFile_,
  getFileContent: getFileContent_,
  listRevisions: listRevisions_,
  getRevision: getRevision_,
  listComments: listComments_,
  addComment: addComment_,
  deleteComment: deleteComment_,
  listReplies: listReplies_,
  addReply: addReply_,
  listSharedDrives: listSharedDrives_,
  getStorageInfo: getStorageInfo_,
  emptyTrash: emptyTrash_,
  getCommandResult: getCommandResult_,
  syncNow: syncNow_
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function jsonResponse_(data, code) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet_(name) {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(name);
}

function uuid_() {
  return Utilities.getUuid();
}

function now_() {
  return new Date().toISOString();
}

function getAllRows_(sheet) {
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  var headers = data[0];
  return data.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function findRowIndex_(sheet, colIndex, value) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][colIndex]) === String(value)) return i + 1;
  }
  return -1;
}

function getRowBySheetId_(sheet, colIndex, id) {
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return null;
  var headers = data[0];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][colIndex]) === String(id)) {
      var obj = {};
      headers.forEach(function(h, j) { obj[h] = data[i][j]; });
      return obj;
    }
  }
  return null;
}

function isActiveFile_(row) {
  var ss = row.syncStatus || row[FIL.SYNC_STATUS];
  return ss !== 'deleted' && ss !== 'pending_delete';
}

function isBool_(val) {
  return String(val) === 'true' || val === true;
}

// ── Formatting ─────────────────────────────────────────────────────────────────

function formatFile_(row) {
  var file = {
    id: row.sheetFileId || '',
    name: row.name || '',
    mimeType: row.mimeType || '',
    size: row.size || '',
    description: row.description || '',
    starred: isBool_(row.starred),
    trashed: isBool_(row.trashed),
    webViewLink: row.webViewLink || '',
    webContentLink: row.webContentLink || '',
    owners: row.owners || '',
    modifiedTime: row.modifiedTime || '',
    createdTime: row.createdTime || '',
    parentId: row.sheetParentId || '',
    updated: row.updatedAt || row.syncedAt || '',
    kind: 'drive#file'
  };

  if (row.extraPropsJson) {
    try {
      var extra = JSON.parse(row.extraPropsJson);
      if (extra.shared !== undefined) file.shared = extra.shared;
    } catch(e) {}
  }

  return file;
}

function formatFileFromArray_(arr) {
  var file = {
    id: arr[FIL.SHEET_FILE_ID] || '',
    name: arr[FIL.NAME] || '',
    mimeType: arr[FIL.MIME_TYPE] || '',
    size: arr[FIL.SIZE] || '',
    description: arr[FIL.DESCRIPTION] || '',
    starred: isBool_(arr[FIL.STARRED]),
    trashed: isBool_(arr[FIL.TRASHED]),
    webViewLink: arr[FIL.WEB_VIEW_LINK] || '',
    webContentLink: arr[FIL.WEB_CONTENT_LINK] || '',
    owners: arr[FIL.OWNERS] || '',
    modifiedTime: arr[FIL.MODIFIED_TIME] || '',
    createdTime: arr[FIL.CREATED_TIME] || '',
    parentId: arr[FIL.SHEET_PARENT_ID] || '',
    updated: arr[FIL.UPDATED_AT] || '',
    kind: 'drive#file'
  };

  if (arr[FIL.EXTRA_PROPS_JSON]) {
    try {
      var extra = JSON.parse(arr[FIL.EXTRA_PROPS_JSON]);
      if (extra.shared !== undefined) file.shared = extra.shared;
    } catch(e) {}
  }

  return file;
}

// ── Read Actions (from sheet cache) ────────────────────────────────────────────

function listFiles_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var rows = getAllRows_(sheet);
  var folderId = params.folderId || null;
  var mimeType = params.mimeType || null;
  var starred = params.starred;
  var trashed = params.trashed;
  var query = params.query ? params.query.toLowerCase() : null;

  var items = rows.filter(function(r) {
    if (!isActiveFile_(r)) return false;
    if (!trashed && isBool_(r.trashed)) return false;
    if (trashed && !isBool_(r.trashed)) return false;
    if (folderId && r.sheetParentId !== folderId) return false;
    if (mimeType && r.mimeType !== mimeType) return false;
    if (starred && !isBool_(r.starred)) return false;
    if (query) {
      var text = ((r.name || '') + ' ' + (r.description || '')).toLowerCase();
      if (text.indexOf(query) === -1) return false;
    }
    return true;
  }).map(formatFile_).sort(function(a, b) {
    return new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0);
  });

  return { kind: 'drive#fileList', items: items };
}

function getFile_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var row = getRowBySheetId_(sheet, FIL.SHEET_FILE_ID, params.fileId);
  if (!row || !isActiveFile_(row)) return { error: 'File not found' };
  return formatFile_(row);
}

function listRecentFiles_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var rows = getAllRows_(sheet);
  var limit = params.limit || 20;

  var items = rows.filter(function(r) {
    return isActiveFile_(r) && !isBool_(r.trashed);
  }).map(formatFile_).sort(function(a, b) {
    return new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0);
  }).slice(0, limit);

  return { kind: 'drive#fileList', items: items };
}

function listFolders_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var rows = getAllRows_(sheet);
  var parentId = params.parentId || null;

  var items = rows.filter(function(r) {
    if (!isActiveFile_(r)) return false;
    if (isBool_(r.trashed)) return false;
    if (r.mimeType !== 'application/vnd.google-apps.folder') return false;
    if (parentId && r.sheetParentId !== parentId) return false;
    return true;
  }).map(formatFile_).sort(function(a, b) {
    return (a.name || '').localeCompare(b.name || '');
  });

  return { kind: 'drive#fileList', items: items };
}

// ── Write Actions (write to sheet, sync pushes to Drive) ──────────────────────

function createFolder_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var id = uuid_();
  var ts = now_();

  sheet.appendRow([
    id,                                           // A: sheetFileId
    '',                                           // B: googleFileId
    params.name || '',                            // C: name
    'application/vnd.google-apps.folder',         // D: mimeType
    '',                                           // E: size
    params.parentId || '',                        // F: sheetParentId
    '',                                           // G: googleParentId
    params.description || '',                     // H: description
    false,                                        // I: starred
    false,                                        // J: trashed
    '',                                           // K: webViewLink
    '',                                           // L: webContentLink
    '',                                           // M: owners
    '',                                           // N: modifiedTime
    '',                                           // O: createdTime
    'pending_create',                             // P: syncStatus
    ts,                                           // Q: updatedAt
    '',                                           // R: syncedAt
    'claude',                                     // S: updatedBy
    '',                                           // T: googleModified
    ''                                            // U: extraPropsJson
  ]);

  return { id: id, name: params.name, mimeType: 'application/vnd.google-apps.folder', kind: 'drive#file', updated: ts };
}

function createFile_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var id = uuid_();
  var ts = now_();

  var extraProps = { content: params.content || '' };

  sheet.appendRow([
    id,                                           // A: sheetFileId
    '',                                           // B: googleFileId
    params.name || '',                            // C: name
    params.mimeType || 'text/plain',              // D: mimeType
    '',                                           // E: size
    params.parentId || '',                        // F: sheetParentId
    '',                                           // G: googleParentId
    params.description || '',                     // H: description
    false,                                        // I: starred
    false,                                        // J: trashed
    '',                                           // K: webViewLink
    '',                                           // L: webContentLink
    '',                                           // M: owners
    '',                                           // N: modifiedTime
    '',                                           // O: createdTime
    'pending_create',                             // P: syncStatus
    ts,                                           // Q: updatedAt
    '',                                           // R: syncedAt
    'claude',                                     // S: updatedBy
    '',                                           // T: googleModified
    JSON.stringify(extraProps)                     // U: extraPropsJson
  ]);

  return { id: id, name: params.name, mimeType: params.mimeType || 'text/plain', kind: 'drive#file', updated: ts };
}

function createDocument_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var id = uuid_();
  var ts = now_();

  sheet.appendRow([
    id,                                           // A: sheetFileId
    '',                                           // B: googleFileId
    params.name || '',                            // C: name
    'application/vnd.google-apps.document',       // D: mimeType
    '',                                           // E: size
    params.parentId || '',                        // F: sheetParentId
    '',                                           // G: googleParentId
    params.description || '',                     // H: description
    false,                                        // I: starred
    false,                                        // J: trashed
    '',                                           // K: webViewLink
    '',                                           // L: webContentLink
    '',                                           // M: owners
    '',                                           // N: modifiedTime
    '',                                           // O: createdTime
    'pending_create',                             // P: syncStatus
    ts,                                           // Q: updatedAt
    '',                                           // R: syncedAt
    'claude',                                     // S: updatedBy
    '',                                           // T: googleModified
    ''                                            // U: extraPropsJson
  ]);

  return { id: id, name: params.name, mimeType: 'application/vnd.google-apps.document', kind: 'drive#file', updated: ts };
}

function createSpreadsheet_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var id = uuid_();
  var ts = now_();

  sheet.appendRow([
    id,                                           // A: sheetFileId
    '',                                           // B: googleFileId
    params.name || '',                            // C: name
    'application/vnd.google-apps.spreadsheet',    // D: mimeType
    '',                                           // E: size
    params.parentId || '',                        // F: sheetParentId
    '',                                           // G: googleParentId
    params.description || '',                     // H: description
    false,                                        // I: starred
    false,                                        // J: trashed
    '',                                           // K: webViewLink
    '',                                           // L: webContentLink
    '',                                           // M: owners
    '',                                           // N: modifiedTime
    '',                                           // O: createdTime
    'pending_create',                             // P: syncStatus
    ts,                                           // Q: updatedAt
    '',                                           // R: syncedAt
    'claude',                                     // S: updatedBy
    '',                                           // T: googleModified
    ''                                            // U: extraPropsJson
  ]);

  return { id: id, name: params.name, mimeType: 'application/vnd.google-apps.spreadsheet', kind: 'drive#file', updated: ts };
}

function createPresentation_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var id = uuid_();
  var ts = now_();

  sheet.appendRow([
    id,                                           // A: sheetFileId
    '',                                           // B: googleFileId
    params.name || '',                            // C: name
    'application/vnd.google-apps.presentation',   // D: mimeType
    '',                                           // E: size
    params.parentId || '',                        // F: sheetParentId
    '',                                           // G: googleParentId
    params.description || '',                     // H: description
    false,                                        // I: starred
    false,                                        // J: trashed
    '',                                           // K: webViewLink
    '',                                           // L: webContentLink
    '',                                           // M: owners
    '',                                           // N: modifiedTime
    '',                                           // O: createdTime
    'pending_create',                             // P: syncStatus
    ts,                                           // Q: updatedAt
    '',                                           // R: syncedAt
    'claude',                                     // S: updatedBy
    '',                                           // T: googleModified
    ''                                            // U: extraPropsJson
  ]);

  return { id: id, name: params.name, mimeType: 'application/vnd.google-apps.presentation', kind: 'drive#file', updated: ts };
}

function renameFile_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var rowNum = findRowIndex_(sheet, FIL.SHEET_FILE_ID, params.fileId);
  if (rowNum < 0) return { error: 'File not found' };
  var ts = now_();

  sheet.getRange(rowNum, FIL.NAME + 1).setValue(params.name);
  sheet.getRange(rowNum, FIL.SYNC_STATUS + 1).setValue('pending_update');
  sheet.getRange(rowNum, FIL.UPDATED_AT + 1).setValue(ts);
  sheet.getRange(rowNum, FIL.UPDATED_BY + 1).setValue('claude');

  var data = sheet.getRange(rowNum, 1, 1, 21).getValues()[0];
  return formatFileFromArray_(data);
}

function updateDescription_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var rowNum = findRowIndex_(sheet, FIL.SHEET_FILE_ID, params.fileId);
  if (rowNum < 0) return { error: 'File not found' };
  var ts = now_();

  sheet.getRange(rowNum, FIL.DESCRIPTION + 1).setValue(params.description);
  sheet.getRange(rowNum, FIL.SYNC_STATUS + 1).setValue('pending_update');
  sheet.getRange(rowNum, FIL.UPDATED_AT + 1).setValue(ts);
  sheet.getRange(rowNum, FIL.UPDATED_BY + 1).setValue('claude');

  var data = sheet.getRange(rowNum, 1, 1, 21).getValues()[0];
  return formatFileFromArray_(data);
}

function starFile_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var rowNum = findRowIndex_(sheet, FIL.SHEET_FILE_ID, params.fileId);
  if (rowNum < 0) return { error: 'File not found' };
  var ts = now_();

  sheet.getRange(rowNum, FIL.STARRED + 1).setValue(true);
  sheet.getRange(rowNum, FIL.SYNC_STATUS + 1).setValue('pending_update');
  sheet.getRange(rowNum, FIL.UPDATED_AT + 1).setValue(ts);
  sheet.getRange(rowNum, FIL.UPDATED_BY + 1).setValue('claude');

  return { success: true, fileId: params.fileId };
}

function unstarFile_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var rowNum = findRowIndex_(sheet, FIL.SHEET_FILE_ID, params.fileId);
  if (rowNum < 0) return { error: 'File not found' };
  var ts = now_();

  sheet.getRange(rowNum, FIL.STARRED + 1).setValue(false);
  sheet.getRange(rowNum, FIL.SYNC_STATUS + 1).setValue('pending_update');
  sheet.getRange(rowNum, FIL.UPDATED_AT + 1).setValue(ts);
  sheet.getRange(rowNum, FIL.UPDATED_BY + 1).setValue('claude');

  return { success: true, fileId: params.fileId };
}

function trashFile_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var rowNum = findRowIndex_(sheet, FIL.SHEET_FILE_ID, params.fileId);
  if (rowNum < 0) return { error: 'File not found' };
  var ts = now_();

  sheet.getRange(rowNum, FIL.TRASHED + 1).setValue(true);
  sheet.getRange(rowNum, FIL.SYNC_STATUS + 1).setValue('pending_trash');
  sheet.getRange(rowNum, FIL.UPDATED_AT + 1).setValue(ts);
  sheet.getRange(rowNum, FIL.UPDATED_BY + 1).setValue('claude');

  return { success: true, fileId: params.fileId };
}

function restoreFile_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var rowNum = findRowIndex_(sheet, FIL.SHEET_FILE_ID, params.fileId);
  if (rowNum < 0) return { error: 'File not found' };
  var ts = now_();

  sheet.getRange(rowNum, FIL.TRASHED + 1).setValue(false);
  sheet.getRange(rowNum, FIL.SYNC_STATUS + 1).setValue('pending_restore');
  sheet.getRange(rowNum, FIL.UPDATED_AT + 1).setValue(ts);
  sheet.getRange(rowNum, FIL.UPDATED_BY + 1).setValue('claude');

  return { success: true, fileId: params.fileId };
}

// ── Async Actions (via CommandQueue) ──────────────────────────────────────────

function enqueueCommand_(action, params) {
  var cmdSheet = getSheet_(CONFIG.SHEET_NAMES.COMMAND_QUEUE);
  var id = uuid_();
  var ts = now_();
  cmdSheet.appendRow([
    id, action, JSON.stringify(params), 'pending', ts, '', ''
  ]);
  return { requestId: id, status: 'queued', message: action + ' queued. Poll with getCommandResult in ~60 seconds.' };
}

function searchFiles_(params) {
  return enqueueCommand_('searchFiles', {
    query: params.query || '',
    mimeType: params.mimeType || '',
    folderId: params.folderId || '',
    trashed: params.trashed || false
  });
}

function listFolderContents_(params) {
  return enqueueCommand_('listFolderContents', {
    folderId: params.folderId || ''
  });
}

function moveFile_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var row = getRowBySheetId_(sheet, FIL.SHEET_FILE_ID, params.fileId);
  if (!row) return { error: 'File not found' };
  var googleFileId = row.googleFileId;
  if (!googleFileId) return { error: 'File has no Google ID yet. Wait for sync.' };
  var googleParentId = row.googleParentId;

  return enqueueCommand_('moveFile', {
    googleFileId: googleFileId,
    sheetFileId: params.fileId,
    currentGoogleParentId: googleParentId || '',
    destinationFolderId: params.destinationFolderId || ''
  });
}

function copyFile_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var row = getRowBySheetId_(sheet, FIL.SHEET_FILE_ID, params.fileId);
  if (!row) return { error: 'File not found' };
  var googleFileId = row.googleFileId;
  if (!googleFileId) return { error: 'File has no Google ID yet. Wait for sync.' };

  return enqueueCommand_('copyFile', {
    googleFileId: googleFileId,
    name: params.name || '',
    destinationFolderId: params.destinationFolderId || ''
  });
}

function shareFile_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var row = getRowBySheetId_(sheet, FIL.SHEET_FILE_ID, params.fileId);
  if (!row) return { error: 'File not found' };
  var googleFileId = row.googleFileId;
  if (!googleFileId) return { error: 'File has no Google ID yet. Wait for sync.' };

  return enqueueCommand_('shareFile', {
    googleFileId: googleFileId,
    email: params.email || '',
    role: params.role || 'viewer',
    sendNotification: params.sendNotification !== false,
    message: params.message || ''
  });
}

function unshareFile_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var row = getRowBySheetId_(sheet, FIL.SHEET_FILE_ID, params.fileId);
  if (!row) return { error: 'File not found' };
  var googleFileId = row.googleFileId;
  if (!googleFileId) return { error: 'File has no Google ID yet. Wait for sync.' };

  return enqueueCommand_('unshareFile', {
    googleFileId: googleFileId,
    email: params.email || ''
  });
}

function getPermissions_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var row = getRowBySheetId_(sheet, FIL.SHEET_FILE_ID, params.fileId);
  if (!row) return { error: 'File not found' };
  var googleFileId = row.googleFileId;
  if (!googleFileId) return { error: 'File has no Google ID yet. Wait for sync.' };

  return enqueueCommand_('getPermissions', {
    googleFileId: googleFileId
  });
}

function setPublicAccess_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var row = getRowBySheetId_(sheet, FIL.SHEET_FILE_ID, params.fileId);
  if (!row) return { error: 'File not found' };
  var googleFileId = row.googleFileId;
  if (!googleFileId) return { error: 'File has no Google ID yet. Wait for sync.' };

  return enqueueCommand_('setPublicAccess', {
    googleFileId: googleFileId,
    role: params.role || 'viewer'
  });
}

function removePublicAccess_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var row = getRowBySheetId_(sheet, FIL.SHEET_FILE_ID, params.fileId);
  if (!row) return { error: 'File not found' };
  var googleFileId = row.googleFileId;
  if (!googleFileId) return { error: 'File has no Google ID yet. Wait for sync.' };

  return enqueueCommand_('removePublicAccess', {
    googleFileId: googleFileId
  });
}

function exportFile_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var row = getRowBySheetId_(sheet, FIL.SHEET_FILE_ID, params.fileId);
  if (!row) return { error: 'File not found' };
  var googleFileId = row.googleFileId;
  if (!googleFileId) return { error: 'File has no Google ID yet. Wait for sync.' };

  return enqueueCommand_('exportFile', {
    googleFileId: googleFileId,
    exportMimeType: params.exportMimeType || 'application/pdf'
  });
}

function getFileContent_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var row = getRowBySheetId_(sheet, FIL.SHEET_FILE_ID, params.fileId);
  if (!row) return { error: 'File not found' };
  var googleFileId = row.googleFileId;
  if (!googleFileId) return { error: 'File has no Google ID yet. Wait for sync.' };

  return enqueueCommand_('getFileContent', {
    googleFileId: googleFileId,
    mimeType: row.mimeType || ''
  });
}

function listRevisions_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var row = getRowBySheetId_(sheet, FIL.SHEET_FILE_ID, params.fileId);
  if (!row) return { error: 'File not found' };
  var googleFileId = row.googleFileId;
  if (!googleFileId) return { error: 'File has no Google ID yet. Wait for sync.' };

  return enqueueCommand_('listRevisions', {
    googleFileId: googleFileId
  });
}

function getRevision_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var row = getRowBySheetId_(sheet, FIL.SHEET_FILE_ID, params.fileId);
  if (!row) return { error: 'File not found' };
  var googleFileId = row.googleFileId;
  if (!googleFileId) return { error: 'File has no Google ID yet. Wait for sync.' };

  return enqueueCommand_('getRevision', {
    googleFileId: googleFileId,
    revisionId: params.revisionId || ''
  });
}

function listComments_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var row = getRowBySheetId_(sheet, FIL.SHEET_FILE_ID, params.fileId);
  if (!row) return { error: 'File not found' };
  var googleFileId = row.googleFileId;
  if (!googleFileId) return { error: 'File has no Google ID yet. Wait for sync.' };

  return enqueueCommand_('listComments', {
    googleFileId: googleFileId
  });
}

function addComment_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var row = getRowBySheetId_(sheet, FIL.SHEET_FILE_ID, params.fileId);
  if (!row) return { error: 'File not found' };
  var googleFileId = row.googleFileId;
  if (!googleFileId) return { error: 'File has no Google ID yet. Wait for sync.' };

  return enqueueCommand_('addComment', {
    googleFileId: googleFileId,
    content: params.content || ''
  });
}

function deleteComment_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var row = getRowBySheetId_(sheet, FIL.SHEET_FILE_ID, params.fileId);
  if (!row) return { error: 'File not found' };
  var googleFileId = row.googleFileId;
  if (!googleFileId) return { error: 'File has no Google ID yet. Wait for sync.' };

  return enqueueCommand_('deleteComment', {
    googleFileId: googleFileId,
    commentId: params.commentId || ''
  });
}

function listReplies_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var row = getRowBySheetId_(sheet, FIL.SHEET_FILE_ID, params.fileId);
  if (!row) return { error: 'File not found' };
  var googleFileId = row.googleFileId;
  if (!googleFileId) return { error: 'File has no Google ID yet. Wait for sync.' };

  return enqueueCommand_('listReplies', {
    googleFileId: googleFileId,
    commentId: params.commentId || ''
  });
}

function addReply_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.FILES);
  var row = getRowBySheetId_(sheet, FIL.SHEET_FILE_ID, params.fileId);
  if (!row) return { error: 'File not found' };
  var googleFileId = row.googleFileId;
  if (!googleFileId) return { error: 'File has no Google ID yet. Wait for sync.' };

  return enqueueCommand_('addReply', {
    googleFileId: googleFileId,
    commentId: params.commentId || '',
    content: params.content || ''
  });
}

function listSharedDrives_() {
  return enqueueCommand_('listSharedDrives', {});
}

function getStorageInfo_() {
  return enqueueCommand_('getStorageInfo', {});
}

function emptyTrash_() {
  return enqueueCommand_('emptyTrash', {});
}

function getCommandResult_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.COMMAND_QUEUE);
  var row = getRowBySheetId_(sheet, 0, params.requestId);
  if (!row) return { error: 'Request not found' };

  var result = {
    requestId: row.commandId,
    action: row.action,
    status: row.status,
    createdAt: row.createdAt || '',
    processedAt: row.processedAt || ''
  };

  if (row.status === 'completed' && row.result) {
    try { result.result = JSON.parse(row.result); } catch(e) { result.result = row.result; }
  } else if (row.status === 'failed' && row.result) {
    result.error = row.result;
  }

  return result;
}

// ── Utility Actions ──────────────────────────────────────────────────────────

function syncNow_() {
  var cmdSheet = getSheet_(CONFIG.SHEET_NAMES.COMMAND_QUEUE);
  var id = uuid_();
  var ts = now_();
  cmdSheet.appendRow([
    id, 'syncNow', '', 'pending', ts, '', ''
  ]);
  return { requestId: id, status: 'queued', message: 'Sync requested. Will execute on next cycle.' };
}
