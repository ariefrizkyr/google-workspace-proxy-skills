// WorkSync.gs — Work Email Apps Script (Sync Engine)
// Runs autonomously on the work email account via 1-minute time-based trigger.
// Processes CommandQueue and refreshes tracked spreadsheet metadata via Sheets API v4.
// Requires: Sheets API (Advanced Service) enabled in Apps Script editor.

// ── Configuration ──────────────────────────────────────────────────────────────

var SYNC_CONFIG = {
  SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID_HERE',
  BATCH_LIMIT: 20,
  LOCK_TIMEOUT_MS: 5 * 60 * 1000,       // 5 minutes
  EXECUTION_TIMEOUT_MS: 4 * 60 * 1000,   // 4 minutes (Apps Script limit is 6)
  CLEANUP_DAYS: 7,
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
    // Phase 1: Refresh tracked spreadsheet metadata
    if (!isTimedOut_(startTime)) {
      refreshMetadata_(startTime);
    }

    // Phase 2: Process command queue
    if (!isTimedOut_(startTime)) {
      processCommands_(startTime);
    }

    // Phase 3: Cleanup old commands
    if (!isTimedOut_(startTime)) {
      cleanupCommands_();
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

// ── Phase 1: Refresh Tracked Spreadsheet Metadata ──────────────────────────────

function refreshMetadata_(startTime) {
  var sheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.TRACKED_SPREADSHEETS);
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;

  for (var i = 1; i < data.length; i++) {
    if (isTimedOut_(startTime)) break;

    var googleSpreadsheetId = data[i][TSS.GOOGLE_SPREADSHEET_ID];
    if (!googleSpreadsheetId) continue;

    try {
      var ssInfo = Sheets.Spreadsheets.get(googleSpreadsheetId, {
        fields: 'properties(title,locale,timeZone),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))'
      });

      var rowNum = i + 1;
      var ts = new Date().toISOString();

      sheet.getRange(rowNum, TSS.TITLE + 1).setValue(ssInfo.properties.title || '');
      sheet.getRange(rowNum, TSS.SHEET_COUNT + 1).setValue(ssInfo.sheets ? ssInfo.sheets.length : 0);
      sheet.getRange(rowNum, TSS.MODIFIED_TIME + 1).setValue(ts);
    } catch (err) {
      Logger.log('Error refreshing metadata for ' + googleSpreadsheetId + ': ' + err.message);
    }
  }
}

// ── Phase 2: Process Command Queue ─────────────────────────────────────────────

function processCommands_(startTime) {
  var sheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.COMMAND_QUEUE);
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;

  var count = 0;
  for (var i = 1; i < data.length && count < SYNC_CONFIG.BATCH_LIMIT; i++) {
    if (isTimedOut_(startTime)) break;
    var status = data[i][3]; // col D: status
    if (status !== 'pending') continue;

    var rowNum = i + 1;
    sheet.getRange(rowNum, 4).setValue('processing'); // status

    try {
      var action = data[i][1]; // col B: action
      var params = {};
      try { params = JSON.parse(data[i][2] || '{}'); } catch(e) {}

      var result = processCommand_(action, params);

      sheet.getRange(rowNum, 4).setValue('completed');
      sheet.getRange(rowNum, 6).setValue(new Date().toISOString()); // processedAt
      sheet.getRange(rowNum, 7).setValue(JSON.stringify(result));   // result
      count++;
    } catch (err) {
      sheet.getRange(rowNum, 4).setValue('failed');
      sheet.getRange(rowNum, 6).setValue(new Date().toISOString());
      sheet.getRange(rowNum, 7).setValue(err.message);
      Logger.log('Error processing command row ' + rowNum + ': ' + err.message);
      count++;
    }
  }
}

