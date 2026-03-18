#!/bin/bash
# Google Docs CLI - wrapper for the PersonalProxy Apps Script web app
# Usage: docs.sh <action> ['{"param": "value"}']
# All requests are POST with JSON body containing action, key, and params.

set -euo pipefail

GOOGLE_DOCS_URL="__GOOGLE_DOCS_URL__"
GOOGLE_DOCS_KEY="__GOOGLE_DOCS_KEY__"

ACTION="${1:?Usage: docs.sh <action> [JSON params]}"
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
    "resolveDocument":              { "required": [], "optional": ["documentId", "url", "name", "driveFileId"] },
    "listTrackedDocuments":         { "required": [], "optional": [] },
    "getDocument":                  { "required": ["documentId"], "optional": [] },
    "getDocumentContent":           { "required": ["documentId"], "optional": ["tabIndex"] },
    "createDocument":               { "required": ["title"], "optional": [] },
    "insertText":                   { "required": ["documentId", "text", "index"], "optional": [] },
    "deleteContent":                { "required": ["documentId", "startIndex", "endIndex"], "optional": [] },
    "replaceAllText":               { "required": ["documentId", "find", "replacement"], "optional": ["matchCase"] },
    "updateTextStyle":              { "required": ["documentId", "startIndex", "endIndex"], "optional": ["bold", "italic", "underline", "strikethrough", "fontSize", "fontFamily", "foregroundColor", "backgroundColor", "link"] },
    "updateParagraphStyle":         { "required": ["documentId", "startIndex", "endIndex"], "optional": ["namedStyleType", "alignment", "lineSpacing", "spaceAbove", "spaceBelow", "indentFirstLine", "indentStart", "indentEnd"] },
    "createBullets":                { "required": ["documentId", "startIndex", "endIndex"], "optional": ["bulletPreset"] },
    "deleteBullets":                { "required": ["documentId", "startIndex", "endIndex"], "optional": [] },
    "insertTable":                  { "required": ["documentId", "rows", "columns", "index"], "optional": [] },
    "insertTableRow":               { "required": ["documentId", "tableStartIndex", "rowIndex"], "optional": ["insertBelow"] },
    "insertTableColumn":            { "required": ["documentId", "tableStartIndex", "columnIndex"], "optional": ["insertRight"] },
    "deleteTableRow":               { "required": ["documentId", "tableStartIndex", "rowIndex"], "optional": [] },
    "deleteTableColumn":            { "required": ["documentId", "tableStartIndex", "columnIndex"], "optional": [] },
    "mergeTableCells":              { "required": ["documentId", "tableStartIndex", "rowIndex", "columnIndex", "rowSpan", "columnSpan"], "optional": [] },
    "unmergeTableCells":            { "required": ["documentId", "tableStartIndex", "rowIndex", "columnIndex", "rowSpan", "columnSpan"], "optional": [] },
    "updateTableColumnProperties":  { "required": ["documentId", "tableStartIndex", "columnIndex"], "optional": ["widthMagnitude", "widthUnit"] },
    "updateTableRowStyle":          { "required": ["documentId", "tableStartIndex", "rowIndex"], "optional": ["minRowHeight", "heightUnit"] },
    "updateTableCellStyle":         { "required": ["documentId", "tableStartIndex", "rowIndex", "columnIndex"], "optional": ["backgroundColor", "borderLeft", "borderRight", "borderTop", "borderBottom", "paddingLeft", "paddingRight", "paddingTop", "paddingBottom", "contentAlignment"] },
    "pinTableHeaderRows":           { "required": ["documentId", "tableStartIndex", "pinnedHeaderRowCount"], "optional": [] },
    "insertInlineImage":            { "required": ["documentId", "imageUrl", "index"], "optional": ["widthMagnitude", "widthUnit", "heightMagnitude", "heightUnit"] },
    "insertPageBreak":              { "required": ["documentId", "index"], "optional": [] },
    "insertSectionBreak":           { "required": ["documentId", "index"], "optional": ["sectionType"] },
    "createHeader":                 { "required": ["documentId"], "optional": ["sectionType"] },
    "createFooter":                 { "required": ["documentId"], "optional": ["sectionType"] },
    "deleteHeader":                 { "required": ["documentId", "headerId"], "optional": [] },
    "deleteFooter":                 { "required": ["documentId", "footerId"], "optional": [] },
    "createFootnote":               { "required": ["documentId", "index"], "optional": [] },
    "createNamedRange":             { "required": ["documentId", "name", "startIndex", "endIndex"], "optional": [] },
    "deleteNamedRange":             { "required": ["documentId"], "optional": ["namedRangeId", "name"] },
    "replaceNamedRangeContent":     { "required": ["documentId", "name", "text"], "optional": [] },
    "getCommandResult":             { "required": ["requestId"], "optional": [] },
    "syncNow":                      { "required": [], "optional": [] }
  },
  "aliases": {
    "id": "documentId", "docId": "documentId", "doc_id": "documentId", "document_id": "documentId", "document": "documentId",
    "idx": "index", "pos": "index", "position": "index",
    "start": "startIndex", "end": "endIndex",
    "t": "title", "txt": "text", "content": "text",
    "search": "find", "query": "find", "q": "find",
    "replace": "replacement",
    "match_case": "matchCase",
    "tab": "tabIndex", "tab_index": "tabIndex",
    "table_start": "tableStartIndex", "tableStart": "tableStartIndex",
    "row": "rowIndex", "row_index": "rowIndex",
    "col": "columnIndex", "column": "columnIndex", "col_index": "columnIndex", "column_index": "columnIndex",
    "row_span": "rowSpan", "col_span": "columnSpan", "column_span": "columnSpan",
    "rows": "rows", "cols": "columns",
    "width": "widthMagnitude", "height": "heightMagnitude",
    "width_unit": "widthUnit", "height_unit": "heightUnit",
    "image": "imageUrl", "image_url": "imageUrl", "src": "imageUrl",
    "bullet": "bulletPreset", "bullet_preset": "bulletPreset",
    "style": "namedStyleType", "named_style": "namedStyleType",
    "align": "alignment",
    "spacing": "lineSpacing",
    "space_above": "spaceAbove", "space_below": "spaceBelow",
    "indent_first": "indentFirstLine", "indent_start": "indentStart", "indent_end": "indentEnd",
    "fg": "foregroundColor", "bg": "backgroundColor",
    "section": "sectionType", "section_type": "sectionType",
    "header": "headerId", "header_id": "headerId",
    "footer": "footerId", "footer_id": "footerId",
    "named_range_id": "namedRangeId", "namedRange": "namedRangeId",
    "pinned_rows": "pinnedHeaderRowCount", "pinned": "pinnedHeaderRowCount",
    "insert_below": "insertBelow", "insert_right": "insertRight",
    "border_left": "borderLeft", "border_right": "borderRight", "border_top": "borderTop", "border_bottom": "borderBottom",
    "padding_left": "paddingLeft", "padding_right": "paddingRight", "padding_top": "paddingTop", "padding_bottom": "paddingBottom",
    "content_alignment": "contentAlignment",
    "min_row_height": "minRowHeight",
    "request_id": "requestId", "requestid": "requestId",
    "file_id": "driveFileId", "fileId": "driveFileId"
  },
  "enums": {
    "updateParagraphStyle": {
      "namedStyleType": ["NORMAL_TEXT", "TITLE", "SUBTITLE", "HEADING_1", "HEADING_2", "HEADING_3", "HEADING_4", "HEADING_5", "HEADING_6"],
      "alignment": ["START", "CENTER", "END", "JUSTIFIED"]
    },
    "createBullets": {
      "bulletPreset": ["BULLET_DISC_CIRCLE_SQUARE", "BULLET_DIAMONDX_ARROW3D_SQUARE", "BULLET_CHECKBOX", "BULLET_ARROW_DIAMOND_DISC", "BULLET_STAR_CIRCLE_SQUARE", "BULLET_ARROW3D_CIRCLE_SQUARE", "BULLET_LEFTTRIANGLE_DIAMOND_DISC", "BULLET_DIAMONDX_HOLLOWDIAMOND_SQUARE", "NUMBERED_DECIMAL_ALPHA_ROMAN", "NUMBERED_DECIMAL_ALPHA_ROMAN_PARENS", "NUMBERED_DECIMAL_NESTED", "NUMBERED_UPPERALPHA_ALPHA_ROMAN", "NUMBERED_UPPERROMAN_UPPERALPHA_DECIMAL", "NUMBERED_ZERODECIMAL_ALPHA_ROMAN"]
    },
    "insertSectionBreak": {
      "sectionType": ["CONTINUOUS", "NEXT_PAGE"]
    },
    "createHeader": {
      "sectionType": ["DEFAULT", "FIRST_PAGE"]
    },
    "createFooter": {
      "sectionType": ["DEFAULT", "FIRST_PAGE"]
    },
    "updateTableColumnProperties": {
      "widthUnit": ["PT"]
    },
    "updateTableRowStyle": {
      "heightUnit": ["PT"]
    },
    "updateTableCellStyle": {
      "contentAlignment": ["TOP", "MIDDLE", "BOTTOM"]
    }
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
  BODY=$(echo "$PARAMS" | jq -c ". + {\"action\": \"$ACTION\", \"key\": \"$GOOGLE_DOCS_KEY\"}")
else
  BODY=$(jq -nc "{\"action\": \"$ACTION\", \"key\": \"$GOOGLE_DOCS_KEY\"}")
fi

# Make the HTTP request
RESPONSE=$(curl -sL \
  -H "Content-Type: application/json" \
  -d "$BODY" \
  "$GOOGLE_DOCS_URL")

# Pretty-print the response
echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"
