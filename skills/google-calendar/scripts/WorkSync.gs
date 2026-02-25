// WorkSync.gs — Work Email Apps Script (Sync Engine)
// Runs autonomously on the work email account via 1-minute time-based trigger.
// Syncs Google Spreadsheet ↔ Google Calendar API bidirectionally.
// Requires: Calendar API (Advanced Service) enabled in Apps Script editor.

// ── Configuration ──────────────────────────────────────────────────────────────

var SYNC_CONFIG = {
  SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID_HERE',
  BATCH_LIMIT: 50,
  LOCK_TIMEOUT_MS: 5 * 60 * 1000,       // 5 minutes
  EXECUTION_TIMEOUT_MS: 4 * 60 * 1000,   // 4 minutes (Apps Script limit is 6)
  CLEANUP_DAYS: 7,
  SYNC_WINDOW_PAST_DAYS: 14,
  SYNC_WINDOW_FUTURE_DAYS: 90,
  SLOT_STEP_MINUTES: 30,                  // Granularity for slot finding
  SHEET_NAMES: {
    CALENDARS: 'Calendars',
    EVENTS: 'Events',
    COMMAND_QUEUE: 'CommandQueue',
    SYNC_META: 'SyncMeta'
  }
};

// Column indices for Events sheet (0-based)
var EVT = {
  SHEET_EVENT_ID: 0,
  GOOGLE_EVENT_ID: 1,
  SHEET_CAL_ID: 2,
  GOOGLE_CAL_ID: 3,
  TITLE: 4,
  DESCRIPTION: 5,
  LOCATION: 6,
  START_TIME: 7,
  END_TIME: 8,
  IS_ALL_DAY: 9,
  STATUS: 10,
  ORGANIZER: 11,
  MY_RSVP: 12,
  ATTENDEES_JSON: 13,
  EVENT_TYPE: 14,
  COLOR: 15,
  MEET_LINK: 16,
  EXTRA_PROPS_JSON: 17,
  SYNC_STATUS: 18,
  UPDATED_AT: 19,
  SYNCED_AT: 20,
  UPDATED_BY: 21,
  GOOGLE_UPDATED: 22
};

