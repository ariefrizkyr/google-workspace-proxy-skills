#!/bin/bash
# Google Drive CLI - wrapper for the PersonalProxy Apps Script web app
# Usage: drive.sh <action> ['{"param": "value"}']
# All requests are POST with JSON body containing action, key, and params.

set -euo pipefail

GOOGLE_DRIVE_URL="__GOOGLE_DRIVE_URL__"
GOOGLE_DRIVE_KEY="__GOOGLE_DRIVE_KEY__"

ACTION="${1:?Usage: drive.sh <action> [JSON params]}"
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
    "listFiles":             { "required": [], "optional": ["folderId", "mimeType", "starred", "trashed", "query"] },
    "getFile":               { "required": ["fileId"], "optional": [] },
    "listRecentFiles":       { "required": [], "optional": ["limit"] },
    "listFolders":           { "required": [], "optional": ["parentId"] },
    "createFolder":          { "required": ["name"], "optional": ["parentId", "description"] },
    "createFile":            { "required": ["name", "content"], "optional": ["parentId", "mimeType", "description"] },
    "createDocument":        { "required": ["name"], "optional": ["parentId", "description"] },
    "createSpreadsheet":     { "required": ["name"], "optional": ["parentId", "description"] },
    "createPresentation":    { "required": ["name"], "optional": ["parentId", "description"] },
    "renameFile":            { "required": ["fileId", "name"], "optional": [] },
    "updateDescription":     { "required": ["fileId", "description"], "optional": [] },
    "starFile":              { "required": ["fileId"], "optional": [] },
    "unstarFile":            { "required": ["fileId"], "optional": [] },
    "trashFile":             { "required": ["fileId"], "optional": [] },
    "restoreFile":           { "required": ["fileId"], "optional": [] },
    "searchFiles":           { "required": ["query"], "optional": ["mimeType", "folderId", "trashed"] },
    "listFolderContents":    { "required": ["folderId"], "optional": [] },
    "moveFile":              { "required": ["fileId", "destinationFolderId"], "optional": [] },
    "copyFile":              { "required": ["fileId"], "optional": ["name", "destinationFolderId"] },
    "shareFile":             { "required": ["fileId", "email", "role"], "optional": ["sendNotification", "message"] },
    "unshareFile":           { "required": ["fileId", "email"], "optional": [] },
    "getPermissions":        { "required": ["fileId"], "optional": [] },
    "setPublicAccess":       { "required": ["fileId"], "optional": ["role"] },
    "removePublicAccess":    { "required": ["fileId"], "optional": [] },
    "exportFile":            { "required": ["fileId", "exportMimeType"], "optional": [] },
    "getFileContent":        { "required": ["fileId"], "optional": [] },
    "listRevisions":         { "required": ["fileId"], "optional": [] },
    "getRevision":           { "required": ["fileId", "revisionId"], "optional": [] },
    "listComments":          { "required": ["fileId"], "optional": [] },
    "addComment":            { "required": ["fileId", "content"], "optional": [] },
    "deleteComment":         { "required": ["fileId", "commentId"], "optional": [] },
    "listReplies":           { "required": ["fileId", "commentId"], "optional": [] },
    "addReply":              { "required": ["fileId", "commentId", "content"], "optional": [] },
    "listSharedDrives":      { "required": [], "optional": [] },
    "getStorageInfo":        { "required": [], "optional": [] },
    "emptyTrash":            { "required": [], "optional": [] },
    "getCommandResult":      { "required": ["requestId"], "optional": [] },
    "syncNow":               { "required": [], "optional": [] }
  },
  "aliases": {
    "id": "fileId", "file": "fileId", "file_id": "fileId",
    "title": "name", "filename": "name",
    "destination": "destinationFolderId", "destFolder": "destinationFolderId", "dest": "destinationFolderId",
    "type": "mimeType", "mime": "mimeType",
    "search": "query", "keyword": "query", "q": "query",
    "format": "exportMimeType", "export": "exportMimeType", "exportFormat": "exportMimeType",
    "revision": "revisionId", "rev": "revisionId", "revision_id": "revisionId",
    "comment": "commentId", "comment_id": "commentId",
    "text": "content", "body": "content",
    "desc": "description", "details": "description", "note": "description", "notes": "description",
    "parent": "parentId", "folder": "folderId", "parent_id": "parentId", "folder_id": "folderId",
    "star": "starred",
    "trash": "trashed",
    "notify": "sendNotification", "notification": "sendNotification",
    "msg": "message",
    "request_id": "requestId", "requestid": "requestId"
  },
  "enums": {
    "shareFile": { "role": ["editor", "viewer", "commenter"] },
    "setPublicAccess": { "role": ["editor", "viewer", "commenter"] },
    "exportFile": { "exportMimeType": [
      "application/pdf",
      "text/plain",
      "text/html",
      "text/csv",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "image/png",
      "image/svg+xml"
    ] }
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

    # 4. Enum validation
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
' 2>&1) || true

if [[ -n "$VALIDATION_ERROR" ]]; then
  echo -e "$VALIDATION_ERROR" >&2
  exit 1
fi
# --- End Validation ---

# Build the request body
if [[ "$PARAMS" != "{}" ]]; then
  BODY=$(echo "$PARAMS" | jq -c ". + {\"action\": \"$ACTION\", \"key\": \"$GOOGLE_DRIVE_KEY\"}")
else
  BODY=$(jq -nc "{\"action\": \"$ACTION\", \"key\": \"$GOOGLE_DRIVE_KEY\"}")
fi

# Make the HTTP request
RESPONSE=$(curl -sL --max-time 120 \
  -H "Content-Type: application/json" \
  -d "$BODY" \
  "$GOOGLE_DRIVE_URL")

# Pretty-print the response
echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"
