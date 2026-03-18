// WorkSync.gs — Work Email Apps Script (Sync Engine)
// Runs autonomously on the work email account via 1-minute time-based trigger.
// Syncs Google Spreadsheet ↔ Google Drive API v3 bidirectionally.
// Requires: Drive API (Advanced Service) enabled in Apps Script editor.
// Uses selective sync: only tracks files created by Claude or discovered via search.

// ── Configuration ──────────────────────────────────────────────────────────────

var SYNC_CONFIG = {
  SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID_HERE',
  BATCH_LIMIT: 50,
  LOCK_TIMEOUT_MS: 5 * 60 * 1000,       // 5 minutes
  EXECUTION_TIMEOUT_MS: 4 * 60 * 1000,   // 4 minutes (Apps Script limit is 6)
  CLEANUP_DAYS: 7,
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

// ── Trigger Setup ──────────────────────────────────────────────────────────────

function setupTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'syncCycle') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('syncCycle')
    .timeBased()
    .everyMinutes(1)
    .create();
  Logger.log('Trigger set up: syncCycle every 1 minute');
}

function removeTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'syncCycle') {
      ScriptApp.deleteTrigger(t);
    }
  });
  Logger.log('All syncCycle triggers removed');
}

// ── Main Sync Cycle ────────────────────────────────────────────────────────────

function syncCycle() {
  var startTime = Date.now();

  if (!acquireLock_()) {
    Logger.log('Sync skipped: another sync is running');
    return;
  }

  try {
    // Phase 1: Push pending changes to Google Drive
    pushToDrive_(startTime);

    // Phase 2: Pull changes from Google Drive (tracked files only)
    if (!isTimedOut_(startTime)) {
      pullFromDrive_(startTime);
    }

    // Phase 3: Process command queue
    if (!isTimedOut_(startTime)) {
      processCommands_(startTime);
    }

    // Phase 4: Cleanup
    if (!isTimedOut_(startTime)) {
      cleanupDeletedRows_();
    }

    setMeta_('lastFullSync', new Date().toISOString());
  } catch (err) {
    Logger.log('Sync error: ' + err.message + '\n' + err.stack);
  } finally {
    releaseLock_();
  }
}

// ── Lock Mechanism ─────────────────────────────────────────────────────────────

function acquireLock_() {
  var lockOwner = getMeta_('syncLockOwner');
  var lockTime = getMeta_('syncLockTime');

  if (lockOwner) {
    var lockDate = new Date(lockTime);
    if (Date.now() - lockDate.getTime() < SYNC_CONFIG.LOCK_TIMEOUT_MS) {
      return false;
    }
    Logger.log('Stale lock detected from ' + lockOwner + ', overriding');
  }

  var myId = Utilities.getUuid();
  setMeta_('syncLockOwner', myId);
  setMeta_('syncLockTime', new Date().toISOString());

  Utilities.sleep(200);
  if (getMeta_('syncLockOwner') !== myId) {
    return false;
  }
  return true;
}

function releaseLock_() {
  setMeta_('syncLockOwner', '');
  setMeta_('syncLockTime', '');
}

function isTimedOut_(startTime) {
  return (Date.now() - startTime) > SYNC_CONFIG.EXECUTION_TIMEOUT_MS;
}

// ── Phase 1: Push to Google Drive ──────────────────────────────────────────────

function pushToDrive_(startTime) {
  var sheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.FILES);
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;

  var parentMap = buildParentIdMap_(data);
  var count = 0;

  for (var i = 1; i < data.length && count < SYNC_CONFIG.BATCH_LIMIT; i++) {
    if (isTimedOut_(startTime)) break;
    var syncStatus = data[i][FIL.SYNC_STATUS];
    if (!syncStatus || syncStatus === 'synced' || syncStatus === 'deleted') continue;

    var rowNum = i + 1;

    try {
      if (syncStatus === 'pending_create') {
        pushCreate_(sheet, data[i], rowNum, parentMap);
        count++;
      } else if (syncStatus === 'pending_update') {
        if (!data[i][FIL.GOOGLE_FILE_ID]) {
          pushCreate_(sheet, data[i], rowNum, parentMap);
        } else {
          pushUpdate_(sheet, data[i], rowNum);
        }
        count++;
      } else if (syncStatus === 'pending_trash') {
        pushTrash_(sheet, data[i], rowNum);
        count++;
      } else if (syncStatus === 'pending_restore') {
        pushRestore_(sheet, data[i], rowNum);
        count++;
      }
    } catch (err) {
      Logger.log('Error pushing file row ' + rowNum + ': ' + err.message);
    }
  }
}

