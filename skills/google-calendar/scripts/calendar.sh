#!/bin/bash
# Google Calendar CLI - wrapper for the PersonalProxy Apps Script web app
# Usage: calendar.sh <action> ['{"param": "value"}']
# All requests are POST with JSON body containing action, key, and params.

set -euo pipefail

GOOGLE_CALENDAR_URL="__GOOGLE_CALENDAR_URL__"
GOOGLE_CALENDAR_KEY="__GOOGLE_CALENDAR_KEY__"

ACTION="${1:?Usage: calendar.sh <action> [JSON params]}"
shift

# Parse params
PARAMS="{}"
if [[ $# -gt 0 ]]; then
  PARAMS="$1"
  if ! echo "$PARAMS" | jq empty 2>/dev/null; then
    echo "ERROR: Invalid JSON payload: $PARAMS" >&2
    exit 1
  fi
fi

# --- Payload Validation ---
VALIDATION_ERROR=$(echo "$PARAMS" | jq -r --arg action "$ACTION" '
def schema: {
  "actions": {
    "listCalendars":        { "required": [], "optional": [] },
    "getCalendar":          { "required": ["calendarId"], "optional": [] },
    "enableCalendarSync":   { "required": ["calendarId"], "optional": [] },
    "disableCalendarSync":  { "required": ["calendarId"], "optional": [] },
    "listEvents":           { "required": ["startDate", "endDate"], "optional": ["calendarId"] },
    "getEvent":             { "required": ["eventId"], "optional": [] },
    "searchEvents":         { "required": ["query"], "optional": ["startDate", "endDate"] },
    "todaySchedule":        { "required": [], "optional": [] },
    "weekSchedule":         { "required": [], "optional": [] },
    "listHolidays":         { "required": [], "optional": ["startDate", "endDate"] },
    "createEvent":          { "required": ["title", "startTime", "endTime"], "optional": ["calendarId", "description", "location", "guests", "createMeetLink", "sendNotifications", "color", "visibility", "reminders"] },
    "createAllDayEvent":    { "required": ["title", "startDate"], "optional": ["endDate", "calendarId", "description", "location", "guests"] },
    "createRecurringEvent": { "required": ["title", "startTime", "endTime", "recurrenceRule"], "optional": ["calendarId", "description", "location", "guests", "createMeetLink"] },
    "createOutOfOffice":    { "required": ["startTime", "endTime"], "optional": ["title", "declineMode", "declineMessage"] },
    "createFocusTime":      { "required": ["startTime", "endTime"], "optional": ["title", "declineMode", "declineMessage"] },
    "updateEvent":          { "required": ["eventId"], "optional": ["title", "description", "location", "startTime", "endTime", "color", "visibility"] },
    "deleteEvent":          { "required": ["eventId"], "optional": [] },
    "rsvpEvent":            { "required": ["eventId", "status"], "optional": [] },
    "addGuest":             { "required": ["eventId", "email"], "optional": [] },
    "removeGuest":          { "required": ["eventId", "email"], "optional": [] },
    "updateSeries":         { "required": ["eventId"], "optional": ["title", "description", "location", "startTime", "endTime", "color"] },
    "deleteSeries":         { "required": ["eventId"], "optional": [] },
    "checkAvailability":    { "required": ["emails", "startTime", "endTime"], "optional": [] },
    "findSlots":            { "required": ["attendees", "duration", "startDate", "endDate"], "optional": ["workingHoursStart", "workingHoursEnd", "preferMorning"] },
    "getCommandResult":     { "required": ["requestId"], "optional": [] },
    "syncNow":              { "required": [], "optional": [] }
  },
  "aliases": {
    "attendees": "guests", "invitees": "guests", "participants": "guests",
    "search": "query", "keyword": "query", "q": "query",
    "name": "title", "subject": "title", "summary": "title",
    "body": "description", "desc": "description", "text": "description", "details": "description", "note": "description", "notes": "description",
    "start": "startTime", "startAt": "startTime", "from": "startTime", "begin": "startTime",
    "end": "endTime", "endAt": "endTime", "to": "endTime",
    "date": "startDate", "start_date": "startDate", "fromDate": "startDate",
    "end_date": "endDate", "toDate": "endDate",
    "place": "location", "where": "location", "venue": "location", "room": "location",
    "response": "status", "rsvp": "status", "reply": "status",
    "event_id": "eventId", "id": "eventId", "event": "eventId",
    "calendar_id": "calendarId", "cal": "calendarId", "calId": "calendarId",
    "meetLink": "createMeetLink", "meet": "createMeetLink", "googleMeet": "createMeetLink",
    "notify": "sendNotifications", "notification": "sendNotifications",
    "recurrence": "recurrenceRule", "rrule": "recurrenceRule", "repeat": "recurrenceRule",
    "decline": "declineMode", "autoDecline": "declineMode",
    "message": "declineMessage",
    "request_id": "requestId", "requestid": "requestId"
  },
  "dateTimeFields": {
    "startTime": "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[+-][0-9]{2}:[0-9]{2}$",
    "endTime": "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[+-][0-9]{2}:[0-9]{2}$"
  },
  "dateFields": {
    "startDate": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
    "endDate": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
  },
  "enums": {
    "rsvpEvent": { "status": ["accepted", "declined", "tentative", "needsAction"] },
    "createOutOfOffice": { "declineMode": ["declineNone", "declineAllConflictingInvitations", "declineOnlyNewConflictingInvitations"] },
    "createFocusTime": { "declineMode": ["declineNone", "declineAllConflictingInvitations", "declineOnlyNewConflictingInvitations"] },
    "createEvent": { "visibility": ["default", "public", "private", "confidential"] },
    "updateEvent": { "visibility": ["default", "public", "private", "confidential"] }
  }
};

. as $params |
schema as $s |
($s.actions | keys) as $valid_actions |

# 1. Validate action name
if ($s.actions | has($action) | not) then
  ($valid_actions | map(select(ascii_downcase == ($action | ascii_downcase)))) as $ci_match |
  if ($ci_match | length) > 0 then
    "ERROR: Unknown action \"\($action)\". Did you mean \"\($ci_match[0])\"?"
  else
    ($valid_actions | map(select(
      ($action | ascii_downcase) as $low |
      ascii_downcase | contains($low[0:4])
    ))) as $partial |
    if ($partial | length) > 0 then
      "ERROR: Unknown action \"\($action)\". Did you mean \"\($partial[0])\"?\n  Valid actions: \($valid_actions | join(", "))"
    else
      "ERROR: Unknown action \"\($action)\".\n  Valid actions: \($valid_actions | join(", "))"
    end
  end
else
  $s.actions[$action] as $act |
  ($act.required + $act.optional) as $all_allowed |
  ($params | keys | map(select(. != "action" and . != "key"))) as $provided |

  # 2. Check for unknown params
  [$provided[] | select(. as $p | $all_allowed | index($p) | not)] as $unknown |
  if ($unknown | length) > 0 then
    ($unknown | map(
      . as $u |
      if ($s.aliases | has($u)) then
        "  - \"\($u)\" -> did you mean \"\($s.aliases[$u])\"?"
      else
        "  - \"\($u)\" (not recognized)"
      end
    ) | join("\n")) as $suggestions |
    ($all_allowed | map(. as $f | if ($act.required | index($f)) then $f + "*" else $f end) | join(", ")) as $allowed_str |
    "ERROR [\($action)]: Unknown parameter(s):\n\($suggestions)\n  Allowed: \($allowed_str)"

  # 3. Check required params
  else
    [$act.required[] | select(. as $r | $provided | index($r) | not)] as $missing |
    if ($missing | length) > 0 then
      "ERROR [\($action)]: Missing required parameter(s): \($missing | map("\"" + . + "\"") | join(", "))\n  Required: \($act.required | map(. + "*") | join(", "))\n  Optional: \($act.optional | join(", "))"

    # 4. DateTime format validation (ISO 8601 with timezone offset)
    else
      [$params | to_entries[] |
        .key as $dk | .value as $dv |
        select($s.dateTimeFields | has($dk)) |
        select($dv | tostring | test($s.dateTimeFields[$dk]) | not) |
        {key: $dk, value: $dv, format: "YYYY-MM-DDTHH:MM:SS+HH:MM"}
      ] as $bad_datetimes |
      if ($bad_datetimes | length) > 0 then
        ($bad_datetimes | map("  - \"\(.key)\" = \"\(.value)\" (expected format: \(.format))") | join("\n")) as $details |
        "ERROR [\($action)]: Invalid datetime format:\n\($details)"

      # 4b. Date-only format validation (YYYY-MM-DD)
      else
        [$params | to_entries[] |
          .key as $dk | .value as $dv |
          select($s.dateFields | has($dk)) |
          select($dv | tostring | test($s.dateFields[$dk]) | not) |
          {key: $dk, value: $dv}
        ] as $bad_dates |
        if ($bad_dates | length) > 0 then
          ($bad_dates | map("  - \"\(.key)\" = \"\(.value)\" (expected format: YYYY-MM-DD)") | join("\n")) as $details |
          "ERROR [\($action)]: Invalid date format:\n\($details)"

        # 5. Enum validation
        else
          [$s.enums[$action] // {} | to_entries[] |
            .key as $ek | .value as $ev |
            select($params | has($ek)) |
            select(($params[$ek] | tostring) as $v | $ev | index($v) | not) |
            {key: $ek, value: $ev, actual: $params[$ek]}
          ] as $bad_enums |
          if ($bad_enums | length) > 0 then
            ($bad_enums | map("  - \"\(.key)\" = \"\(.actual)\" (allowed: \(.value | join(", ")))") | join("\n")) as $details |
            "ERROR [\($action)]: Invalid enum value:\n\($details)"
          else
            empty
          end
        end
      end
    end
  end
end
' 2>&1) || true

if [[ -n "$VALIDATION_ERROR" ]]; then
  echo -e "$VALIDATION_ERROR" >&2
  exit 1
fi
# --- End Validation ---

# Build the request body
if [[ "$PARAMS" != "{}" ]]; then
  BODY=$(echo "$PARAMS" | jq -c ". + {\"action\": \"$ACTION\", \"key\": \"$GOOGLE_CALENDAR_KEY\"}")
else
  BODY=$(jq -nc "{\"action\": \"$ACTION\", \"key\": \"$GOOGLE_CALENDAR_KEY\"}")
fi

# Make the HTTP request
RESPONSE=$(curl -sL \
  -H "Content-Type: application/json" \
  -d "$BODY" \
  "$GOOGLE_CALENDAR_URL")

# Pretty-print the response
echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"
