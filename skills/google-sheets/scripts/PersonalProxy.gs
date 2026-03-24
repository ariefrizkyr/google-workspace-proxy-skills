// PersonalProxy.gs — Personal Gmail Apps Script
// Deployed as web app on personal Gmail account.
// Routes ALL target spreadsheet operations (reads AND writes) through CommandQueue
// because the personal email may not have access to work email spreadsheets.
// Only proxy-spreadsheet operations (listTrackedSpreadsheets, getCommandResult) are sync.
// Claude Code calls this via HTTP; WorkSync.gs handles Sheets API v4 on work email.

// ── Configuration ──────────────────────────────────────────────────────────────

var CONFIG = {
  SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID_HERE',
  API_KEY: 'YOUR_API_KEY_HERE',
  SHEET_NAMES: {
    TRACKED_SPREADSHEETS: 'TrackedSpreadsheets',
    COMMAND_QUEUE: 'CommandQueue',
    SYNC_META: 'SyncMeta'
  }
};

// Column indices for TrackedSpreadsheets sheet (0-based)
var TSS = {
  TRACKING_ID: 0,
  GOOGLE_SPREADSHEET_ID: 1,
  TITLE: 2,
  URL: 3,
  OWNER: 4,
  SHEET_COUNT: 5,
  CREATED_TIME: 6,
  MODIFIED_TIME: 7,
  TRACKED_AT: 8,
  LAST_ACCESSED: 9,
  DRIVE_FILE_ID: 10,
  EXTRA_JSON: 11
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
  return jsonResponse_({ status: 'ok', message: 'Google Sheets Proxy is running' });
}

// ── Action Router ──────────────────────────────────────────────────────────────

var ACTIONS = {
  // Sync (reads proxy spreadsheet only)
  listTrackedSpreadsheets: listTrackedSpreadsheets_,
  getCommandResult: getCommandResult_,
  // Async — reads (via CommandQueue → WorkSync on work email)
  resolveSpreadsheet: resolveSpreadsheet_,
  getSpreadsheet: getSpreadsheet_,
  listSheets: listSheets_,
  readRange: readRange_,
  readMultipleRanges: readMultipleRanges_,
  getSheetData: getSheetData_,
  // Async — writes (via CommandQueue)
  writeRange: writeRange_,
  writeMultipleRanges: writeMultipleRanges_,
  appendRows: appendRows_,
  clearRange: clearRange_,
  clearMultipleRanges: clearMultipleRanges_,
  // Async — sheet management
  addSheet: addSheet_,
  deleteSheet: deleteSheet_,
  duplicateSheet: duplicateSheet_,
  renameSheet: renameSheet_,
  updateSheetProperties: updateSheetProperties_,
  // Async — row/column operations
  insertRows: insertRows_,
  insertColumns: insertColumns_,
  deleteRows: deleteRows_,
  deleteColumns: deleteColumns_,
  moveRows: moveRows_,
  moveColumns: moveColumns_,
  resizeRows: resizeRows_,
  resizeColumns: resizeColumns_,
  autoResizeColumns: autoResizeColumns_,
  // Async — formatting
  formatCells: formatCells_,
  setBorders: setBorders_,
  mergeCells: mergeCells_,
  unmergeCells: unmergeCells_,
  // Async — data operations
  sortRange: sortRange_,
  findReplace: findReplace_,
  addConditionalFormat: addConditionalFormat_,
  deleteConditionalFormat: deleteConditionalFormat_,
  setDataValidation: setDataValidation_,
  addNamedRange: addNamedRange_,
  deleteNamedRange: deleteNamedRange_,
  // Async — protection
  protectRange: protectRange_,
  unprotectRange: unprotectRange_,
  // Async — charts
  addChart: addChart_,
  updateChart: updateChart_,
  deleteChart: deleteChart_,
  // Async — filters
  setBasicFilter: setBasicFilter_,
  clearBasicFilter: clearBasicFilter_,
  addFilterView: addFilterView_,
  deleteFilterView: deleteFilterView_,
  // Async — pivot tables
  addPivotTable: addPivotTable_,
  // Utility
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

// ── Resolve Google Spreadsheet ID from tracking ID ─────────────────────────────

function resolveGoogleSpreadsheetId_(trackingId) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.TRACKED_SPREADSHEETS);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][TSS.TRACKING_ID]) === String(trackingId)) {
      return data[i][TSS.GOOGLE_SPREADSHEET_ID] || '';
    }
  }
  return '';
}