function processCommand_(action, params) {
  // Resolve & read operations
  if (action === 'resolveSpreadsheet') return processResolveSpreadsheet_(params);
  if (action === 'getSpreadsheet') return processGetSpreadsheet_(params);
  if (action === 'listSheets') return processListSheets_(params);
  if (action === 'readRange') return processReadRange_(params);
  if (action === 'readMultipleRanges') return processReadMultipleRanges_(params);
  if (action === 'getSheetData') return processGetSheetData_(params);

  // Value operations
  if (action === 'writeRange') return processWriteRange_(params);
  if (action === 'writeMultipleRanges') return processWriteMultipleRanges_(params);
  if (action === 'appendRows') return processAppendRows_(params);
  if (action === 'clearRange') return processClearRange_(params);
  if (action === 'clearMultipleRanges') return processClearMultipleRanges_(params);

  // Sheet management
  if (action === 'addSheet') return processAddSheet_(params);
  if (action === 'deleteSheet') return processDeleteSheet_(params);
  if (action === 'duplicateSheet') return processDuplicateSheet_(params);
  if (action === 'renameSheet') return processRenameSheet_(params);
  if (action === 'updateSheetProperties') return processUpdateSheetProperties_(params);

  // Row/column operations
  if (action === 'insertRows') return processInsertDimension_(params, 'ROWS');
  if (action === 'insertColumns') return processInsertDimension_(params, 'COLUMNS');
  if (action === 'deleteRows') return processDeleteDimension_(params, 'ROWS');
  if (action === 'deleteColumns') return processDeleteDimension_(params, 'COLUMNS');
  if (action === 'moveRows') return processMoveDimension_(params, 'ROWS');
  if (action === 'moveColumns') return processMoveDimension_(params, 'COLUMNS');
  if (action === 'resizeRows') return processResizeDimension_(params, 'ROWS');
  if (action === 'resizeColumns') return processResizeDimension_(params, 'COLUMNS');
  if (action === 'autoResizeColumns') return processAutoResizeColumns_(params);

  // Formatting
  if (action === 'formatCells') return processFormatCells_(params);
  if (action === 'setBorders') return processSetBorders_(params);
  if (action === 'mergeCells') return processMergeCells_(params);
  if (action === 'unmergeCells') return processUnmergeCells_(params);

  // Data operations
  if (action === 'sortRange') return processSortRange_(params);
  if (action === 'findReplace') return processFindReplace_(params);
  if (action === 'addConditionalFormat') return processAddConditionalFormat_(params);
  if (action === 'deleteConditionalFormat') return processDeleteConditionalFormat_(params);
  if (action === 'setDataValidation') return processSetDataValidation_(params);
  if (action === 'addNamedRange') return processAddNamedRange_(params);
  if (action === 'deleteNamedRange') return processDeleteNamedRange_(params);

  // Protection
  if (action === 'protectRange') return processProtectRange_(params);
  if (action === 'unprotectRange') return processUnprotectRange_(params);

  // Charts
  if (action === 'addChart') return processAddChart_(params);
  if (action === 'updateChart') return processUpdateChart_(params);
  if (action === 'deleteChart') return processDeleteChart_(params);

  // Filters
  if (action === 'setBasicFilter') return processSetBasicFilter_(params);
  if (action === 'clearBasicFilter') return processClearBasicFilter_(params);
  if (action === 'addFilterView') return processAddFilterView_(params);
  if (action === 'deleteFilterView') return processDeleteFilterView_(params);

  // Pivot tables
  if (action === 'addPivotTable') return processAddPivotTable_(params);

  // Utility
  if (action === 'syncNow') return { message: 'Sync triggered' };

  throw new Error('Unknown command: ' + action);
}

// ── Resolve & Read Operations ──────────────────────────────────────────────────

function processResolveSpreadsheet_(params) {
  var googleSpreadsheetId = params.googleSpreadsheetId;

  // Try to access via Sheets API (work email has access)
  var ssInfo = Sheets.Spreadsheets.get(googleSpreadsheetId, {
    fields: 'properties(title,locale,timeZone),spreadsheetUrl,sheets(properties(sheetId,title))'
  });

  // Upsert into TrackedSpreadsheets
  var tssSheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.TRACKED_SPREADSHEETS);
  var tssData = tssSheet.getDataRange().getValues();
  var trackingId = '';
  var ts = new Date().toISOString();

  // Check if already tracked
  for (var i = 1; i < tssData.length; i++) {
    if (String(tssData[i][TSS.GOOGLE_SPREADSHEET_ID]) === String(googleSpreadsheetId)) {
      trackingId = tssData[i][TSS.TRACKING_ID];
      var rowNum = i + 1;
      tssSheet.getRange(rowNum, TSS.TITLE + 1).setValue(ssInfo.properties.title || '');
      tssSheet.getRange(rowNum, TSS.URL + 1).setValue(ssInfo.spreadsheetUrl || '');
      tssSheet.getRange(rowNum, TSS.SHEET_COUNT + 1).setValue(ssInfo.sheets ? ssInfo.sheets.length : 0);
      tssSheet.getRange(rowNum, TSS.MODIFIED_TIME + 1).setValue(ts);
      tssSheet.getRange(rowNum, TSS.LAST_ACCESSED + 1).setValue(ts);
      if (params.driveFileId) tssSheet.getRange(rowNum, TSS.DRIVE_FILE_ID + 1).setValue(params.driveFileId);
      break;
    }
  }

  // Insert new row if not tracked
  if (!trackingId) {
    trackingId = Utilities.getUuid();
    tssSheet.appendRow([
      trackingId,                    // A: trackingId
      googleSpreadsheetId,           // B: googleSpreadsheetId
      ssInfo.properties.title || '', // C: title
      ssInfo.spreadsheetUrl || '',   // D: url
      '',                            // E: owner
      ssInfo.sheets ? ssInfo.sheets.length : 0, // F: sheetCount
      '',                            // G: createdTime
      ts,                            // H: modifiedTime
      ts,                            // I: trackedAt
      ts,                            // J: lastAccessed
      params.driveFileId || '',      // K: driveFileId
      ''                             // L: extraJson
    ]);
  }

  return {
    spreadsheetId: trackingId,
    title: ssInfo.properties.title || '',
    url: ssInfo.spreadsheetUrl || '',
    sheetCount: ssInfo.sheets ? ssInfo.sheets.length : 0,
    trackedAt: ts,
    lastAccessed: ts,
    kind: 'sheets#spreadsheet'
  };
}