// Column indices for Calendars sheet (0-based)
var CAL = {
  SHEET_CAL_ID: 0,
  GOOGLE_CAL_ID: 1,
  NAME: 2,
  OWNER_EMAIL: 3,
  TYPE: 4,
  COLOR: 5,
  SYNC_ENABLED: 6,
  UPDATED_AT: 7,
  SYNCED_AT: 8
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
    // Phase 1: Push pending changes to Google Calendar
    pushToGoogle_(startTime);

    // Phase 2: Pull changes from Google Calendar
    if (!isTimedOut_(startTime)) {
      pullFromGoogle_(startTime);
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

// ── Phase 1: Push to Google Calendar ───────────────────────────────────────────

function pushToGoogle_(startTime) {
  var sheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.EVENTS);
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;

  var calMap = buildCalIdMap_();
  var count = 0;

  for (var i = 1; i < data.length && count < SYNC_CONFIG.BATCH_LIMIT; i++) {
    if (isTimedOut_(startTime)) break;
    var syncStatus = data[i][EVT.SYNC_STATUS];
    if (!syncStatus || syncStatus === 'synced' || syncStatus === 'deleted') continue;

    var rowNum = i + 1;
    var sheetCalId = data[i][EVT.SHEET_CAL_ID];
    var googleCalId = data[i][EVT.GOOGLE_CAL_ID] || calMap[sheetCalId];

    // Update denormalized googleCalId if missing
    if (!data[i][EVT.GOOGLE_CAL_ID] && googleCalId) {
      sheet.getRange(rowNum, EVT.GOOGLE_CAL_ID + 1).setValue(googleCalId);
    }

    if (!googleCalId) continue; // Calendar not synced yet

    var extraProps = {};
    try { extraProps = JSON.parse(data[i][EVT.EXTRA_PROPS_JSON] || '{}'); } catch(e) {}

    try {
      if (syncStatus === 'pending_create') {
        pushCreate_(sheet, data[i], rowNum, googleCalId, extraProps);
        count++;
      } else if (syncStatus === 'pending_update') {
        pushUpdate_(sheet, data[i], rowNum, googleCalId, extraProps);
        count++;
      } else if (syncStatus === 'pending_delete') {
        pushDelete_(sheet, data[i], rowNum, googleCalId);
        count++;
      } else if (syncStatus === 'pending_rsvp') {
        pushRsvp_(sheet, data[i], rowNum, googleCalId);
        count++;
      }
    } catch (err) {
      Logger.log('Error pushing event row ' + rowNum + ': ' + err.message);
    }
  }
}

function pushCreate_(sheet, row, rowNum, googleCalId, extraProps) {
  var eventType = row[EVT.EVENT_TYPE] || 'default';
  var isAllDay = String(row[EVT.IS_ALL_DAY]) === 'true' || row[EVT.IS_ALL_DAY] === true;
  var sendNotifications = extraProps.sendNotifications !== false;

  var eventBody = {
    summary: row[EVT.TITLE] || '',
    description: row[EVT.DESCRIPTION] || '',
    location: row[EVT.LOCATION] || ''
  };

  // Set start/end based on all-day vs timed
  if (isAllDay) {
    eventBody.start = { date: row[EVT.START_TIME] };
    // For all-day events, end date is exclusive in Google Calendar API
    var endDate = row[EVT.END_TIME] || row[EVT.START_TIME];
    // If start == end, add 1 day for single all-day event
    if (endDate === row[EVT.START_TIME]) {
      var d = new Date(endDate);
      d.setDate(d.getDate() + 1);
      endDate = Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
    }
    eventBody.end = { date: endDate };
  } else {
    eventBody.start = { dateTime: row[EVT.START_TIME] };
    eventBody.end = { dateTime: row[EVT.END_TIME] };
  }

  // Event type: outOfOffice or focusTime
  if (eventType === 'outOfOffice') {
    eventBody.eventType = 'outOfOffice';
    eventBody.transparency = 'opaque';
    if (extraProps.statusProps) {
      eventBody.outOfOfficeProperties = {
        autoDeclineMode: extraProps.statusProps.autoDeclineMode || 'declineAllConflictingInvitations',
        declineMessage: extraProps.statusProps.declineMessage || ''
      };
    }
  } else if (eventType === 'focusTime') {
    eventBody.eventType = 'focusTime';
    eventBody.transparency = 'opaque';
    if (extraProps.statusProps) {
      eventBody.focusTimeProperties = {
        chatStatus: extraProps.statusProps.chatStatus || 'doNotDisturb',
        autoDeclineMode: extraProps.statusProps.autoDeclineMode || 'declineOnlyNewConflictingInvitations',
        declineMessage: extraProps.statusProps.declineMessage || ''
      };
    }
  }

  // Attendees
  if (row[EVT.ATTENDEES_JSON]) {
    try {
      var attendees = JSON.parse(row[EVT.ATTENDEES_JSON]);
      if (attendees.length > 0) {
        eventBody.attendees = attendees.map(function(a) {
          return { email: a.email };
        });
      }
    } catch(e) {}
  }

  // Recurrence
  if (extraProps.recurrenceRule && extraProps.recurrenceRule.length > 0) {
    eventBody.recurrence = extraProps.recurrenceRule;
  }

  // Color
  if (row[EVT.COLOR]) {
    eventBody.colorId = String(row[EVT.COLOR]);
  }

  // Visibility
  if (extraProps.visibility) {
    eventBody.visibility = extraProps.visibility;
  }

  // Transparency
  if (extraProps.transparency) {
    eventBody.transparency = extraProps.transparency;
  }

  // Conference data (Google Meet)
  var queryParams = {};
  if (extraProps.createMeetLink) {
    eventBody.conferenceData = {
      createRequest: {
        requestId: Utilities.getUuid(),
        conferenceSolutionKey: { type: 'hangoutsMeet' }
      }
    };
    queryParams.conferenceDataVersion = 1;
  }

  // Reminders
  if (extraProps.reminders) {
    eventBody.reminders = extraProps.reminders;
  }

  queryParams.sendUpdates = sendNotifications ? 'all' : 'none';

  var created = Calendar.Events.insert(eventBody, googleCalId, queryParams);

  // Update sheet with Google data
  var ts = new Date().toISOString();
  sheet.getRange(rowNum, EVT.GOOGLE_EVENT_ID + 1).setValue(created.id);
  sheet.getRange(rowNum, EVT.MEET_LINK + 1).setValue(created.hangoutLink || '');
  sheet.getRange(rowNum, EVT.SYNC_STATUS + 1).setValue('synced');
  sheet.getRange(rowNum, EVT.SYNCED_AT + 1).setValue(ts);
  sheet.getRange(rowNum, EVT.GOOGLE_UPDATED + 1).setValue(created.updated || '');
}

function pushUpdate_(sheet, row, rowNum, googleCalId, extraProps) {
  var googleEventId = row[EVT.GOOGLE_EVENT_ID];
  if (!googleEventId) return;

  var sendNotifications = extraProps.sendNotifications !== false;

  var patchBody = {};
  if (row[EVT.TITLE]) patchBody.summary = row[EVT.TITLE];
  if (row[EVT.DESCRIPTION] !== undefined) patchBody.description = row[EVT.DESCRIPTION];
  if (row[EVT.LOCATION] !== undefined) patchBody.location = row[EVT.LOCATION];

  var isAllDay = String(row[EVT.IS_ALL_DAY]) === 'true' || row[EVT.IS_ALL_DAY] === true;
  if (row[EVT.START_TIME]) {
    if (isAllDay) {
      patchBody.start = { date: row[EVT.START_TIME] };
    } else {
      patchBody.start = { dateTime: row[EVT.START_TIME] };
    }
  }
  if (row[EVT.END_TIME]) {
    if (isAllDay) {
      patchBody.end = { date: row[EVT.END_TIME] };
    } else {
      patchBody.end = { dateTime: row[EVT.END_TIME] };
    }
  }

  if (row[EVT.COLOR]) patchBody.colorId = String(row[EVT.COLOR]);
  if (extraProps.visibility) patchBody.visibility = extraProps.visibility;
  if (extraProps.transparency) patchBody.transparency = extraProps.transparency;

  // Attendees
  if (row[EVT.ATTENDEES_JSON]) {
    try {
      var attendees = JSON.parse(row[EVT.ATTENDEES_JSON]);
      patchBody.attendees = attendees.map(function(a) {
        return { email: a.email, responseStatus: a.responseStatus || 'needsAction' };
      });
    } catch(e) {}
  }

  var updated = Calendar.Events.patch(patchBody, googleCalId, googleEventId, {
    sendUpdates: sendNotifications ? 'all' : 'none'
  });

  var ts = new Date().toISOString();
  sheet.getRange(rowNum, EVT.SYNC_STATUS + 1).setValue('synced');
  sheet.getRange(rowNum, EVT.SYNCED_AT + 1).setValue(ts);
  sheet.getRange(rowNum, EVT.GOOGLE_UPDATED + 1).setValue(updated.updated || '');
}

function pushDelete_(sheet, row, rowNum, googleCalId) {
  var googleEventId = row[EVT.GOOGLE_EVENT_ID];
  if (googleEventId) {
    try {
      Calendar.Events.remove(googleCalId, googleEventId, { sendUpdates: 'all' });
    } catch(e) { /* may already be deleted */ }
  }
  sheet.getRange(rowNum, EVT.SYNC_STATUS + 1).setValue('deleted');
  sheet.getRange(rowNum, EVT.SYNCED_AT + 1).setValue(new Date().toISOString());
}

function pushRsvp_(sheet, row, rowNum, googleCalId) {
  var googleEventId = row[EVT.GOOGLE_EVENT_ID];
  if (!googleEventId) return;

  var myEmail = Session.getActiveUser().getEmail();
  var rsvpStatus = row[EVT.MY_RSVP] || 'accepted';

  // Get current event to preserve other attendees
  try {
    var existing = Calendar.Events.get(googleCalId, googleEventId);
    var attendees = existing.attendees || [];
    var found = false;
    for (var j = 0; j < attendees.length; j++) {
      if (attendees[j].email === myEmail || attendees[j].self === true) {
        attendees[j].responseStatus = rsvpStatus;
        found = true;
        break;
      }
    }
    if (!found) {
      attendees.push({ email: myEmail, responseStatus: rsvpStatus });
    }

    Calendar.Events.patch({ attendees: attendees }, googleCalId, googleEventId, {
      sendUpdates: 'all'
    });
  } catch(e) {
    Logger.log('Error RSVPing event ' + googleEventId + ': ' + e.message);
  }

  var ts = new Date().toISOString();
  sheet.getRange(rowNum, EVT.SYNC_STATUS + 1).setValue('synced');
  sheet.getRange(rowNum, EVT.SYNCED_AT + 1).setValue(ts);
}

// ── Phase 2: Pull from Google Calendar ─────────────────────────────────────────

function pullFromGoogle_(startTime) {
  var calSheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.CALENDARS);
  var calData = calSheet.getDataRange().getValues();
  if (calData.length <= 1) return;

  var eventSheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.EVENTS);
  var eventData = eventSheet.getDataRange().getValues();

  // Build googleEventId → row number map
  var eventMap = {};
  for (var i = 1; i < eventData.length; i++) {
    var gid = eventData[i][EVT.GOOGLE_EVENT_ID];
    var gcid = eventData[i][EVT.GOOGLE_CAL_ID];
    if (gid) eventMap[gcid + '|' + gid] = i + 1;
  }

  // Calculate sync window
  var windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - SYNC_CONFIG.SYNC_WINDOW_PAST_DAYS);
  var windowEnd = new Date();
  windowEnd.setDate(windowEnd.getDate() + SYNC_CONFIG.SYNC_WINDOW_FUTURE_DAYS);

  for (var ci = 1; ci < calData.length; ci++) {
    if (isTimedOut_(startTime)) break;

    var googleCalId = calData[ci][CAL.GOOGLE_CAL_ID];
    var sheetCalId = calData[ci][CAL.SHEET_CAL_ID];
    var syncEnabled = String(calData[ci][CAL.SYNC_ENABLED]) === 'true' || calData[ci][CAL.SYNC_ENABLED] === true;

    if (!googleCalId || !syncEnabled) continue;

    try {
      pullCalendarEvents_(eventSheet, eventData, eventMap, googleCalId, sheetCalId, windowStart, windowEnd, startTime);
    } catch (err) {
      Logger.log('Error pulling calendar ' + googleCalId + ': ' + err.message);
    }
  }
}

