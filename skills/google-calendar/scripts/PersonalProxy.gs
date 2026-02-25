// PersonalProxy.gs — Personal Gmail Apps Script
// Deployed as web app on personal Gmail account.
// Reads/writes Google Spreadsheet as proxy for Google Calendar.
// Claude Code calls this via HTTP; WorkSync.gs handles the actual Calendar API.

// ── Configuration ──────────────────────────────────────────────────────────────

const CONFIG = {
  SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID_HERE',
  API_KEY: 'YOUR_API_KEY_HERE',
  DEFAULT_TIMEZONE_OFFSET: '+07:00',
  DEFAULT_ORGANIZER_EMAIL: 'yourworkemail@company.com',
  SHEET_NAMES: {
    CALENDARS: 'Calendars',
    EVENTS: 'Events',
    COMMAND_QUEUE: 'CommandQueue',
    SYNC_META: 'SyncMeta'
  }
};

// Column indices for Events sheet (0-based)
const EVT = {
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
const CAL = {
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
  return jsonResponse_({ status: 'ok', message: 'Google Calendar Proxy is running' });
}

// ── Action Router ──────────────────────────────────────────────────────────────

var ACTIONS = {
  // Calendar management
  listCalendars: listCalendars_,
  getCalendar: getCalendar_,
  enableCalendarSync: enableCalendarSync_,
  disableCalendarSync: disableCalendarSync_,
  // Event read
  listEvents: listEvents_,
  getEvent: getEvent_,
  searchEvents: searchEvents_,
  todaySchedule: todaySchedule_,
  weekSchedule: weekSchedule_,
  listHolidays: listHolidays_,
  // Event write
  createEvent: createEvent_,
  createAllDayEvent: createAllDayEvent_,
  createRecurringEvent: createRecurringEvent_,
  createOutOfOffice: createOutOfOffice_,
  createFocusTime: createFocusTime_,
  updateEvent: updateEvent_,
  deleteEvent: deleteEvent_,
  updateSeries: updateSeries_,
  deleteSeries: deleteSeries_,
  rsvpEvent: rsvpEvent_,
  addGuest: addGuest_,
  removeGuest: removeGuest_,
  // Smart scheduling (async)
  checkAvailability: checkAvailability_,
  findSlots: findSlots_,
  getCommandResult: getCommandResult_,
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

function todayRange_() {
  var now = new Date();
  var start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start, end: end };
}

function weekRange_() {
  var now = new Date();
  var day = now.getDay(); // 0=Sun, 1=Mon, ...
  var diffToMon = day === 0 ? -6 : 1 - day;
  var start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMon);
  var end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start: start, end: end };
}

function parseDate_(str) {
  if (!str) return null;
  return new Date(str);
}

function isActiveEvent_(row) {
  var ss = row.syncStatus || row[EVT.SYNC_STATUS];
  return ss !== 'deleted' && ss !== 'pending_delete';
}

function isNotCancelled_(row) {
  var st = row.status || row[EVT.STATUS];
  return st !== 'cancelled';
}

// Find primary calendar sheetCalId
function getPrimaryCalendarId_() {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.CALENDARS);
  var rows = getAllRows_(sheet);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].type === 'primary') return rows[i].sheetCalId;
  }
  // Fallback: first enabled calendar
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].syncEnabled) === 'true' || rows[i].syncEnabled === true) return rows[i].sheetCalId;
  }
  return '';
}

// ── Calendar Management Actions ────────────────────────────────────────────────

function listCalendars_() {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.CALENDARS);
  var rows = getAllRows_(sheet);
  var items = rows.map(function(r) {
    return {
      id: r.sheetCalId,
      name: r.name,
      ownerEmail: r.ownerEmail || '',
      type: r.type || 'shared',
      color: r.color || '',
      syncEnabled: String(r.syncEnabled) === 'true' || r.syncEnabled === true,
      syncedAt: r.syncedAt || ''
    };
  });
  return { kind: 'calendar#calendarList', items: items };
}

