#!/bin/bash
# Google Sheets CLI - wrapper for the PersonalProxy Apps Script web app
# Usage: sheets.sh <action> ['{"param": "value"}']
# All requests are POST with JSON body containing action, key, and params.

set -euo pipefail

GOOGLE_SHEETS_URL="__GOOGLE_SHEETS_URL__"
GOOGLE_SHEETS_KEY="__GOOGLE_SHEETS_KEY__"

ACTION="${1:?Usage: sheets.sh <action> [JSON params]}"
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
    "resolveSpreadsheet":       { "required": [], "optional": ["spreadsheetId", "url", "name", "driveFileId"] },
    "listTrackedSpreadsheets":  { "required": [], "optional": [] },
    "getSpreadsheet":           { "required": ["spreadsheetId"], "optional": [] },
    "listSheets":               { "required": ["spreadsheetId"], "optional": [] },
    "readRange":                { "required": ["spreadsheetId", "range"], "optional": ["valueRenderOption"] },
    "readMultipleRanges":       { "required": ["spreadsheetId", "ranges"], "optional": ["valueRenderOption"] },
    "getSheetData":             { "required": ["spreadsheetId", "sheetName"], "optional": ["maxRows", "maxCols"] },
    "writeRange":               { "required": ["spreadsheetId", "range", "values"], "optional": ["valueInputOption"] },
    "writeMultipleRanges":      { "required": ["spreadsheetId", "data"], "optional": ["valueInputOption"] },
    "appendRows":               { "required": ["spreadsheetId", "range", "values"], "optional": ["valueInputOption"] },
    "clearRange":               { "required": ["spreadsheetId", "range"], "optional": [] },
    "clearMultipleRanges":      { "required": ["spreadsheetId", "ranges"], "optional": [] },
    "addSheet":                 { "required": ["spreadsheetId", "title"], "optional": ["rowCount", "colCount"] },
    "deleteSheet":              { "required": ["spreadsheetId", "sheetId"], "optional": [] },
    "duplicateSheet":           { "required": ["spreadsheetId", "sheetId"], "optional": ["newTitle", "insertIndex"] },
    "renameSheet":              { "required": ["spreadsheetId", "sheetId", "title"], "optional": [] },
    "updateSheetProperties":    { "required": ["spreadsheetId", "sheetId"], "optional": ["hidden", "frozenRowCount", "frozenColumnCount", "rightToLeft", "tabColor"] },
    "insertRows":               { "required": ["spreadsheetId", "sheetId", "startIndex", "endIndex"], "optional": ["inheritFromBefore"] },
    "insertColumns":            { "required": ["spreadsheetId", "sheetId", "startIndex", "endIndex"], "optional": ["inheritFromBefore"] },
    "deleteRows":               { "required": ["spreadsheetId", "sheetId", "startIndex", "endIndex"], "optional": [] },
    "deleteColumns":            { "required": ["spreadsheetId", "sheetId", "startIndex", "endIndex"], "optional": [] },
    "moveRows":                 { "required": ["spreadsheetId", "sheetId", "startIndex", "endIndex", "destinationIndex"], "optional": [] },
    "moveColumns":              { "required": ["spreadsheetId", "sheetId", "startIndex", "endIndex", "destinationIndex"], "optional": [] },
    "resizeRows":               { "required": ["spreadsheetId", "sheetId", "startIndex", "endIndex", "pixelSize"], "optional": [] },
    "resizeColumns":            { "required": ["spreadsheetId", "sheetId", "startIndex", "endIndex", "pixelSize"], "optional": [] },
    "autoResizeColumns":        { "required": ["spreadsheetId", "sheetId", "startIndex", "endIndex"], "optional": [] },
    "formatCells":              { "required": ["spreadsheetId", "range"], "optional": ["bold", "italic", "underline", "strikethrough", "fontSize", "fontFamily", "foregroundColor", "backgroundColor", "horizontalAlignment", "verticalAlignment", "wrapStrategy", "numberFormat"] },
    "setBorders":               { "required": ["spreadsheetId", "range"], "optional": ["top", "bottom", "left", "right", "innerHorizontal", "innerVertical"] },
    "mergeCells":               { "required": ["spreadsheetId", "range"], "optional": ["mergeType"] },
    "unmergeCells":             { "required": ["spreadsheetId", "range"], "optional": [] },
    "sortRange":                { "required": ["spreadsheetId", "range", "sortSpecs"], "optional": [] },
    "findReplace":              { "required": ["spreadsheetId", "find"], "optional": ["replacement", "sheetId", "allSheets", "matchCase", "matchEntireCell", "searchByRegex"] },
    "addConditionalFormat":     { "required": ["spreadsheetId", "range", "rule"], "optional": [] },
    "deleteConditionalFormat":  { "required": ["spreadsheetId", "sheetId", "index"], "optional": [] },
    "setDataValidation":        { "required": ["spreadsheetId", "range", "rule"], "optional": [] },
    "addNamedRange":            { "required": ["spreadsheetId", "name", "range"], "optional": [] },
    "deleteNamedRange":         { "required": ["spreadsheetId", "namedRangeId"], "optional": [] },
    "protectRange":             { "required": ["spreadsheetId", "range"], "optional": ["description", "warningOnly", "editors"] },
    "unprotectRange":           { "required": ["spreadsheetId", "protectedRangeId"], "optional": [] },
    "addChart":                 { "required": ["spreadsheetId", "sheetId", "chartType", "sourceRange"], "optional": ["title", "position"] },
    "updateChart":              { "required": ["spreadsheetId", "chartId"], "optional": ["title", "chartType", "sourceRange"] },
    "deleteChart":              { "required": ["spreadsheetId", "chartId"], "optional": [] },
    "setBasicFilter":           { "required": ["spreadsheetId", "range"], "optional": ["criteria"] },
    "clearBasicFilter":         { "required": ["spreadsheetId", "sheetId"], "optional": [] },
    "addFilterView":            { "required": ["spreadsheetId", "range"], "optional": ["title", "criteria"] },
    "deleteFilterView":         { "required": ["spreadsheetId", "filterViewId"], "optional": [] },
    "addPivotTable":            { "required": ["spreadsheetId", "sourceRange", "destinationRange", "rows", "columns", "values"], "optional": ["filterSpecs"] },
    "getCommandResult":         { "required": ["requestId"], "optional": [] },
    "syncNow":                  { "required": [], "optional": [] }
  },
  "aliases": {
    "id": "spreadsheetId", "ssid": "spreadsheetId", "spreadsheet_id": "spreadsheetId", "spreadsheet": "spreadsheetId",
    "sheet": "sheetName", "tab": "sheetName", "sheet_name": "sheetName",
    "r": "range", "a1": "range",
    "val": "values", "data": "values", "rows": "values",
    "sid": "sheetId", "sheet_id": "sheetId", "tabId": "sheetId",
    "t": "title", "name": "title",
    "start": "startIndex", "end": "endIndex", "dest": "destinationIndex",
    "search": "find", "query": "find", "q": "find",
    "replace": "replacement",
    "type": "chartType", "chart_type": "chartType",
    "src": "sourceRange", "source": "sourceRange",
    "format": "numberFormat",
    "bg": "backgroundColor", "fg": "foregroundColor",
    "align": "horizontalAlignment", "valign": "verticalAlignment",
    "wrap": "wrapStrategy",
    "filter_id": "filterViewId", "filterId": "filterViewId",
    "named_range_id": "namedRangeId", "namedRange": "namedRangeId",
    "protected_range_id": "protectedRangeId", "protectedRange": "protectedRangeId",
    "chart_id": "chartId", "chart": "chartId",
    "request_id": "requestId", "requestid": "requestId",
    "file_id": "driveFileId", "fileId": "driveFileId",
    "render": "valueRenderOption", "value_render": "valueRenderOption",
    "input": "valueInputOption", "value_input": "valueInputOption"
  },
  "enums": {
    "readRange": { "valueRenderOption": ["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"] },
    "readMultipleRanges": { "valueRenderOption": ["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"] },
    "writeRange": { "valueInputOption": ["RAW", "USER_ENTERED"] },
    "writeMultipleRanges": { "valueInputOption": ["RAW", "USER_ENTERED"] },
    "appendRows": { "valueInputOption": ["RAW", "USER_ENTERED"] },
    "mergeCells": { "mergeType": ["MERGE_ALL", "MERGE_COLUMNS", "MERGE_ROWS"] },
    "formatCells": {
      "horizontalAlignment": ["LEFT", "CENTER", "RIGHT"],
      "verticalAlignment": ["TOP", "MIDDLE", "BOTTOM"],
      "wrapStrategy": ["OVERFLOW_CELL", "LEGACY_WRAP", "CLIP", "WRAP"]
    },
    "addChart": { "chartType": ["BAR", "LINE", "AREA", "COLUMN", "SCATTER", "COMBO", "STEPPED_AREA", "PIE", "DOUGHNUT", "TREEMAP", "HISTOGRAM", "WATERFALL", "CANDLESTICK", "ORG", "RADAR", "SCORECARD"] }
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
  BODY=$(echo "$PARAMS" | jq -c ". + {\"action\": \"$ACTION\", \"key\": \"$GOOGLE_SHEETS_KEY\"}")
else
  BODY=$(jq -nc "{\"action\": \"$ACTION\", \"key\": \"$GOOGLE_SHEETS_KEY\"}")
fi

# Make the HTTP request
RESPONSE=$(curl -sL --max-time 120 \
  -H "Content-Type: application/json" \
  -d "$BODY" \
  "$GOOGLE_SHEETS_URL")

# Pretty-print the response
echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"