function pullCalendarEvents_(eventSheet, eventData, eventMap, googleCalId, sheetCalId, windowStart, windowEnd, startTime) {
  var syncTokenKey = 'syncToken_' + googleCalId;
  var syncToken = getMeta_(syncTokenKey);

  var options = {
    singleEvents: true,
    maxResults: 250
  };

  if (syncToken) {
    options.syncToken = syncToken;
  } else {
    options.timeMin = windowStart.toISOString();
    options.timeMax = windowEnd.toISOString();
    options.orderBy = 'startTime';
  }

  var pageToken = null;
  do {
    if (isTimedOut_(startTime)) break;
    if (pageToken) options.pageToken = pageToken;

    var response;
    try {
      response = Calendar.Events.list(googleCalId, options);
    } catch (e) {
      // Sync token expired — do a full resync
      if (e.message && e.message.indexOf('Sync token') !== -1) {
        Logger.log('Sync token expired for ' + googleCalId + ', doing full sync');
        setMeta_(syncTokenKey, '');
        options = {
          singleEvents: true,
          maxResults: 250,
          timeMin: windowStart.toISOString(),
          timeMax: windowEnd.toISOString(),
          orderBy: 'startTime'
        };
        response = Calendar.Events.list(googleCalId, options);
      } else {
        throw e;
      }
    }

    if (response.items) {
      response.items.forEach(function(ge) {
        if (isTimedOut_(startTime)) return;
        processGoogleEvent_(eventSheet, eventData, eventMap, ge, googleCalId, sheetCalId);
      });
    }

    pageToken = response.nextPageToken;

    // Save sync token when available
    if (response.nextSyncToken) {
      setMeta_(syncTokenKey, response.nextSyncToken);
    }
  } while (pageToken);
}

