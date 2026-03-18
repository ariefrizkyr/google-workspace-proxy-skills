// WorkSync.gs — Work Email Apps Script (Sync Engine)
// Runs autonomously on the work email account via 1-minute time-based trigger.
// Processes CommandQueue and refreshes tracked document metadata via Docs API v1.
// Requires: Docs API (Advanced Service) enabled in Apps Script editor.

// ── Configuration ──────────────────────────────────────────────────────────────

var SYNC_CONFIG = {
  SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID_HERE',
  BATCH_LIMIT: 20,
  LOCK_TIMEOUT_MS: 5 * 60 * 1000,       // 5 minutes
  EXECUTION_TIMEOUT_MS: 4 * 60 * 1000,   // 4 minutes (Apps Script limit is 6)
  CLEANUP_DAYS: 7,
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
    // Phase 1: Refresh tracked document metadata
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

// ── Phase 1: Refresh Tracked Document Metadata ─────────────────────────────────

function refreshMetadata_(startTime) {
  var sheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.TRACKED_DOCUMENTS);
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;

  for (var i = 1; i < data.length; i++) {
    if (isTimedOut_(startTime)) break;

    var googleDocumentId = data[i][TDC.GOOGLE_DOCUMENT_ID];
    if (!googleDocumentId) continue;

    try {
      var docInfo = Docs.Documents.get(googleDocumentId, {
        fields: 'title,tabs.tabProperties'
      });

      var rowNum = i + 1;
      var ts = new Date().toISOString();

      sheet.getRange(rowNum, TDC.TITLE + 1).setValue(docInfo.title || '');
      sheet.getRange(rowNum, TDC.TAB_COUNT + 1).setValue(docInfo.tabs ? docInfo.tabs.length : 1);
      sheet.getRange(rowNum, TDC.MODIFIED_TIME + 1).setValue(ts);
    } catch (err) {
      Logger.log('Error refreshing metadata for ' + googleDocumentId + ': ' + err.message);
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
  // Document management
  if (action === 'resolveDocument') return processResolveDocument_(params);
  if (action === 'getDocument') return processGetDocument_(params);
  if (action === 'getDocumentContent') return processGetDocumentContent_(params);
  if (action === 'createDocument') return processCreateDocument_(params);

  // Text operations
  if (action === 'insertText') return processInsertText_(params);
  if (action === 'deleteContent') return processDeleteContent_(params);
  if (action === 'replaceAllText') return processReplaceAllText_(params);

  // Formatting
  if (action === 'updateTextStyle') return processUpdateTextStyle_(params);
  if (action === 'updateParagraphStyle') return processUpdateParagraphStyle_(params);

  // Lists
  if (action === 'createBullets') return processCreateBullets_(params);
  if (action === 'deleteBullets') return processDeleteBullets_(params);

  // Tables
  if (action === 'insertTable') return processInsertTable_(params);
  if (action === 'insertTableRow') return processInsertTableRow_(params);
  if (action === 'insertTableColumn') return processInsertTableColumn_(params);
  if (action === 'deleteTableRow') return processDeleteTableRow_(params);
  if (action === 'deleteTableColumn') return processDeleteTableColumn_(params);
  if (action === 'mergeTableCells') return processMergeTableCells_(params);
  if (action === 'unmergeTableCells') return processUnmergeTableCells_(params);
  if (action === 'updateTableColumnProperties') return processUpdateTableColumnProperties_(params);
  if (action === 'updateTableRowStyle') return processUpdateTableRowStyle_(params);
  if (action === 'updateTableCellStyle') return processUpdateTableCellStyle_(params);
  if (action === 'pinTableHeaderRows') return processPinTableHeaderRows_(params);

  // Images
  if (action === 'insertInlineImage') return processInsertInlineImage_(params);

  // Structure
  if (action === 'insertPageBreak') return processInsertPageBreak_(params);
  if (action === 'insertSectionBreak') return processInsertSectionBreak_(params);
  if (action === 'createHeader') return processCreateHeader_(params);
  if (action === 'createFooter') return processCreateFooter_(params);
  if (action === 'deleteHeader') return processDeleteHeader_(params);
  if (action === 'deleteFooter') return processDeleteFooter_(params);
  if (action === 'createFootnote') return processCreateFootnote_(params);

  // Named ranges
  if (action === 'createNamedRange') return processCreateNamedRange_(params);
  if (action === 'deleteNamedRange') return processDeleteNamedRange_(params);
  if (action === 'replaceNamedRangeContent') return processReplaceNamedRangeContent_(params);

  // Utility
  if (action === 'syncNow') return { message: 'Sync triggered' };

  throw new Error('Unknown command: ' + action);
}

// ── Document Management ────────────────────────────────────────────────────────

function processResolveDocument_(params) {
  var googleDocumentId = params.googleDocumentId;

  // Try to access via Docs API (work email has access)
  var docInfo = Docs.Documents.get(googleDocumentId, {
    fields: 'title,documentId,tabs.tabProperties'
  });

  var docUrl = 'https://docs.google.com/document/d/' + googleDocumentId + '/edit';
  var tabCount = docInfo.tabs ? docInfo.tabs.length : 1;

  // Upsert into TrackedDocuments
  var tdcSheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.TRACKED_DOCUMENTS);
  var tdcData = tdcSheet.getDataRange().getValues();
  var trackingId = '';
  var ts = new Date().toISOString();

  // Check if already tracked
  for (var i = 1; i < tdcData.length; i++) {
    if (String(tdcData[i][TDC.GOOGLE_DOCUMENT_ID]) === String(googleDocumentId)) {
      trackingId = tdcData[i][TDC.TRACKING_ID];
      var rowNum = i + 1;
      tdcSheet.getRange(rowNum, TDC.TITLE + 1).setValue(docInfo.title || '');
      tdcSheet.getRange(rowNum, TDC.URL + 1).setValue(docUrl);
      tdcSheet.getRange(rowNum, TDC.TAB_COUNT + 1).setValue(tabCount);
      tdcSheet.getRange(rowNum, TDC.MODIFIED_TIME + 1).setValue(ts);
      tdcSheet.getRange(rowNum, TDC.LAST_ACCESSED + 1).setValue(ts);
      if (params.driveFileId) tdcSheet.getRange(rowNum, TDC.DRIVE_FILE_ID + 1).setValue(params.driveFileId);
      break;
    }
  }

  // Insert new row if not tracked
  if (!trackingId) {
    trackingId = Utilities.getUuid();
    tdcSheet.appendRow([
      trackingId,                       // A: trackingId
      googleDocumentId,                 // B: googleDocumentId
      docInfo.title || '',              // C: title
      docUrl,                           // D: url
      '',                               // E: owner
      tabCount,                         // F: tabCount
      '',                               // G: createdTime
      ts,                               // H: modifiedTime
      ts,                               // I: trackedAt
      ts,                               // J: lastAccessed
      params.driveFileId || '',         // K: driveFileId
      ''                                // L: extraJson
    ]);
  }

  return {
    documentId: trackingId,
    title: docInfo.title || '',
    url: docUrl,
    tabCount: tabCount,
    trackedAt: ts,
    lastAccessed: ts,
    kind: 'docs#document'
  };
}

function processGetDocument_(params) {
  var docInfo = Docs.Documents.get(params.googleDocumentId, {
    fields: 'title,documentId,tabs.tabProperties,tabs.documentTab.headers,tabs.documentTab.footers,tabs.documentTab.footnotes,tabs.documentTab.namedRanges'
  });

  var tabs = (docInfo.tabs || []).map(function(tab, idx) {
    var props = tab.tabProperties || {};
    return {
      tabId: props.tabId || '',
      title: props.title || ('Tab ' + (idx + 1)),
      index: idx
    };
  });

  // Extract headers, footers, namedRanges from the first tab (primary)
  var firstTab = (docInfo.tabs && docInfo.tabs.length > 0) ? docInfo.tabs[0].documentTab || {} : {};
  var headerIds = firstTab.headers ? Object.keys(firstTab.headers) : [];
  var footerIds = firstTab.footers ? Object.keys(firstTab.footers) : [];
  var namedRanges = firstTab.namedRanges ? Object.keys(firstTab.namedRanges).map(function(name) {
    var nr = firstTab.namedRanges[name];
    return {
      name: name,
      ranges: (nr.namedRanges || []).map(function(r) {
        return { namedRangeId: r.namedRangeId };
      })
    };
  }) : [];

  return {
    documentId: params.trackingId || '',
    title: docInfo.title || '',
    url: 'https://docs.google.com/document/d/' + params.googleDocumentId + '/edit',
    tabs: tabs,
    headerIds: headerIds,
    footerIds: footerIds,
    namedRanges: namedRanges,
    kind: 'docs#document'
  };
}

function processGetDocumentContent_(params) {
  // Use includeTabsContent to get tab-aware response (avoids legacy field conflict)
  var docInfo = Docs.Documents.get(params.googleDocumentId, {
    includeTabsContent: true
  });
  var tabIndex = params.tabIndex || 0;

  var tabs = docInfo.tabs || [];
  if (tabIndex >= tabs.length) {
    return { error: 'Tab index ' + tabIndex + ' out of range. Document has ' + tabs.length + ' tab(s).' };
  }

  var tab = tabs[tabIndex];
  var body = (tab.documentTab && tab.documentTab.body) ? tab.documentTab.body : {};
  var elements = flattenContent_(body);

  // Truncate at 50K chars for the result JSON
  var resultJson = JSON.stringify(elements);
  var truncated = false;
  if (resultJson.length > 50000) {
    // Trim elements until under limit
    while (elements.length > 0 && JSON.stringify(elements).length > 48000) {
      elements.pop();
      truncated = true;
    }
  }

  return {
    documentId: params.trackingId || '',
    tabIndex: tabIndex,
    elements: elements,
    elementCount: elements.length,
    truncated: truncated,
    kind: 'docs#documentContent'
  };
}

// ── Content Flattener ──────────────────────────────────────────────────────────

function flattenContent_(body) {
  var elements = [];
  var content = body.content || [];

  for (var i = 0; i < content.length; i++) {
    var el = content[i];

    if (el.paragraph) {
      var para = el.paragraph;
      var paraStyle = para.paragraphStyle || {};

      for (var j = 0; j < (para.elements || []).length; j++) {
        var pe = para.elements[j];

        if (pe.textRun) {
          elements.push({
            type: 'text',
            startIndex: pe.startIndex || 0,
            endIndex: pe.endIndex || 0,
            text: pe.textRun.content || '',
            style: {
              bold: pe.textRun.textStyle ? pe.textRun.textStyle.bold || false : false,
              italic: pe.textRun.textStyle ? pe.textRun.textStyle.italic || false : false,
              underline: pe.textRun.textStyle ? pe.textRun.textStyle.underline || false : false,
              fontSize: pe.textRun.textStyle && pe.textRun.textStyle.fontSize ? pe.textRun.textStyle.fontSize.magnitude : null,
              fontFamily: pe.textRun.textStyle ? pe.textRun.textStyle.fontFamily || null : null,
              namedStyleType: paraStyle.namedStyleType || 'NORMAL_TEXT',
              link: pe.textRun.textStyle && pe.textRun.textStyle.link ? pe.textRun.textStyle.link.url || '' : ''
            }
          });
        } else if (pe.inlineObjectElement) {
          elements.push({
            type: 'inlineImage',
            startIndex: pe.startIndex || 0,
            endIndex: pe.endIndex || 0,
            text: '',
            style: { objectId: pe.inlineObjectElement.inlineObjectId || '' }
          });
        } else if (pe.pageBreak) {
          elements.push({
            type: 'pageBreak',
            startIndex: pe.startIndex || 0,
            endIndex: pe.endIndex || 0,
            text: '',
            style: {}
          });
        } else if (pe.footnoteReference) {
          elements.push({
            type: 'footnoteReference',
            startIndex: pe.startIndex || 0,
            endIndex: pe.endIndex || 0,
            text: '',
            style: { footnoteId: pe.footnoteReference.footnoteId || '' }
          });
        }
      }

      // Add bullet info if present
      if (para.bullet) {
        var firstEl = elements.length > 0 ? elements[elements.length - 1] : null;
        if (firstEl && firstEl.startIndex >= (el.startIndex || 0)) {
          firstEl.style.bullet = true;
          firstEl.style.nestingLevel = para.bullet.nestingLevel || 0;
        }
      }

    } else if (el.table) {
      elements.push({
        type: 'table',
        startIndex: el.startIndex || 0,
        endIndex: el.endIndex || 0,
        text: '',
        style: {
          rows: el.table.rows || 0,
          columns: el.table.columns || 0
        }
      });

      // Flatten table cell content
      var rows = el.table.tableRows || [];
      for (var ri = 0; ri < rows.length; ri++) {
        var cells = rows[ri].tableCells || [];
        for (var ci = 0; ci < cells.length; ci++) {
          var cellContent = cells[ci].content || [];
          for (var cci = 0; cci < cellContent.length; cci++) {
            var cellEl = cellContent[cci];
            if (cellEl.paragraph) {
              var cellPara = cellEl.paragraph;
              for (var cj = 0; cj < (cellPara.elements || []).length; cj++) {
                var cpe = cellPara.elements[cj];
                if (cpe.textRun) {
                  elements.push({
                    type: 'tableCell',
                    startIndex: cpe.startIndex || 0,
                    endIndex: cpe.endIndex || 0,
                    text: cpe.textRun.content || '',
                    style: {
                      row: ri,
                      column: ci,
                      tableStartIndex: el.startIndex || 0
                    }
                  });
                }
              }
            }
          }
        }
      }

    } else if (el.sectionBreak) {
      elements.push({
        type: 'sectionBreak',
        startIndex: el.startIndex || 0,
        endIndex: el.endIndex || 0,
        text: '',
        style: { sectionType: el.sectionBreak.sectionStyle ? el.sectionBreak.sectionStyle.sectionType || '' : '' }
      });
    } else if (el.tableOfContents) {
      elements.push({
        type: 'tableOfContents',
        startIndex: el.startIndex || 0,
        endIndex: el.endIndex || 0,
        text: '',
        style: {}
      });
    }
  }

  return elements;
}

function processCreateDocument_(params) {
  var doc = Docs.Documents.create({ title: params.title });

  // Insert into TrackedDocuments
  var tdcSheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.TRACKED_DOCUMENTS);
  var trackingId = Utilities.getUuid();
  var ts = new Date().toISOString();
  var docUrl = 'https://docs.google.com/document/d/' + doc.documentId + '/edit';

  tdcSheet.appendRow([
    trackingId,          // A: trackingId
    doc.documentId,      // B: googleDocumentId
    params.title,        // C: title
    docUrl,              // D: url
    '',                  // E: owner
    1,                   // F: tabCount
    ts,                  // G: createdTime
    ts,                  // H: modifiedTime
    ts,                  // I: trackedAt
    ts,                  // J: lastAccessed
    '',                  // K: driveFileId
    ''                   // L: extraJson
  ]);

  return {
    documentId: trackingId,
    googleDocumentId: doc.documentId,
    title: params.title,
    url: docUrl,
    kind: 'docs#document'
  };
}