function getCalendar_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.CALENDARS);
  var row = getRowBySheetId_(sheet, CAL.SHEET_CAL_ID, params.calendarId);
  if (!row) return { error: 'Calendar not found' };
  return {
    id: row.sheetCalId,
    name: row.name,
    ownerEmail: row.ownerEmail || '',
    type: row.type || 'shared',
    color: row.color || '',
    syncEnabled: String(row.syncEnabled) === 'true' || row.syncEnabled === true,
    syncedAt: row.syncedAt || ''
  };
}

function enableCalendarSync_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.CALENDARS);
  var rowNum = findRowIndex_(sheet, CAL.SHEET_CAL_ID, params.calendarId);
  if (rowNum < 0) return { error: 'Calendar not found' };
  sheet.getRange(rowNum, CAL.SYNC_ENABLED + 1).setValue('true');
  sheet.getRange(rowNum, CAL.UPDATED_AT + 1).setValue(now_());
  return { success: true, calendarId: params.calendarId };
}

function disableCalendarSync_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.CALENDARS);
  var rowNum = findRowIndex_(sheet, CAL.SHEET_CAL_ID, params.calendarId);
  if (rowNum < 0) return { error: 'Calendar not found' };
  sheet.getRange(rowNum, CAL.SYNC_ENABLED + 1).setValue('false');
  sheet.getRange(rowNum, CAL.UPDATED_AT + 1).setValue(now_());
  return { success: true, calendarId: params.calendarId };
}

// ── Event Read Actions ─────────────────────────────────────────────────────────

function listEvents_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.EVENTS);
  var rows = getAllRows_(sheet);
  var startDate = parseDate_(params.startDate);
  var endDate = parseDate_(params.endDate);
  var calId = params.calendarId || null;

  var items = rows.filter(function(r) {
    if (!isActiveEvent_(r)) return false;
    if (!isNotCancelled_(r)) return false;
    if (calId && r.sheetCalId !== calId) return false;
    if (startDate || endDate) {
      var evtStart = parseDate_(r.startTime);
      var evtEnd = parseDate_(r.endTime);
      if (!evtStart) return false;
      if (startDate && evtEnd && evtEnd <= startDate) return false;
      if (endDate && evtStart >= endDate) return false;
    }
    return true;
  }).map(formatEvent_).sort(function(a, b) {
    return new Date(a.startTime) - new Date(b.startTime);
  });

  return { kind: 'calendar#events', items: items };
}

function getEvent_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.EVENTS);
  var row = getRowBySheetId_(sheet, EVT.SHEET_EVENT_ID, params.eventId);
  if (!row || !isActiveEvent_(row)) return { error: 'Event not found' };
  return formatEvent_(row);
}

function searchEvents_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.EVENTS);
  var rows = getAllRows_(sheet);
  var query = (params.query || '').toLowerCase();
  var startDate = parseDate_(params.startDate);
  var endDate = parseDate_(params.endDate);

  var items = rows.filter(function(r) {
    if (!isActiveEvent_(r)) return false;
    if (!isNotCancelled_(r)) return false;
    // Text search across title, description, location
    var text = ((r.title || '') + ' ' + (r.description || '') + ' ' + (r.location || '')).toLowerCase();
    if (query && text.indexOf(query) === -1) return false;
    if (startDate || endDate) {
      var evtStart = parseDate_(r.startTime);
      var evtEnd = parseDate_(r.endTime);
      if (startDate && evtEnd && evtEnd <= startDate) return false;
      if (endDate && evtStart && evtStart >= endDate) return false;
    }
    return true;
  }).map(formatEvent_).sort(function(a, b) {
    return new Date(a.startTime) - new Date(b.startTime);
  });

  return { kind: 'calendar#events', items: items };
}

function todaySchedule_() {
  var range = todayRange_();
  return listEvents_({ startDate: range.start.toISOString(), endDate: range.end.toISOString() });
}

function weekSchedule_() {
  var range = weekRange_();
  return listEvents_({ startDate: range.start.toISOString(), endDate: range.end.toISOString() });
}