function processGetSpreadsheet_(params) {
  var ssInfo = Sheets.Spreadsheets.get(params.googleSpreadsheetId, {
    fields: 'properties(title,locale,timeZone),spreadsheetUrl,sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))'
  });

  var sheets = (ssInfo.sheets || []).map(function(s) {
    return {
      sheetId: s.properties.sheetId,
      title: s.properties.title,
      rowCount: s.properties.gridProperties ? s.properties.gridProperties.rowCount : 0,
      colCount: s.properties.gridProperties ? s.properties.gridProperties.columnCount : 0
    };
  });

  return {
    spreadsheetId: params.trackingId || '',
    title: ssInfo.properties.title || '',
    url: ssInfo.spreadsheetUrl || '',
    locale: ssInfo.properties.locale || '',
    timeZone: ssInfo.properties.timeZone || '',
    sheets: sheets,
    kind: 'sheets#spreadsheet'
  };
}

function processListSheets_(params) {
  var ssInfo = Sheets.Spreadsheets.get(params.googleSpreadsheetId, {
    fields: 'sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)))'
  });

  var sheets = (ssInfo.sheets || []).map(function(s) {
    return {
      sheetId: s.properties.sheetId,
      title: s.properties.title,
      index: s.properties.index,
      rowCount: s.properties.gridProperties ? s.properties.gridProperties.rowCount : 0,
      colCount: s.properties.gridProperties ? s.properties.gridProperties.columnCount : 0
    };
  });

  return { spreadsheetId: params.trackingId || '', sheets: sheets };
}

function processReadRange_(params) {
  var response = Sheets.Spreadsheets.Values.get(
    params.googleSpreadsheetId,
    params.range,
    { valueRenderOption: params.valueRenderOption || 'FORMATTED_VALUE' }
  );

  var values = response.values || [];
  return {
    range: response.range || params.range,
    values: values,
    rowCount: values.length,
    colCount: values.length > 0 ? values[0].length : 0
  };
}

function processReadMultipleRanges_(params) {
  var response = Sheets.Spreadsheets.Values.batchGet(
    params.googleSpreadsheetId,
    { ranges: params.ranges, valueRenderOption: params.valueRenderOption || 'FORMATTED_VALUE' }
  );

  var results = (response.valueRanges || []).map(function(vr) {
    var values = vr.values || [];
    return {
      range: vr.range || '',
      values: values,
      rowCount: values.length,
      colCount: values.length > 0 ? values[0].length : 0
    };
  });

  return { ranges: results };
}