// ── Text Operations ────────────────────────────────────────────────────────────

function processInsertText_(params) {
  Docs.Documents.batchUpdate({
    requests: [{
      insertText: {
        location: { index: params.index },
        text: params.text
      }
    }]
  }, params.googleDocumentId);
  return { success: true, index: params.index, textLength: params.text.length };
}

function processDeleteContent_(params) {
  Docs.Documents.batchUpdate({
    requests: [{
      deleteContentRange: {
        range: {
          startIndex: params.startIndex,
          endIndex: params.endIndex
        }
      }
    }]
  }, params.googleDocumentId);
  return { success: true, startIndex: params.startIndex, endIndex: params.endIndex };
}

function processReplaceAllText_(params) {
  var response = Docs.Documents.batchUpdate({
    requests: [{
      replaceAllText: {
        containsText: {
          text: params.find,
          matchCase: params.matchCase || false
        },
        replaceText: params.replacement
      }
    }]
  }, params.googleDocumentId);
  var reply = response.replies[0].replaceAllText;
  return {
    success: true,
    occurrencesChanged: reply ? reply.occurrencesChanged || 0 : 0
  };
}

// ── Formatting ─────────────────────────────────────────────────────────────────

function processUpdateTextStyle_(params) {
  var textStyle = {};
  var fields = [];
  var style = params.style;

  if (style.bold !== undefined) { textStyle.bold = style.bold; fields.push('bold'); }
  if (style.italic !== undefined) { textStyle.italic = style.italic; fields.push('italic'); }
  if (style.underline !== undefined) { textStyle.underline = style.underline; fields.push('underline'); }
  if (style.strikethrough !== undefined) { textStyle.strikethrough = style.strikethrough; fields.push('strikethrough'); }
  if (style.fontSize !== undefined) {
    textStyle.fontSize = { magnitude: style.fontSize, unit: 'PT' };
    fields.push('fontSize');
  }
  if (style.fontFamily !== undefined) {
    textStyle.weightedFontFamily = { fontFamily: style.fontFamily };
    fields.push('weightedFontFamily');
  }
  if (style.foregroundColor !== undefined) {
    textStyle.foregroundColor = { color: { rgbColor: style.foregroundColor } };
    fields.push('foregroundColor');
  }
  if (style.backgroundColor !== undefined) {
    textStyle.backgroundColor = { color: { rgbColor: style.backgroundColor } };
    fields.push('backgroundColor');
  }
  if (style.link !== undefined) {
    textStyle.link = { url: style.link };
    fields.push('link');
  }

  Docs.Documents.batchUpdate({
    requests: [{
      updateTextStyle: {
        range: {
          startIndex: params.startIndex,
          endIndex: params.endIndex
        },
        textStyle: textStyle,
        fields: fields.join(',')
      }
    }]
  }, params.googleDocumentId);
  return { success: true, startIndex: params.startIndex, endIndex: params.endIndex };
}