function listHolidays_(params) {
  // Get holiday calendar IDs
  var calSheet = getSheet_(CONFIG.SHEET_NAMES.CALENDARS);
  var calRows = getAllRows_(calSheet);
  var holidayCalIds = calRows
    .filter(function(c) { return c.type === 'holiday'; })
    .map(function(c) { return c.sheetCalId; });

  if (holidayCalIds.length === 0) return { kind: 'calendar#events', items: [] };

  var sheet = getSheet_(CONFIG.SHEET_NAMES.EVENTS);
  var rows = getAllRows_(sheet);

  // Default: next 30 days
  var startDate = parseDate_(params.startDate) || new Date();
  var endDate = parseDate_(params.endDate);
  if (!endDate) {
    endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 30);
  }

  var items = rows.filter(function(r) {
    if (!isActiveEvent_(r)) return false;
    if (holidayCalIds.indexOf(r.sheetCalId) === -1) return false;
    var evtStart = parseDate_(r.startTime);
    var evtEnd = parseDate_(r.endTime);
    if (evtEnd && evtEnd <= startDate) return false;
    if (evtStart && evtStart >= endDate) return false;
    return true;
  }).map(formatEvent_).sort(function(a, b) {
    return new Date(a.startTime) - new Date(b.startTime);
  });

  return { kind: 'calendar#events', items: items };
}

// ── Event Write Actions ────────────────────────────────────────────────────────

function createEvent_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.EVENTS);
  var id = uuid_();
  var ts = now_();
  var calId = params.calendarId || getPrimaryCalendarId_();

  var extraProps = {};
  // Default to creating Google Meet link unless explicitly set to false
  extraProps.createMeetLink = params.createMeetLink !== false;
  if (params.sendNotifications !== undefined) extraProps.sendNotifications = params.sendNotifications;
  if (params.reminders) extraProps.reminders = params.reminders;

  var attendeesJson = '';
  if (params.guests) {
    var emails = params.guests.split(',').map(function(e) { return e.trim(); });
    var attendees = emails.map(function(e) { return { email: e, responseStatus: 'needsAction' }; });
    attendeesJson = JSON.stringify(attendees);
  }

  sheet.appendRow([
    id,                                       // A: sheetEventId
    '',                                       // B: googleEventId
    calId,                                    // C: sheetCalId
    '',                                       // D: googleCalId (filled by sync)
    params.title || '',                       // E: title
    params.description || '',                 // F: description
    params.location || '',                    // G: location
    params.startTime || '',                   // H: startTime
    params.endTime || '',                     // I: endTime
    false,                                    // J: isAllDay
    'confirmed',                              // K: status
    params.organizer || CONFIG.DEFAULT_ORGANIZER_EMAIL, // L: organizer
    'accepted',                               // M: myRsvp
    attendeesJson,                            // N: attendeesJson
    'default',                                // O: eventType
    params.color || '',                       // P: color
    '',                                       // Q: meetLink
    JSON.stringify(extraProps),                // R: extraPropsJson
    'pending_create',                         // S: syncStatus
    ts,                                       // T: updatedAt
    '',                                       // U: syncedAt
    'claude',                                 // V: updatedBy
    ''                                        // W: googleUpdated
  ]);

  return {
    id: id,
    title: params.title || '',
    startTime: params.startTime || '',
    endTime: params.endTime || '',
    location: params.location || '',
    guests: params.guests || '',
    createMeetLink: extraProps.createMeetLink,
    kind: 'calendar#event',
    updated: ts
  };
}