function processGetSheetData_(params) {
  var maxRows = params.maxRows || 500;
  var maxCols = params.maxCols || 50;
  var sheetName = params.sheetName;

  // Get sheet metadata to find total size
  var ssInfo = Sheets.Spreadsheets.get(params.googleSpreadsheetId, {
    fields: 'sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))'
  });

  var sheetInfo = null;
  for (var i = 0; i < ssInfo.sheets.length; i++) {
    if (ssInfo.sheets[i].properties.title === sheetName) {
      sheetInfo = ssInfo.sheets[i].properties;
      break;
    }
  }
  if (!sheetInfo) return { error: 'Sheet not found: ' + sheetName };

  var totalRows = sheetInfo.gridProperties ? sheetInfo.gridProperties.rowCount : 0;
  var totalCols = sheetInfo.gridProperties ? sheetInfo.gridProperties.columnCount : 0;

  // Build a capped range in A1 notation
  var rows = Math.min(totalRows, maxRows);
  var cols = Math.min(totalCols, maxCols);
  var endCol = columnToLetter_(cols);
  var range = "'" + sheetName.replace(/'/g, "''") + "'!A1:" + endCol + rows;

  var response = Sheets.Spreadsheets.Values.get(
    params.googleSpreadsheetId,
    range,
    { valueRenderOption: 'FORMATTED_VALUE' }
  );

  var values = response.values || [];
  return {
    sheetName: sheetName,
    values: values,
    rowCount: values.length,
    colCount: values.length > 0 ? values[0].length : 0,
    totalRows: totalRows,
    totalCols: totalCols,
    truncated: totalRows > maxRows || totalCols > maxCols
  };
}

function columnToLetter_(colNum) {
  var result = '';
  while (colNum > 0) {
    var mod = (colNum - 1) % 26;
    result = String.fromCharCode(65 + mod) + result;
    colNum = Math.floor((colNum - 1) / 26);
  }
  return result || 'A';
}

// ── Value Operations ───────────────────────────────────────────────────────────

function processWriteRange_(params) {
  Sheets.Spreadsheets.Values.update(
    { values: params.values },
    params.googleSpreadsheetId,
    params.range,
    { valueInputOption: params.valueInputOption || 'USER_ENTERED' }
  );
  return { success: true, range: params.range, updatedRows: params.values.length };
}

function processWriteMultipleRanges_(params) {
  var data = params.data.map(function(d) {
    return { range: d.range, values: d.values };
  });
  Sheets.Spreadsheets.Values.batchUpdate(
    { valueInputOption: params.valueInputOption || 'USER_ENTERED', data: data },
    params.googleSpreadsheetId
  );
  return { success: true, rangesUpdated: data.length };
}

function processAppendRows_(params) {
  Sheets.Spreadsheets.Values.append(
    { values: params.values },
    params.googleSpreadsheetId,
    params.range,
    { valueInputOption: params.valueInputOption || 'USER_ENTERED', insertDataOption: 'INSERT_ROWS' }
  );
  return { success: true, range: params.range, rowsAppended: params.values.length };
}

function processClearRange_(params) {
  Sheets.Spreadsheets.Values.clear({}, params.googleSpreadsheetId, params.range);
  return { success: true, range: params.range };
}

function processClearMultipleRanges_(params) {
  Sheets.Spreadsheets.Values.batchClear(
    { ranges: params.ranges },
    params.googleSpreadsheetId
  );
  return { success: true, rangesCleared: params.ranges.length };
}

// ── Sheet Management ───────────────────────────────────────────────────────────

function processAddSheet_(params) {
  var request = {
    addSheet: {
      properties: {
        title: params.title
      }
    }
  };
  if (params.rowCount) request.addSheet.properties.gridProperties = request.addSheet.properties.gridProperties || {};
  if (params.rowCount) request.addSheet.properties.gridProperties.rowCount = params.rowCount;
  if (params.colCount) request.addSheet.properties.gridProperties = request.addSheet.properties.gridProperties || {};
  if (params.colCount) request.addSheet.properties.gridProperties.columnCount = params.colCount;

  var response = Sheets.Spreadsheets.batchUpdate({ requests: [request] }, params.googleSpreadsheetId);
  var addedSheet = response.replies[0].addSheet;
  return {
    success: true,
    sheetId: addedSheet.properties.sheetId,
    title: addedSheet.properties.title
  };
}

function processDeleteSheet_(params) {
  Sheets.Spreadsheets.batchUpdate({
    requests: [{ deleteSheet: { sheetId: params.sheetId } }]
  }, params.googleSpreadsheetId);
  return { success: true, sheetId: params.sheetId };
}

function processDuplicateSheet_(params) {
  var request = {
    duplicateSheet: {
      sourceSheetId: params.sheetId
    }
  };
  if (params.newTitle) request.duplicateSheet.newSheetName = params.newTitle;
  if (params.insertIndex !== '' && params.insertIndex !== undefined) {
    request.duplicateSheet.insertSheetIndex = params.insertIndex;
  }

  var response = Sheets.Spreadsheets.batchUpdate({ requests: [request] }, params.googleSpreadsheetId);
  var dup = response.replies[0].duplicateSheet;
  return {
    success: true,
    sheetId: dup.properties.sheetId,
    title: dup.properties.title
  };
}

function processRenameSheet_(params) {
  Sheets.Spreadsheets.batchUpdate({
    requests: [{
      updateSheetProperties: {
        properties: { sheetId: params.sheetId, title: params.title },
        fields: 'title'
      }
    }]
  }, params.googleSpreadsheetId);
  return { success: true, sheetId: params.sheetId, title: params.title };
}

function processUpdateSheetProperties_(params) {
  var properties = { sheetId: params.sheetId };
  var fields = [];

  if (params.properties.hidden !== undefined) { properties.hidden = params.properties.hidden; fields.push('hidden'); }
  if (params.properties.frozenRowCount !== undefined) {
    properties.gridProperties = properties.gridProperties || {};
    properties.gridProperties.frozenRowCount = params.properties.frozenRowCount;
    fields.push('gridProperties.frozenRowCount');
  }
  if (params.properties.frozenColumnCount !== undefined) {
    properties.gridProperties = properties.gridProperties || {};
    properties.gridProperties.frozenColumnCount = params.properties.frozenColumnCount;
    fields.push('gridProperties.frozenColumnCount');
  }
  if (params.properties.rightToLeft !== undefined) { properties.rightToLeft = params.properties.rightToLeft; fields.push('rightToLeft'); }
  if (params.properties.tabColor !== undefined) { properties.tabColorStyle = { rgbColor: params.properties.tabColor }; fields.push('tabColorStyle'); }

  Sheets.Spreadsheets.batchUpdate({
    requests: [{
      updateSheetProperties: {
        properties: properties,
        fields: fields.join(',')
      }
    }]
  }, params.googleSpreadsheetId);
  return { success: true, sheetId: params.sheetId };
}

// ── Row/Column Operations ──────────────────────────────────────────────────────

function processInsertDimension_(params, dimension) {
  var request = {
    insertDimension: {
      range: {
        sheetId: params.sheetId,
        dimension: dimension,
        startIndex: params.startIndex,
        endIndex: params.endIndex
      },
      inheritFromBefore: params.inheritFromBefore || false
    }
  };
  Sheets.Spreadsheets.batchUpdate({ requests: [request] }, params.googleSpreadsheetId);
  return { success: true, dimension: dimension, startIndex: params.startIndex, endIndex: params.endIndex };
}

function processDeleteDimension_(params, dimension) {
  Sheets.Spreadsheets.batchUpdate({
    requests: [{
      deleteDimension: {
        range: {
          sheetId: params.sheetId,
          dimension: dimension,
          startIndex: params.startIndex,
          endIndex: params.endIndex
        }
      }
    }]
  }, params.googleSpreadsheetId);
  return { success: true, dimension: dimension, startIndex: params.startIndex, endIndex: params.endIndex };
}

function processMoveDimension_(params, dimension) {
  Sheets.Spreadsheets.batchUpdate({
    requests: [{
      moveDimension: {
        source: {
          sheetId: params.sheetId,
          dimension: dimension,
          startIndex: params.startIndex,
          endIndex: params.endIndex
        },
        destinationIndex: params.destinationIndex
      }
    }]
  }, params.googleSpreadsheetId);
  return { success: true, dimension: dimension, destinationIndex: params.destinationIndex };
}

function processResizeDimension_(params, dimension) {
  Sheets.Spreadsheets.batchUpdate({
    requests: [{
      updateDimensionProperties: {
        range: {
          sheetId: params.sheetId,
          dimension: dimension,
          startIndex: params.startIndex,
          endIndex: params.endIndex
        },
        properties: { pixelSize: params.pixelSize },
        fields: 'pixelSize'
      }
    }]
  }, params.googleSpreadsheetId);
  return { success: true, dimension: dimension, pixelSize: params.pixelSize };
}

function processAutoResizeColumns_(params) {
  Sheets.Spreadsheets.batchUpdate({
    requests: [{
      autoResizeDimensions: {
        dimensions: {
          sheetId: params.sheetId,
          dimension: 'COLUMNS',
          startIndex: params.startIndex,
          endIndex: params.endIndex
        }
      }
    }]
  }, params.googleSpreadsheetId);
  return { success: true, startIndex: params.startIndex, endIndex: params.endIndex };
}

// ── Formatting ─────────────────────────────────────────────────────────────────

function processFormatCells_(params) {
  var gridRange = parseA1ToGridRange_(params.range, params.googleSpreadsheetId);
  var cellFormat = {};
  var fields = [];

  var fmt = params.format;
  if (fmt.bold !== undefined || fmt.italic !== undefined || fmt.underline !== undefined ||
      fmt.strikethrough !== undefined || fmt.fontSize !== undefined || fmt.fontFamily !== undefined ||
      fmt.foregroundColor !== undefined) {
    cellFormat.textFormat = {};
    if (fmt.bold !== undefined) { cellFormat.textFormat.bold = fmt.bold; fields.push('userEnteredFormat.textFormat.bold'); }
    if (fmt.italic !== undefined) { cellFormat.textFormat.italic = fmt.italic; fields.push('userEnteredFormat.textFormat.italic'); }
    if (fmt.underline !== undefined) { cellFormat.textFormat.underline = fmt.underline; fields.push('userEnteredFormat.textFormat.underline'); }
    if (fmt.strikethrough !== undefined) { cellFormat.textFormat.strikethrough = fmt.strikethrough; fields.push('userEnteredFormat.textFormat.strikethrough'); }
    if (fmt.fontSize !== undefined) { cellFormat.textFormat.fontSize = fmt.fontSize; fields.push('userEnteredFormat.textFormat.fontSize'); }
    if (fmt.fontFamily !== undefined) { cellFormat.textFormat.fontFamily = fmt.fontFamily; fields.push('userEnteredFormat.textFormat.fontFamily'); }
    if (fmt.foregroundColor !== undefined) { cellFormat.textFormat.foregroundColorStyle = { rgbColor: fmt.foregroundColor }; fields.push('userEnteredFormat.textFormat.foregroundColorStyle'); }
  }
  if (fmt.backgroundColor !== undefined) { cellFormat.backgroundColorStyle = { rgbColor: fmt.backgroundColor }; fields.push('userEnteredFormat.backgroundColorStyle'); }
  if (fmt.horizontalAlignment !== undefined) { cellFormat.horizontalAlignment = fmt.horizontalAlignment; fields.push('userEnteredFormat.horizontalAlignment'); }
  if (fmt.verticalAlignment !== undefined) { cellFormat.verticalAlignment = fmt.verticalAlignment; fields.push('userEnteredFormat.verticalAlignment'); }
  if (fmt.wrapStrategy !== undefined) { cellFormat.wrapStrategy = fmt.wrapStrategy; fields.push('userEnteredFormat.wrapStrategy'); }
  if (fmt.numberFormat !== undefined) { cellFormat.numberFormat = fmt.numberFormat; fields.push('userEnteredFormat.numberFormat'); }

  Sheets.Spreadsheets.batchUpdate({
    requests: [{
      repeatCell: {
        range: gridRange,
        cell: { userEnteredFormat: cellFormat },
        fields: fields.join(',')
      }
    }]
  }, params.googleSpreadsheetId);
  return { success: true, range: params.range };
}

function processSetBorders_(params) {
  var gridRange = parseA1ToGridRange_(params.range, params.googleSpreadsheetId);
  var borders = params.borders;

  var borderRequest = { range: gridRange };
  if (borders.top) borderRequest.top = buildBorder_(borders.top);
  if (borders.bottom) borderRequest.bottom = buildBorder_(borders.bottom);
  if (borders.left) borderRequest.left = buildBorder_(borders.left);
  if (borders.right) borderRequest.right = buildBorder_(borders.right);
  if (borders.innerHorizontal) borderRequest.innerHorizontal = buildBorder_(borders.innerHorizontal);
  if (borders.innerVertical) borderRequest.innerVertical = buildBorder_(borders.innerVertical);

  Sheets.Spreadsheets.batchUpdate({
    requests: [{ updateBorders: borderRequest }]
  }, params.googleSpreadsheetId);
  return { success: true, range: params.range };
}

function buildBorder_(border) {
  var b = { style: border.style || 'SOLID' };
  if (border.color) {
    b.colorStyle = { rgbColor: border.color };
  } else {
    b.colorStyle = { rgbColor: { red: 0, green: 0, blue: 0 } };
  }
  return b;
}

function processMergeCells_(params) {
  var gridRange = parseA1ToGridRange_(params.range, params.googleSpreadsheetId);
  Sheets.Spreadsheets.batchUpdate({
    requests: [{
      mergeCells: {
        range: gridRange,
        mergeType: params.mergeType || 'MERGE_ALL'
      }
    }]
  }, params.googleSpreadsheetId);
  return { success: true, range: params.range };
}

function processUnmergeCells_(params) {
  var gridRange = parseA1ToGridRange_(params.range, params.googleSpreadsheetId);
  Sheets.Spreadsheets.batchUpdate({
    requests: [{ unmergeCells: { range: gridRange } }]
  }, params.googleSpreadsheetId);
  return { success: true, range: params.range };
}

// ── Data Operations ────────────────────────────────────────────────────────────

function processSortRange_(params) {
  var gridRange = parseA1ToGridRange_(params.range, params.googleSpreadsheetId);
  var sortSpecs = params.sortSpecs.map(function(s) {
    return {
      dimensionIndex: s.dimensionIndex,
      sortOrder: s.sortOrder || 'ASCENDING'
    };
  });
  Sheets.Spreadsheets.batchUpdate({
    requests: [{
      sortRange: {
        range: gridRange,
        sortSpecs: sortSpecs
      }
    }]
  }, params.googleSpreadsheetId);
  return { success: true, range: params.range };
}

function processFindReplace_(params) {
  var request = {
    findReplace: {
      find: params.find,
      replacement: params.replacement || ''
    }
  };
  if (params.allSheets) {
    request.findReplace.allSheets = true;
  } else if (params.sheetId !== '' && params.sheetId !== undefined) {
    request.findReplace.sheetId = params.sheetId;
  }
  if (params.matchCase) request.findReplace.matchCase = true;
  if (params.matchEntireCell) request.findReplace.matchEntireCell = true;
  if (params.searchByRegex) request.findReplace.searchByRegex = true;

  var response = Sheets.Spreadsheets.batchUpdate({ requests: [request] }, params.googleSpreadsheetId);
  var reply = response.replies[0].findReplace;
  return {
    success: true,
    occurrencesChanged: reply.occurrencesChanged || 0,
    rowsChanged: reply.rowsChanged || 0,
    sheetsChanged: reply.sheetsChanged || 0,
    formulasChanged: reply.formulasChanged || 0,
    valuesChanged: reply.valuesChanged || 0
  };
}

function processAddConditionalFormat_(params) {
  var gridRange = parseA1ToGridRange_(params.range, params.googleSpreadsheetId);
  var rule = params.rule;

  var request = {
    addConditionalFormatRule: {
      rule: {
        ranges: [gridRange]
      },
      index: 0
    }
  };

  // Build boolean condition rule
  if (rule.type) {
    request.addConditionalFormatRule.rule.booleanRule = {
      condition: {
        type: rule.type,
        values: (rule.values || []).map(function(v) { return { userEnteredValue: String(v) }; })
      },
      format: rule.format || {}
    };
    if (rule.format && rule.format.backgroundColor) {
      request.addConditionalFormatRule.rule.booleanRule.format.backgroundColorStyle = {
        rgbColor: rule.format.backgroundColor
      };
    }
  }

  Sheets.Spreadsheets.batchUpdate({ requests: [request] }, params.googleSpreadsheetId);
  return { success: true, range: params.range };
}

function processDeleteConditionalFormat_(params) {
  Sheets.Spreadsheets.batchUpdate({
    requests: [{
      deleteConditionalFormatRule: {
        sheetId: params.sheetId,
        index: params.index
      }
    }]
  }, params.googleSpreadsheetId);
  return { success: true, sheetId: params.sheetId, index: params.index };
}

function processSetDataValidation_(params) {
  var gridRange = parseA1ToGridRange_(params.range, params.googleSpreadsheetId);
  var rule = params.rule;

  var condition = {};
  if (rule.type === 'ONE_OF_LIST') {
    condition.type = 'ONE_OF_LIST';
    condition.values = (rule.values || []).map(function(v) { return { userEnteredValue: String(v) }; });
  } else if (rule.type === 'NUMBER_BETWEEN') {
    condition.type = 'NUMBER_BETWEEN';
    condition.values = [
      { userEnteredValue: String(rule.values[0]) },
      { userEnteredValue: String(rule.values[1]) }
    ];
  } else if (rule.type) {
    condition.type = rule.type;
    if (rule.values) {
      condition.values = rule.values.map(function(v) { return { userEnteredValue: String(v) }; });
    }
  }

  Sheets.Spreadsheets.batchUpdate({
    requests: [{
      setDataValidation: {
        range: gridRange,
        rule: {
          condition: condition,
          showCustomUi: true,
          strict: rule.strict || false
        }
      }
    }]
  }, params.googleSpreadsheetId);
  return { success: true, range: params.range };
}

function processAddNamedRange_(params) {
  var gridRange = parseA1ToGridRange_(params.range, params.googleSpreadsheetId);
  var response = Sheets.Spreadsheets.batchUpdate({
    requests: [{
      addNamedRange: {
        namedRange: {
          name: params.name,
          range: gridRange
        }
      }
    }]
  }, params.googleSpreadsheetId);
  var added = response.replies[0].addNamedRange.namedRange;
  return { success: true, namedRangeId: added.namedRangeId, name: added.name };
}

function processDeleteNamedRange_(params) {
  Sheets.Spreadsheets.batchUpdate({
    requests: [{ deleteNamedRange: { namedRangeId: params.namedRangeId } }]
  }, params.googleSpreadsheetId);
  return { success: true, namedRangeId: params.namedRangeId };
}

// ── Protection ─────────────────────────────────────────────────────────────────

function processProtectRange_(params) {
  var gridRange = parseA1ToGridRange_(params.range, params.googleSpreadsheetId);
  var request = {
    addProtectedRange: {
      protectedRange: {
        range: gridRange,
        description: params.description || '',
        warningOnly: params.warningOnly || false
      }
    }
  };
  if (params.editors && params.editors.length > 0) {
    request.addProtectedRange.protectedRange.editors = {
      users: params.editors
    };
  }
  var response = Sheets.Spreadsheets.batchUpdate({ requests: [request] }, params.googleSpreadsheetId);
  var added = response.replies[0].addProtectedRange.protectedRange;
  return { success: true, protectedRangeId: added.protectedRangeId };
}

function processUnprotectRange_(params) {
  Sheets.Spreadsheets.batchUpdate({
    requests: [{ deleteProtectedRange: { protectedRangeId: params.protectedRangeId } }]
  }, params.googleSpreadsheetId);
  return { success: true, protectedRangeId: params.protectedRangeId };
}

// ── Charts ─────────────────────────────────────────────────────────────────────

function processAddChart_(params) {
  var sourceGridRange = parseA1ToGridRange_(params.sourceRange, params.googleSpreadsheetId);

  var chartSpec = {
    title: params.title || '',
    basicChart: {
      chartType: params.chartType || 'BAR',
      legendPosition: 'BOTTOM_LEGEND',
      domains: [{ domain: { sourceRange: { sources: [sourceGridRange] } } }],
      series: [{ series: { sourceRange: { sources: [sourceGridRange] } } }]
    }
  };

  var position = { overlayPosition: { anchorCell: { sheetId: params.sheetId, rowIndex: 0, columnIndex: 0 } } };
  if (params.position && params.position.rowIndex !== undefined) {
    position.overlayPosition.anchorCell.rowIndex = params.position.rowIndex;
    position.overlayPosition.anchorCell.columnIndex = params.position.columnIndex || 0;
  }

  var response = Sheets.Spreadsheets.batchUpdate({
    requests: [{
      addChart: {
        chart: {
          spec: chartSpec,
          position: position
        }
      }
    }]
  }, params.googleSpreadsheetId);
  var chart = response.replies[0].addChart.chart;
  return { success: true, chartId: chart.chartId };
}

function processUpdateChart_(params) {
  var request = { updateChartSpec: { chartId: params.chartId, spec: {} } };

  // Get existing chart spec first
  var ss = Sheets.Spreadsheets.get(params.googleSpreadsheetId, { fields: 'sheets(charts(chartId,spec))' });
  var existingSpec = null;
  for (var si = 0; si < ss.sheets.length; si++) {
    var charts = ss.sheets[si].charts || [];
    for (var ci = 0; ci < charts.length; ci++) {
      if (charts[ci].chartId === params.chartId) {
        existingSpec = charts[ci].spec;
        break;
      }
    }
    if (existingSpec) break;
  }

  if (!existingSpec) throw new Error('Chart not found: ' + params.chartId);

  var spec = existingSpec;
  if (params.title) spec.title = params.title;
  if (params.chartType && spec.basicChart) spec.basicChart.chartType = params.chartType;
  if (params.sourceRange && spec.basicChart) {
    var sourceGridRange = parseA1ToGridRange_(params.sourceRange, params.googleSpreadsheetId);
    spec.basicChart.domains = [{ domain: { sourceRange: { sources: [sourceGridRange] } } }];
    spec.basicChart.series = [{ series: { sourceRange: { sources: [sourceGridRange] } } }];
  }

  request.updateChartSpec.spec = spec;
  Sheets.Spreadsheets.batchUpdate({ requests: [request] }, params.googleSpreadsheetId);
  return { success: true, chartId: params.chartId };
}

function processDeleteChart_(params) {
  Sheets.Spreadsheets.batchUpdate({
    requests: [{ deleteEmbeddedObject: { objectId: params.chartId } }]
  }, params.googleSpreadsheetId);
  return { success: true, chartId: params.chartId };
}

// ── Filters ────────────────────────────────────────────────────────────────────

function processSetBasicFilter_(params) {
  var gridRange = parseA1ToGridRange_(params.range, params.googleSpreadsheetId);
  var request = {
    setBasicFilter: {
      filter: { range: gridRange }
    }
  };
  if (params.criteria) {
    request.setBasicFilter.filter.criteria = params.criteria;
  }
  Sheets.Spreadsheets.batchUpdate({ requests: [request] }, params.googleSpreadsheetId);
  return { success: true, range: params.range };
}

function processClearBasicFilter_(params) {
  Sheets.Spreadsheets.batchUpdate({
    requests: [{ clearBasicFilter: { sheetId: params.sheetId } }]
  }, params.googleSpreadsheetId);
  return { success: true, sheetId: params.sheetId };
}

function processAddFilterView_(params) {
  var gridRange = parseA1ToGridRange_(params.range, params.googleSpreadsheetId);
  var filterView = { range: gridRange };
  if (params.title) filterView.title = params.title;
  if (params.criteria) filterView.criteria = params.criteria;

  var response = Sheets.Spreadsheets.batchUpdate({
    requests: [{ addFilterView: { filter: filterView } }]
  }, params.googleSpreadsheetId);
  var added = response.replies[0].addFilterView.filter;
  return { success: true, filterViewId: added.filterViewId, title: added.title || '' };
}

function processDeleteFilterView_(params) {
  Sheets.Spreadsheets.batchUpdate({
    requests: [{ deleteFilterView: { filterId: params.filterViewId } }]
  }, params.googleSpreadsheetId);
  return { success: true, filterViewId: params.filterViewId };
}

// ── Pivot Tables ───────────────────────────────────────────────────────────────

function processAddPivotTable_(params) {
  var sourceGridRange = parseA1ToGridRange_(params.sourceRange, params.googleSpreadsheetId);
  var destGridRange = parseA1ToGridRange_(params.destinationRange, params.googleSpreadsheetId);

  var pivotRows = params.rows.map(function(r) {
    return { sourceColumnOffset: r.sourceColumnOffset, sortOrder: r.sortOrder || 'ASCENDING', showTotals: true };
  });
  var pivotCols = params.columns.map(function(c) {
    return { sourceColumnOffset: c.sourceColumnOffset, sortOrder: c.sortOrder || 'ASCENDING', showTotals: true };
  });
  var pivotValues = params.values.map(function(v) {
    return { sourceColumnOffset: v.sourceColumnOffset, summarizeFunction: v.summarizeFunction || 'SUM' };
  });

  var pivotTable = {
    source: sourceGridRange,
    rows: pivotRows,
    columns: pivotCols,
    values: pivotValues
  };

  if (params.filterSpecs) {
    pivotTable.filterSpecs = params.filterSpecs;
  }

  // Write pivot table via updateCells
  Sheets.Spreadsheets.batchUpdate({
    requests: [{
      updateCells: {
        rows: [{ values: [{ pivotTable: pivotTable }] }],
        start: {
          sheetId: destGridRange.sheetId,
          rowIndex: destGridRange.startRowIndex || 0,
          columnIndex: destGridRange.startColumnIndex || 0
        },
        fields: 'pivotTable'
      }
    }]
  }, params.googleSpreadsheetId);
  return { success: true, destinationRange: params.destinationRange };
}

// ── Phase 3: Cleanup ───────────────────────────────────────────────────────────

function cleanupCommands_() {
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - SYNC_CONFIG.CLEANUP_DAYS);

  var cmdSheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.COMMAND_QUEUE);
  var cmdData = cmdSheet.getDataRange().getValues();
  var rowsToDelete = [];

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