function processUpdateParagraphStyle_(params) {
  var paragraphStyle = {};
  var fields = [];
  var style = params.style;

  if (style.namedStyleType !== undefined) {
    paragraphStyle.namedStyleType = style.namedStyleType;
    fields.push('namedStyleType');
  }
  if (style.alignment !== undefined) {
    paragraphStyle.alignment = style.alignment;
    fields.push('alignment');
  }
  if (style.lineSpacing !== undefined) {
    paragraphStyle.lineSpacing = style.lineSpacing;
    fields.push('lineSpacing');
  }
  if (style.spaceAbove !== undefined) {
    paragraphStyle.spaceAbove = { magnitude: style.spaceAbove, unit: 'PT' };
    fields.push('spaceAbove');
  }
  if (style.spaceBelow !== undefined) {
    paragraphStyle.spaceBelow = { magnitude: style.spaceBelow, unit: 'PT' };
    fields.push('spaceBelow');
  }
  if (style.indentFirstLine !== undefined) {
    paragraphStyle.indentFirstLine = { magnitude: style.indentFirstLine, unit: 'PT' };
    fields.push('indentFirstLine');
  }
  if (style.indentStart !== undefined) {
    paragraphStyle.indentStart = { magnitude: style.indentStart, unit: 'PT' };
    fields.push('indentStart');
  }
  if (style.indentEnd !== undefined) {
    paragraphStyle.indentEnd = { magnitude: style.indentEnd, unit: 'PT' };
    fields.push('indentEnd');
  }

  Docs.Documents.batchUpdate({
    requests: [{
      updateParagraphStyle: {
        range: {
          startIndex: params.startIndex,
          endIndex: params.endIndex
        },
        paragraphStyle: paragraphStyle,
        fields: fields.join(',')
      }
    }]
  }, params.googleDocumentId);
  return { success: true, startIndex: params.startIndex, endIndex: params.endIndex };
}