function createAllDayEvent_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.EVENTS);
  var id = uuid_();
  var ts = now_();
  var calId = params.calendarId || getPrimaryCalendarId_();

  var attendeesJson = '';
  if (params.guests) {
    var emails = params.guests.split(',').map(function(e) { return e.trim(); });
    var attendees = emails.map(function(e) { return { email: e, responseStatus: 'needsAction' }; });
    attendeesJson = JSON.stringify(attendees);
  }

  var extraProps = {};
  if (params.sendNotifications !== undefined) extraProps.sendNotifications = params.sendNotifications;

  sheet.appendRow([
    id,                                       // A: sheetEventId
    '',                                       // B: googleEventId
    calId,                                    // C: sheetCalId
    '',                                       // D: googleCalId
    params.title || '',                       // E: title
    params.description || '',                 // F: description
    params.location || '',                    // G: location
    params.startDate || '',                   // H: startTime (date for all-day)
    params.endDate || params.startDate || '', // I: endTime (date for all-day)
    true,                                     // J: isAllDay
    'confirmed',                              // K: status
    params.organizer || CONFIG.DEFAULT_ORGANIZER_EMAIL, // L: organizer
    'accepted',                               // M: myRsvp
    attendeesJson,                            // N: attendeesJson
    'default',                                // O: eventType
    '',                                       // P: color
    '',                                       // Q: meetLink
    JSON.stringify(extraProps),                // R: extraPropsJson
    'pending_create',                         // S: syncStatus
    ts,                                       // T: updatedAt
    '',                                       // U: syncedAt
    'claude',                                 // V: updatedBy
    ''                                        // W: googleUpdated
  ]);

  return {
    id: id,
    title: params.title || '',
    startDate: params.startDate || '',
    endDate: params.endDate || params.startDate || '',
    isAllDay: true,
    kind: 'calendar#event',
    updated: ts
  };
}

function createRecurringEvent_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.EVENTS);
  var id = uuid_();
  var ts = now_();
  var calId = params.calendarId || getPrimaryCalendarId_();

  var attendeesJson = '';
  if (params.guests) {
    var emails = params.guests.split(',').map(function(e) { return e.trim(); });
    var attendees = emails.map(function(e) { return { email: e, responseStatus: 'needsAction' }; });
    attendeesJson = JSON.stringify(attendees);
  }

  var extraProps = {
    recurrenceRule: params.recurrenceRule || []
  };
  // Default to creating Google Meet link unless explicitly set to false
  extraProps.createMeetLink = params.createMeetLink !== false;
  if (params.sendNotifications !== undefined) extraProps.sendNotifications = params.sendNotifications;

  sheet.appendRow([
    id,                                       // A: sheetEventId
    '',                                       // B: googleEventId
    calId,                                    // C: sheetCalId
    '',                                       // D: googleCalId
    params.title || '',                       // E: title
    params.description || '',                 // F: description
    params.location || '',                    // G: location
    params.startTime || '',                   // H: startTime
    params.endTime || '',                     // I: endTime
    false,                                    // J: isAllDay
    'confirmed',                              // K: status
    params.organizer || CONFIG.DEFAULT_ORGANIZER_EMAIL, // L: organizer
    'accepted',                               // M: myRsvp
    attendeesJson,                            // N: attendeesJson
    'default',                                // O: eventType
    '',                                       // P: color
    '',                                       // Q: meetLink
    JSON.stringify(extraProps),                // R: extraPropsJson
    'pending_create',                         // S: syncStatus
    ts,                                       // T: updatedAt
    '',                                       // U: syncedAt
    'claude',                                 // V: updatedBy
    ''                                        // W: googleUpdated
  ]);

  return {
    id: id,
    title: params.title || '',
    startTime: params.startTime || '',
    endTime: params.endTime || '',
    recurrenceRule: params.recurrenceRule || [],
    kind: 'calendar#event',
    updated: ts
  };
}

function createOutOfOffice_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.EVENTS);
  var id = uuid_();
  var ts = now_();
  var calId = getPrimaryCalendarId_();

  var extraProps = {
    statusProps: {
      autoDeclineMode: params.declineMode || 'declineAllConflictingInvitations',
      declineMessage: params.declineMessage || 'I am out of office and will respond when I return.'
    }
  };

  sheet.appendRow([
    id,                                       // A: sheetEventId
    '',                                       // B: googleEventId
    calId,                                    // C: sheetCalId
    '',                                       // D: googleCalId
    params.title || 'Out of Office',          // E: title
    '',                                       // F: description
    '',                                       // G: location
    params.startTime || '',                   // H: startTime
    params.endTime || '',                     // I: endTime
    false,                                    // J: isAllDay
    'confirmed',                              // K: status
    '',                                       // L: organizer
    '',                                       // M: myRsvp
    '',                                       // N: attendeesJson
    'outOfOffice',                            // O: eventType
    '',                                       // P: color
    '',                                       // Q: meetLink
    JSON.stringify(extraProps),                // R: extraPropsJson
    'pending_create',                         // S: syncStatus
    ts,                                       // T: updatedAt
    '',                                       // U: syncedAt
    'claude',                                 // V: updatedBy
    ''                                        // W: googleUpdated
  ]);

  return {
    id: id,
    title: params.title || 'Out of Office',
    eventType: 'outOfOffice',
    startTime: params.startTime || '',
    endTime: params.endTime || '',
    declineMode: extraProps.statusProps.autoDeclineMode,
    kind: 'calendar#event',
    updated: ts
  };
}