function pushCreate_(sheet, row, rowNum, parentMap) {
  var mimeType = row[FIL.MIME_TYPE] || 'text/plain';
  var name = row[FIL.NAME] || 'Untitled';
  var description = row[FIL.DESCRIPTION] || '';
  var sheetParentId = row[FIL.SHEET_PARENT_ID];
  var googleParentId = row[FIL.GOOGLE_PARENT_ID] || (sheetParentId ? parentMap[sheetParentId] : '') || '';

  var extraProps = {};
  try { extraProps = JSON.parse(row[FIL.EXTRA_PROPS_JSON] || '{}'); } catch(e) {}

  var metadata = {
    name: name,
    mimeType: mimeType
  };
  if (description) metadata.description = description;
  if (googleParentId) metadata.parents = [googleParentId];

  var created;

  // Google Workspace file types — create empty, no blob
  if (mimeType === 'application/vnd.google-apps.folder' ||
      mimeType === 'application/vnd.google-apps.document' ||
      mimeType === 'application/vnd.google-apps.spreadsheet' ||
      mimeType === 'application/vnd.google-apps.presentation') {
    created = Drive.Files.create(metadata, null, { fields: 'id,name,mimeType,size,webViewLink,webContentLink,owners,modifiedTime,createdTime,parents' });
  } else if (extraProps.content) {
    // File with content
    var blob = Utilities.newBlob(extraProps.content, mimeType, name);
    created = Drive.Files.create(metadata, blob, { fields: 'id,name,mimeType,size,webViewLink,webContentLink,owners,modifiedTime,createdTime,parents' });
  } else {
    // Empty file
    created = Drive.Files.create(metadata, null, { fields: 'id,name,mimeType,size,webViewLink,webContentLink,owners,modifiedTime,createdTime,parents' });
  }

  var ts = new Date().toISOString();
  var owners = '';
  if (created.owners && created.owners.length > 0) {
    owners = created.owners.map(function(o) { return o.emailAddress || ''; }).join(', ');
  }
  var parentId = (created.parents && created.parents.length > 0) ? created.parents[0] : '';

  sheet.getRange(rowNum, FIL.GOOGLE_FILE_ID + 1).setValue(created.id);
  sheet.getRange(rowNum, FIL.SIZE + 1).setValue(created.size || '');
  sheet.getRange(rowNum, FIL.GOOGLE_PARENT_ID + 1).setValue(parentId);
  sheet.getRange(rowNum, FIL.WEB_VIEW_LINK + 1).setValue(created.webViewLink || '');
  sheet.getRange(rowNum, FIL.WEB_CONTENT_LINK + 1).setValue(created.webContentLink || '');
  sheet.getRange(rowNum, FIL.OWNERS + 1).setValue(owners);
  sheet.getRange(rowNum, FIL.MODIFIED_TIME + 1).setValue(created.modifiedTime || '');
  sheet.getRange(rowNum, FIL.CREATED_TIME + 1).setValue(created.createdTime || '');
  sheet.getRange(rowNum, FIL.SYNC_STATUS + 1).setValue('synced');
  sheet.getRange(rowNum, FIL.SYNCED_AT + 1).setValue(ts);
  sheet.getRange(rowNum, FIL.GOOGLE_MODIFIED + 1).setValue(created.modifiedTime || '');

  // Clear content from extraProps after creation
  if (extraProps.content) {
    delete extraProps.content;
    var newExtra = Object.keys(extraProps).length > 0 ? JSON.stringify(extraProps) : '';
    sheet.getRange(rowNum, FIL.EXTRA_PROPS_JSON + 1).setValue(newExtra);
  }
}

function pushUpdate_(sheet, row, rowNum) {
  var googleFileId = row[FIL.GOOGLE_FILE_ID];
  if (!googleFileId) return;

  var patchBody = {};
  if (row[FIL.NAME]) patchBody.name = row[FIL.NAME];
  if (row[FIL.DESCRIPTION] !== undefined) patchBody.description = row[FIL.DESCRIPTION] || '';
  if (row[FIL.STARRED] !== undefined) patchBody.starred = String(row[FIL.STARRED]) === 'true' || row[FIL.STARRED] === true;

  var updated = Drive.Files.update(patchBody, googleFileId, null, { fields: 'id,name,modifiedTime,starred' });

  var ts = new Date().toISOString();
  sheet.getRange(rowNum, FIL.MODIFIED_TIME + 1).setValue(updated.modifiedTime || '');
  sheet.getRange(rowNum, FIL.SYNC_STATUS + 1).setValue('synced');
  sheet.getRange(rowNum, FIL.SYNCED_AT + 1).setValue(ts);
  sheet.getRange(rowNum, FIL.GOOGLE_MODIFIED + 1).setValue(updated.modifiedTime || '');
}

function pushTrash_(sheet, row, rowNum) {
  var googleFileId = row[FIL.GOOGLE_FILE_ID];
  if (googleFileId) {
    try {
      Drive.Files.update({ trashed: true }, googleFileId);
    } catch(e) { /* may already be trashed */ }
  }
  var ts = new Date().toISOString();
  sheet.getRange(rowNum, FIL.SYNC_STATUS + 1).setValue('synced');
  sheet.getRange(rowNum, FIL.SYNCED_AT + 1).setValue(ts);
}

function pushRestore_(sheet, row, rowNum) {
  var googleFileId = row[FIL.GOOGLE_FILE_ID];
  if (googleFileId) {
    try {
      Drive.Files.update({ trashed: false }, googleFileId);
    } catch(e) { /* may already be restored */ }
  }
  var ts = new Date().toISOString();
  sheet.getRange(rowNum, FIL.SYNC_STATUS + 1).setValue('synced');
  sheet.getRange(rowNum, FIL.SYNCED_AT + 1).setValue(ts);
}

// ── Phase 2: Pull from Google Drive (selective, change-based) ──────────────────

