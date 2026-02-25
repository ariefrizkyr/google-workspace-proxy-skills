# Google Calendar API Actions Reference

All actions are called via `calendar.sh <action> ['{"param": "value"}']`. Every request is POST with JSON body.

## Calendar management

| Action | Params | Description |
|--------|--------|-------------|
| `listCalendars` | — | List all synced calendars with type/sync status |
| `getCalendar` | `calendarId` | Get details of a specific calendar |
| `enableCalendarSync` | `calendarId` | Start syncing a calendar |
| `disableCalendarSync` | `calendarId` | Stop syncing a calendar |

## Event read

| Action | Params | Description |
|--------|--------|-------------|
| `listEvents` | `startDate`, `endDate`, `calendarId`(opt) | Get events in date range, optionally filtered by calendar |
| `getEvent` | `eventId` | Get full event details including attendees |
| `searchEvents` | `query`, `startDate`(opt), `endDate`(opt) | Text search across all synced calendars |
| `todaySchedule` | — | Get today's events across all synced calendars |
| `weekSchedule` | — | Get this week's events (Mon-Sun) across all synced calendars |
| `listHolidays` | `startDate`(opt), `endDate`(opt) | Get events from holiday-type calendars. Defaults to next 30 days. |

## Event write

| Action | Params | Description |
|--------|--------|-------------|
| `createEvent` | `title`, `startTime`, `endTime`, `calendarId`(opt), `description`(opt), `location`(opt), `guests`(opt), `createMeetLink`(opt), `sendNotifications`(opt), `color`(opt), `visibility`(opt), `reminders`(opt) | Create a timed event |
| `createAllDayEvent` | `title`, `startDate`, `endDate`(opt), `calendarId`(opt), `description`(opt), `location`(opt), `guests`(opt) | Create an all-day or multi-day event |
| `createRecurringEvent` | `title`, `startTime`, `endTime`, `recurrenceRule`, `calendarId`(opt), `description`(opt), `location`(opt), `guests`(opt), `createMeetLink`(opt) | Create a recurring event series |
| `createOutOfOffice` | `startTime`, `endTime`, `title`(opt), `declineMode`(opt), `declineMessage`(opt) | Create out-of-office event on primary calendar |
| `createFocusTime` | `startTime`, `endTime`, `title`(opt), `declineMode`(opt), `declineMessage`(opt) | Create focus time block on primary calendar |
| `updateEvent` | `eventId`, plus any fields to update: `title`, `description`, `location`, `startTime`, `endTime`, `color`, `visibility` | Update event properties |
| `deleteEvent` | `eventId` | Delete an event |
| `rsvpEvent` | `eventId`, `status` | Set RSVP (accepted/declined/tentative) |
| `addGuest` | `eventId`, `email` | Add attendee to event |
| `removeGuest` | `eventId`, `email` | Remove attendee from event |
| `updateSeries` | `eventId` (any instance), plus fields: `title`, `description`, `location`, `startTime`, `endTime`, `color` | Update all instances of a recurring series (async) |
| `deleteSeries` | `eventId` (any instance) | Delete an entire recurring series (async) |

## Smart scheduling (async — use getCommandResult to poll)

| Action | Params | Description |
|--------|--------|-------------|
| `checkAvailability` | `emails`, `startTime`, `endTime` | Check free/busy for specific people in a time range |
| `findSlots` | `attendees`, `duration`, `startDate`, `endDate`, `workingHoursStart`(opt), `workingHoursEnd`(opt), `preferMorning`(opt) | Find available meeting slots for multiple attendees |
| `getCommandResult` | `requestId` | Poll for async command result |

## Utility

| Action | Params | Description |
|--------|--------|-------------|
| `syncNow` | — | Queue an immediate sync cycle |

## Date/time formats

- **Datetime**: ISO 8601 with timezone — `2026-03-01T10:00:00+07:00`
- **Date** (all-day events): `2026-03-01`
- Default timezone: Asia/Jakarta (UTC+7)

## RSVP status values

- `accepted` — Accepted the invitation
- `declined` — Declined the invitation
- `tentative` — Tentatively accepted
- `needsAction` — No response yet

## Event status values

- `confirmed` — Event is confirmed
- `tentative` — Event is tentative
- `cancelled` — Event is cancelled

## Event types

- `default` — Regular event
- `outOfOffice` — Out of office block
- `focusTime` — Focus time block

## Auto-decline modes (for OOO/Focus Time)

- `declineNone` — Don't auto-decline
- `declineAllConflictingInvitations` — Decline all conflicts
- `declineOnlyNewConflictingInvitations` — Only decline new invitations

## Calendar types

- `primary` — User's own work calendar (full read/write)
- `coworker` — Subscribed coworker calendar (read-only, used for scheduling)
- `holiday` — HR/People team calendar (read-only, generates warnings)
- `shared` — Team/project shared calendar (read-only)
- `resource` — Meeting rooms, equipment (read-only)

