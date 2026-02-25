// WorkSync.gs — Work Email Apps Script (Sync Engine)
// Runs autonomously on the work email account via 1-minute time-based trigger.
// Syncs Google Spreadsheet ↔ Google Tasks API bidirectionally.
// Requires: Google Tasks API service enabled in Apps Script editor.

// ── Configuration ──────────────────────────────────────────────────────────────

const SYNC_CONFIG = {
  SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID_HERE',
  BATCH_LIMIT: 50,
  LOCK_TIMEOUT_MS: 5 * 60 * 1000,       // 5 minutes
  EXECUTION_TIMEOUT_MS: 4 * 60 * 1000,   // 4 minutes (Apps Script limit is 6)
  CLEANUP_DAYS: 7,
  SHEET_NAMES: {
    TASK_LISTS: 'TaskLists',
    TASKS: 'Tasks',
    COMMAND_QUEUE: 'CommandQueue',
    SYNC_META: 'SyncMeta'
  }
};

// ── Trigger Setup ──────────────────────────────────────────────────────────────

function setupTrigger() {
  // Remove existing triggers
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'syncCycle') {
      ScriptApp.deleteTrigger(t);
    }
  });
  // Create 1-minute trigger
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

  // Acquire lock
  if (!acquireLock_()) {
    Logger.log('Sync skipped: another sync is running');
    return;
  }

  try {
    // Phase 1: Push pending changes to Google Tasks
    pushToGoogle_(startTime);

    // Phase 2: Pull changes from Google Tasks
    if (!isTimedOut_(startTime)) {
      pullFromGoogle_(startTime);
    }

    // Phase 3: Process command queue
    if (!isTimedOut_(startTime)) {
      processCommands_(startTime);
    }

    // Phase 4: Weekly cleanup
    if (!isTimedOut_(startTime)) {
      cleanupDeletedRows_();
    }

    // Update last sync time
    setMeta_('lastFullSync', new Date().toISOString());
  } catch (err) {
    Logger.log('Sync error: ' + err.message + '\n' + err.stack);
  } finally {
    releaseLock_();
  }
}

// ── Lock Mechanism ─────────────────────────────────────────────────────────────

function acquireLock_() {
  var sheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.SYNC_META);
  var lockOwner = getMeta_('syncLockOwner');
  var lockTime = getMeta_('syncLockTime');

  if (lockOwner) {
    // Check if lock has expired
    var lockDate = new Date(lockTime);
    if (Date.now() - lockDate.getTime() < SYNC_CONFIG.LOCK_TIMEOUT_MS) {
      return false; // Lock is still valid
    }
    Logger.log('Stale lock detected from ' + lockOwner + ', overriding');
  }

  var myId = Utilities.getUuid();
  setMeta_('syncLockOwner', myId);
  setMeta_('syncLockTime', new Date().toISOString());

  // Re-read to verify we got the lock (basic race condition check)
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

// ── Phase 1: Push to Google Tasks ──────────────────────────────────────────────

function pushToGoogle_(startTime) {
  pushTaskLists_(startTime);
  if (!isTimedOut_(startTime)) {
    pushTasks_(startTime);
  }
}

function pushTaskLists_(startTime) {
  var sheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.TASK_LISTS);
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;

  var count = 0;
  for (var i = 1; i < data.length && count < SYNC_CONFIG.BATCH_LIMIT; i++) {
    if (isTimedOut_(startTime)) break;
    var syncStatus = data[i][3]; // col D
    if (!syncStatus || syncStatus === 'synced' || syncStatus === 'deleted') continue;

    var rowNum = i + 1;
    try {
      if (syncStatus === 'pending_create') {
        var newList = Tasks.Tasklists.insert({ title: data[i][2] });
        sheet.getRange(rowNum, 2).setValue(newList.id);          // googleListId
        sheet.getRange(rowNum, 4).setValue('synced');             // syncStatus
        sheet.getRange(rowNum, 6).setValue(new Date().toISOString()); // syncedAt
        count++;
      } else if (syncStatus === 'pending_update') {
        var googleId = data[i][1];
        if (googleId) {
          Tasks.Tasklists.patch({ title: data[i][2] }, googleId);
          sheet.getRange(rowNum, 4).setValue('synced');
          sheet.getRange(rowNum, 6).setValue(new Date().toISOString());
        }
        count++;
      } else if (syncStatus === 'pending_delete') {
        var googleId = data[i][1];
        if (googleId) {
          try { Tasks.Tasklists.remove(googleId); } catch(e) { /* may already be deleted */ }
        }
        sheet.getRange(rowNum, 4).setValue('deleted');
        sheet.getRange(rowNum, 6).setValue(new Date().toISOString());
        count++;
      }
    } catch (err) {
      Logger.log('Error pushing task list row ' + rowNum + ': ' + err.message);
    }
  }
}