function pullFromDrive_(startTime) {
  var pageToken = getMeta_('lastChangeStartPageToken');
  if (!pageToken) {
    // First run — get initial token, skip pulling
    try {
      var tokenResponse = Drive.Changes.getStartPageToken();
      setMeta_('lastChangeStartPageToken', tokenResponse.startPageToken);
    } catch(e) {
      Logger.log('Error getting start page token: ' + e.message);
    }
    return;
  }

  var fileSheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.FILES);
  var fileData = fileSheet.getDataRange().getValues();

  // Build googleFileId → row number map for tracked files
  var trackedMap = {};
  for (var i = 1; i < fileData.length; i++) {
    var gid = fileData[i][FIL.GOOGLE_FILE_ID];
    if (gid) trackedMap[gid] = i + 1;
  }

  var currentToken = pageToken;
  do {
    if (isTimedOut_(startTime)) break;

    var response;
    try {
      response = Drive.Changes.list(currentToken, {
        fields: 'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,size,description,starred,trashed,webViewLink,webContentLink,owners,modifiedTime,createdTime,parents))',
        pageSize: 100,
        includeRemoved: true
      });
    } catch(e) {
      Logger.log('Error listing changes: ' + e.message);
      break;
    }

    if (response.changes) {
      for (var ci = 0; ci < response.changes.length; ci++) {
        if (isTimedOut_(startTime)) break;
        var change = response.changes[ci];
        var rowNum = trackedMap[change.fileId];

        // Only process changes for tracked files
        if (!rowNum) continue;

        // Skip rows with pending local changes
        var syncStatus = fileData[rowNum - 1][FIL.SYNC_STATUS];
        if (syncStatus !== 'synced') continue;

        var ts = new Date().toISOString();

        if (change.removed || (change.file && change.file.trashed === true)) {
          // File removed or trashed in Drive
          fileSheet.getRange(rowNum, FIL.TRASHED + 1).setValue(true);
          fileSheet.getRange(rowNum, FIL.SYNC_STATUS + 1).setValue('synced');
          fileSheet.getRange(rowNum, FIL.UPDATED_AT + 1).setValue(ts);
          fileSheet.getRange(rowNum, FIL.SYNCED_AT + 1).setValue(ts);
          fileSheet.getRange(rowNum, FIL.UPDATED_BY + 1).setValue('google');
        } else if (change.file) {
          var gf = change.file;
          // Check if data actually changed
          var storedModified = fileData[rowNum - 1][FIL.GOOGLE_MODIFIED];
          if (storedModified && gf.modifiedTime && gf.modifiedTime === storedModified) continue;

          var owners = '';
          if (gf.owners && gf.owners.length > 0) {
            owners = gf.owners.map(function(o) { return o.emailAddress || ''; }).join(', ');
          }
          var parentId = (gf.parents && gf.parents.length > 0) ? gf.parents[0] : '';

          fileSheet.getRange(rowNum, FIL.NAME + 1).setValue(gf.name || '');
          fileSheet.getRange(rowNum, FIL.MIME_TYPE + 1).setValue(gf.mimeType || '');
          fileSheet.getRange(rowNum, FIL.SIZE + 1).setValue(gf.size || '');
          fileSheet.getRange(rowNum, FIL.GOOGLE_PARENT_ID + 1).setValue(parentId);
          fileSheet.getRange(rowNum, FIL.DESCRIPTION + 1).setValue(gf.description || '');
          fileSheet.getRange(rowNum, FIL.STARRED + 1).setValue(gf.starred || false);
          fileSheet.getRange(rowNum, FIL.TRASHED + 1).setValue(gf.trashed || false);
          fileSheet.getRange(rowNum, FIL.WEB_VIEW_LINK + 1).setValue(gf.webViewLink || '');
          fileSheet.getRange(rowNum, FIL.WEB_CONTENT_LINK + 1).setValue(gf.webContentLink || '');
          fileSheet.getRange(rowNum, FIL.OWNERS + 1).setValue(owners);
          fileSheet.getRange(rowNum, FIL.MODIFIED_TIME + 1).setValue(gf.modifiedTime || '');
          fileSheet.getRange(rowNum, FIL.UPDATED_AT + 1).setValue(ts);
          fileSheet.getRange(rowNum, FIL.SYNCED_AT + 1).setValue(ts);
          fileSheet.getRange(rowNum, FIL.UPDATED_BY + 1).setValue('google');
          fileSheet.getRange(rowNum, FIL.GOOGLE_MODIFIED + 1).setValue(gf.modifiedTime || '');
        }
      }
    }

    currentToken = response.nextPageToken || null;

    if (response.newStartPageToken) {
      setMeta_('lastChangeStartPageToken', response.newStartPageToken);
    }
  } while (currentToken);
}

// ── Phase 3: Process Command Queue ─────────────────────────────────────────────