function processGoogleEvent_(eventSheet, eventData, eventMap, ge, googleCalId, sheetCalId) {
  var mapKey = googleCalId + '|' + ge.id;
  var rowNum = eventMap[mapKey];
  var ts = new Date().toISOString();
  var myEmail = Session.getActiveUser().getEmail();

  // Determine my RSVP status
  var myRsvp = '';
  if (ge.attendees) {
    for (var j = 0; j < ge.attendees.length; j++) {
      if (ge.attendees[j].email === myEmail || ge.attendees[j].self === true) {
        myRsvp = ge.attendees[j].responseStatus || '';
        break;
      }
    }
  }

  // Format attendees
  var attendeesJson = '';
  if (ge.attendees && ge.attendees.length > 0) {
    var attendees = ge.attendees.map(function(a) {
      return {
        email: a.email || '',
        displayName: a.displayName || '',
        responseStatus: a.responseStatus || 'needsAction',
        self: a.self || false,
        organizer: a.organizer || false
      };
    });
    attendeesJson = JSON.stringify(attendees);
  }

  // Determine start/end and isAllDay
  var startTime = '';
  var endTime = '';
  var isAllDay = false;
  if (ge.start) {
    if (ge.start.date) {
      startTime = ge.start.date;
      isAllDay = true;
    } else if (ge.start.dateTime) {
      startTime = ge.start.dateTime;
    }
  }
  if (ge.end) {
    if (ge.end.date) {
      endTime = ge.end.date;
    } else if (ge.end.dateTime) {
      endTime = ge.end.dateTime;
    }
  }

  // Build extra props
  var extraProps = {};
  if (ge.visibility) extraProps.visibility = ge.visibility;
  if (ge.transparency) extraProps.transparency = ge.transparency;
  if (ge.recurringEventId) extraProps.recurringEventId = ge.recurringEventId;
  if (ge.recurrence) extraProps.recurrenceRule = ge.recurrence;
  if (ge.reminders) extraProps.reminders = ge.reminders;
  if (ge.outOfOfficeProperties) extraProps.statusProps = ge.outOfOfficeProperties;
  if (ge.focusTimeProperties) extraProps.statusProps = ge.focusTimeProperties;
  var extraPropsJson = Object.keys(extraProps).length > 0 ? JSON.stringify(extraProps) : '';

  var organizer = ge.organizer ? (ge.organizer.email || '') : '';
  var eventType = ge.eventType || 'default';
  var color = ge.colorId || '';
  var meetLink = ge.hangoutLink || '';
  var status = ge.status || 'confirmed';

  if (rowNum) {
    // Existing event — update only if synced (no pending local changes)
    var syncStatus = eventData[rowNum - 1][EVT.SYNC_STATUS];
    if (syncStatus !== 'synced') return;

    // Check if Google has newer data
    var storedGoogleUpdated = eventData[rowNum - 1][EVT.GOOGLE_UPDATED];
    if (storedGoogleUpdated && ge.updated && ge.updated === storedGoogleUpdated) {
      return; // No change
    }

    // Handle cancelled events (deleted from Google)
    if (ge.status === 'cancelled') {
      eventSheet.getRange(rowNum, EVT.STATUS + 1).setValue('cancelled');
      eventSheet.getRange(rowNum, EVT.SYNC_STATUS + 1).setValue('deleted');
      eventSheet.getRange(rowNum, EVT.UPDATED_AT + 1).setValue(ts);
      eventSheet.getRange(rowNum, EVT.SYNCED_AT + 1).setValue(ts);
      eventSheet.getRange(rowNum, EVT.UPDATED_BY + 1).setValue('google');
      return;
    }

    eventSheet.getRange(rowNum, EVT.TITLE + 1).setValue(ge.summary || '');
    eventSheet.getRange(rowNum, EVT.DESCRIPTION + 1).setValue(ge.description || '');
    eventSheet.getRange(rowNum, EVT.LOCATION + 1).setValue(ge.location || '');
    eventSheet.getRange(rowNum, EVT.START_TIME + 1).setValue(startTime);
    eventSheet.getRange(rowNum, EVT.END_TIME + 1).setValue(endTime);
    eventSheet.getRange(rowNum, EVT.IS_ALL_DAY + 1).setValue(isAllDay);
    eventSheet.getRange(rowNum, EVT.STATUS + 1).setValue(status);
    eventSheet.getRange(rowNum, EVT.ORGANIZER + 1).setValue(organizer);
    eventSheet.getRange(rowNum, EVT.MY_RSVP + 1).setValue(myRsvp);
    eventSheet.getRange(rowNum, EVT.ATTENDEES_JSON + 1).setValue(attendeesJson);
    eventSheet.getRange(rowNum, EVT.EVENT_TYPE + 1).setValue(eventType);
    eventSheet.getRange(rowNum, EVT.COLOR + 1).setValue(color);
    eventSheet.getRange(rowNum, EVT.MEET_LINK + 1).setValue(meetLink);
    eventSheet.getRange(rowNum, EVT.EXTRA_PROPS_JSON + 1).setValue(extraPropsJson);
    eventSheet.getRange(rowNum, EVT.UPDATED_AT + 1).setValue(ts);
    eventSheet.getRange(rowNum, EVT.SYNCED_AT + 1).setValue(ts);
    eventSheet.getRange(rowNum, EVT.UPDATED_BY + 1).setValue('google');
    eventSheet.getRange(rowNum, EVT.GOOGLE_UPDATED + 1).setValue(ge.updated || '');
  } else {
    // Skip cancelled events that we don't have locally
    if (ge.status === 'cancelled') return;

    // New event from Google
    var newSheetId = Utilities.getUuid();
    eventSheet.appendRow([
      newSheetId,          // A: sheetEventId
      ge.id,               // B: googleEventId
      sheetCalId,          // C: sheetCalId
      googleCalId,         // D: googleCalId
      ge.summary || '',    // E: title
      ge.description || '',// F: description
      ge.location || '',   // G: location
      startTime,           // H: startTime
      endTime,             // I: endTime
      isAllDay,            // J: isAllDay
      status,              // K: status
      organizer,           // L: organizer
      myRsvp,              // M: myRsvp
      attendeesJson,       // N: attendeesJson
      eventType,           // O: eventType
      color,               // P: color
      meetLink,            // Q: meetLink
      extraPropsJson,      // R: extraPropsJson
      'synced',            // S: syncStatus
      ts,                  // T: updatedAt
      ts,                  // U: syncedAt
      'google',            // V: updatedBy
      ge.updated || ''     // W: googleUpdated
    ]);

    // Update map for deduplication within this cycle
    eventMap[googleCalId + '|' + ge.id] = eventSheet.getLastRow();
  }
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
      if (action === 'checkAvailability') {
        result = processCheckAvailability_(params);
      } else if (action === 'findSlots') {
        result = processFindSlots_(params);
      } else if (action === 'updateSeries') {
        result = processUpdateSeries_(params);
      } else if (action === 'deleteSeries') {
        result = processDeleteSeries_(params);
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

// ── Check Availability ─────────────────────────────────────────────────────────

function processCheckAvailability_(params) {
  var emails = params.emails || [];
  var startTime = params.startTime;
  var endTime = params.endTime;

  if (emails.length === 0 || !startTime || !endTime) {
    return { error: 'emails, startTime, and endTime are required' };
  }

  // Include current user
  var myEmail = Session.getActiveUser().getEmail();
  var allEmails = [myEmail].concat(emails.filter(function(e) { return e !== myEmail; }));

  var request = {
    timeMin: startTime,
    timeMax: endTime,
    items: allEmails.map(function(e) { return { id: e }; })
  };

  var response = Calendar.Freebusy.query(request);
  var availability = {};

  allEmails.forEach(function(email) {
    var calData = response.calendars[email];
    if (calData) {
      availability[email] = {
        busy: (calData.busy || []).map(function(b) {
          return { start: b.start, end: b.end };
        }),
        errors: calData.errors || []
      };
    }
  });

  return { availability: availability };
}

// ── Find Slots ─────────────────────────────────────────────────────────────────

function processFindSlots_(params) {
  var attendees = params.attendees || [];
  var duration = params.duration || 30;
  var startDate = params.startDate;
  var endDate = params.endDate;
  var workStart = params.workingHoursStart || '09:00';
  var workEnd = params.workingHoursEnd || '17:00';
  var preferMorning = params.preferMorning || false;

  if (!startDate || !endDate) {
    return { error: 'startDate and endDate are required' };
  }

  var myEmail = Session.getActiveUser().getEmail();
  var allEmails = [myEmail].concat(attendees.filter(function(e) { return e !== myEmail; }));

  // Parse working hours
  var workStartParts = workStart.split(':');
  var workStartHour = parseInt(workStartParts[0], 10);
  var workStartMin = parseInt(workStartParts[1] || '0', 10);
  var workEndParts = workEnd.split(':');
  var workEndHour = parseInt(workEndParts[0], 10);
  var workEndMin = parseInt(workEndParts[1] || '0', 10);

  // Determine time range for FreeBusy query
  var rangeStart = new Date(startDate + 'T' + workStart + ':00+07:00');
  var rangeEnd = new Date(endDate + 'T' + workEnd + ':00+07:00');

  // FreeBusy query
  var fbRequest = {
    timeMin: rangeStart.toISOString(),
    timeMax: rangeEnd.toISOString(),
    items: allEmails.map(function(e) { return { id: e }; })
  };

  var fbResponse = Calendar.Freebusy.query(fbRequest);

  // Collect all busy intervals per person
  var busyIntervals = {};
  allEmails.forEach(function(email) {
    var calData = fbResponse.calendars[email];
    busyIntervals[email] = (calData && calData.busy) ? calData.busy.map(function(b) {
      return { start: new Date(b.start).getTime(), end: new Date(b.end).getTime() };
    }) : [];
  });

  // Load holiday events for warnings
  var holidays = getHolidayEvents_(rangeStart, rangeEnd);

  // Generate candidate slots
  var slots = [];
  var current = new Date(startDate + 'T00:00:00+07:00');
  var last = new Date(endDate + 'T00:00:00+07:00');

  while (current <= last) {
    var dayStart = new Date(current);
    dayStart.setHours(workStartHour, workStartMin, 0, 0);
    var dayEnd = new Date(current);
    dayEnd.setHours(workEndHour, workEndMin, 0, 0);

    var slotStart = new Date(dayStart);

    while (slotStart.getTime() + duration * 60000 <= dayEnd.getTime()) {
      var slotEnd = new Date(slotStart.getTime() + duration * 60000);
      var slotStartMs = slotStart.getTime();
      var slotEndMs = slotEnd.getTime();

      // Check if all attendees are free
      var allFree = true;
      for (var ei = 0; ei < allEmails.length; ei++) {
        var busy = busyIntervals[allEmails[ei]];
        for (var bi = 0; bi < busy.length; bi++) {
          if (slotStartMs < busy[bi].end && slotEndMs > busy[bi].start) {
            allFree = false;
            break;
          }
        }
        if (!allFree) break;
      }

      if (allFree) {
        // Score the slot
        var score = 100;
        var warnings = [];

        // Check holiday overlaps
        for (var hi = 0; hi < holidays.length; hi++) {
          var hStart = holidays[hi].start;
          var hEnd = holidays[hi].end;
          if (slotStartMs < hEnd && slotEndMs > hStart) {
            score -= 25;
            warnings.push(holidays[hi].title);
          }
        }

        // Prefer morning or afternoon
        var hour = slotStart.getHours();
        if (preferMorning && hour < 12) {
          score += 10;
        } else if (!preferMorning && hour >= 13) {
          score += 5;
        }

        // Slight penalty for very early or very late
        if (hour === workStartHour || hour >= workEndHour - 1) {
          score -= 5;
        }

        // Bonus for mid-morning / mid-afternoon
        if (hour === 10 || hour === 14) {
          score += 5;
        }

        slots.push({
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
          score: Math.max(0, Math.min(100, score)),
          warnings: warnings
        });
      }

      // Move to next slot
      slotStart = new Date(slotStart.getTime() + SYNC_CONFIG.SLOT_STEP_MINUTES * 60000);
    }

    // Next day
    current.setDate(current.getDate() + 1);
  }

  // Sort by score descending, then by time
  slots.sort(function(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(a.start) - new Date(b.start);
  });

  // Return top 10 slots
  return {
    slots: slots.slice(0, 10),
    attendees: allEmails,
    duration: duration,
    totalFound: slots.length
  };
}

function getHolidayEvents_(rangeStart, rangeEnd) {
  var calSheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.CALENDARS);
  var calData = calSheet.getDataRange().getValues();
  var holidayCalIds = [];
  for (var i = 1; i < calData.length; i++) {
    if (calData[i][CAL.TYPE] === 'holiday') {
      holidayCalIds.push(calData[i][CAL.GOOGLE_CAL_ID]);
    }
  }

  if (holidayCalIds.length === 0) return [];

  var eventSheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.EVENTS);
  var eventData = eventSheet.getDataRange().getValues();
  var holidays = [];
  var rangeStartMs = rangeStart.getTime();
  var rangeEndMs = rangeEnd.getTime();

  for (var i = 1; i < eventData.length; i++) {
    var gcid = eventData[i][EVT.GOOGLE_CAL_ID];
    if (holidayCalIds.indexOf(gcid) === -1) continue;
    if (eventData[i][EVT.SYNC_STATUS] === 'deleted') continue;

    var startStr = eventData[i][EVT.START_TIME];
    var endStr = eventData[i][EVT.END_TIME];
    if (!startStr) continue;

    var evtStart = new Date(startStr).getTime();
    var evtEnd = endStr ? new Date(endStr).getTime() : evtStart + 86400000;

    if (evtStart < rangeEndMs && evtEnd > rangeStartMs) {
      holidays.push({
        title: eventData[i][EVT.TITLE] || 'Holiday',
        start: evtStart,
        end: evtEnd
      });
    }
  }

  return holidays;
}