// ── Enqueue Command ────────────────────────────────────────────────────────────

function enqueueCommand_(action, params) {
  var cmdSheet = getSheet_(CONFIG.SHEET_NAMES.COMMAND_QUEUE);
  var id = uuid_();
  var ts = now_();
  cmdSheet.appendRow([
    id, action, JSON.stringify(params), 'pending', ts, '', ''
  ]);
  return executeAsyncAndWait_(id);
}

function executeAsyncAndWait_(commandId) {
  for (var i = 0; i < 20; i++) {
    Utilities.sleep(3000);
    var result = getCommandResult_({requestId: commandId});
    if (result.status === 'completed' || result.status === 'failed') {
      return result;
    }
  }
  return { requestId: commandId, status: 'processing', message: 'Still processing. Poll with getCommandResult if needed.' };
}

// ── Formatting ─────────────────────────────────────────────────────────────────

function formatSpreadsheet_(row) {
  return {
    spreadsheetId: row.trackingId || '',
    title: row.title || '',
    url: row.url || '',
    owner: row.owner || '',
    sheetCount: row.sheetCount || 0,
    createdTime: row.createdTime || '',
    modifiedTime: row.modifiedTime || '',
    trackedAt: row.trackedAt || '',
    lastAccessed: row.lastAccessed || '',
    kind: 'sheets#spreadsheet'
  };
}

// ── Sync Actions (proxy spreadsheet only) ──────────────────────────────────────

function listTrackedSpreadsheets_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.TRACKED_SPREADSHEETS);
  var rows = getAllRows_(sheet);

  var items = rows.map(formatSpreadsheet_).sort(function(a, b) {
    return new Date(b.lastAccessed || b.trackedAt || 0) - new Date(a.lastAccessed || a.trackedAt || 0);
  });

  return { kind: 'sheets#spreadsheetList', items: items };
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

// ── Async Read Actions (via CommandQueue → WorkSync on work email) ─────────────

function resolveSpreadsheet_(params) {
  // Extract Google spreadsheet ID from whatever identifier was provided
  var googleSpreadsheetId = '';
  var resolvedFrom = '';

  // Resolve from URL
  if (params.url) {
    var match = String(params.url).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (match) {
      googleSpreadsheetId = match[1];
      resolvedFrom = 'url';
    }
  }

  // Resolve from spreadsheetId (could be a tracking UUID or a Google ID)
  if (!googleSpreadsheetId && params.spreadsheetId) {
    var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
    if (gsid) {
      // Already tracked — return immediately from proxy sheet
      var sheet = getSheet_(CONFIG.SHEET_NAMES.TRACKED_SPREADSHEETS);
      var row = getRowBySheetId_(sheet, TSS.TRACKING_ID, params.spreadsheetId);
      if (row) return formatSpreadsheet_(row);
    }
    // Could be a Google spreadsheet ID directly
    googleSpreadsheetId = params.spreadsheetId;
    resolvedFrom = 'spreadsheetId';
  }

  // Resolve from driveFileId
  if (!googleSpreadsheetId && params.driveFileId) {
    // Check if already tracked by driveFileId
    var tssSheet = getSheet_(CONFIG.SHEET_NAMES.TRACKED_SPREADSHEETS);
    var tssData = tssSheet.getDataRange().getValues();
    for (var i = 1; i < tssData.length; i++) {
      if (String(tssData[i][TSS.DRIVE_FILE_ID]) === String(params.driveFileId)) {
        var row2 = {};
        var headers = tssData[0];
        headers.forEach(function(h, j) { row2[h] = tssData[i][j]; });
        return formatSpreadsheet_(row2);
      }
    }
    // Drive file ID = Google spreadsheet ID in Google's system
    googleSpreadsheetId = params.driveFileId;
    resolvedFrom = 'driveFileId';
  }

  // Resolve from name (search tracked spreadsheets only)
  if (!googleSpreadsheetId && params.name) {
    var tssSheet2 = getSheet_(CONFIG.SHEET_NAMES.TRACKED_SPREADSHEETS);
    var tssData2 = tssSheet2.getDataRange().getValues();
    var searchName = String(params.name).toLowerCase();
    for (var i2 = 1; i2 < tssData2.length; i2++) {
      if (String(tssData2[i2][TSS.TITLE]).toLowerCase().indexOf(searchName) !== -1) {
        var row3 = {};
        var headers2 = tssData2[0];
        headers2.forEach(function(h, j) { row3[h] = tssData2[i2][j]; });
        return formatSpreadsheet_(row3);
      }
    }
    return { error: 'Spreadsheet not found by name: ' + params.name + '. Try providing a URL or spreadsheet ID.' };
  }

  if (!googleSpreadsheetId) {
    return { error: 'Provide at least one of: spreadsheetId, url, name, driveFileId' };
  }

  // Check if already tracked by Google spreadsheet ID
  var tssSheet3 = getSheet_(CONFIG.SHEET_NAMES.TRACKED_SPREADSHEETS);
  var tssData3 = tssSheet3.getDataRange().getValues();
  for (var i3 = 1; i3 < tssData3.length; i3++) {
    if (String(tssData3[i3][TSS.GOOGLE_SPREADSHEET_ID]) === String(googleSpreadsheetId)) {
      var row4 = {};
      var headers3 = tssData3[0];
      headers3.forEach(function(h, j) { row4[h] = tssData3[i3][j]; });
      return formatSpreadsheet_(row4);
    }
  }

  // Not tracked yet — enqueue for WorkSync to resolve via Sheets API on work email
  return enqueueCommand_('resolveSpreadsheet', {
    googleSpreadsheetId: googleSpreadsheetId,
    driveFileId: params.driveFileId || '',
    resolvedFrom: resolvedFrom
  });
}