// ── Lists ──────────────────────────────────────────────────────────────────────

function processCreateBullets_(params) {
  Docs.Documents.batchUpdate({
    requests: [{
      createParagraphBullets: {
        range: {
          startIndex: params.startIndex,
          endIndex: params.endIndex
        },
        bulletPreset: params.bulletPreset || 'BULLET_DISC_CIRCLE_SQUARE'
      }
    }]
  }, params.googleDocumentId);
  return { success: true, startIndex: params.startIndex, endIndex: params.endIndex };
}

function processDeleteBullets_(params) {
  Docs.Documents.batchUpdate({
    requests: [{
      deleteParagraphBullets: {
        range: {
          startIndex: params.startIndex,
          endIndex: params.endIndex
        }
      }
    }]
  }, params.googleDocumentId);
  return { success: true, startIndex: params.startIndex, endIndex: params.endIndex };
}

// ── Tables ─────────────────────────────────────────────────────────────────────

function processInsertTable_(params) {
  Docs.Documents.batchUpdate({
    requests: [{
      insertTable: {
        rows: params.rows,
        columns: params.columns,
        location: { index: params.index }
      }
    }]
  }, params.googleDocumentId);
  return { success: true, rows: params.rows, columns: params.columns, index: params.index };
}

function processInsertTableRow_(params) {
  Docs.Documents.batchUpdate({
    requests: [{
      insertTableRow: {
        tableCellLocation: {
          tableStartLocation: { index: params.tableStartIndex },
          rowIndex: params.rowIndex,
          columnIndex: 0
        },
        insertBelow: params.insertBelow !== undefined ? params.insertBelow : true
      }
    }]
  }, params.googleDocumentId);
  return { success: true, tableStartIndex: params.tableStartIndex, rowIndex: params.rowIndex };
}