// ── Series Operations ───────────────────────────────────────────────────────────

function processUpdateSeries_(params) {
  var googleCalId = params.googleCalId;
  var recurringEventId = params.recurringEventId;
  if (!googleCalId || !recurringEventId) {
    return { error: 'googleCalId and recurringEventId are required' };
  }

  var patchBody = {};
  if (params.title !== undefined) patchBody.summary = params.title;
  if (params.description !== undefined) patchBody.description = params.description;
  if (params.location !== undefined) patchBody.location = params.location;
  if (params.startTime !== undefined) patchBody.start = { dateTime: params.startTime };
  if (params.endTime !== undefined) patchBody.end = { dateTime: params.endTime };
  if (params.color !== undefined) patchBody.colorId = String(params.color);

  Calendar.Events.patch(patchBody, googleCalId, recurringEventId);

  // Invalidate sync token to force re-pull of updated instances
  var syncTokenKey = 'syncToken_' + googleCalId;
  setMeta_(syncTokenKey, '');

  return { success: true, seriesId: recurringEventId };
}

function processDeleteSeries_(params) {
  var googleCalId = params.googleCalId;
  var recurringEventId = params.recurringEventId;
  if (!googleCalId || !recurringEventId) {
    return { error: 'googleCalId and recurringEventId are required' };
  }

  Calendar.Events.remove(googleCalId, recurringEventId, { sendUpdates: 'all' });

  // Mark all matching instance rows in Events sheet as deleted
  var eventSheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.EVENTS);
  var eventData = eventSheet.getDataRange().getValues();
  var ts = new Date().toISOString();

  for (var i = 1; i < eventData.length; i++) {
    if (eventData[i][EVT.GOOGLE_CAL_ID] !== googleCalId) continue;
    var extraJson = eventData[i][EVT.EXTRA_PROPS_JSON];
    if (!extraJson) continue;
    try {
      var extra = JSON.parse(extraJson);
      if (extra.recurringEventId === recurringEventId) {
        var rowNum = i + 1;
        eventSheet.getRange(rowNum, EVT.STATUS + 1).setValue('cancelled');
        eventSheet.getRange(rowNum, EVT.SYNC_STATUS + 1).setValue('deleted');
        eventSheet.getRange(rowNum, EVT.UPDATED_AT + 1).setValue(ts);
        eventSheet.getRange(rowNum, EVT.UPDATED_BY + 1).setValue('google');
      }
    } catch(e) {}
  }

  // Invalidate sync token to force re-pull
  var syncTokenKey = 'syncToken_' + googleCalId;
  setMeta_(syncTokenKey, '');

  return { success: true, seriesId: recurringEventId };
}