## Recurrence rule format

RFC 5545 RRULE strings as JSON array:
```json
["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"]
["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU"]
["RRULE:FREQ=MONTHLY;BYMONTHDAY=1"]
["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10"]
["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231T000000Z"]
```

## IDs

All IDs returned are spreadsheet UUIDs, not Google Calendar event IDs. Use these UUIDs in all subsequent API calls.

## Async commands

`checkAvailability`, `findSlots`, and `syncNow` are processed asynchronously by the sync engine. The response includes a `requestId`. Use `getCommandResult` to poll:

```bash
# Submit scheduling request
calendar.sh findSlots '{"attendees": ["ardian@company.com"], "duration": 30, "startDate": "2026-02-26", "endDate": "2026-02-28"}'
# Returns: {"requestId": "uuid", "status": "queued"}

# Poll for result (after ~60 seconds)
calendar.sh getCommandResult '{"requestId": "uuid"}'
# Returns: {"status": "completed", "result": {"slots": [...]}}
```

## Recurring event operations

Recurring events pulled from Google Calendar are stored as individual **instances**, each with a `recurringEventId` in their `extraPropsJson`. The parent series event itself is not stored in the spreadsheet (because `singleEvents: true` during pull).

**Instance scope** — modify a single occurrence:
- Use `updateEvent` / `deleteEvent` with the instance's `eventId`
- Works exactly like non-recurring events

**Series scope** — modify all instances:
- Use `updateSeries` / `deleteSeries` with any instance's `eventId`
- These are async commands — poll with `getCommandResult`
- The proxy extracts the `recurringEventId` and `googleCalId` from the instance, then the sync engine operates on the parent series via the Calendar API

**"This and following instances"** is not supported by the Google Calendar API for external clients. Workaround: delete the series and create a new one starting from the desired date.

## Examples

```bash
# Today's schedule
calendar.sh todaySchedule

# List events for a date range
calendar.sh listEvents '{"startDate": "2026-03-01", "endDate": "2026-03-07"}'

# Create a meeting
calendar.sh createEvent '{"title": "Sync with Ardian", "startTime": "2026-03-01T10:00:00+07:00", "endTime": "2026-03-01T10:30:00+07:00", "guests": "ardian@company.com", "createMeetLink": true, "sendNotifications": true}'

# Create all-day event
calendar.sh createAllDayEvent '{"title": "Team Offsite", "startDate": "2026-03-15", "endDate": "2026-03-16"}'

# Create recurring event
calendar.sh createRecurringEvent '{"title": "Weekly Standup", "startTime": "2026-03-02T09:00:00+07:00", "endTime": "2026-03-02T09:15:00+07:00", "recurrenceRule": ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"], "guests": "team@company.com", "createMeetLink": true}'

# Out of office
calendar.sh createOutOfOffice '{"startTime": "2026-03-10T00:00:00+07:00", "endTime": "2026-03-15T00:00:00+07:00", "declineMode": "declineAllConflictingInvitations", "declineMessage": "On leave, back March 15"}'

# Focus time
calendar.sh createFocusTime '{"startTime": "2026-03-01T09:00:00+07:00", "endTime": "2026-03-01T12:00:00+07:00", "title": "Deep Work"}'

# RSVP
calendar.sh rsvpEvent '{"eventId": "uuid-here", "status": "accepted"}'

# Find meeting slots
calendar.sh findSlots '{"attendees": ["ardian@company.com", "sarah@company.com"], "duration": 30, "startDate": "2026-03-01", "endDate": "2026-03-03", "workingHoursStart": "09:00", "workingHoursEnd": "17:00"}'

# Check availability
calendar.sh checkAvailability '{"emails": ["ardian@company.com"], "startTime": "2026-03-01T08:00:00+07:00", "endTime": "2026-03-01T18:00:00+07:00"}'

# Get async result
calendar.sh getCommandResult '{"requestId": "uuid-here"}'

# Search events
calendar.sh searchEvents '{"query": "standup"}'

# Holidays
calendar.sh listHolidays '{"startDate": "2026-03-01", "endDate": "2026-03-31"}'

# List calendars
calendar.sh listCalendars

# Add guest
calendar.sh addGuest '{"eventId": "uuid-here", "email": "newperson@company.com"}'

# Update all instances of a recurring series (change time)
calendar.sh updateSeries '{"eventId": "uuid-of-any-instance", "startTime": "2026-03-02T10:00:00+07:00", "endTime": "2026-03-02T10:30:00+07:00"}'

# Delete an entire recurring series
calendar.sh deleteSeries '{"eventId": "uuid-of-any-instance"}'

# Sync now
calendar.sh syncNow
```