function processCommands_(startTime) {
  var sheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.COMMAND_QUEUE);
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;

  for (var i = 1; i < data.length; i++) {
    if (isTimedOut_(startTime)) break;
    var status = data[i][3]; // col D: status
    if (status !== 'pending') continue;

    var rowNum = i + 1;
    sheet.getRange(rowNum, 4).setValue('processing'); // status

    try {
      var action = data[i][1]; // col B: action
      var params = {};
      try { params = JSON.parse(data[i][2] || '{}'); } catch(e) {}

      var result;
      if (action === 'searchFiles') {
        result = processSearchFiles_(params);
      } else if (action === 'listFolderContents') {
        result = processListFolderContents_(params);
      } else if (action === 'moveFile') {
        result = processMoveFile_(params);
      } else if (action === 'copyFile') {
        result = processCopyFile_(params);
      } else if (action === 'shareFile') {
        result = processShareFile_(params);
      } else if (action === 'unshareFile') {
        result = processUnshareFile_(params);
      } else if (action === 'getPermissions') {
        result = processGetPermissions_(params);
      } else if (action === 'setPublicAccess') {
        result = processSetPublicAccess_(params);
      } else if (action === 'removePublicAccess') {
        result = processRemovePublicAccess_(params);
      } else if (action === 'exportFile') {
        result = processExportFile_(params);
      } else if (action === 'getFileContent') {
        result = processGetFileContent_(params);
      } else if (action === 'listRevisions') {
        result = processListRevisions_(params);
      } else if (action === 'getRevision') {
        result = processGetRevision_(params);
      } else if (action === 'listComments') {
        result = processListComments_(params);
      } else if (action === 'addComment') {
        result = processAddComment_(params);
      } else if (action === 'deleteComment') {
        result = processDeleteComment_(params);
      } else if (action === 'listReplies') {
        result = processListReplies_(params);
      } else if (action === 'addReply') {
        result = processAddReply_(params);
      } else if (action === 'listSharedDrives') {
        result = processListSharedDrives_();
      } else if (action === 'getStorageInfo') {
        result = processGetStorageInfo_();
      } else if (action === 'emptyTrash') {
        result = processEmptyTrash_();
      } else if (action === 'syncNow') {
        result = { message: 'Sync triggered' };
      } else {
        sheet.getRange(rowNum, 4).setValue('failed');
        sheet.getRange(rowNum, 7).setValue('Unknown command: ' + action);
        continue;
      }

      sheet.getRange(rowNum, 4).setValue('completed');
      sheet.getRange(rowNum, 6).setValue(new Date().toISOString()); // processedAt
      sheet.getRange(rowNum, 7).setValue(JSON.stringify(result));   // result
    } catch (err) {
      sheet.getRange(rowNum, 4).setValue('failed');
      sheet.getRange(rowNum, 6).setValue(new Date().toISOString());
      sheet.getRange(rowNum, 7).setValue(err.message);
      Logger.log('Error processing command row ' + rowNum + ': ' + err.message);
    }
  }
}

// ── Search & Discovery Commands ────────────────────────────────────────────────

