#!/bin/bash
# Google Tasks CLI - wrapper for the PersonalProxy Apps Script web app
# Usage: tasks.sh <action> ['{"param": "value"}']
# All requests are POST with JSON body containing action, key, and params.

set -euo pipefail

GOOGLE_TASKS_URL="__GOOGLE_TASKS_URL__"
GOOGLE_TASKS_KEY="__GOOGLE_TASKS_KEY__"

ACTION="${1:?Usage: tasks.sh <action> [JSON params]}"
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
    "listTaskLists":  { "required": [], "optional": [] },
    "getTaskList":    { "required": ["taskListId"], "optional": [] },
    "createTaskList": { "required": ["title"], "optional": [] },
    "updateTaskList": { "required": ["taskListId"], "optional": ["title"] },
    "deleteTaskList": { "required": ["taskListId"], "optional": [] },
    "listTasks":      { "required": ["taskListId"], "optional": ["showCompleted", "showHidden"] },
    "getTask":        { "required": ["taskId"], "optional": [] },
    "createTask":     { "required": ["taskListId", "title"], "optional": ["notes", "due", "parent", "position", "links"] },
    "updateTask":     { "required": ["taskId"], "optional": ["title", "notes", "due", "status", "completed"] },
    "deleteTask":     { "required": ["taskId"], "optional": [] },
    "completeTask":   { "required": ["taskId"], "optional": [] },
    "uncompleteTask": { "required": ["taskId"], "optional": [] },
    "moveTask":       { "required": ["taskId"], "optional": ["parent", "previous", "destinationTaskList"] },
    "clearCompleted": { "required": ["taskListId"], "optional": [] }
  },
  "aliases": {
    "listId": "taskListId", "list_id": "taskListId", "list": "taskListId",
    "id": "taskId", "task_id": "taskId",
    "dueDate": "due", "deadline": "due", "date": "due",
    "name": "title", "subject": "title", "summary": "title",
    "body": "notes", "description": "notes", "note": "notes", "content": "notes",
    "dest": "destinationTaskList", "destination": "destinationTaskList", "targetList": "destinationTaskList"
  },
  "dateFields": {
    "due": "^[0-9]{4}-[0-9]{2}-[0-9]{2}T00:00:00\\.000Z$",
    "completed": "^[0-9]{4}-[0-9]{2}-[0-9]{2}T00:00:00\\.000Z$"
  },
  "enums": {
    "updateTask": { "status": ["needsAction", "completed"] }
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

    # 4. Date format validation
    else
      [$params | to_entries[] |
        .key as $dk | .value as $dv |
        select($s.dateFields | has($dk)) |
        select($dv | tostring | test($s.dateFields[$dk]) | not) |
        {key: $dk, value: $dv}
      ] as $bad_dates |
      if ($bad_dates | length) > 0 then
        ($bad_dates | map("  - \"\(.key)\" = \"\(.value)\" (expected format: YYYY-MM-DDT00:00:00.000Z)") | join("\n")) as $details |
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
' 2>&1) || true

if [[ -n "$VALIDATION_ERROR" ]]; then
  echo -e "$VALIDATION_ERROR" >&2
  exit 1
fi
# --- End Validation ---

# Build the request body
if [[ "$PARAMS" != "{}" ]]; then
  BODY=$(echo "$PARAMS" | jq -c ". + {\"action\": \"$ACTION\", \"key\": \"$GOOGLE_TASKS_KEY\"}")
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