function getSpreadsheet_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('getSpreadsheet', {
    googleSpreadsheetId: gsid,
    trackingId: params.spreadsheetId
  });
}

function listSheets_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('listSheets', {
    googleSpreadsheetId: gsid,
    trackingId: params.spreadsheetId
  });
}

function readRange_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('readRange', {
    googleSpreadsheetId: gsid,
    range: params.range,
    valueRenderOption: params.valueRenderOption || 'FORMATTED_VALUE'
  });
}

function readMultipleRanges_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('readMultipleRanges', {
    googleSpreadsheetId: gsid,
    ranges: params.ranges || [],
    valueRenderOption: params.valueRenderOption || 'FORMATTED_VALUE'
  });
}

function getSheetData_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('getSheetData', {
    googleSpreadsheetId: gsid,
    sheetName: params.sheetName,
    maxRows: params.maxRows || 500,
    maxCols: params.maxCols || 50
  });
}

// ── Async Write Actions (via CommandQueue) ─────────────────────────────────────

function writeRange_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('writeRange', {
    googleSpreadsheetId: gsid,
    range: params.range,
    values: params.values,
    valueInputOption: params.valueInputOption || 'USER_ENTERED'
  });
}

function writeMultipleRanges_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('writeMultipleRanges', {
    googleSpreadsheetId: gsid,
    data: params.data,
    valueInputOption: params.valueInputOption || 'USER_ENTERED'
  });
}

function appendRows_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('appendRows', {
    googleSpreadsheetId: gsid,
    range: params.range,
    values: params.values,
    valueInputOption: params.valueInputOption || 'USER_ENTERED'
  });
}

function clearRange_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('clearRange', {
    googleSpreadsheetId: gsid,
    range: params.range
  });
}

function clearMultipleRanges_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('clearMultipleRanges', {
    googleSpreadsheetId: gsid,
    ranges: params.ranges
  });
}

// ── Async Sheet Management ─────────────────────────────────────────────────────

function addSheet_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('addSheet', {
    googleSpreadsheetId: gsid,
    title: params.title,
    rowCount: params.rowCount || '',
    colCount: params.colCount || ''
  });
}

function deleteSheet_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('deleteSheet', {
    googleSpreadsheetId: gsid,
    sheetId: params.sheetId
  });
}

function duplicateSheet_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('duplicateSheet', {
    googleSpreadsheetId: gsid,
    sheetId: params.sheetId,
    newTitle: params.newTitle || '',
    insertIndex: params.insertIndex || ''
  });
}

function renameSheet_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('renameSheet', {
    googleSpreadsheetId: gsid,
    sheetId: params.sheetId,
    title: params.title
  });
}

