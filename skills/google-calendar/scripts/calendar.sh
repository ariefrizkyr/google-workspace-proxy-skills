#!/bin/bash
# Google Calendar CLI - wrapper for the PersonalProxy Apps Script web app
# Usage: calendar.sh <action> ['{"param": "value"}']
# All requests are POST with JSON body containing action, key, and params.

set -euo pipefail

GOOGLE_CALENDAR_URL="__GOOGLE_CALENDAR_URL__"
GOOGLE_CALENDAR_KEY="__GOOGLE_CALENDAR_KEY__"

ACTION="${1:?Usage: calendar.sh <action> [JSON params]}"
shift

# Build the request body
if [[ $# -gt 0 ]]; then
  # Merge provided JSON params with action and key
  BODY=$(echo "$1" | jq -c ". + {\"action\": \"$ACTION\", \"key\": \"$GOOGLE_CALENDAR_KEY\"}")
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