function processSearchFiles_(params) {
  var queryParts = [];
  if (params.query) {
    queryParts.push("fullText contains '" + params.query.replace(/'/g, "\\'") + "'");
  }
  if (params.mimeType) {
    queryParts.push("mimeType = '" + params.mimeType + "'");
  }
  if (params.folderId) {
    // Resolve folderId — it could be a sheetFileId, look up googleFileId
    var googleFolderId = resolveGoogleFileId_(params.folderId);
    if (googleFolderId) {
      queryParts.push("'" + googleFolderId + "' in parents");
    }
  }
  if (params.trashed) {
    queryParts.push('trashed = true');
  } else {
    queryParts.push('trashed = false');
  }

  var q = queryParts.join(' and ');
  var response = Drive.Files.list({
    q: q,
    fields: 'files(id,name,mimeType,size,description,starred,trashed,webViewLink,webContentLink,owners,modifiedTime,createdTime,parents)',
    pageSize: 50,
    orderBy: 'modifiedTime desc'
  });

  var items = [];
  if (response.files) {
    response.files.forEach(function(gf) {
      upsertFile_(gf);
      items.push(formatGoogleFile_(gf));
    });
  }

  return { kind: 'drive#fileList', items: items };
}

function processListFolderContents_(params) {
  var googleFolderId = resolveGoogleFileId_(params.folderId);
  if (!googleFolderId) return { error: 'Folder not found or not synced' };

  var q = "'" + googleFolderId + "' in parents and trashed = false";
  var response = Drive.Files.list({
    q: q,
    fields: 'files(id,name,mimeType,size,description,starred,trashed,webViewLink,webContentLink,owners,modifiedTime,createdTime,parents)',
    pageSize: 100,
    orderBy: 'folder,name'
  });

  var items = [];
  if (response.files) {
    response.files.forEach(function(gf) {
      upsertFile_(gf);
      items.push(formatGoogleFile_(gf));
    });
  }

  return { kind: 'drive#fileList', items: items };
}

// ── Organize Commands ──────────────────────────────────────────────────────────

function processMoveFile_(params) {
  var googleFileId = params.googleFileId;
  var destFolderId = params.destinationFolderId;
  var currentParentId = params.currentGoogleParentId;

  // Resolve destination if it's a sheet ID
  var googleDestId = resolveGoogleFileId_(destFolderId) || destFolderId;

  var updated = Drive.Files.update({}, googleFileId, null, {
    addParents: googleDestId,
    removeParents: currentParentId || '',
    fields: 'id,name,parents,modifiedTime'
  });

  // Update sheet row
  var fileSheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.FILES);
  var rowNum = findRowByGoogleId_(fileSheet, googleFileId);
  if (rowNum > 0) {
    var newParent = (updated.parents && updated.parents.length > 0) ? updated.parents[0] : '';
    var ts = new Date().toISOString();
    fileSheet.getRange(rowNum, FIL.GOOGLE_PARENT_ID + 1).setValue(newParent);
    fileSheet.getRange(rowNum, FIL.MODIFIED_TIME + 1).setValue(updated.modifiedTime || '');
    fileSheet.getRange(rowNum, FIL.UPDATED_AT + 1).setValue(ts);
    fileSheet.getRange(rowNum, FIL.SYNCED_AT + 1).setValue(ts);
    fileSheet.getRange(rowNum, FIL.GOOGLE_MODIFIED + 1).setValue(updated.modifiedTime || '');
  }

  return { success: true, fileId: googleFileId };
}

function processCopyFile_(params) {
  var googleFileId = params.googleFileId;
  var copyBody = {};
  if (params.name) copyBody.name = params.name;

  var destFolderId = params.destinationFolderId;
  if (destFolderId) {
    var googleDestId = resolveGoogleFileId_(destFolderId) || destFolderId;
    copyBody.parents = [googleDestId];
  }

  var copied = Drive.Files.copy(copyBody, googleFileId, {
    fields: 'id,name,mimeType,size,description,starred,trashed,webViewLink,webContentLink,owners,modifiedTime,createdTime,parents'
  });

  // Insert new row in Files sheet
  upsertFile_(copied);

  return formatGoogleFile_(copied);
}

// ── Sharing & Permissions Commands ─────────────────────────────────────────────

function processShareFile_(params) {
  var googleFileId = params.googleFileId;
  var permission = {
    role: params.role || 'viewer',
    type: 'user',
    emailAddress: params.email
  };

  Drive.Permissions.create(permission, googleFileId, {
    sendNotificationEmail: params.sendNotification !== false,
    emailMessage: params.message || ''
  });

  return { success: true, email: params.email, role: params.role || 'viewer' };
}

function processUnshareFile_(params) {
  var googleFileId = params.googleFileId;
  var email = params.email;

  var permList = Drive.Permissions.list(googleFileId, {
    fields: 'permissions(id,type,role,emailAddress)'
  });

  var permId = null;
  if (permList.permissions) {
    for (var i = 0; i < permList.permissions.length; i++) {
      if (permList.permissions[i].emailAddress === email) {
        permId = permList.permissions[i].id;
        break;
      }
    }
  }

  if (!permId) return { error: 'Permission not found for ' + email };

  Drive.Permissions.remove(googleFileId, permId);
  return { success: true, email: email };
}

function processGetPermissions_(params) {
  var googleFileId = params.googleFileId;
  var permList = Drive.Permissions.list(googleFileId, {
    fields: 'permissions(id,type,role,emailAddress,displayName)'
  });

  var permissions = [];
  if (permList.permissions) {
    permissions = permList.permissions.map(function(p) {
      return {
        id: p.id || '',
        type: p.type || '',
        role: p.role || '',
        emailAddress: p.emailAddress || '',
        displayName: p.displayName || ''
      };
    });
  }

  return { permissions: permissions };
}

function processSetPublicAccess_(params) {
  var googleFileId = params.googleFileId;
  var permission = {
    role: params.role || 'viewer',
    type: 'anyone'
  };

  Drive.Permissions.create(permission, googleFileId);
  return { success: true, role: params.role || 'viewer', access: 'public' };
}

function processRemovePublicAccess_(params) {
  var googleFileId = params.googleFileId;
  var permList = Drive.Permissions.list(googleFileId, {
    fields: 'permissions(id,type)'
  });

  if (permList.permissions) {
    for (var i = 0; i < permList.permissions.length; i++) {
      if (permList.permissions[i].type === 'anyone') {
        Drive.Permissions.remove(googleFileId, permList.permissions[i].id);
        return { success: true };
      }
    }
  }

  return { success: true, message: 'No public access found' };
}

// ── Export & Content Commands ───────────────────────────────────────────────────

function processExportFile_(params) {
  var googleFileId = params.googleFileId;
  var exportMimeType = params.exportMimeType || 'application/pdf';

  // Drive.Files.export() in Advanced Service doesn't support alt=media.
  // Use UrlFetchApp with OAuth token to hit the REST endpoint directly.
  var url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(googleFileId)
    + '/export?mimeType=' + encodeURIComponent(exportMimeType);
  var token = ScriptApp.getOAuthToken();
  var response = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': 'Bearer ' + token },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    return { error: 'Export failed: ' + response.getContentText() };
  }

  var blob = response.getBlob();

  // For binary formats, return as base64
  if (exportMimeType === 'application/pdf' ||
      exportMimeType === 'image/png' ||
      exportMimeType === 'image/svg+xml' ||
      exportMimeType.indexOf('officedocument') !== -1) {
    var content = Utilities.base64Encode(blob.getBytes());
    return { content: content, mimeType: exportMimeType, encoding: 'base64' };
  }

  return { content: blob.getDataAsString(), mimeType: exportMimeType, encoding: 'utf-8' };
}