function updateSheetProperties_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  var props = {};
  if (params.hidden !== undefined) props.hidden = params.hidden;
  if (params.frozenRowCount !== undefined) props.frozenRowCount = params.frozenRowCount;
  if (params.frozenColumnCount !== undefined) props.frozenColumnCount = params.frozenColumnCount;
  if (params.rightToLeft !== undefined) props.rightToLeft = params.rightToLeft;
  if (params.tabColor !== undefined) props.tabColor = params.tabColor;
  return enqueueCommand_('updateSheetProperties', {
    googleSpreadsheetId: gsid,
    sheetId: params.sheetId,
    properties: props
  });
}

// ── Async Row/Column Operations ────────────────────────────────────────────────

function insertRows_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('insertRows', {
    googleSpreadsheetId: gsid,
    sheetId: params.sheetId,
    startIndex: params.startIndex,
    endIndex: params.endIndex,
    inheritFromBefore: params.inheritFromBefore || false
  });
}

function insertColumns_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('insertColumns', {
    googleSpreadsheetId: gsid,
    sheetId: params.sheetId,
    startIndex: params.startIndex,
    endIndex: params.endIndex,
    inheritFromBefore: params.inheritFromBefore || false
  });
}

function deleteRows_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('deleteRows', {
    googleSpreadsheetId: gsid,
    sheetId: params.sheetId,
    startIndex: params.startIndex,
    endIndex: params.endIndex
  });
}

function deleteColumns_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('deleteColumns', {
    googleSpreadsheetId: gsid,
    sheetId: params.sheetId,
    startIndex: params.startIndex,
    endIndex: params.endIndex
  });
}

function moveRows_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('moveRows', {
    googleSpreadsheetId: gsid,
    sheetId: params.sheetId,
    startIndex: params.startIndex,
    endIndex: params.endIndex,
    destinationIndex: params.destinationIndex
  });
}

function moveColumns_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('moveColumns', {
    googleSpreadsheetId: gsid,
    sheetId: params.sheetId,
    startIndex: params.startIndex,
    endIndex: params.endIndex,
    destinationIndex: params.destinationIndex
  });
}

function resizeRows_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('resizeRows', {
    googleSpreadsheetId: gsid,
    sheetId: params.sheetId,
    startIndex: params.startIndex,
    endIndex: params.endIndex,
    pixelSize: params.pixelSize
  });
}

function resizeColumns_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('resizeColumns', {
    googleSpreadsheetId: gsid,
    sheetId: params.sheetId,
    startIndex: params.startIndex,
    endIndex: params.endIndex,
    pixelSize: params.pixelSize
  });
}

function autoResizeColumns_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('autoResizeColumns', {
    googleSpreadsheetId: gsid,
    sheetId: params.sheetId,
    startIndex: params.startIndex,
    endIndex: params.endIndex
  });
}

// ── Async Formatting ───────────────────────────────────────────────────────────

function formatCells_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  var format = {};
  if (params.bold !== undefined) format.bold = params.bold;
  if (params.italic !== undefined) format.italic = params.italic;
  if (params.underline !== undefined) format.underline = params.underline;
  if (params.strikethrough !== undefined) format.strikethrough = params.strikethrough;
  if (params.fontSize !== undefined) format.fontSize = params.fontSize;
  if (params.fontFamily !== undefined) format.fontFamily = params.fontFamily;
  if (params.foregroundColor !== undefined) format.foregroundColor = params.foregroundColor;
  if (params.backgroundColor !== undefined) format.backgroundColor = params.backgroundColor;
  if (params.horizontalAlignment !== undefined) format.horizontalAlignment = params.horizontalAlignment;
  if (params.verticalAlignment !== undefined) format.verticalAlignment = params.verticalAlignment;
  if (params.wrapStrategy !== undefined) format.wrapStrategy = params.wrapStrategy;
  if (params.numberFormat !== undefined) format.numberFormat = params.numberFormat;
  return enqueueCommand_('formatCells', {
    googleSpreadsheetId: gsid,
    range: params.range,
    format: format
  });
}

function setBorders_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  var borders = {};
  if (params.top !== undefined) borders.top = params.top;
  if (params.bottom !== undefined) borders.bottom = params.bottom;
  if (params.left !== undefined) borders.left = params.left;
  if (params.right !== undefined) borders.right = params.right;
  if (params.innerHorizontal !== undefined) borders.innerHorizontal = params.innerHorizontal;
  if (params.innerVertical !== undefined) borders.innerVertical = params.innerVertical;
  return enqueueCommand_('setBorders', {
    googleSpreadsheetId: gsid,
    range: params.range,
    borders: borders
  });
}

