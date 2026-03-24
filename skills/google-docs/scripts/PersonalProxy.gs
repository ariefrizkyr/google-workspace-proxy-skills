// PersonalProxy.gs — Personal Gmail Apps Script
// Deployed as web app on personal Gmail account.
// Routes ALL target document operations (reads AND writes) through CommandQueue
// because the personal email may not have access to work email documents.
// Only proxy-spreadsheet operations (listTrackedDocuments, getCommandResult) are sync.
// Claude Code calls this via HTTP; WorkSync.gs handles Docs API v1 on work email.

// ── Configuration ──────────────────────────────────────────────────────────────

var CONFIG = {
  SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID_HERE',
  API_KEY: 'YOUR_API_KEY_HERE',
  SHEET_NAMES: {
    TRACKED_DOCUMENTS: 'TrackedDocuments',
    COMMAND_QUEUE: 'CommandQueue',
    SYNC_META: 'SyncMeta'
  }
};

// Column indices for TrackedDocuments sheet (0-based)
var TDC = {
  TRACKING_ID: 0,
  GOOGLE_DOCUMENT_ID: 1,
  TITLE: 2,
  URL: 3,
  OWNER: 4,
  TAB_COUNT: 5,
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
  return jsonResponse_({ status: 'ok', message: 'Google Docs Proxy is running' });
}

// ── Action Router ──────────────────────────────────────────────────────────────

var ACTIONS = {
  // Sync (reads proxy spreadsheet only)
  listTrackedDocuments: listTrackedDocuments_,
  getCommandResult: getCommandResult_,
  // Async — document management
  resolveDocument: resolveDocument_,
  getDocument: getDocument_,
  getDocumentContent: getDocumentContent_,
  createDocument: createDocument_,
  // Async — text operations
  insertText: insertText_,
  deleteContent: deleteContent_,
  replaceAllText: replaceAllText_,
  // Async — formatting
  updateTextStyle: updateTextStyle_,
  updateParagraphStyle: updateParagraphStyle_,
  // Async — lists
  createBullets: createBullets_,
  deleteBullets: deleteBullets_,
  // Async — tables
  insertTable: insertTable_,
  insertTableRow: insertTableRow_,
  insertTableColumn: insertTableColumn_,
  deleteTableRow: deleteTableRow_,
  deleteTableColumn: deleteTableColumn_,
  mergeTableCells: mergeTableCells_,
  unmergeTableCells: unmergeTableCells_,
  updateTableColumnProperties: updateTableColumnProperties_,
  updateTableRowStyle: updateTableRowStyle_,
  updateTableCellStyle: updateTableCellStyle_,
  pinTableHeaderRows: pinTableHeaderRows_,
  // Async — images
  insertInlineImage: insertInlineImage_,
  // Async — structure
  insertPageBreak: insertPageBreak_,
  insertSectionBreak: insertSectionBreak_,
  createHeader: createHeader_,
  createFooter: createFooter_,
  deleteHeader: deleteHeader_,
  deleteFooter: deleteFooter_,
  createFootnote: createFootnote_,
  // Async — named ranges
  createNamedRange: createNamedRange_,
  deleteNamedRange: deleteNamedRange_,
  replaceNamedRangeContent: replaceNamedRangeContent_,
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

// ── Resolve Google Document ID from tracking ID ────────────────────────────────

function resolveGoogleDocumentId_(trackingId) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.TRACKED_DOCUMENTS);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][TDC.TRACKING_ID]) === String(trackingId)) {
      return data[i][TDC.GOOGLE_DOCUMENT_ID] || '';
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

function formatDocument_(row) {
  return {
    documentId: row.trackingId || '',
    title: row.title || '',
    url: row.url || '',
    owner: row.owner || '',
    tabCount: row.tabCount || 0,
    createdTime: row.createdTime || '',
    modifiedTime: row.modifiedTime || '',
    trackedAt: row.trackedAt || '',
    lastAccessed: row.lastAccessed || '',
    kind: 'docs#document'
  };
}

// ── Sync Actions (proxy spreadsheet only) ──────────────────────────────────────

function listTrackedDocuments_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.TRACKED_DOCUMENTS);
  var rows = getAllRows_(sheet);

  var items = rows.map(formatDocument_).sort(function(a, b) {
    return new Date(b.lastAccessed || b.trackedAt || 0) - new Date(a.lastAccessed || a.trackedAt || 0);
  });

  return { kind: 'docs#documentList', items: items };
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

// ── Async Document Management ──────────────────────────────────────────────────