function processGetFileContent_(params) {
  var googleFileId = params.googleFileId;
  var mimeType = params.mimeType || '';
  var token = ScriptApp.getOAuthToken();

  // For Google Workspace files, export as plain text via REST endpoint
  if (mimeType.indexOf('google-apps') !== -1) {
    var exportMime = 'text/plain';
    if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      exportMime = 'text/csv';
    }
    var url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(googleFileId)
      + '/export?mimeType=' + encodeURIComponent(exportMime);
    var response = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) {
      return { error: 'Export failed: ' + response.getContentText() };
    }
    return { content: response.getContentText(), mimeType: exportMime, encoding: 'utf-8' };
  }

  // For regular files, download via alt=media REST endpoint
  var url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(googleFileId) + '?alt=media';
  var response = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': 'Bearer ' + token },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    return { error: 'Download failed: ' + response.getContentText() };
  }

  var blob = response.getBlob();
  try {
    var content = blob.getDataAsString();
    return { content: content, mimeType: mimeType, encoding: 'utf-8' };
  } catch(e) {
    var content = Utilities.base64Encode(blob.getBytes());
    return { content: content, mimeType: mimeType, encoding: 'base64' };
  }
}

// ── Revision Commands ──────────────────────────────────────────────────────────

function processListRevisions_(params) {
  var googleFileId = params.googleFileId;
  var response = Drive.Revisions.list(googleFileId, {
    fields: 'revisions(id,modifiedTime,lastModifyingUser,size)'
  });

  var revisions = [];
  if (response.revisions) {
    revisions = response.revisions.map(function(r) {
      return {
        id: r.id || '',
        modifiedTime: r.modifiedTime || '',
        lastModifyingUser: r.lastModifyingUser ? (r.lastModifyingUser.displayName || r.lastModifyingUser.emailAddress || '') : '',
        size: r.size || ''
      };
    });
  }

  return { revisions: revisions };
}

function processGetRevision_(params) {
  var googleFileId = params.googleFileId;
  var revisionId = params.revisionId;

  var revision = Drive.Revisions.get(googleFileId, revisionId, {
    fields: 'id,modifiedTime,lastModifyingUser,size,exportLinks'
  });

  return {
    id: revision.id || '',
    modifiedTime: revision.modifiedTime || '',
    lastModifyingUser: revision.lastModifyingUser ? (revision.lastModifyingUser.displayName || revision.lastModifyingUser.emailAddress || '') : '',
    size: revision.size || '',
    exportLinks: revision.exportLinks || {}
  };
}

// ── Comment & Reply Commands ───────────────────────────────────────────────────

function processListComments_(params) {
  var googleFileId = params.googleFileId;
  var response = Drive.Comments.list(googleFileId, {
    fields: 'comments(id,content,author,createdTime,resolved,replies(id,content,author,createdTime))'
  });

  var comments = [];
  if (response.comments) {
    comments = response.comments.map(function(c) {
      var comment = {
        id: c.id || '',
        content: c.content || '',
        author: c.author ? (c.author.displayName || c.author.emailAddress || '') : '',
        createdTime: c.createdTime || '',
        resolved: c.resolved || false
      };
      if (c.replies && c.replies.length > 0) {
        comment.replies = c.replies.map(function(r) {
          return {
            id: r.id || '',
            content: r.content || '',
            author: r.author ? (r.author.displayName || r.author.emailAddress || '') : '',
            createdTime: r.createdTime || ''
          };
        });
      }
      return comment;
    });
  }

  return { comments: comments };
}

function processAddComment_(params) {
  var googleFileId = params.googleFileId;
  var comment = Drive.Comments.create({ content: params.content }, googleFileId, {
    fields: 'id,content,author,createdTime'
  });

  return {
    id: comment.id || '',
    content: comment.content || '',
    author: comment.author ? (comment.author.displayName || comment.author.emailAddress || '') : '',
    createdTime: comment.createdTime || ''
  };
}

function processDeleteComment_(params) {
  Drive.Comments.remove(params.googleFileId, params.commentId);
  return { success: true };
}

function processListReplies_(params) {
  var googleFileId = params.googleFileId;
  var commentId = params.commentId;
  var response = Drive.Replies.list(googleFileId, commentId, {
    fields: 'replies(id,content,author,createdTime)'
  });

  var replies = [];
  if (response.replies) {
    replies = response.replies.map(function(r) {
      return {
        id: r.id || '',
        content: r.content || '',
        author: r.author ? (r.author.displayName || r.author.emailAddress || '') : '',
        createdTime: r.createdTime || ''
      };
    });
  }

  return { replies: replies };
}

function processAddReply_(params) {
  var reply = Drive.Replies.create({ content: params.content }, params.googleFileId, params.commentId, {
    fields: 'id,content,author,createdTime'
  });

  return {
    id: reply.id || '',
    content: reply.content || '',
    author: reply.author ? (reply.author.displayName || reply.author.emailAddress || '') : '',
    createdTime: reply.createdTime || ''
  };
}

// ── Shared Drives, Storage & Cleanup Commands ──────────────────────────────────

function processListSharedDrives_() {
  var response = Drive.Drives.list({
    fields: 'drives(id,name,createdTime)',
    pageSize: 100
  });

  var drives = [];
  if (response.drives) {
    drives = response.drives.map(function(d) {
      return {
        id: d.id || '',
        name: d.name || '',
        createdTime: d.createdTime || ''
      };
    });
  }

  return { drives: drives };
}