// ── Initial Import ─────────────────────────────────────────────────────────────

function initialImport() {
  Logger.log('Starting initial import of Google Calendars...');

  var calSheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.CALENDARS);
  var eventSheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.EVENTS);
  var myEmail = Session.getActiveUser().getEmail();

  // Discover all calendars via Calendar List API
  var calList = Calendar.CalendarList.list({ maxResults: 250 });
  if (!calList.items) {
    Logger.log('No calendars found');
    return;
  }

  var calMap = {}; // googleCalId → sheetCalId

  calList.items.forEach(function(cal) {
    var sheetCalId = Utilities.getUuid();
    var ts = new Date().toISOString();

    // Auto-detect type
    var type = 'shared';
    if (cal.primary === true) {
      type = 'primary';
    } else if (cal.accessRole === 'freeBusyReader') {
      type = 'coworker';
    }

    // Only auto-enable primary calendar
    var syncEnabled = (type === 'primary') ? 'true' : 'false';

    calSheet.appendRow([
      sheetCalId,
      cal.id,
      cal.summary || cal.summaryOverride || '',
      cal.id,  // ownerEmail (for calendars, the ID is often the email)
      type,
      cal.backgroundColor || '',
      syncEnabled,
      ts,
      ts
    ]);

    calMap[cal.id] = sheetCalId;
    Logger.log('Imported calendar: ' + (cal.summary || cal.id) + ' [' + type + '] sync=' + syncEnabled);
  });

  // Import events for primary calendar only (others can be enabled later)
  var primaryCalId = myEmail;
  var primarySheetCalId = calMap[primaryCalId];
  if (primarySheetCalId) {
    importCalendarEvents_(eventSheet, primaryCalId, primarySheetCalId);
  }

  setMeta_('lastFullSync', new Date().toISOString());
  Logger.log('Initial import complete. Enable sync for other calendars as needed.');
  Logger.log('To enable a calendar, set syncEnabled to "true" in the Calendars sheet.');
  Logger.log('To set calendar type, update the type column (primary/coworker/holiday/shared/resource).');
}

