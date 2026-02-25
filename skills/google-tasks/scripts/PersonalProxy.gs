// PersonalProxy.gs — Personal Gmail Apps Script
// Deployed as web app on personal Gmail account.
// Reads/writes Google Spreadsheet as proxy for Google Tasks.
// Claude Code calls this via HTTP; WorkSync.gs handles the actual Google Tasks API.

// ── Configuration ──────────────────────────────────────────────────────────────

const CONFIG = {
  SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID_HERE',
  API_KEY: 'YOUR_API_KEY_HERE',
  SHEET_NAMES: {
    TASK_LISTS: 'TaskLists',
    TASKS: 'Tasks',
    COMMAND_QUEUE: 'CommandQueue',
    SYNC_META: 'SyncMeta'
  }
};

// ── Web App Entry Points ───────────────────────────────────────────────────────

function doPost(e) {
  try {
    const params = JSON.parse(e.postData.contents);
    if (params.key !== CONFIG.API_KEY) {
      return jsonResponse_({ error: 'Unauthorized' }, 401);
    }
    const action = params.action;
    const handler = ACTIONS[action];
    if (!handler) {
      return jsonResponse_({ error: 'Unknown action: ' + action }, 400);
    }
    const result = handler(params);
    return jsonResponse_(result);
  } catch (err) {
    return jsonResponse_({ error: err.message, stack: err.stack }, 500);
  }
}

function doGet(e) {
  return jsonResponse_({ status: 'ok', message: 'Google Tasks Proxy is running' });
}

// ── Action Router ──────────────────────────────────────────────────────────────

const ACTIONS = {
  listTaskLists: listTaskLists_,
  getTaskList: getTaskList_,
  createTaskList: createTaskList_,
  updateTaskList: updateTaskList_,
  deleteTaskList: deleteTaskList_,
  listTasks: listTasks_,
  getTask: getTask_,
  createTask: createTask_,
  updateTask: updateTask_,
  deleteTask: deleteTask_,
  completeTask: completeTask_,
  uncompleteTask: uncompleteTask_,
  moveTask: moveTask_,
  clearCompleted: clearCompleted_
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
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0];
  return data.slice(1).map(function(row) {
    const obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function findRowIndex_(sheet, colIndex, value) {
  const data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][colIndex] === value) return i + 1; // 1-indexed row number
  }
  return -1;
}

function getRowBySheetId_(sheet, colIndex, id) {
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return null;
  const headers = data[0];
  for (var i = 1; i < data.length; i++) {
    if (data[i][colIndex] === id) {
      const obj = {};
      headers.forEach(function(h, j) { obj[h] = data[i][j]; });
      return obj;
    }
  }
  return null;
}

// ── TaskLists Actions ──────────────────────────────────────────────────────────

function listTaskLists_() {
  const sheet = getSheet_(CONFIG.SHEET_NAMES.TASK_LISTS);
  const rows = getAllRows_(sheet);
  const items = rows
    .filter(function(r) { return r.syncStatus !== 'deleted' && r.syncStatus !== 'pending_delete'; })
    .map(function(r) {
      return {
        id: r.sheetListId,
        title: r.title,
        updated: r.updatedAt || r.syncedAt || '',
        kind: 'tasks#taskList'
      };
    });
  return { kind: 'tasks#taskLists', items: items };
}

function getTaskList_(params) {
  var id = params.taskListId;
  var sheet = getSheet_(CONFIG.SHEET_NAMES.TASK_LISTS);
  var row = getRowBySheetId_(sheet, 0, id);
  if (!row || row.syncStatus === 'deleted') {
    return { error: 'Task list not found' };
  }
  return {
    id: row.sheetListId,
    title: row.title,
    updated: row.updatedAt || row.syncedAt || '',
    kind: 'tasks#taskList'
  };
}

function createTaskList_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.TASK_LISTS);
  var id = uuid_();
  var ts = now_();
  sheet.appendRow([
    id,           // sheetListId
    '',           // googleListId (empty until synced)
    params.title, // title
    'pending_create', // syncStatus
    ts,           // updatedAt
    '',           // syncedAt
    'claude'      // updatedBy
  ]);
  return {
    id: id,
    title: params.title,
    updated: ts,
    kind: 'tasks#taskList'
  };
}

function updateTaskList_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.TASK_LISTS);
  var rowNum = findRowIndex_(sheet, 0, params.taskListId);
  if (rowNum < 0) return { error: 'Task list not found' };
  var ts = now_();
  if (params.title) sheet.getRange(rowNum, 3).setValue(params.title); // col C = title
  sheet.getRange(rowNum, 4).setValue('pending_update'); // syncStatus
  sheet.getRange(rowNum, 5).setValue(ts);               // updatedAt
  sheet.getRange(rowNum, 7).setValue('claude');          // updatedBy
  return {
    id: params.taskListId,
    title: params.title || sheet.getRange(rowNum, 3).getValue(),
    updated: ts,
    kind: 'tasks#taskList'
  };
}

