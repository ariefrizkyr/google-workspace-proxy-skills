---
name: google-calendar
description: Manage Google Calendar via natural language. Use when the user mentions calendar, meetings, schedule, appointments, availability, or time management. Triggers include asking about today's/tomorrow's/this week's schedule, creating meetings or events, checking availability, finding meeting times, scheduling with specific people, RSVPing to invitations, creating out-of-office or focus time, checking holidays, rescheduling, cancelling meetings, or any phrase like "what's on my calendar", "schedule a meeting", "am I free", "book time with", "block my calendar", "set up a call with", "when is X available", "out of office".
---
# Google Calendar

Manage Google Calendar through a spreadsheet-proxy architecture. Claude calls a personal Gmail Apps Script web app, which reads/writes a shared Google Spreadsheet. A work-email Apps Script syncs the spreadsheet with Google Calendar every minute.

```
Claude → calendar.sh → Personal Gmail Apps Script → Spreadsheet ↔ Work Email Apps Script → Google Calendar
```

## Execution

Run `scripts/calendar.sh` with the action and JSON params:

```
"__SKILL_DIR__/scripts/calendar.sh" <action> ['{"param": "value"}']
```

For full API actions reference, see `references/api-actions.md`.

## Sync behavior

- Write operations take effect in the spreadsheet immediately. Sync to Google Calendar happens within 1-2 minutes.
- Read operations return data from the spreadsheet (reflects last sync).
- IDs are spreadsheet UUIDs, not Google Calendar event IDs.
- Conflict resolution: last-write-wins. Claude's pending changes push before pulling from Google.
- Async commands (findSlots, checkAvailability) are queued and processed by the next sync cycle. Use `getCommandResult` to poll for results.

## Multi-calendar support

The system syncs multiple calendars, each tagged with a **type**:

| Type | Description | Scheduling behavior |
|------|-------------|-------------------|
| `primary` | User's own work calendar | Full read/write. Checked for conflicts. |
| `coworker` | Subscribed coworker calendars | Read-only. Used for FreeBusy scheduling. |
| `holiday` | HR/People team shared calendar | Read-only. Overlapping events generate **warnings** (not exclusions) since holidays vary by country. |
| `shared` | Team/project shared calendars | Read-only. Checked for conflicts. |
| `resource` | Meeting rooms, equipment | Read-only. Used for availability. |

## Workflow

### 1. Map intent to action

**View schedule:**
- "what's on my calendar today", "my schedule", "what meetings do I have" → `todaySchedule`
- "what's this week look like", "my week" → `weekSchedule`
- "show events from March 1 to 15" → `listEvents`
- "find meetings about project alpha" → `searchEvents`
- "any holidays coming up", "company holidays this month" → `listHolidays`
- "who's attending the standup" → `getEvent` (check attendeesJson)

**Create events:**
- "schedule a meeting with X at 2pm", "set up a call" → `createEvent`
- "block March 5 as all-day event" → `createAllDayEvent`
- "set up a weekly standup every Monday" → `createRecurringEvent`
- "I'll be out of office March 10-14" → `createOutOfOffice`
- "block focus time tomorrow 9-12" → `createFocusTime`

**Modify events:**
- "rename the meeting to X", "change location to Y", "add description" → `updateEvent`
- "move the meeting to 3pm", "reschedule to Friday" → `updateEvent` (update startTime/endTime)
- "cancel the standup", "delete tomorrow's meeting" → `deleteEvent`
- "accept the invitation", "decline the meeting", "mark as tentative" → `rsvpEvent`
- "add Sarah to the meeting" → `addGuest`
- "remove Bob from the invite" → `removeGuest`
- "change all standup times to 10am", "update the series" → ask scope → `updateSeries` (all instances) or `updateEvent` (single instance)
- "cancel all the 1-on-1s", "delete the recurring series" → ask scope → `deleteSeries` (all instances) or `deleteEvent` (single instance)

**Smart scheduling:**
- "when is Ardian free tomorrow", "check Ardian's availability" → `checkAvailability`
- "find a 30-min slot with Ardian and Sarah this week" → `findSlots`
- "schedule a meeting with X" (no time specified) → `findSlots` first, then `createEvent`

**Calendar management:**
- "show my calendars" → `listCalendars`
- "start syncing Ardian's calendar" → `enableCalendarSync`
- "stop syncing the project calendar" → `disableCalendarSync`

### 2. Resolve IDs

Always resolve IDs before any operation — never guess.

1. For calendar-specific operations, call `listCalendars` to find the calendar ID.
2. For event operations, call `listEvents` or `searchEvents` to find the event, matching user's description to event title (case-insensitive, partial match OK).
3. If multiple matches, ask the user which one. If no match, say so.
4. For scheduling with people, use `listCalendars` to find coworker calendar IDs by name/email.