function importCalendarEvents_(eventSheet, googleCalId, sheetCalId) {
  var windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - SYNC_CONFIG.SYNC_WINDOW_PAST_DAYS);
  var windowEnd = new Date();
  windowEnd.setDate(windowEnd.getDate() + SYNC_CONFIG.SYNC_WINDOW_FUTURE_DAYS);
  var myEmail = Session.getActiveUser().getEmail();

  var pageToken = null;
  var count = 0;
  do {
    var options = {
      singleEvents: true,
      orderBy: 'startTime',
      timeMin: windowStart.toISOString(),
      timeMax: windowEnd.toISOString(),
      maxResults: 250
    };
    if (pageToken) options.pageToken = pageToken;

    var response = Calendar.Events.list(googleCalId, options);
    if (!response.items) break;

    response.items.forEach(function(ge) {
      if (ge.status === 'cancelled') return;

      var startTime = '';
      var endTime = '';
      var isAllDay = false;
      if (ge.start) {
        if (ge.start.date) { startTime = ge.start.date; isAllDay = true; }
        else if (ge.start.dateTime) { startTime = ge.start.dateTime; }
      }
      if (ge.end) {
        if (ge.end.date) { endTime = ge.end.date; }
        else if (ge.end.dateTime) { endTime = ge.end.dateTime; }
      }

      var myRsvp = '';
      var attendeesJson = '';
      if (ge.attendees) {
        for (var j = 0; j < ge.attendees.length; j++) {
          if (ge.attendees[j].email === myEmail || ge.attendees[j].self === true) {
            myRsvp = ge.attendees[j].responseStatus || '';
            break;
          }
        }
        attendeesJson = JSON.stringify(ge.attendees.map(function(a) {
          return {
            email: a.email || '',
            displayName: a.displayName || '',
            responseStatus: a.responseStatus || 'needsAction',
            self: a.self || false,
            organizer: a.organizer || false
          };
        }));
      }

      var extraProps = {};
      if (ge.visibility) extraProps.visibility = ge.visibility;
      if (ge.transparency) extraProps.transparency = ge.transparency;
      if (ge.recurringEventId) extraProps.recurringEventId = ge.recurringEventId;
      if (ge.recurrence) extraProps.recurrenceRule = ge.recurrence;
      if (ge.reminders) extraProps.reminders = ge.reminders;
      if (ge.outOfOfficeProperties) extraProps.statusProps = ge.outOfOfficeProperties;
      if (ge.focusTimeProperties) extraProps.statusProps = ge.focusTimeProperties;
      var extraPropsJson = Object.keys(extraProps).length > 0 ? JSON.stringify(extraProps) : '';

      var ts = new Date().toISOString();
      eventSheet.appendRow([
        Utilities.getUuid(),       // sheetEventId
        ge.id,                     // googleEventId
        sheetCalId,                // sheetCalId
        googleCalId,               // googleCalId
        ge.summary || '',          // title
        ge.description || '',      // description
        ge.location || '',         // location
        startTime,                 // startTime
        endTime,                   // endTime
        isAllDay,                  // isAllDay
        ge.status || 'confirmed',  // status
        ge.organizer ? ge.organizer.email || '' : '', // organizer
        myRsvp,                    // myRsvp
        attendeesJson,             // attendeesJson
        ge.eventType || 'default', // eventType
        ge.colorId || '',          // color
        ge.hangoutLink || '',      // meetLink
        extraPropsJson,            // extraPropsJson
        'synced',                  // syncStatus
        ts,                        // updatedAt
        ts,                        // syncedAt
        'google',                  // updatedBy
        ge.updated || ''           // googleUpdated
      ]);
      count++;
    });

    pageToken = response.nextPageToken;

    // Save sync token for incremental sync
    if (response.nextSyncToken) {
      setMeta_('syncToken_' + googleCalId, response.nextSyncToken);
    }
  } while (pageToken);

  Logger.log('Imported ' + count + ' events from ' + googleCalId);
}

// ── Cleanup ────────────────────────────────────────────────────────────────────

function cleanupDeletedRows_() {
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - SYNC_CONFIG.CLEANUP_DAYS);

  // Clean Events sheet
  var eventSheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.EVENTS);
  var eventData = eventSheet.getDataRange().getValues();
  var rowsToDelete = [];
  for (var i = 1; i < eventData.length; i++) {
    if (eventData[i][EVT.SYNC_STATUS] === 'deleted') {
      var updatedAt = eventData[i][EVT.UPDATED_AT];
      if (updatedAt && new Date(updatedAt) < cutoff) {
        rowsToDelete.push(i + 1);
      }
    }
  }
  for (var j = rowsToDelete.length - 1; j >= 0; j--) {
    eventSheet.deleteRow(rowsToDelete[j]);
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

function buildCalIdMap_() {
  var sheet = getSheet_(SYNC_CONFIG.SHEET_NAMES.CALENDARS);
  var data = sheet.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < data.length; i++) {
    if (data[i][CAL.SHEET_CAL_ID] && data[i][CAL.GOOGLE_CAL_ID]) {
      map[data[i][CAL.SHEET_CAL_ID]] = data[i][CAL.GOOGLE_CAL_ID];
    }
  }
  return map;
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