function createFocusTime_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.EVENTS);
  var id = uuid_();
  var ts = now_();
  var calId = getPrimaryCalendarId_();

  var extraProps = {
    statusProps: {
      chatStatus: 'doNotDisturb',
      autoDeclineMode: params.declineMode || 'declineOnlyNewConflictingInvitations',
      declineMessage: params.declineMessage || 'Declined because I am in focus time.'
    }
  };

  sheet.appendRow([
    id,                                       // A: sheetEventId
    '',                                       // B: googleEventId
    calId,                                    // C: sheetCalId
    '',                                       // D: googleCalId
    params.title || 'Focus Time',             // E: title
    '',                                       // F: description
    '',                                       // G: location
    params.startTime || '',                   // H: startTime
    params.endTime || '',                     // I: endTime
    false,                                    // J: isAllDay
    'confirmed',                              // K: status
    '',                                       // L: organizer
    '',                                       // M: myRsvp
    '',                                       // N: attendeesJson
    'focusTime',                              // O: eventType
    '',                                       // P: color
    '',                                       // Q: meetLink
    JSON.stringify(extraProps),                // R: extraPropsJson
    'pending_create',                         // S: syncStatus
    ts,                                       // T: updatedAt
    '',                                       // U: syncedAt
    'claude',                                 // V: updatedBy
    ''                                        // W: googleUpdated
  ]);

  return {
    id: id,
    title: params.title || 'Focus Time',
    eventType: 'focusTime',
    startTime: params.startTime || '',
    endTime: params.endTime || '',
    kind: 'calendar#event',
    updated: ts
  };
}

function updateEvent_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.EVENTS);
  var rowNum = findRowIndex_(sheet, EVT.SHEET_EVENT_ID, params.eventId);
  if (rowNum < 0) return { error: 'Event not found' };
  var ts = now_();

  if (params.title !== undefined) sheet.getRange(rowNum, EVT.TITLE + 1).setValue(params.title);
  if (params.description !== undefined) sheet.getRange(rowNum, EVT.DESCRIPTION + 1).setValue(params.description);
  if (params.location !== undefined) sheet.getRange(rowNum, EVT.LOCATION + 1).setValue(params.location);
  if (params.startTime !== undefined) sheet.getRange(rowNum, EVT.START_TIME + 1).setValue(params.startTime);
  if (params.endTime !== undefined) sheet.getRange(rowNum, EVT.END_TIME + 1).setValue(params.endTime);
  if (params.color !== undefined) sheet.getRange(rowNum, EVT.COLOR + 1).setValue(params.color);

  // Handle visibility/transparency via extraPropsJson
  if (params.visibility !== undefined || params.transparency !== undefined) {
    var currentExtra = sheet.getRange(rowNum, EVT.EXTRA_PROPS_JSON + 1).getValue();
    var extra = {};
    try { extra = JSON.parse(currentExtra || '{}'); } catch(e) {}
    if (params.visibility !== undefined) extra.visibility = params.visibility;
    if (params.transparency !== undefined) extra.transparency = params.transparency;
    sheet.getRange(rowNum, EVT.EXTRA_PROPS_JSON + 1).setValue(JSON.stringify(extra));
  }

  sheet.getRange(rowNum, EVT.SYNC_STATUS + 1).setValue('pending_update');
  sheet.getRange(rowNum, EVT.UPDATED_AT + 1).setValue(ts);
  sheet.getRange(rowNum, EVT.UPDATED_BY + 1).setValue('claude');

  // Re-read the row to return
  var data = sheet.getRange(rowNum, 1, 1, 23).getValues()[0];
  return formatEventFromArray_(data);
}