function resolveDocument_(params) {
  // Extract Google document ID from whatever identifier was provided
  var googleDocumentId = '';
  var resolvedFrom = '';

  // Resolve from URL
  if (params.url) {
    var match = String(params.url).match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (match) {
      googleDocumentId = match[1];
      resolvedFrom = 'url';
    }
  }

  // Resolve from documentId (could be a tracking UUID or a Google ID)
  if (!googleDocumentId && params.documentId) {
    var gdid = resolveGoogleDocumentId_(params.documentId);
    if (gdid) {
      // Already tracked — return immediately from proxy sheet
      var sheet = getSheet_(CONFIG.SHEET_NAMES.TRACKED_DOCUMENTS);
      var row = getRowBySheetId_(sheet, TDC.TRACKING_ID, params.documentId);
      if (row) return formatDocument_(row);
    }
    // Could be a Google document ID directly
    googleDocumentId = params.documentId;
    resolvedFrom = 'documentId';
  }

  // Resolve from driveFileId
  if (!googleDocumentId && params.driveFileId) {
    // Check if already tracked by driveFileId
    var tdcSheet = getSheet_(CONFIG.SHEET_NAMES.TRACKED_DOCUMENTS);
    var tdcData = tdcSheet.getDataRange().getValues();
    for (var i = 1; i < tdcData.length; i++) {
      if (String(tdcData[i][TDC.DRIVE_FILE_ID]) === String(params.driveFileId)) {
        var row2 = {};
        var headers = tdcData[0];
        headers.forEach(function(h, j) { row2[h] = tdcData[i][j]; });
        return formatDocument_(row2);
      }
    }
    // Drive file ID = Google document ID in Google's system
    googleDocumentId = params.driveFileId;
    resolvedFrom = 'driveFileId';
  }

  // Resolve from name (search tracked documents only)
  if (!googleDocumentId && params.name) {
    var tdcSheet2 = getSheet_(CONFIG.SHEET_NAMES.TRACKED_DOCUMENTS);
    var tdcData2 = tdcSheet2.getDataRange().getValues();
    var searchName = String(params.name).toLowerCase();
    for (var i2 = 1; i2 < tdcData2.length; i2++) {
      if (String(tdcData2[i2][TDC.TITLE]).toLowerCase().indexOf(searchName) !== -1) {
        var row3 = {};
        var headers2 = tdcData2[0];
        headers2.forEach(function(h, j) { row3[h] = tdcData2[i2][j]; });
        return formatDocument_(row3);
      }
    }
    return { error: 'Document not found by name: ' + params.name + '. Try providing a URL or document ID.' };
  }

  if (!googleDocumentId) {
    return { error: 'Provide at least one of: documentId, url, name, driveFileId' };
  }

  // Check if already tracked by Google document ID
  var tdcSheet3 = getSheet_(CONFIG.SHEET_NAMES.TRACKED_DOCUMENTS);
  var tdcData3 = tdcSheet3.getDataRange().getValues();
  for (var i3 = 1; i3 < tdcData3.length; i3++) {
    if (String(tdcData3[i3][TDC.GOOGLE_DOCUMENT_ID]) === String(googleDocumentId)) {
      var row4 = {};
      var headers3 = tdcData3[0];
      headers3.forEach(function(h, j) { row4[h] = tdcData3[i3][j]; });
      return formatDocument_(row4);
    }
  }

  // Not tracked yet — enqueue for WorkSync to resolve via Docs API on work email
  return enqueueCommand_('resolveDocument', {
    googleDocumentId: googleDocumentId,
    driveFileId: params.driveFileId || '',
    resolvedFrom: resolvedFrom
  });
}

function getDocument_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  return enqueueCommand_('getDocument', {
    googleDocumentId: gdid,
    trackingId: params.documentId
  });
}

function getDocumentContent_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  return enqueueCommand_('getDocumentContent', {
    googleDocumentId: gdid,
    trackingId: params.documentId,
    tabIndex: params.tabIndex || 0
  });
}

function createDocument_(params) {
  return enqueueCommand_('createDocument', {
    title: params.title
  });
}

// ── Async Text Operations ──────────────────────────────────────────────────────

function insertText_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  return enqueueCommand_('insertText', {
    googleDocumentId: gdid,
    text: params.text,
    index: params.index
  });
}

function deleteContent_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  return enqueueCommand_('deleteContent', {
    googleDocumentId: gdid,
    startIndex: params.startIndex,
    endIndex: params.endIndex
  });
}