function deleteTaskList_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.TASK_LISTS);
  var rowNum = findRowIndex_(sheet, 0, params.taskListId);
  if (rowNum < 0) return { error: 'Task list not found' };
  var ts = now_();
  sheet.getRange(rowNum, 4).setValue('pending_delete'); // syncStatus
  sheet.getRange(rowNum, 5).setValue(ts);               // updatedAt
  sheet.getRange(rowNum, 7).setValue('claude');          // updatedBy

  // Also mark all tasks in this list as pending_delete
  var tasksSheet = getSheet_(CONFIG.SHEET_NAMES.TASKS);
  var taskData = tasksSheet.getDataRange().getValues();
  for (var i = 1; i < taskData.length; i++) {
    if (taskData[i][2] === params.taskListId && taskData[i][12] !== 'deleted') { // col C = sheetListId, col M = syncStatus
      tasksSheet.getRange(i + 1, 13).setValue('pending_delete');
      tasksSheet.getRange(i + 1, 14).setValue(ts);
      tasksSheet.getRange(i + 1, 16).setValue('claude');
    }
  }
  return { success: true };
}

// ── Tasks Actions ──────────────────────────────────────────────────────────────

function listTasks_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.TASKS);
  var rows = getAllRows_(sheet);
  var listId = params.taskListId;
  var showCompleted = params.showCompleted !== false;
  var showDeleted = false;
  var showHidden = params.showHidden === true;

  var items = rows.filter(function(r) {
    if (r.sheetListId !== listId) return false;
    if (r.syncStatus === 'deleted' || r.syncStatus === 'pending_delete') return false;
    if (!showCompleted && r.status === 'completed') return false;
    return true;
  }).map(function(r) {
    return formatTask_(r);
  });

  return { kind: 'tasks#tasks', items: items };
}

function getTask_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.TASKS);
  var row = getRowBySheetId_(sheet, 0, params.taskId);
  if (!row || row.syncStatus === 'deleted') {
    return { error: 'Task not found' };
  }
  return formatTask_(row);
}

function createTask_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.TASKS);
  var id = uuid_();
  var ts = now_();
  sheet.appendRow([
    id,                          // A: sheetTaskId
    '',                          // B: googleTaskId
    params.taskListId,           // C: sheetListId
    '',                          // D: googleListId (filled by sync)
    params.title || '',          // E: title
    params.notes || '',          // F: notes
    params.due || '',            // G: due
    'needsAction',               // H: status
    '',                          // I: completed
    params.parent || '',         // J: parent (sheetTaskId)
    params.position || '',       // K: position
    params.links ? JSON.stringify(params.links) : '', // L: links
    'pending_create',            // M: syncStatus
    ts,                          // N: updatedAt
    '',                          // O: syncedAt
    'claude',                    // P: updatedBy
    '',                          // Q: googleUpdated
    ''                           // R: moveTarget
  ]);
  return {
    id: id,
    title: params.title || '',
    notes: params.notes || '',
    due: params.due || '',
    status: 'needsAction',
    parent: params.parent || '',
    position: params.position || '',
    kind: 'tasks#task',
    updated: ts
  };
}

function updateTask_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.TASKS);
  var rowNum = findRowIndex_(sheet, 0, params.taskId);
  if (rowNum < 0) return { error: 'Task not found' };
  var ts = now_();

  // Update only provided fields
  if (params.title !== undefined) sheet.getRange(rowNum, 5).setValue(params.title);
  if (params.notes !== undefined) sheet.getRange(rowNum, 6).setValue(params.notes);
  if (params.due !== undefined)   sheet.getRange(rowNum, 7).setValue(params.due);
  if (params.status !== undefined) sheet.getRange(rowNum, 8).setValue(params.status);
  if (params.completed !== undefined) sheet.getRange(rowNum, 9).setValue(params.completed);

  sheet.getRange(rowNum, 13).setValue('pending_update'); // syncStatus
  sheet.getRange(rowNum, 14).setValue(ts);               // updatedAt
  sheet.getRange(rowNum, 16).setValue('claude');          // updatedBy

  // Re-read the full row to return
  var data = sheet.getRange(rowNum, 1, 1, 18).getValues()[0];
  return formatTaskFromArray_(data, ts);
}

function deleteTask_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.TASKS);
  var rowNum = findRowIndex_(sheet, 0, params.taskId);
  if (rowNum < 0) return { error: 'Task not found' };
  var ts = now_();
  sheet.getRange(rowNum, 13).setValue('pending_delete'); // syncStatus
  sheet.getRange(rowNum, 14).setValue(ts);               // updatedAt
  sheet.getRange(rowNum, 16).setValue('claude');          // updatedBy
  return { success: true };
}