function deleteEvent_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.EVENTS);
  var rowNum = findRowIndex_(sheet, EVT.SHEET_EVENT_ID, params.eventId);
  if (rowNum < 0) return { error: 'Event not found' };
  var ts = now_();
  sheet.getRange(rowNum, EVT.SYNC_STATUS + 1).setValue('pending_delete');
  sheet.getRange(rowNum, EVT.UPDATED_AT + 1).setValue(ts);
  sheet.getRange(rowNum, EVT.UPDATED_BY + 1).setValue('claude');
  return { success: true };
}

function rsvpEvent_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.EVENTS);
  var rowNum = findRowIndex_(sheet, EVT.SHEET_EVENT_ID, params.eventId);
  if (rowNum < 0) return { error: 'Event not found' };
  var ts = now_();
  sheet.getRange(rowNum, EVT.MY_RSVP + 1).setValue(params.status || 'accepted');
  sheet.getRange(rowNum, EVT.SYNC_STATUS + 1).setValue('pending_rsvp');
  sheet.getRange(rowNum, EVT.UPDATED_AT + 1).setValue(ts);
  sheet.getRange(rowNum, EVT.UPDATED_BY + 1).setValue('claude');

  var data = sheet.getRange(rowNum, 1, 1, 23).getValues()[0];
  return formatEventFromArray_(data);
}

function addGuest_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.EVENTS);
  var rowNum = findRowIndex_(sheet, EVT.SHEET_EVENT_ID, params.eventId);
  if (rowNum < 0) return { error: 'Event not found' };
  var ts = now_();

  var currentJson = sheet.getRange(rowNum, EVT.ATTENDEES_JSON + 1).getValue();
  var attendees = [];
  try { attendees = JSON.parse(currentJson || '[]'); } catch(e) {}

  // Check if already added
  var exists = attendees.some(function(a) { return a.email === params.email; });
  if (!exists) {
    attendees.push({ email: params.email, responseStatus: 'needsAction' });
    sheet.getRange(rowNum, EVT.ATTENDEES_JSON + 1).setValue(JSON.stringify(attendees));
  }

  // Store sendNotifications flag in extraProps
  var currentExtra = sheet.getRange(rowNum, EVT.EXTRA_PROPS_JSON + 1).getValue();
  var extra = {};
  try { extra = JSON.parse(currentExtra || '{}'); } catch(e) {}
  extra.sendNotifications = true;
  sheet.getRange(rowNum, EVT.EXTRA_PROPS_JSON + 1).setValue(JSON.stringify(extra));

  sheet.getRange(rowNum, EVT.SYNC_STATUS + 1).setValue('pending_update');
  sheet.getRange(rowNum, EVT.UPDATED_AT + 1).setValue(ts);
  sheet.getRange(rowNum, EVT.UPDATED_BY + 1).setValue('claude');

  return { success: true, email: params.email, attendees: attendees };
}

function removeGuest_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.EVENTS);
  var rowNum = findRowIndex_(sheet, EVT.SHEET_EVENT_ID, params.eventId);
  if (rowNum < 0) return { error: 'Event not found' };
  var ts = now_();

  var currentJson = sheet.getRange(rowNum, EVT.ATTENDEES_JSON + 1).getValue();
  var attendees = [];
  try { attendees = JSON.parse(currentJson || '[]'); } catch(e) {}

  attendees = attendees.filter(function(a) { return a.email !== params.email; });
  sheet.getRange(rowNum, EVT.ATTENDEES_JSON + 1).setValue(JSON.stringify(attendees));

  sheet.getRange(rowNum, EVT.SYNC_STATUS + 1).setValue('pending_update');
  sheet.getRange(rowNum, EVT.UPDATED_AT + 1).setValue(ts);
  sheet.getRange(rowNum, EVT.UPDATED_BY + 1).setValue('claude');

  return { success: true, email: params.email, attendees: attendees };
}

// ── Recurring Series Actions (Async) ───────────────────────────────────────────

