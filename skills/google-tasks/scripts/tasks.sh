#!/bin/bash
# Google Tasks CLI - wrapper for the PersonalProxy Apps Script web app
# Usage: tasks.sh <action> ['{"param": "value"}']
# All requests are POST with JSON body containing action, key, and params.

set -euo pipefail

GOOGLE_TASKS_URL="__GOOGLE_TASKS_URL__"
GOOGLE_TASKS_KEY="__GOOGLE_TASKS_KEY__"

ACTION="${1:?Usage: tasks.sh <action> [JSON params]}"
shift

# Build the request body
if [[ $# -gt 0 ]]; then
  # Merge provided JSON params with action and key
  BODY=$(echo "$1" | jq -c ". + {\"action\": \"$ACTION\", \"key\": \"$GOOGLE_TASKS_KEY\"}")
else
  BODY=$(jq -nc "{\"action\": \"$ACTION\", \"key\": \"$GOOGLE_TASKS_KEY\"}")
fi

# Make the HTTP request
RESPONSE=$(curl -sL \
  -H "Content-Type: application/json" \
  -d "$BODY" \
  "$GOOGLE_TASKS_URL")

# Pretty-print the response
echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"