function mergeCells_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('mergeCells', {
    googleSpreadsheetId: gsid,
    range: params.range,
    mergeType: params.mergeType || 'MERGE_ALL'
  });
}

function unmergeCells_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('unmergeCells', {
    googleSpreadsheetId: gsid,
    range: params.range
  });
}

// ── Async Data Operations ──────────────────────────────────────────────────────

function sortRange_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('sortRange', {
    googleSpreadsheetId: gsid,
    range: params.range,
    sortSpecs: params.sortSpecs
  });
}

function findReplace_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('findReplace', {
    googleSpreadsheetId: gsid,
    find: params.find,
    replacement: params.replacement || '',
    sheetId: params.sheetId || '',
    allSheets: params.allSheets || false,
    matchCase: params.matchCase || false,
    matchEntireCell: params.matchEntireCell || false,
    searchByRegex: params.searchByRegex || false
  });
}

function addConditionalFormat_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('addConditionalFormat', {
    googleSpreadsheetId: gsid,
    range: params.range,
    rule: params.rule
  });
}

function deleteConditionalFormat_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('deleteConditionalFormat', {
    googleSpreadsheetId: gsid,
    sheetId: params.sheetId,
    index: params.index
  });
}

function setDataValidation_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('setDataValidation', {
    googleSpreadsheetId: gsid,
    range: params.range,
    rule: params.rule
  });
}

function addNamedRange_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('addNamedRange', {
    googleSpreadsheetId: gsid,
    name: params.name,
    range: params.range
  });
}

function deleteNamedRange_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('deleteNamedRange', {
    googleSpreadsheetId: gsid,
    namedRangeId: params.namedRangeId
  });
}

// ── Async Protection ───────────────────────────────────────────────────────────

function protectRange_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('protectRange', {
    googleSpreadsheetId: gsid,
    range: params.range,
    description: params.description || '',
    warningOnly: params.warningOnly || false,
    editors: params.editors || []
  });
}

function unprotectRange_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('unprotectRange', {
    googleSpreadsheetId: gsid,
    protectedRangeId: params.protectedRangeId
  });
}

// ── Async Charts ───────────────────────────────────────────────────────────────

function addChart_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('addChart', {
    googleSpreadsheetId: gsid,
    sheetId: params.sheetId,
    chartType: params.chartType,
    sourceRange: params.sourceRange,
    title: params.title || '',
    position: params.position || ''
  });
}

function updateChart_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('updateChart', {
    googleSpreadsheetId: gsid,
    chartId: params.chartId,
    title: params.title || '',
    chartType: params.chartType || '',
    sourceRange: params.sourceRange || ''
  });
}

function deleteChart_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('deleteChart', {
    googleSpreadsheetId: gsid,
    chartId: params.chartId
  });
}

// ── Async Filters ──────────────────────────────────────────────────────────────

function setBasicFilter_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('setBasicFilter', {
    googleSpreadsheetId: gsid,
    range: params.range,
    criteria: params.criteria || ''
  });
}

function clearBasicFilter_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('clearBasicFilter', {
    googleSpreadsheetId: gsid,
    sheetId: params.sheetId
  });
}

function addFilterView_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('addFilterView', {
    googleSpreadsheetId: gsid,
    range: params.range,
    title: params.title || '',
    criteria: params.criteria || ''
  });
}

function deleteFilterView_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('deleteFilterView', {
    googleSpreadsheetId: gsid,
    filterViewId: params.filterViewId
  });
}

// ── Async Pivot Tables ─────────────────────────────────────────────────────────

function addPivotTable_(params) {
  var gsid = resolveGoogleSpreadsheetId_(params.spreadsheetId);
  if (!gsid) return { error: 'Spreadsheet not found. Use resolveSpreadsheet first.' };
  return enqueueCommand_('addPivotTable', {
    googleSpreadsheetId: gsid,
    sourceRange: params.sourceRange,
    destinationRange: params.destinationRange,
    rows: params.rows,
    columns: params.columns,
    values: params.values,
    filterSpecs: params.filterSpecs || ''
  });
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