function updateSeries_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.EVENTS);
  var rowNum = findRowIndex_(sheet, EVT.SHEET_EVENT_ID, params.eventId);
  if (rowNum < 0) return { error: 'Event not found' };

  var data = sheet.getRange(rowNum, 1, 1, 23).getValues()[0];
  var extra = {};
  try { extra = JSON.parse(data[EVT.EXTRA_PROPS_JSON] || '{}'); } catch(e) {}

  if (!extra.recurringEventId) {
    return { error: 'Event is not a recurring instance. Use updateEvent for non-recurring events.' };
  }

  var googleCalId = data[EVT.GOOGLE_CAL_ID];
  if (!googleCalId) return { error: 'Event has no linked Google Calendar ID yet. Wait for sync.' };

  var cmdSheet = getSheet_(CONFIG.SHEET_NAMES.COMMAND_QUEUE);
  var id = uuid_();
  var ts = now_();
  var cmdParams = {
    recurringEventId: extra.recurringEventId,
    googleCalId: googleCalId
  };
  if (params.title !== undefined) cmdParams.title = params.title;
  if (params.description !== undefined) cmdParams.description = params.description;
  if (params.location !== undefined) cmdParams.location = params.location;
  if (params.startTime !== undefined) cmdParams.startTime = params.startTime;
  if (params.endTime !== undefined) cmdParams.endTime = params.endTime;
  if (params.color !== undefined) cmdParams.color = params.color;

  cmdSheet.appendRow([
    id, 'updateSeries', JSON.stringify(cmdParams), 'pending', ts, '', ''
  ]);

  return { requestId: id, status: 'queued', message: 'Series update queued. Poll with getCommandResult in ~60 seconds.' };
}

function deleteSeries_(params) {
  var sheet = getSheet_(CONFIG.SHEET_NAMES.EVENTS);
  var rowNum = findRowIndex_(sheet, EVT.SHEET_EVENT_ID, params.eventId);
  if (rowNum < 0) return { error: 'Event not found' };

  var data = sheet.getRange(rowNum, 1, 1, 23).getValues()[0];
  var extra = {};
  try { extra = JSON.parse(data[EVT.EXTRA_PROPS_JSON] || '{}'); } catch(e) {}

  if (!extra.recurringEventId) {
    return { error: 'Event is not a recurring instance. Use deleteEvent for non-recurring events.' };
  }

  var googleCalId = data[EVT.GOOGLE_CAL_ID];
  if (!googleCalId) return { error: 'Event has no linked Google Calendar ID yet. Wait for sync.' };

  var cmdSheet = getSheet_(CONFIG.SHEET_NAMES.COMMAND_QUEUE);
  var id = uuid_();
  var ts = now_();

  cmdSheet.appendRow([
    id,
    'deleteSeries',
    JSON.stringify({
      recurringEventId: extra.recurringEventId,
      googleCalId: googleCalId
    }),
    'pending', ts, '', ''
  ]);

  return { requestId: id, status: 'queued', message: 'Series deletion queued. Poll with getCommandResult in ~60 seconds.' };
}

// ── Smart Scheduling Actions (Async) ───────────────────────────────────────────

function checkAvailability_(params) {
  var cmdSheet = getSheet_(CONFIG.SHEET_NAMES.COMMAND_QUEUE);
  var id = uuid_();
  var ts = now_();
  cmdSheet.appendRow([
    id,                                       // commandId
    'checkAvailability',                      // action
    JSON.stringify({
      emails: params.emails || [],
      startTime: params.startTime || '',
      endTime: params.endTime || ''
    }),                                       // params
    'pending',                                // status
    ts,                                       // createdAt
    '',                                       // processedAt
    ''                                        // result
  ]);
  return { requestId: id, status: 'queued', message: 'Availability check queued. Poll with getCommandResult in ~60 seconds.' };
}