function processGetStorageInfo_() {
  var about = Drive.About.get({ fields: 'storageQuota,user' });
  var quota = about.storageQuota || {};
  return {
    limit: quota.limit || '',
    usage: quota.usage || '',
    usageInDrive: quota.usageInDrive || '',
    usageInTrash: quota.usageInTrash || '',
    user: about.user ? (about.user.emailAddress || '') : ''
  };
}

function processEmptyTrash_() {
  Drive.Files.emptyTrash();

  // Mark all trashed rows in sheet as deleted
  var fileSheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.FILES);
  var fileData = fileSheet.getDataRange().getValues();
  var ts = new Date().toISOString();

  for (var i = 1; i < fileData.length; i++) {
    if (String(fileData[i][FIL.TRASHED]) === 'true' || fileData[i][FIL.TRASHED] === true) {
      var rowNum = i + 1;
      fileSheet.getRange(rowNum, FIL.SYNC_STATUS + 1).setValue('deleted');
      fileSheet.getRange(rowNum, FIL.UPDATED_AT + 1).setValue(ts);
      fileSheet.getRange(rowNum, FIL.UPDATED_BY + 1).setValue('google');
    }
  }

  return { success: true, message: 'Trash emptied' };
}

// ── Initial Import ─────────────────────────────────────────────────────────────

function initialImport() {
  Logger.log('Starting initial import of Google Drive files...');

  var fileSheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.FILES);

  // Get change start page token for future incremental syncs
  var tokenResponse = Drive.Changes.getStartPageToken();
  setMeta_('lastChangeStartPageToken', tokenResponse.startPageToken);

  // Import root-level files
  var count = 0;
  var pageToken = null;
  do {
    var options = {
      q: "'root' in parents and trashed = false",
      fields: 'nextPageToken,files(id,name,mimeType,size,description,starred,trashed,webViewLink,webContentLink,owners,modifiedTime,createdTime,parents)',
      pageSize: 100,
      orderBy: 'modifiedTime desc'
    };
    if (pageToken) options.pageToken = pageToken;

    var response = Drive.Files.list(options);
    if (response.files) {
      response.files.forEach(function(gf) {
        appendFileRow_(fileSheet, gf);
        count++;
      });
    }
    pageToken = response.nextPageToken;
  } while (pageToken && count < 200); // Cap at 200 root files

  // Import starred files (may overlap with root)
  pageToken = null;
  do {
    var options2 = {
      q: "starred = true and trashed = false",
      fields: 'nextPageToken,files(id,name,mimeType,size,description,starred,trashed,webViewLink,webContentLink,owners,modifiedTime,createdTime,parents)',
      pageSize: 100
    };
    if (pageToken) options2.pageToken = pageToken;

    var response2 = Drive.Files.list(options2);
    if (response2.files) {
      response2.files.forEach(function(gf) {
        // Skip if already imported (check by Google ID)
        if (!isGoogleIdTracked_(fileSheet, gf.id)) {
          appendFileRow_(fileSheet, gf);
          count++;
        }
      });
    }
    pageToken = response2.nextPageToken;
  } while (pageToken);

  setMeta_('lastFullSync', new Date().toISOString());
  Logger.log('Initial import complete. Imported ' + count + ' files.');
  Logger.log('Additional files will be added when discovered via search.');
}

// ── Cleanup ────────────────────────────────────────────────────────────────────

function cleanupDeletedRows_() {
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - SYNC_CONFIG.CLEANUP_DAYS);

  // Clean Files sheet
  var fileSheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.FILES);
  var fileData = fileSheet.getDataRange().getValues();
  var rowsToDelete = [];
  for (var i = 1; i < fileData.length; i++) {
    if (fileData[i][FIL.SYNC_STATUS] === 'deleted') {
      var updatedAt = fileData[i][FIL.UPDATED_AT];
      if (updatedAt && new Date(updatedAt) < cutoff) {
        rowsToDelete.push(i + 1);
      }
    }
  }
  for (var j = rowsToDelete.length - 1; j >= 0; j--) {
    fileSheet.deleteRow(rowsToDelete[j]);
  }

  // Clean completed/failed commands older than cleanup period
  var cmdSheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.COMMAND_QUEUE);
  var cmdData = cmdSheet.getDataRange().getValues();
  rowsToDelete = [];
  for (var i = 1; i < cmdData.length; i++) {
    var cmdStatus = cmdData[i][3]; // status
    if (cmdStatus === 'completed' || cmdStatus === 'failed') {
      var processedAt = cmdData[i][5]; // processedAt
      if (processedAt && new Date(processedAt) < cutoff) {
        rowsToDelete.push(i + 1);
      }
    }
  }
  for (var j = rowsToDelete.length - 1; j >= 0; j--) {
    cmdSheet.deleteRow(rowsToDelete[j]);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getSheet_(name) {
  return SpreadsheetApp.openById(SYNC_CONFIG.SPREADSHEET_ID).getSheetByName(name);
}

function getMeta_(key) {
  var sheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.SYNC_META);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) return data[i][1] || '';
  }
  return '';
}

function setMeta_(key, value) {
  var sheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.SYNC_META);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

function findRowIndex_(sheet, colIndex, value) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][colIndex]) === String(value)) return i + 1;
  }
  return -1;
}

function findRowByGoogleId_(sheet, googleFileId) {
  return findRowIndex_(sheet, FIL.GOOGLE_FILE_ID, googleFileId);
}