function pushTasks_(startTime) {
  var sheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.TASKS);
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;

  // Build sheetListId → googleListId map
  var listMap = buildListIdMap_();

  var count = 0;
  for (var i = 1; i < data.length && count < SYNC_CONFIG.BATCH_LIMIT; i++) {
    if (isTimedOut_(startTime)) break;
    var syncStatus = data[i][12]; // col M
    if (!syncStatus || syncStatus === 'synced' || syncStatus === 'deleted') continue;

    var rowNum = i + 1;
    var sheetListId = data[i][2];
    var googleListId = data[i][3] || listMap[sheetListId];

    // Update denormalized googleListId if missing
    if (!data[i][3] && googleListId) {
      sheet.getRange(rowNum, 4).setValue(googleListId);
    }

    if (!googleListId) {
      // List hasn't been synced yet, skip this task
      continue;
    }

    try {
      if (syncStatus === 'pending_create') {
        var taskBody = {
          title: data[i][4] || '',
          notes: data[i][5] || '',
          status: data[i][7] || 'needsAction'
        };
        if (data[i][6]) taskBody.due = data[i][6]; // due date

        // Handle parent task (need to map sheetTaskId → googleTaskId)
        var parentSheetId = data[i][9];
        var parentGoogleId = '';
        if (parentSheetId) {
          parentGoogleId = findGoogleTaskId_(sheet, data, parentSheetId);
        }

        var newTask = Tasks.Tasks.insert(taskBody, googleListId, {
          parent: parentGoogleId || undefined
        });
        sheet.getRange(rowNum, 2).setValue(newTask.id);                // googleTaskId
        sheet.getRange(rowNum, 13).setValue('synced');                  // syncStatus
        sheet.getRange(rowNum, 15).setValue(new Date().toISOString());  // syncedAt
        sheet.getRange(rowNum, 17).setValue(newTask.updated || '');     // googleUpdated
        count++;

      } else if (syncStatus === 'pending_update') {
        var googleTaskId = data[i][1];
        if (googleTaskId) {
          var patchBody = {};
          if (data[i][4]) patchBody.title = data[i][4];
          if (data[i][5] !== undefined) patchBody.notes = data[i][5];
          if (data[i][6]) patchBody.due = data[i][6];
          var updated = Tasks.Tasks.patch(patchBody, googleListId, googleTaskId);
          sheet.getRange(rowNum, 13).setValue('synced');
          sheet.getRange(rowNum, 15).setValue(new Date().toISOString());
          sheet.getRange(rowNum, 17).setValue(updated.updated || '');
        }
        count++;

      } else if (syncStatus === 'pending_complete') {
        var googleTaskId = data[i][1];
        if (googleTaskId) {
          Tasks.Tasks.patch({ status: 'completed' }, googleListId, googleTaskId);
          sheet.getRange(rowNum, 13).setValue('synced');
          sheet.getRange(rowNum, 15).setValue(new Date().toISOString());
        }
        count++;

      } else if (syncStatus === 'pending_uncomplete') {
        var googleTaskId = data[i][1];
        if (googleTaskId) {
          Tasks.Tasks.patch({ status: 'needsAction', completed: null }, googleListId, googleTaskId);
          sheet.getRange(rowNum, 13).setValue('synced');
          sheet.getRange(rowNum, 15).setValue(new Date().toISOString());
        }
        count++;

      } else if (syncStatus === 'pending_move') {
        var googleTaskId = data[i][1];
        var moveTargetStr = data[i][17]; // col R
        if (googleTaskId && moveTargetStr) {
          var moveTarget = JSON.parse(moveTargetStr);
          var destListId = googleListId;
          if (moveTarget.destinationTaskList) {
            destListId = listMap[moveTarget.destinationTaskList] || googleListId;
          }
          var parentGId = '';
          if (moveTarget.parent) {
            parentGId = findGoogleTaskId_(sheet, data, moveTarget.parent);
          }
          Tasks.Tasks.move(googleListId, googleTaskId, {
            parent: parentGId || undefined,
            previous: moveTarget.previous || undefined,
            destinationTasklist: destListId !== googleListId ? destListId : undefined
          });
          sheet.getRange(rowNum, 13).setValue('synced');
          sheet.getRange(rowNum, 15).setValue(new Date().toISOString());
          sheet.getRange(rowNum, 18).setValue(''); // clear moveTarget
        }
        count++;

      } else if (syncStatus === 'pending_delete') {
        var googleTaskId = data[i][1];
        if (googleTaskId) {
          try { Tasks.Tasks.remove(googleListId, googleTaskId); } catch(e) { /* may already be deleted */ }
        }
        sheet.getRange(rowNum, 13).setValue('deleted');
        sheet.getRange(rowNum, 15).setValue(new Date().toISOString());
        count++;
      }
    } catch (err) {
      Logger.log('Error pushing task row ' + rowNum + ': ' + err.message);
    }
  }
}