function processInsertTableColumn_(params) {
  Docs.Documents.batchUpdate({
    requests: [{
      insertTableColumn: {
        tableCellLocation: {
          tableStartLocation: { index: params.tableStartIndex },
          rowIndex: 0,
          columnIndex: params.columnIndex
        },
        insertRight: params.insertRight !== undefined ? params.insertRight : true
      }
    }]
  }, params.googleDocumentId);
  return { success: true, tableStartIndex: params.tableStartIndex, columnIndex: params.columnIndex };
}

function processDeleteTableRow_(params) {
  Docs.Documents.batchUpdate({
    requests: [{
      deleteTableRow: {
        tableCellLocation: {
          tableStartLocation: { index: params.tableStartIndex },
          rowIndex: params.rowIndex,
          columnIndex: 0
        }
      }
    }]
  }, params.googleDocumentId);
  return { success: true, tableStartIndex: params.tableStartIndex, rowIndex: params.rowIndex };
}

function processDeleteTableColumn_(params) {
  Docs.Documents.batchUpdate({
    requests: [{
      deleteTableColumn: {
        tableCellLocation: {
          tableStartLocation: { index: params.tableStartIndex },
          rowIndex: 0,
          columnIndex: params.columnIndex
        }
      }
    }]
  }, params.googleDocumentId);
  return { success: true, tableStartIndex: params.tableStartIndex, columnIndex: params.columnIndex };
}