function findSlots_(params) {
  var cmdSheet = getSheet_(CONFIG.SHEET_NAMES.COMMAND_QUEUE);
  var id = uuid_();
  var ts = now_();
  cmdSheet.appendRow([
    id,                                       // commandId
    'findSlots',                              // action
    JSON.stringify({
      attendees: params.attendees || [],
      duration: params.duration || 30,
      startDate: params.startDate || '',
      endDate: params.endDate || '',
      workingHoursStart: params.workingHoursStart || '09:00',
      workingHoursEnd: params.workingHoursEnd || '17:00',
      preferMorning: params.preferMorning || false
    }),                                       // params
    'pending',                                // status
    ts,                                       // createdAt
    '',                                       // processedAt
    ''                                        // result
  ]);
  return { requestId: id, status: 'queued', message: 'Slot search queued. Poll with getCommandResult in ~60 seconds.' };
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

// ── Utility Actions ────────────────────────────────────────────────────────────

function syncNow_() {
  var cmdSheet = getSheet_(CONFIG.SHEET_NAMES.COMMAND_QUEUE);
  var id = uuid_();
  var ts = now_();
  cmdSheet.appendRow([
    id, 'syncNow', '', 'pending', ts, '', ''
  ]);
  return { requestId: id, status: 'queued', message: 'Sync requested. Will execute on next cycle.' };
}

// ── Formatting ─────────────────────────────────────────────────────────────────

function formatEvent_(row) {
  var event = {
    id: row.sheetEventId || '',
    title: row.title || '',
    description: row.description || '',
    location: row.location || '',
    startTime: row.startTime || '',
    endTime: row.endTime || '',
    isAllDay: String(row.isAllDay) === 'true' || row.isAllDay === true,
    status: row.status || 'confirmed',
    organizer: row.organizer || '',
    myRsvp: row.myRsvp || '',
    eventType: row.eventType || 'default',
    color: row.color || '',
    meetLink: row.meetLink || '',
    calendarId: row.sheetCalId || '',
    updated: row.updatedAt || row.syncedAt || '',
    kind: 'calendar#event'
  };

  if (row.attendeesJson) {
    try { event.attendees = JSON.parse(row.attendeesJson); } catch(e) { event.attendees = []; }
  }

  if (row.extraPropsJson) {
    try {
      var extra = JSON.parse(row.extraPropsJson);
      if (extra.recurrenceRule) event.recurrenceRule = extra.recurrenceRule;
      if (extra.recurringEventId) event.recurringEventId = extra.recurringEventId;
      if (extra.visibility) event.visibility = extra.visibility;
      if (extra.transparency) event.transparency = extra.transparency;
      if (extra.statusProps) event.statusProps = extra.statusProps;
    } catch(e) {}
  }

  return event;
}

function formatEventFromArray_(arr) {
  var event = {
    id: arr[EVT.SHEET_EVENT_ID] || '',
    title: arr[EVT.TITLE] || '',
    description: arr[EVT.DESCRIPTION] || '',
    location: arr[EVT.LOCATION] || '',
    startTime: arr[EVT.START_TIME] || '',
    endTime: arr[EVT.END_TIME] || '',
    isAllDay: String(arr[EVT.IS_ALL_DAY]) === 'true' || arr[EVT.IS_ALL_DAY] === true,
    status: arr[EVT.STATUS] || 'confirmed',
    organizer: arr[EVT.ORGANIZER] || '',
    myRsvp: arr[EVT.MY_RSVP] || '',
    eventType: arr[EVT.EVENT_TYPE] || 'default',
    color: arr[EVT.COLOR] || '',
    meetLink: arr[EVT.MEET_LINK] || '',
    calendarId: arr[EVT.SHEET_CAL_ID] || '',
    updated: arr[EVT.UPDATED_AT] || '',
    kind: 'calendar#event'
  };

  if (arr[EVT.ATTENDEES_JSON]) {
    try { event.attendees = JSON.parse(arr[EVT.ATTENDEES_JSON]); } catch(e) { event.attendees = []; }
  }

  if (arr[EVT.EXTRA_PROPS_JSON]) {
    try {
      var extra = JSON.parse(arr[EVT.EXTRA_PROPS_JSON]);
      if (extra.recurrenceRule) event.recurrenceRule = extra.recurrenceRule;
      if (extra.recurringEventId) event.recurringEventId = extra.recurringEventId;
      if (extra.visibility) event.visibility = extra.visibility;
      if (extra.transparency) event.transparency = extra.transparency;
      if (extra.statusProps) event.statusProps = extra.statusProps;
    } catch(e) {}
  }

  return event;
}