### 3. Handle dates and times

Convert relative dates/times to ISO 8601 format:
- Dates: `YYYY-MM-DD` (for all-day events)
- Datetimes: `YYYY-MM-DDTHH:mm:ss+07:00` (with timezone offset, default Asia/Jakarta +07:00)
- "today" → current date, "tomorrow" → +1 day, "next Monday" → calculate
- "2pm" → `14:00:00`, "9:30 AM" → `09:30:00`
- For date ranges, set start/end boundaries appropriately.
- Default meeting duration is 30 minutes if not specified.
- Default timezone is Asia/Jakarta (UTC+7) unless user specifies otherwise.

### 4. Smart scheduling workflow

When user wants to schedule with someone without specifying a time:

1. Call `findSlots` with attendees, duration, and date range.
2. Tell user: "Let me check availability. This takes about a minute..."
3. Wait ~60 seconds, then call `getCommandResult` with the requestId.
4. If status is still "processing", wait another 30 seconds and retry (max 3 attempts).
5. Present the available slots with any warnings (holidays, etc.).
6. Once user picks a slot, call `createEvent`.

### 5. Present results

**Schedule view:**
```
## Today — Tue, Feb 25, 2026

09:00 - 09:30  Daily Standup (Google Meet)
               Attendees: Alice, Bob, You
10:00 - 11:00  Project Review — Room 5A
               Organizer: Sarah
12:00 - 13:00  Lunch with Client — Cafe Milano
14:00 - 15:00  [Focus Time]

⚠ Hari Raya Nyepi (Indonesia) — from HR Calendar
```

**Slot suggestions:**
```
## Available slots for 30-min call with Ardian

1. Tomorrow 09:00 - 09:30 — both free
2. Tomorrow 14:00 - 14:30 — both free
3. Thu 10:00 - 10:30 — both free ⚠ Hari Raya Nyepi (Indonesia)

Which slot works? Or pick a different time.
```

**Formatting rules:**
- Show time in 24h format (HH:mm).
- Group events by day with date headers.
- Show Google Meet link if available.
- Show attendee names (not emails) when possible.
- Show calendar source for non-primary events (e.g., "from HR Calendar").
- Show warnings with ⚠ prefix for holiday overlaps.
- Be concise in confirmations for create/update/delete.
- For destructive operations (delete), confirm with the user first.
- If multiple steps needed (e.g., "schedule 3 meetings"), execute sequentially.

### 6. Out of Office and Focus Time

**Out of Office:**
- Auto-declines conflicting invitations.
- User can choose: decline all, decline only new, or decline none.
- Default: `declineAllConflictingInvitations`.
- Always ask for decline message (default: "I am out of office and will respond when I return.").

**Focus Time:**
- Sets chat status to Do Not Disturb.
- Auto-declines new conflicting invitations by default.
- Default: `declineOnlyNewConflictingInvitations`.

### 7. Holiday awareness

Events from calendars with type `holiday` are treated as **warnings**, not exclusions:
- When scheduling, slots overlapping holidays get a score penalty and a warning label.
- The warning includes the holiday name and country context (parsed from event title).
- Claude should surface the warning and let the user decide whether to proceed.
- Reason: holidays vary by country, and the HR calendar lists all countries' holidays.

### 8. Recurring event handling

**Identifying recurring events:** Events that are part of a recurring series have a `recurringEventId` field in their response. This field links all instances to the same parent series.

**Always ask about scope:** When the user wants to modify or delete a recurring event, ask whether they mean just this instance or the entire series before proceeding.

**Scope mapping:**
- **This instance only** → use `updateEvent` / `deleteEvent` with the instance's `eventId` (synchronous, same as non-recurring)
- **All instances (entire series)** → use `updateSeries` / `deleteSeries` with any instance's `eventId` (async — poll with `getCommandResult`)

**"This and following instances"** is not supported. If the user wants this, suggest: delete the series, then create a new recurring event starting from the desired date.

**Workflow — update a series:**
1. Find the event: `searchEvents` or `listEvents` to get an instance's `eventId`
2. Confirm it's recurring: check for `recurringEventId` in the response
3. Ask user: "Do you want to change just this occurrence, or all instances of the series?"
4. If all instances: call `updateSeries '{"eventId": "<instance-uuid>", "startTime": "...", "endTime": "..."}'`
5. Tell user: "Updating the series. This takes about a minute..."
6. Poll with `getCommandResult` after ~60 seconds

**Workflow — delete a series:**
1. Find the event and confirm it's recurring (same as above)
2. Ask user: "Do you want to cancel just this occurrence, or the entire series?"
3. If entire series: call `deleteSeries '{"eventId": "<instance-uuid>"}'`
4. Poll with `getCommandResult` after ~60 seconds