function completeTask_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.TASKS);
  var rowNum = findRowIndex_(sheet, 0, params.taskId);
  if (rowNum < 0) return { error: 'Task not found' };
  var ts = now_();
  sheet.getRange(rowNum, 8).setValue('completed');          // status
  sheet.getRange(rowNum, 9).setValue(ts);                   // completed timestamp
  sheet.getRange(rowNum, 13).setValue('pending_complete');   // syncStatus
  sheet.getRange(rowNum, 14).setValue(ts);                  // updatedAt
  sheet.getRange(rowNum, 16).setValue('claude');             // updatedBy

  var data = sheet.getRange(rowNum, 1, 1, 18).getValues()[0];
  return formatTaskFromArray_(data, ts);
}

function uncompleteTask_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.TASKS);
  var rowNum = findRowIndex_(sheet, 0, params.taskId);
  if (rowNum < 0) return { error: 'Task not found' };
  var ts = now_();
  sheet.getRange(rowNum, 8).setValue('needsAction');          // status
  sheet.getRange(rowNum, 9).setValue('');                     // clear completed timestamp
  sheet.getRange(rowNum, 13).setValue('pending_uncomplete');  // syncStatus
  sheet.getRange(rowNum, 14).setValue(ts);                    // updatedAt
  sheet.getRange(rowNum, 16).setValue('claude');              // updatedBy

  var data = sheet.getRange(rowNum, 1, 1, 18).getValues()[0];
  return formatTaskFromArray_(data, ts);
}

function moveTask_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.TASKS);
  var rowNum = findRowIndex_(sheet, 0, params.taskId);
  if (rowNum < 0) return { error: 'Task not found' };
  var ts = now_();

  var moveTarget = {
    parent: params.parent || '',
    previous: params.previous || '',
    destinationTaskList: params.destinationTaskList || ''
  };

  // If moving to a different list, update the sheetListId
  if (params.destinationTaskList) {
    sheet.getRange(rowNum, 3).setValue(params.destinationTaskList);
  }
  if (params.parent !== undefined) {
    sheet.getRange(rowNum, 10).setValue(params.parent || '');
  }

  sheet.getRange(rowNum, 13).setValue('pending_move');              // syncStatus
  sheet.getRange(rowNum, 14).setValue(ts);                         // updatedAt
  sheet.getRange(rowNum, 16).setValue('claude');                    // updatedBy
  sheet.getRange(rowNum, 18).setValue(JSON.stringify(moveTarget));  // moveTarget

  var data = sheet.getRange(rowNum, 1, 1, 18).getValues()[0];
  return formatTaskFromArray_(data, ts);
}

function clearCompleted_(params) {
  var listId = params.taskListId;
  var ts = now_();

  // Mark completed tasks as deleted in spreadsheet for immediate read consistency
  var sheet = getSheet_(CONFIG.SHEET_NAMES.TASKS);
  var data = sheet.getDataRange().getValues();
  var count = 0;
  for (var i = 1; i < data.length; i++) {
    if (data[i][2] === listId && data[i][7] === 'completed' && data[i][12] !== 'deleted') {
      sheet.getRange(i + 1, 13).setValue('deleted');  // syncStatus
      sheet.getRange(i + 1, 14).setValue(ts);         // updatedAt
      sheet.getRange(i + 1, 16).setValue('claude');    // updatedBy
      count++;
    }
  }

  // Also enqueue a clearCompleted command for the sync engine
  var cmdSheet = getSheet_(CONFIG.SHEET_NAMES.COMMAND_QUEUE);
  cmdSheet.appendRow([
    uuid_(),        // commandId
    'clearCompleted', // action
    listId,         // sheetListId
    '',             // params
    'pending',      // status
    ts,             // createdAt
    '',             // processedAt
    ''              // result
  ]);

  return { success: true, cleared: count };
}

// ── Formatting ─────────────────────────────────────────────────────────────────

function formatTask_(row) {
  var task = {
    id: row.sheetTaskId,
    title: row.title || '',
    notes: row.notes || '',
    status: row.status || 'needsAction',
    due: row.due || '',
    completed: row.completed || '',
    parent: row.parent || '',
    position: row.position || '',
    updated: row.updatedAt || row.syncedAt || '',
    kind: 'tasks#task'
  };
  if (row.links) {
    try { task.links = JSON.parse(row.links); } catch(e) { task.links = []; }
  }
  return task;
}

function formatTaskFromArray_(arr, ts) {
  return {
    id: arr[0],           // sheetTaskId
    title: arr[4] || '',  // title
    notes: arr[5] || '',  // notes
    due: arr[6] || '',    // due
    status: arr[7] || 'needsAction', // status
    completed: arr[8] || '', // completed
    parent: arr[9] || '', // parent
    position: arr[10] || '', // position
    updated: ts || arr[13] || '', // updatedAt
    kind: 'tasks#task'
  };
}