// ── Phase 2: Pull from Google Tasks ────────────────────────────────────────────

function pullFromGoogle_(startTime) {
  pullTaskLists_(startTime);
  if (!isTimedOut_(startTime)) {
    pullTasks_(startTime);
  }
}

function pullTaskLists_(startTime) {
  var sheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.TASK_LISTS);
  var data = sheet.getDataRange().getValues();
  var existing = {};
  for (var i = 1; i < data.length; i++) {
    if (data[i][1]) existing[data[i][1]] = i + 1; // googleListId → row number
  }

  try {
    var googleLists = Tasks.Tasklists.list({ maxResults: 100 });
    if (!googleLists.items) return;

    googleLists.items.forEach(function(gl) {
      if (isTimedOut_(startTime)) return;
      var rowNum = existing[gl.id];
      if (rowNum) {
        // Existing list — update if Google has newer data and row is synced
        var syncStatus = data[rowNum - 1][3];
        if (syncStatus === 'synced') {
          sheet.getRange(rowNum, 3).setValue(gl.title);                  // title
          sheet.getRange(rowNum, 5).setValue(gl.updated || '');          // updatedAt
          sheet.getRange(rowNum, 6).setValue(new Date().toISOString());  // syncedAt
          sheet.getRange(rowNum, 7).setValue('google');                   // updatedBy
        }
      } else {
        // New list from Google — add to spreadsheet
        sheet.appendRow([
          Utilities.getUuid(),           // sheetListId
          gl.id,                         // googleListId
          gl.title,                      // title
          'synced',                      // syncStatus
          gl.updated || '',              // updatedAt
          new Date().toISOString(),      // syncedAt
          'google'                       // updatedBy
        ]);
      }
    });
  } catch (err) {
    Logger.log('Error pulling task lists: ' + err.message);
  }
}