function buildParentIdMap_(data) {
  var map = {};
  for (var i = 1; i < data.length; i++) {
    if (data[i][FIL.SHEET_FILE_ID] && data[i][FIL.GOOGLE_FILE_ID]) {
      map[data[i][FIL.SHEET_FILE_ID]] = data[i][FIL.GOOGLE_FILE_ID];
    }
  }
  return map;
}

function resolveGoogleFileId_(idOrSheetId) {
  if (!idOrSheetId) return '';
  var fileSheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.FILES);
  var data = fileSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][FIL.SHEET_FILE_ID] === idOrSheetId) {
      return data[i][FIL.GOOGLE_FILE_ID] || '';
    }
  }
  // Might already be a Google ID
  return idOrSheetId;
}

function isGoogleIdTracked_(fileSheet, googleFileId) {
  var data = fileSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][FIL.GOOGLE_FILE_ID] === googleFileId) return true;
  }
  return false;
}

function upsertFile_(gf) {
  var fileSheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.FILES);
  var rowNum = findRowByGoogleId_(fileSheet, gf.id);
  var ts = new Date().toISOString();

  var owners = '';
  if (gf.owners && gf.owners.length > 0) {
    owners = gf.owners.map(function(o) { return o.emailAddress || ''; }).join(', ');
  }
  var parentId = (gf.parents && gf.parents.length > 0) ? gf.parents[0] : '';

  if (rowNum > 0) {
    // Update existing row (only if synced)
    var data = fileSheet.getDataRange().getValues();
    var syncStatus = data[rowNum - 1][FIL.SYNC_STATUS];
    if (syncStatus !== 'synced') return;

    fileSheet.getRange(rowNum, FIL.NAME + 1).setValue(gf.name || '');
    fileSheet.getRange(rowNum, FIL.MIME_TYPE + 1).setValue(gf.mimeType || '');
    fileSheet.getRange(rowNum, FIL.SIZE + 1).setValue(gf.size || '');
    fileSheet.getRange(rowNum, FIL.GOOGLE_PARENT_ID + 1).setValue(parentId);
    fileSheet.getRange(rowNum, FIL.DESCRIPTION + 1).setValue(gf.description || '');
    fileSheet.getRange(rowNum, FIL.STARRED + 1).setValue(gf.starred || false);
    fileSheet.getRange(rowNum, FIL.TRASHED + 1).setValue(gf.trashed || false);
    fileSheet.getRange(rowNum, FIL.WEB_VIEW_LINK + 1).setValue(gf.webViewLink || '');
    fileSheet.getRange(rowNum, FIL.WEB_CONTENT_LINK + 1).setValue(gf.webContentLink || '');
    fileSheet.getRange(rowNum, FIL.OWNERS + 1).setValue(owners);
    fileSheet.getRange(rowNum, FIL.MODIFIED_TIME + 1).setValue(gf.modifiedTime || '');
    fileSheet.getRange(rowNum, FIL.UPDATED_AT + 1).setValue(ts);
    fileSheet.getRange(rowNum, FIL.SYNCED_AT + 1).setValue(ts);
    fileSheet.getRange(rowNum, FIL.UPDATED_BY + 1).setValue('google');
    fileSheet.getRange(rowNum, FIL.GOOGLE_MODIFIED + 1).setValue(gf.modifiedTime || '');
  } else {
    // Insert new row
    appendFileRow_(fileSheet, gf);
  }
}

function appendFileRow_(fileSheet, gf) {
  var ts = new Date().toISOString();
  var owners = '';
  if (gf.owners && gf.owners.length > 0) {
    owners = gf.owners.map(function(o) { return o.emailAddress || ''; }).join(', ');
  }
  var parentId = (gf.parents && gf.parents.length > 0) ? gf.parents[0] : '';

  fileSheet.appendRow([
    Utilities.getUuid(),           // sheetFileId
    gf.id,                         // googleFileId
    gf.name || '',                 // name
    gf.mimeType || '',             // mimeType
    gf.size || '',                 // size
    '',                            // sheetParentId (no cross-ref for imports)
    parentId,                      // googleParentId
    gf.description || '',          // description
    gf.starred || false,           // starred
    gf.trashed || false,           // trashed
    gf.webViewLink || '',          // webViewLink
    gf.webContentLink || '',       // webContentLink
    owners,                        // owners
    gf.modifiedTime || '',         // modifiedTime
    gf.createdTime || '',          // createdTime
    'synced',                      // syncStatus
    ts,                            // updatedAt
    ts,                            // syncedAt
    'google',                      // updatedBy
    gf.modifiedTime || '',         // googleModified
    ''                             // extraPropsJson
  ]);
}

function formatGoogleFile_(gf) {
  var owners = '';
  if (gf.owners && gf.owners.length > 0) {
    owners = gf.owners.map(function(o) { return o.emailAddress || ''; }).join(', ');
  }
  return {
    googleId: gf.id || '',
    name: gf.name || '',
    mimeType: gf.mimeType || '',
    size: gf.size || '',
    description: gf.description || '',
    starred: gf.starred || false,
    trashed: gf.trashed || false,
    webViewLink: gf.webViewLink || '',
    webContentLink: gf.webContentLink || '',
    owners: owners,
    modifiedTime: gf.modifiedTime || '',
    createdTime: gf.createdTime || '',
    kind: 'drive#file'
  };
}