// ── Initial Import ─────────────────────────────────────────────────────────────

function initialImport() {
  Logger.log('Google Sheets WorkSync initialized. No initial import needed.');
  Logger.log('Spreadsheets are tracked on-demand via resolveSpreadsheet.');
  setMeta_('lastFullSync', new Date().toISOString());
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

// ── A1 Notation Parser ─────────────────────────────────────────────────────────

function parseA1ToGridRange_(a1Notation, spreadsheetId) {
  // Parse A1 notation like "Sheet1!A1:C10" into a GridRange object
  var sheetName = '';
  var rangePart = a1Notation;

  // Extract sheet name if present
  var exclamationIndex = a1Notation.indexOf('!');
  if (exclamationIndex !== -1) {
    sheetName = a1Notation.substring(0, exclamationIndex).replace(/^'|'$/g, '');
    rangePart = a1Notation.substring(exclamationIndex + 1);
  }

  // Get sheet ID
  var sheetId = 0;
  if (sheetName) {
    var ssInfo = Sheets.Spreadsheets.get(spreadsheetId, { fields: 'sheets(properties(sheetId,title))' });
    for (var i = 0; i < ssInfo.sheets.length; i++) {
      if (ssInfo.sheets[i].properties.title === sheetName) {
        sheetId = ssInfo.sheets[i].properties.sheetId;
        break;
      }
    }
  }

  var gridRange = { sheetId: sheetId };

  // Parse the range part (e.g., "A1:C10", "A1", "A:C", "1:5")
  var parts = rangePart.split(':');
  var start = parseCellRef_(parts[0]);
  gridRange.startRowIndex = start.row;
  gridRange.startColumnIndex = start.col;

  if (parts.length > 1) {
    var end = parseCellRef_(parts[1]);
    if (end.row !== undefined) gridRange.endRowIndex = end.row + 1;
    if (end.col !== undefined) gridRange.endColumnIndex = end.col + 1;
  } else {
    if (start.row !== undefined) gridRange.endRowIndex = start.row + 1;
    if (start.col !== undefined) gridRange.endColumnIndex = start.col + 1;
  }

  return gridRange;
}

function parseCellRef_(ref) {
  var result = {};
  var colStr = '';
  var rowStr = '';

  for (var i = 0; i < ref.length; i++) {
    var ch = ref.charAt(i);
    if (ch >= 'A' && ch <= 'Z') {
      colStr += ch;
    } else if (ch >= '0' && ch <= '9') {
      rowStr += ch;
    }
  }

  if (colStr) {
    var col = 0;
    for (var j = 0; j < colStr.length; j++) {
      col = col * 26 + (colStr.charCodeAt(j) - 64);
    }
    result.col = col - 1; // 0-based
  }
  if (rowStr) {
    result.row = parseInt(rowStr, 10) - 1; // 0-based
  }

  return result;
}