function pullTasks_(startTime) {
  var listSheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.TASK_LISTS);
  var listData = listSheet.getDataRange().getValues();

  var taskSheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.TASKS);
  var taskData = taskSheet.getDataRange().getValues();

  // Build googleTaskId → row number map
  var taskMap = {};
  for (var i = 1; i < taskData.length; i++) {
    if (taskData[i][1]) taskMap[taskData[i][1]] = i + 1;
  }

  // Build googleTaskId → sheetTaskId map for parent resolution
  var googleToSheetId = {};
  for (var i = 1; i < taskData.length; i++) {
    if (taskData[i][1]) googleToSheetId[taskData[i][1]] = taskData[i][0];
  }

  for (var li = 1; li < listData.length; li++) {
    if (isTimedOut_(startTime)) break;
    var googleListId = listData[li][1];
    var sheetListId = listData[li][0];
    var listSyncStatus = listData[li][3];
    if (!googleListId || listSyncStatus === 'deleted' || listSyncStatus === 'pending_delete') continue;

    try {
      var googleTasks = Tasks.Tasks.list(googleListId, {
        maxResults: 100,
        showCompleted: true,
        showHidden: true
      });
      if (!googleTasks.items) continue;

      googleTasks.items.forEach(function(gt) {
        if (isTimedOut_(startTime)) return;
        var rowNum = taskMap[gt.id];

        if (rowNum) {
          // Existing task — update only if synced (no pending local changes)
          var syncStatus = taskData[rowNum - 1][12]; // col M
          if (syncStatus !== 'synced') return; // Don't overwrite pending local changes

          var storedGoogleUpdated = taskData[rowNum - 1][16]; // col Q
          if (storedGoogleUpdated && gt.updated && gt.updated === storedGoogleUpdated) {
            return; // No change from Google
          }

          // Google has newer data — update spreadsheet
          var ts = new Date().toISOString();
          var parentSheetId = gt.parent ? (googleToSheetId[gt.parent] || '') : '';
          taskSheet.getRange(rowNum, 5).setValue(gt.title || '');
          taskSheet.getRange(rowNum, 6).setValue(gt.notes || '');
          taskSheet.getRange(rowNum, 7).setValue(gt.due || '');
          taskSheet.getRange(rowNum, 8).setValue(gt.status || 'needsAction');
          taskSheet.getRange(rowNum, 9).setValue(gt.completed || '');
          taskSheet.getRange(rowNum, 10).setValue(parentSheetId);
          taskSheet.getRange(rowNum, 11).setValue(gt.position || '');
          taskSheet.getRange(rowNum, 12).setValue(gt.links ? JSON.stringify(gt.links) : '');
          taskSheet.getRange(rowNum, 14).setValue(ts);         // updatedAt
          taskSheet.getRange(rowNum, 15).setValue(ts);         // syncedAt
          taskSheet.getRange(rowNum, 16).setValue('google');    // updatedBy
          taskSheet.getRange(rowNum, 17).setValue(gt.updated || ''); // googleUpdated
        } else {
          // New task from Google — insert into spreadsheet
          var parentSheetId = gt.parent ? (googleToSheetId[gt.parent] || '') : '';
          var newSheetId = Utilities.getUuid();
          var ts = new Date().toISOString();
          taskSheet.appendRow([
            newSheetId,                     // A: sheetTaskId
            gt.id,                          // B: googleTaskId
            sheetListId,                    // C: sheetListId
            googleListId,                   // D: googleListId
            gt.title || '',                 // E: title
            gt.notes || '',                 // F: notes
            gt.due || '',                   // G: due
            gt.status || 'needsAction',     // H: status
            gt.completed || '',             // I: completed
            parentSheetId,                  // J: parent
            gt.position || '',              // K: position
            gt.links ? JSON.stringify(gt.links) : '', // L: links
            'synced',                       // M: syncStatus
            ts,                             // N: updatedAt
            ts,                             // O: syncedAt
            'google',                       // P: updatedBy
            gt.updated || '',               // Q: googleUpdated
            ''                              // R: moveTarget
          ]);
          // Update map for subsequent parent resolution
          googleToSheetId[gt.id] = newSheetId;
          taskMap[gt.id] = taskSheet.getLastRow();
        }
      });
    } catch (err) {
      Logger.log('Error pulling tasks for list ' + googleListId + ': ' + err.message);
    }
  }
}

// ── Phase 3: Process Command Queue ─────────────────────────────────────────────

function processCommands_(startTime) {
  var sheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.COMMAND_QUEUE);
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;

  var listMap = buildListIdMap_();

  for (var i = 1; i < data.length; i++) {
    if (isTimedOut_(startTime)) break;
    var status = data[i][4]; // col E
    if (status !== 'pending') continue;

    var rowNum = i + 1;
    sheet.getRange(rowNum, 5).setValue('processing');

    try {
      var action = data[i][1]; // col B
      var sheetListId = data[i][2]; // col C
      var googleListId = listMap[sheetListId];

      if (action === 'clearCompleted' && googleListId) {
        Tasks.Tasks.clear(googleListId);
        sheet.getRange(rowNum, 5).setValue('completed');
      } else {
        sheet.getRange(rowNum, 5).setValue('failed');
        sheet.getRange(rowNum, 8).setValue('Unknown action or missing list mapping');
      }
      sheet.getRange(rowNum, 7).setValue(new Date().toISOString()); // processedAt
    } catch (err) {
      sheet.getRange(rowNum, 5).setValue('failed');
      sheet.getRange(rowNum, 7).setValue(new Date().toISOString());
      sheet.getRange(rowNum, 8).setValue(err.message);
      Logger.log('Error processing command row ' + rowNum + ': ' + err.message);
    }
  }
}