function processMergeTableCells_(params) {
  Docs.Documents.batchUpdate({
    requests: [{
      mergeTableCells: {
        tableRange: {
          tableCellLocation: {
            tableStartLocation: { index: params.tableStartIndex },
            rowIndex: params.rowIndex,
            columnIndex: params.columnIndex
          },
          rowSpan: params.rowSpan,
          columnSpan: params.columnSpan
        }
      }
    }]
  }, params.googleDocumentId);
  return { success: true };
}

function processUnmergeTableCells_(params) {
  Docs.Documents.batchUpdate({
    requests: [{
      unmergeTableCells: {
        tableRange: {
          tableCellLocation: {
            tableStartLocation: { index: params.tableStartIndex },
            rowIndex: params.rowIndex,
            columnIndex: params.columnIndex
          },
          rowSpan: params.rowSpan,
          columnSpan: params.columnSpan
        }
      }
    }]
  }, params.googleDocumentId);
  return { success: true };
}

function processUpdateTableColumnProperties_(params) {
  var properties = {};
  var fields = [];

  if (params.widthMagnitude) {
    properties.width = { magnitude: params.widthMagnitude, unit: params.widthUnit || 'PT' };
    fields.push('width');
  }

  Docs.Documents.batchUpdate({
    requests: [{
      updateTableColumnProperties: {
        tableStartLocation: { index: params.tableStartIndex },
        columnIndices: [params.columnIndex],
        tableColumnProperties: properties,
        fields: fields.join(',')
      }
    }]
  }, params.googleDocumentId);
  return { success: true, tableStartIndex: params.tableStartIndex, columnIndex: params.columnIndex };
}