function replaceAllText_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  return enqueueCommand_('replaceAllText', {
    googleDocumentId: gdid,
    find: params.find,
    replacement: params.replacement,
    matchCase: params.matchCase || false
  });
}

// ── Async Formatting ───────────────────────────────────────────────────────────

function updateTextStyle_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  var style = {};
  if (params.bold !== undefined) style.bold = params.bold;
  if (params.italic !== undefined) style.italic = params.italic;
  if (params.underline !== undefined) style.underline = params.underline;
  if (params.strikethrough !== undefined) style.strikethrough = params.strikethrough;
  if (params.fontSize !== undefined) style.fontSize = params.fontSize;
  if (params.fontFamily !== undefined) style.fontFamily = params.fontFamily;
  if (params.foregroundColor !== undefined) style.foregroundColor = params.foregroundColor;
  if (params.backgroundColor !== undefined) style.backgroundColor = params.backgroundColor;
  if (params.link !== undefined) style.link = params.link;
  return enqueueCommand_('updateTextStyle', {
    googleDocumentId: gdid,
    startIndex: params.startIndex,
    endIndex: params.endIndex,
    style: style
  });
}

function updateParagraphStyle_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  var style = {};
  if (params.namedStyleType !== undefined) style.namedStyleType = params.namedStyleType;
  if (params.alignment !== undefined) style.alignment = params.alignment;
  if (params.lineSpacing !== undefined) style.lineSpacing = params.lineSpacing;
  if (params.spaceAbove !== undefined) style.spaceAbove = params.spaceAbove;
  if (params.spaceBelow !== undefined) style.spaceBelow = params.spaceBelow;
  if (params.indentFirstLine !== undefined) style.indentFirstLine = params.indentFirstLine;
  if (params.indentStart !== undefined) style.indentStart = params.indentStart;
  if (params.indentEnd !== undefined) style.indentEnd = params.indentEnd;
  return enqueueCommand_('updateParagraphStyle', {
    googleDocumentId: gdid,
    startIndex: params.startIndex,
    endIndex: params.endIndex,
    style: style
  });
}

// ── Async Lists ────────────────────────────────────────────────────────────────

function createBullets_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  return enqueueCommand_('createBullets', {
    googleDocumentId: gdid,
    startIndex: params.startIndex,
    endIndex: params.endIndex,
    bulletPreset: params.bulletPreset || 'BULLET_DISC_CIRCLE_SQUARE'
  });
}

function deleteBullets_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  return enqueueCommand_('deleteBullets', {
    googleDocumentId: gdid,
    startIndex: params.startIndex,
    endIndex: params.endIndex
  });
}

// ── Async Tables ───────────────────────────────────────────────────────────────

function insertTable_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  return enqueueCommand_('insertTable', {
    googleDocumentId: gdid,
    rows: params.rows,
    columns: params.columns,
    index: params.index
  });
}

function insertTableRow_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  return enqueueCommand_('insertTableRow', {
    googleDocumentId: gdid,
    tableStartIndex: params.tableStartIndex,
    rowIndex: params.rowIndex,
    insertBelow: params.insertBelow !== undefined ? params.insertBelow : true
  });
}

function insertTableColumn_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  return enqueueCommand_('insertTableColumn', {
    googleDocumentId: gdid,
    tableStartIndex: params.tableStartIndex,
    columnIndex: params.columnIndex,
    insertRight: params.insertRight !== undefined ? params.insertRight : true
  });
}

function deleteTableRow_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  return enqueueCommand_('deleteTableRow', {
    googleDocumentId: gdid,
    tableStartIndex: params.tableStartIndex,
    rowIndex: params.rowIndex
  });
}

function deleteTableColumn_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  return enqueueCommand_('deleteTableColumn', {
    googleDocumentId: gdid,
    tableStartIndex: params.tableStartIndex,
    columnIndex: params.columnIndex
  });
}

function mergeTableCells_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  return enqueueCommand_('mergeTableCells', {
    googleDocumentId: gdid,
    tableStartIndex: params.tableStartIndex,
    rowIndex: params.rowIndex,
    columnIndex: params.columnIndex,
    rowSpan: params.rowSpan,
    columnSpan: params.columnSpan
  });
}

function unmergeTableCells_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  return enqueueCommand_('unmergeTableCells', {
    googleDocumentId: gdid,
    tableStartIndex: params.tableStartIndex,
    rowIndex: params.rowIndex,
    columnIndex: params.columnIndex,
    rowSpan: params.rowSpan,
    columnSpan: params.columnSpan
  });
}