// ── Initial Import ─────────────────────────────────────────────────────────────

function initialImport() {
  Logger.log('Starting initial import of Google Tasks...');

  var listSheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.TASK_LISTS);
  var taskSheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.TASKS);

  var googleLists = Tasks.Tasklists.list({ maxResults: 100 });
  if (!googleLists.items) {
    Logger.log('No task lists found');
    return;
  }

  var googleToSheetId = {};

  googleLists.items.forEach(function(gl) {
    var sheetListId = Utilities.getUuid();
    var ts = new Date().toISOString();
    listSheet.appendRow([
      sheetListId, gl.id, gl.title, 'synced', ts, ts, 'google'
    ]);

    // Import tasks for this list
    try {
      var googleTasks = Tasks.Tasks.list(gl.id, {
        maxResults: 100,
        showCompleted: true,
        showHidden: true
      });
      if (!googleTasks.items) return;

      googleTasks.items.forEach(function(gt) {
        var sheetTaskId = Utilities.getUuid();
        googleToSheetId[gt.id] = sheetTaskId;
        var parentSheetId = gt.parent ? (googleToSheetId[gt.parent] || '') : '';

        taskSheet.appendRow([
          sheetTaskId, gt.id, sheetListId, gl.id,
          gt.title || '', gt.notes || '', gt.due || '',
          gt.status || 'needsAction', gt.completed || '',
          parentSheetId, gt.position || '',
          gt.links ? JSON.stringify(gt.links) : '',
          'synced', ts, ts, 'google', gt.updated || '', ''
        ]);
      });
    } catch (err) {
      Logger.log('Error importing tasks for ' + gl.title + ': ' + err.message);
    }
  });

  setMeta_('lastFullSync', new Date().toISOString());
  Logger.log('Initial import complete');
}

// ── Cleanup ────────────────────────────────────────────────────────────────────

function cleanupDeletedRows_() {
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - SYNC_CONFIG.CLEANUP_DAYS);

  // Clean Tasks sheet
  var taskSheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.TASKS);
  var taskData = taskSheet.getDataRange().getValues();
  var rowsToDelete = [];
  for (var i = 1; i < taskData.length; i++) {
    if (taskData[i][12] === 'deleted') { // syncStatus
      var updatedAt = taskData[i][13]; // updatedAt
      if (updatedAt && new Date(updatedAt) < cutoff) {
        rowsToDelete.push(i + 1);
      }
    }
  }
  // Delete from bottom to top to preserve row indices
  for (var j = rowsToDelete.length - 1; j >= 0; j--) {
    taskSheet.deleteRow(rowsToDelete[j]);
  }

  // Clean TaskLists sheet
  var listSheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.TASK_LISTS);
  var listData = listSheet.getDataRange().getValues();
  rowsToDelete = [];
  for (var i = 1; i < listData.length; i++) {
    if (listData[i][3] === 'deleted') {
      var updatedAt = listData[i][4];
      if (updatedAt && new Date(updatedAt) < cutoff) {
        rowsToDelete.push(i + 1);
      }
    }
  }
  for (var j = rowsToDelete.length - 1; j >= 0; j--) {
    listSheet.deleteRow(rowsToDelete[j]);
  }

  // Clean completed commands older than cleanup period
  var cmdSheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.COMMAND_QUEUE);
  var cmdData = cmdSheet.getDataRange().getValues();
  rowsToDelete = [];
  for (var i = 1; i < cmdData.length; i++) {
    var cmdStatus = cmdData[i][4];
    if (cmdStatus === 'completed' || cmdStatus === 'failed') {
      var processedAt = cmdData[i][6];
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

function buildListIdMap_() {
  var sheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.TASK_LISTS);
  var data = sheet.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][1]) {
      map[data[i][0]] = data[i][1]; // sheetListId → googleListId
    }
  }
  return map;
}

function findGoogleTaskId_(sheet, data, sheetTaskId) {
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === sheetTaskId) return data[i][1] || '';
  }
  return '';
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
  // Key not found, append
  sheet.appendRow([key, value]);
}