function processUpdateTableRowStyle_(params) {
  var style = {};
  var fields = [];

  if (params.minRowHeight) {
    style.minRowHeight = { magnitude: params.minRowHeight, unit: params.heightUnit || 'PT' };
    fields.push('minRowHeight');
  }

  Docs.Documents.batchUpdate({
    requests: [{
      updateTableRowStyle: {
        tableStartLocation: { index: params.tableStartIndex },
        rowIndices: [params.rowIndex],
        tableRowStyle: style,
        fields: fields.join(',')
      }
    }]
  }, params.googleDocumentId);
  return { success: true, tableStartIndex: params.tableStartIndex, rowIndex: params.rowIndex };
}

function processUpdateTableCellStyle_(params) {
  var cellStyle = {};
  var fields = [];
  var style = params.style;

  if (style.backgroundColor !== undefined) {
    cellStyle.backgroundColor = { color: { rgbColor: style.backgroundColor } };
    fields.push('backgroundColor');
  }
  if (style.borderLeft !== undefined) {
    cellStyle.borderLeft = buildTableBorder_(style.borderLeft);
    fields.push('borderLeft');
  }
  if (style.borderRight !== undefined) {
    cellStyle.borderRight = buildTableBorder_(style.borderRight);
    fields.push('borderRight');
  }
  if (style.borderTop !== undefined) {
    cellStyle.borderTop = buildTableBorder_(style.borderTop);
    fields.push('borderTop');
  }
  if (style.borderBottom !== undefined) {
    cellStyle.borderBottom = buildTableBorder_(style.borderBottom);
    fields.push('borderBottom');
  }
  if (style.paddingLeft !== undefined) {
    cellStyle.paddingLeft = { magnitude: style.paddingLeft, unit: 'PT' };
    fields.push('paddingLeft');
  }
  if (style.paddingRight !== undefined) {
    cellStyle.paddingRight = { magnitude: style.paddingRight, unit: 'PT' };
    fields.push('paddingRight');
  }
  if (style.paddingTop !== undefined) {
    cellStyle.paddingTop = { magnitude: style.paddingTop, unit: 'PT' };
    fields.push('paddingTop');
  }
  if (style.paddingBottom !== undefined) {
    cellStyle.paddingBottom = { magnitude: style.paddingBottom, unit: 'PT' };
    fields.push('paddingBottom');
  }
  if (style.contentAlignment !== undefined) {
    cellStyle.contentAlignment = style.contentAlignment;
    fields.push('contentAlignment');
  }

  Docs.Documents.batchUpdate({
    requests: [{
      updateTableCellStyle: {
        tableRange: {
          tableCellLocation: {
            tableStartLocation: { index: params.tableStartIndex },
            rowIndex: params.rowIndex,
            columnIndex: params.columnIndex
          },
          rowSpan: 1,
          columnSpan: 1
        },
        tableCellStyle: cellStyle,
        fields: fields.join(',')
      }
    }]
  }, params.googleDocumentId);
  return { success: true };
}

function buildTableBorder_(border) {
  var b = {
    width: { magnitude: border.width || 1, unit: 'PT' },
    dashStyle: border.dashStyle || 'SOLID'
  };
  if (border.color) {
    b.color = { color: { rgbColor: border.color } };
  }
  return b;
}

function processPinTableHeaderRows_(params) {
  Docs.Documents.batchUpdate({
    requests: [{
      pinTableHeaderRows: {
        tableStartLocation: { index: params.tableStartIndex },
        pinnedHeaderRowsCount: params.pinnedHeaderRowCount
      }
    }]
  }, params.googleDocumentId);
  return { success: true, tableStartIndex: params.tableStartIndex, pinnedHeaderRowCount: params.pinnedHeaderRowCount };
}

// ── Images ─────────────────────────────────────────────────────────────────────