function updateTableColumnProperties_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  return enqueueCommand_('updateTableColumnProperties', {
    googleDocumentId: gdid,
    tableStartIndex: params.tableStartIndex,
    columnIndex: params.columnIndex,
    widthMagnitude: params.widthMagnitude || '',
    widthUnit: params.widthUnit || 'PT'
  });
}

function updateTableRowStyle_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  return enqueueCommand_('updateTableRowStyle', {
    googleDocumentId: gdid,
    tableStartIndex: params.tableStartIndex,
    rowIndex: params.rowIndex,
    minRowHeight: params.minRowHeight || '',
    heightUnit: params.heightUnit || 'PT'
  });
}

function updateTableCellStyle_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  var style = {};
  if (params.backgroundColor !== undefined) style.backgroundColor = params.backgroundColor;
  if (params.borderLeft !== undefined) style.borderLeft = params.borderLeft;
  if (params.borderRight !== undefined) style.borderRight = params.borderRight;
  if (params.borderTop !== undefined) style.borderTop = params.borderTop;
  if (params.borderBottom !== undefined) style.borderBottom = params.borderBottom;
  if (params.paddingLeft !== undefined) style.paddingLeft = params.paddingLeft;
  if (params.paddingRight !== undefined) style.paddingRight = params.paddingRight;
  if (params.paddingTop !== undefined) style.paddingTop = params.paddingTop;
  if (params.paddingBottom !== undefined) style.paddingBottom = params.paddingBottom;
  if (params.contentAlignment !== undefined) style.contentAlignment = params.contentAlignment;
  return enqueueCommand_('updateTableCellStyle', {
    googleDocumentId: gdid,
    tableStartIndex: params.tableStartIndex,
    rowIndex: params.rowIndex,
    columnIndex: params.columnIndex,
    style: style
  });
}

function pinTableHeaderRows_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  return enqueueCommand_('pinTableHeaderRows', {
    googleDocumentId: gdid,
    tableStartIndex: params.tableStartIndex,
    pinnedHeaderRowCount: params.pinnedHeaderRowCount
  });
}

// ── Async Images ───────────────────────────────────────────────────────────────

function insertInlineImage_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  return enqueueCommand_('insertInlineImage', {
    googleDocumentId: gdid,
    imageUrl: params.imageUrl,
    index: params.index,
    widthMagnitude: params.widthMagnitude || '',
    widthUnit: params.widthUnit || 'PT',
    heightMagnitude: params.heightMagnitude || '',
    heightUnit: params.heightUnit || 'PT'
  });
}

// ── Async Structure ────────────────────────────────────────────────────────────

function insertPageBreak_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  return enqueueCommand_('insertPageBreak', {
    googleDocumentId: gdid,
    index: params.index
  });
}

function insertSectionBreak_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  return enqueueCommand_('insertSectionBreak', {
    googleDocumentId: gdid,
    index: params.index,
    sectionType: params.sectionType || 'NEXT_PAGE'
  });
}

function createHeader_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  return enqueueCommand_('createHeader', {
    googleDocumentId: gdid,
    sectionType: params.sectionType || 'DEFAULT'
  });
}

function createFooter_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  return enqueueCommand_('createFooter', {
    googleDocumentId: gdid,
    sectionType: params.sectionType || 'DEFAULT'
  });
}

function deleteHeader_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  return enqueueCommand_('deleteHeader', {
    googleDocumentId: gdid,
    headerId: params.headerId
  });
}

function deleteFooter_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  return enqueueCommand_('deleteFooter', {
    googleDocumentId: gdid,
    footerId: params.footerId
  });
}

function createFootnote_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  return enqueueCommand_('createFootnote', {
    googleDocumentId: gdid,
    index: params.index
  });
}

// ── Async Named Ranges ─────────────────────────────────────────────────────────

function createNamedRange_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  return enqueueCommand_('createNamedRange', {
    googleDocumentId: gdid,
    name: params.name,
    startIndex: params.startIndex,
    endIndex: params.endIndex
  });
}

function deleteNamedRange_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  return enqueueCommand_('deleteNamedRange', {
    googleDocumentId: gdid,
    namedRangeId: params.namedRangeId || '',
    name: params.name || ''
  });
}

function replaceNamedRangeContent_(params) {
  var gdid = resolveGoogleDocumentId_(params.documentId);
  if (!gdid) return { error: 'Document not found. Use resolveDocument first.' };
  return enqueueCommand_('replaceNamedRangeContent', {
    googleDocumentId: gdid,
    name: params.name,
    text: params.text
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