function processInsertInlineImage_(params) {
  var request = {
    insertInlineImage: {
      uri: params.imageUrl,
      location: { index: params.index }
    }
  };

  if (params.widthMagnitude && params.heightMagnitude) {
    request.insertInlineImage.objectSize = {
      width: { magnitude: params.widthMagnitude, unit: params.widthUnit || 'PT' },
      height: { magnitude: params.heightMagnitude, unit: params.heightUnit || 'PT' }
    };
  }

  Docs.Documents.batchUpdate({
    requests: [request]
  }, params.googleDocumentId);
  return { success: true, index: params.index };
}

// ── Structure ──────────────────────────────────────────────────────────────────

function processInsertPageBreak_(params) {
  Docs.Documents.batchUpdate({
    requests: [{
      insertPageBreak: {
        location: { index: params.index }
      }
    }]
  }, params.googleDocumentId);
  return { success: true, index: params.index };
}

function processInsertSectionBreak_(params) {
  Docs.Documents.batchUpdate({
    requests: [{
      insertSectionBreak: {
        location: { index: params.index },
        sectionType: params.sectionType || 'NEXT_PAGE'
      }
    }]
  }, params.googleDocumentId);
  return { success: true, index: params.index };
}

function processCreateHeader_(params) {
  var response = Docs.Documents.batchUpdate({
    requests: [{
      createHeader: {
        type: params.sectionType || 'DEFAULT',
        sectionBreakLocation: { index: 0 }
      }
    }]
  }, params.googleDocumentId);
  var reply = response.replies[0].createHeader;
  return { success: true, headerId: reply ? reply.headerId || '' : '' };
}

function processCreateFooter_(params) {
  var response = Docs.Documents.batchUpdate({
    requests: [{
      createFooter: {
        type: params.sectionType || 'DEFAULT',
        sectionBreakLocation: { index: 0 }
      }
    }]
  }, params.googleDocumentId);
  var reply = response.replies[0].createFooter;
  return { success: true, footerId: reply ? reply.footerId || '' : '' };
}

function processDeleteHeader_(params) {
  Docs.Documents.batchUpdate({
    requests: [{
      deleteHeader: {
        headerId: params.headerId
      }
    }]
  }, params.googleDocumentId);
  return { success: true, headerId: params.headerId };
}

function processDeleteFooter_(params) {
  Docs.Documents.batchUpdate({
    requests: [{
      deleteFooter: {
        footerId: params.footerId
      }
    }]
  }, params.googleDocumentId);
  return { success: true, footerId: params.footerId };
}

function processCreateFootnote_(params) {
  var response = Docs.Documents.batchUpdate({
    requests: [{
      createFootnote: {
        location: { index: params.index }
      }
    }]
  }, params.googleDocumentId);
  var reply = response.replies[0].createFootnote;
  return { success: true, footnoteId: reply ? reply.footnoteId || '' : '' };
}

// ── Named Ranges ───────────────────────────────────────────────────────────────

function processCreateNamedRange_(params) {
  var response = Docs.Documents.batchUpdate({
    requests: [{
      createNamedRange: {
        name: params.name,
        range: {
          startIndex: params.startIndex,
          endIndex: params.endIndex
        }
      }
    }]
  }, params.googleDocumentId);
  var reply = response.replies[0].createNamedRange;
  return { success: true, namedRangeId: reply ? reply.namedRangeId || '' : '', name: params.name };
}

function processDeleteNamedRange_(params) {
  var request = {};
  if (params.namedRangeId) {
    request.deleteNamedRange = { namedRangeId: params.namedRangeId };
  } else if (params.name) {
    request.deleteNamedRange = { name: params.name };
  } else {
    throw new Error('Provide namedRangeId or name to delete');
  }

  Docs.Documents.batchUpdate({
    requests: [request]
  }, params.googleDocumentId);
  return { success: true, namedRangeId: params.namedRangeId || '', name: params.name || '' };
}

function processReplaceNamedRangeContent_(params) {
  Docs.Documents.batchUpdate({
    requests: [{
      replaceNamedRangeContent: {
        namedRangeName: params.name,
        text: params.text
      }
    }]
  }, params.googleDocumentId);
  return { success: true, name: params.name };
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
  Logger.log('Google Docs WorkSync initialized. No initial import needed.');
  Logger.log('Documents are tracked on-demand via resolveDocument.');
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
