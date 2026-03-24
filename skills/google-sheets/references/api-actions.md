# Google Sheets API Actions Reference

All actions are called via `sheets.sh <action> ['{"param": "value"}']`. Every request is POST with JSON body.

## Resolve & track spreadsheets (synchronous)

| Action | Params | Description |
|--------|--------|-------------|
| `resolveSpreadsheet` | one of: `spreadsheetId`, `url`, `name`, `driveFileId` | Resolve any identifier to a tracked spreadsheet. Auto-adds to tracking. |
| `listTrackedSpreadsheets` | — | List all tracked spreadsheets |
| `getSpreadsheet` | `spreadsheetId` | Get spreadsheet metadata (title, locale, sheets list) |
| `listSheets` | `spreadsheetId` | List all sheets/tabs with sheetId, title, row/col count |

## Read data (synchronous — direct SpreadsheetApp access)

| Action | Params | Description |
|--------|--------|-------------|
| `readRange` | `spreadsheetId`, `range`, `valueRenderOption`(opt) | Read values from A1 range |
| `readMultipleRanges` | `spreadsheetId`, `ranges`(array), `valueRenderOption`(opt) | Read from multiple ranges at once |
| `getSheetData` | `spreadsheetId`, `sheetName`, `maxRows`(opt), `maxCols`(opt) | Get all data from a sheet (defaults: 500 rows, 50 cols) |

## Write data (async — CommandQueue → Sheets API v4)

| Action | Params | Description |
|--------|--------|-------------|
| `writeRange` | `spreadsheetId`, `range`, `values`(2D array), `valueInputOption`(opt) | Write values to a range |
| `writeMultipleRanges` | `spreadsheetId`, `data`(array of {range, values}), `valueInputOption`(opt) | Write to multiple ranges |
| `appendRows` | `spreadsheetId`, `range`, `values`(2D array), `valueInputOption`(opt) | Append rows after existing data |
| `clearRange` | `spreadsheetId`, `range` | Clear all values in a range |
| `clearMultipleRanges` | `spreadsheetId`, `ranges`(array) | Clear values in multiple ranges |

## Sheet/tab management (async)

| Action | Params | Description |
|--------|--------|-------------|
| `addSheet` | `spreadsheetId`, `title`, `rowCount`(opt), `colCount`(opt) | Add a new sheet/tab |
| `deleteSheet` | `spreadsheetId`, `sheetId` | Delete a sheet/tab by numeric ID |
| `duplicateSheet` | `spreadsheetId`, `sheetId`, `newTitle`(opt), `insertIndex`(opt) | Duplicate a sheet |
| `renameSheet` | `spreadsheetId`, `sheetId`, `title` | Rename a sheet |
| `updateSheetProperties` | `spreadsheetId`, `sheetId`, `hidden`(opt), `frozenRowCount`(opt), `frozenColumnCount`(opt), `rightToLeft`(opt), `tabColor`(opt) | Update sheet properties |

## Row/column operations (async)

| Action | Params | Description |
|--------|--------|-------------|
| `insertRows` | `spreadsheetId`, `sheetId`, `startIndex`, `endIndex`, `inheritFromBefore`(opt) | Insert rows (0-based indices) |
| `insertColumns` | `spreadsheetId`, `sheetId`, `startIndex`, `endIndex`, `inheritFromBefore`(opt) | Insert columns (0-based indices) |
| `deleteRows` | `spreadsheetId`, `sheetId`, `startIndex`, `endIndex` | Delete rows (0-based, endIndex exclusive) |
| `deleteColumns` | `spreadsheetId`, `sheetId`, `startIndex`, `endIndex` | Delete columns (0-based, endIndex exclusive) |
| `moveRows` | `spreadsheetId`, `sheetId`, `startIndex`, `endIndex`, `destinationIndex` | Move rows to a new position |
| `moveColumns` | `spreadsheetId`, `sheetId`, `startIndex`, `endIndex`, `destinationIndex` | Move columns to a new position |
| `resizeRows` | `spreadsheetId`, `sheetId`, `startIndex`, `endIndex`, `pixelSize` | Set row height in pixels |
| `resizeColumns` | `spreadsheetId`, `sheetId`, `startIndex`, `endIndex`, `pixelSize` | Set column width in pixels |
| `autoResizeColumns` | `spreadsheetId`, `sheetId`, `startIndex`, `endIndex` | Auto-resize columns to fit content |

## Cell formatting (async)

| Action | Params | Description |
|--------|--------|-------------|
| `formatCells` | `spreadsheetId`, `range`, `bold`(opt), `italic`(opt), `underline`(opt), `strikethrough`(opt), `fontSize`(opt), `fontFamily`(opt), `foregroundColor`(opt), `backgroundColor`(opt), `horizontalAlignment`(opt), `verticalAlignment`(opt), `wrapStrategy`(opt), `numberFormat`(opt) | Format cells (multiple properties at once) |
| `setBorders` | `spreadsheetId`, `range`, `top`(opt), `bottom`(opt), `left`(opt), `right`(opt), `innerHorizontal`(opt), `innerVertical`(opt) | Set borders on a range. Each border is `{style, color}` |
| `mergeCells` | `spreadsheetId`, `range`, `mergeType`(opt) | Merge cells in a range |
| `unmergeCells` | `spreadsheetId`, `range` | Unmerge previously merged cells |

## Data operations (async)

| Action | Params | Description |
|--------|--------|-------------|
| `sortRange` | `spreadsheetId`, `range`, `sortSpecs`(array of {dimensionIndex, sortOrder}) | Sort a range by one or more columns |
| `findReplace` | `spreadsheetId`, `find`, `replacement`(opt), `sheetId`(opt), `allSheets`(opt), `matchCase`(opt), `matchEntireCell`(opt), `searchByRegex`(opt) | Find and optionally replace text |
| `addConditionalFormat` | `spreadsheetId`, `range`, `rule`(object) | Add a conditional formatting rule |
| `deleteConditionalFormat` | `spreadsheetId`, `sheetId`, `index` | Delete a conditional formatting rule by index |
| `setDataValidation` | `spreadsheetId`, `range`, `rule`(object) | Set data validation on a range |
| `addNamedRange` | `spreadsheetId`, `name`, `range` | Create a named range |
| `deleteNamedRange` | `spreadsheetId`, `namedRangeId` | Delete a named range by ID |

## Protection (async)

| Action | Params | Description |
|--------|--------|-------------|
| `protectRange` | `spreadsheetId`, `range`, `description`(opt), `warningOnly`(opt), `editors`(opt) | Protect a range (restrict editing) |
| `unprotectRange` | `spreadsheetId`, `protectedRangeId` | Remove protection from a range |

## Charts (async)

| Action | Params | Description |
|--------|--------|-------------|
| `addChart` | `spreadsheetId`, `sheetId`, `chartType`, `sourceRange`, `title`(opt), `position`(opt) | Add an embedded chart |
| `updateChart` | `spreadsheetId`, `chartId`, `title`(opt), `chartType`(opt), `sourceRange`(opt) | Update an existing chart |
| `deleteChart` | `spreadsheetId`, `chartId` | Delete an embedded chart |

## Filters (async)

| Action | Params | Description |
|--------|--------|-------------|
| `setBasicFilter` | `spreadsheetId`, `range`, `criteria`(opt) | Set a basic filter on a range |
| `clearBasicFilter` | `spreadsheetId`, `sheetId` | Clear the basic filter on a sheet |
| `addFilterView` | `spreadsheetId`, `range`, `title`(opt), `criteria`(opt) | Create a filter view |
| `deleteFilterView` | `spreadsheetId`, `filterViewId` | Delete a filter view |

## Pivot tables (async)

| Action | Params | Description |
|--------|--------|-------------|
| `addPivotTable` | `spreadsheetId`, `sourceRange`, `destinationRange`, `rows`(array), `columns`(array), `values`(array), `filterSpecs`(opt) | Create a pivot table |

## Utility

| Action | Params | Description |
|--------|--------|-------------|
| `getCommandResult` | `requestId` | Poll for async command result |
| `syncNow` | — | Queue an immediate sync cycle |

## Value input options

| Option | Behavior |
|--------|----------|
| `USER_ENTERED` | Values parsed as if typed in the UI (formulas executed, dates parsed). **Default.** |
| `RAW` | Values stored exactly as provided (no parsing) |

## Value render options

| Option | Behavior |
|--------|----------|
| `FORMATTED_VALUE` | Values as displayed in the UI. **Default.** |
| `UNFORMATTED_VALUE` | Raw numeric values without formatting |
| `FORMULA` | Show formulas instead of computed values |

## Chart types

`BAR`, `LINE`, `AREA`, `COLUMN`, `SCATTER`, `COMBO`, `STEPPED_AREA`, `PIE`, `DOUGHNUT`, `TREEMAP`, `HISTOGRAM`, `WATERFALL`, `CANDLESTICK`, `ORG`, `RADAR`, `SCORECARD`

## Merge types

| Type | Behavior |
|------|----------|
| `MERGE_ALL` | Merge all cells in the range into one (default) |
| `MERGE_COLUMNS` | Merge cells in each column separately |
| `MERGE_ROWS` | Merge cells in each row separately |

## Alignment options

**Horizontal:** `LEFT`, `CENTER`, `RIGHT`
**Vertical:** `TOP`, `MIDDLE`, `BOTTOM`
**Wrap strategy:** `OVERFLOW_CELL`, `LEGACY_WRAP`, `CLIP`, `WRAP`

## Row/column indices

Row and column indices for structural operations (`insertRows`, `deleteRows`, etc.) are **0-based** and the `endIndex` is **exclusive**:
- To insert 3 rows before row 5 (1-based): `startIndex: 4, endIndex: 7`
- To delete column B: `startIndex: 1, endIndex: 2`

## Sort specs

Each sort spec is `{dimensionIndex, sortOrder}`:
- `dimensionIndex`: 0-based column index
- `sortOrder`: `"ASCENDING"` or `"DESCENDING"`

Example: Sort by column B ascending, then column C descending:
```json
[{"dimensionIndex": 1, "sortOrder": "ASCENDING"}, {"dimensionIndex": 2, "sortOrder": "DESCENDING"}]
```

## Color format

Colors are specified as `{red, green, blue}` with values 0-1:
- Red: `{"red": 1, "green": 0, "blue": 0}`
- White: `{"red": 1, "green": 1, "blue": 1}`
- Light gray background: `{"red": 0.9, "green": 0.9, "blue": 0.9}`

## Border styles

Each border property (`top`, `bottom`, `left`, `right`, `innerHorizontal`, `innerVertical`) is:
```json
{"style": "SOLID", "color": {"red": 0, "green": 0, "blue": 0}}
```
Styles: `DOTTED`, `DASHED`, `SOLID`, `SOLID_MEDIUM`, `SOLID_THICK`, `DOUBLE`

## Selective tracking

The system uses **selective tracking** for spreadsheets:
- Spreadsheets accessed via `resolveSpreadsheet` are automatically tracked.
- Call `resolveSpreadsheet` with a URL, name, or Drive file ID to start tracking.
- Use `listTrackedSpreadsheets` to see what's currently tracked.
- TrackedSpreadsheets metadata is refreshed each sync cycle.

## IDs

- `spreadsheetId` — tracking UUID from TrackedSpreadsheets (use in all API calls)
- `sheetId` — numeric ID of a sheet/tab within a spreadsheet (get via `listSheets`)
- `googleSpreadsheetId` — the actual Google Sheets ID (internal, resolved automatically)

## Async commands

Write operations, formatting, structural changes, charts, filters, and pivot tables are processed asynchronously. The response includes a `requestId`. Use `getCommandResult` to poll:

```bash
# Write values (result returned directly, typically 5-15 seconds)
sheets.sh writeRange '{"spreadsheetId": "uuid", "range": "Sheet1!A1:C3", "values": [["a","b","c"],["d","e","f"],["g","h","i"]]}'
# Returns: {"status": "completed", "result": {...}}

# If status is "processing" (rare), poll with getCommandResult after 30 seconds:
sheets.sh getCommandResult '{"requestId": "uuid"}'
```

## Limitations

- **Cell limit**: CommandQueue stores params as JSON in a cell (50,000 char limit). Split very large writes into multiple calls.
- **Rate limits**: Sheets API has 60 read/60 write requests per minute per user.
- **Read size**: `getSheetData` defaults to 500 rows / 50 cols to prevent timeouts. Use `maxRows`/`maxCols` to adjust.
- **Apps Script execution**: 6-minute limit per invocation (4-minute safety timeout used).

## Examples

```bash
# Resolve a spreadsheet by URL
sheets.sh resolveSpreadsheet '{"url": "https://docs.google.com/spreadsheets/d/abc123/edit"}'

# Resolve from Drive file ID
sheets.sh resolveSpreadsheet '{"driveFileId": "drive-uuid-here"}'

# List tracked spreadsheets
sheets.sh listTrackedSpreadsheets

# Get spreadsheet metadata
sheets.sh getSpreadsheet '{"spreadsheetId": "uuid"}'

# List sheets/tabs
sheets.sh listSheets '{"spreadsheetId": "uuid"}'

# Read a range
sheets.sh readRange '{"spreadsheetId": "uuid", "range": "Sheet1!A1:D10"}'

# Read with formula display
sheets.sh readRange '{"spreadsheetId": "uuid", "range": "Sheet1!A1:D10", "valueRenderOption": "FORMULA"}'

# Read multiple ranges
sheets.sh readMultipleRanges '{"spreadsheetId": "uuid", "ranges": ["Sheet1!A1:C5", "Sheet1!E1:G5"]}'

# Get all data from a sheet
sheets.sh getSheetData '{"spreadsheetId": "uuid", "sheetName": "Sheet1"}'

# Get data with limits
sheets.sh getSheetData '{"spreadsheetId": "uuid", "sheetName": "Sheet1", "maxRows": 100, "maxCols": 10}'

# Write to a range (async)
sheets.sh writeRange '{"spreadsheetId": "uuid", "range": "Sheet1!A1:C2", "values": [["Name","Email","Role"],["Alice","alice@co.com","Engineer"]]}'

# Write with RAW input
sheets.sh writeRange '{"spreadsheetId": "uuid", "range": "A1", "values": [["=SUM(B1:B10)"]], "valueInputOption": "RAW"}'

# Write to multiple ranges (async)
sheets.sh writeMultipleRanges '{"spreadsheetId": "uuid", "data": [{"range": "A1:B2", "values": [["a","b"],["c","d"]]}, {"range": "D1:E2", "values": [["e","f"],["g","h"]]}]}'

# Append rows (async)
sheets.sh appendRows '{"spreadsheetId": "uuid", "range": "Sheet1!A:D", "values": [["New","Row","Data","Here"]]}'

# Clear a range (async)
sheets.sh clearRange '{"spreadsheetId": "uuid", "range": "Sheet1!A1:D10"}'

# Add a sheet (async)
sheets.sh addSheet '{"spreadsheetId": "uuid", "title": "Summary"}'

# Delete a sheet (async)
sheets.sh deleteSheet '{"spreadsheetId": "uuid", "sheetId": 123456}'

# Duplicate a sheet (async)
sheets.sh duplicateSheet '{"spreadsheetId": "uuid", "sheetId": 0, "newTitle": "Sheet1 Copy"}'

# Rename a sheet (async)
sheets.sh renameSheet '{"spreadsheetId": "uuid", "sheetId": 0, "title": "Overview"}'

# Freeze top row (async)
sheets.sh updateSheetProperties '{"spreadsheetId": "uuid", "sheetId": 0, "frozenRowCount": 1}'

# Insert 3 rows before row 5 (async)
sheets.sh insertRows '{"spreadsheetId": "uuid", "sheetId": 0, "startIndex": 4, "endIndex": 7}'

# Delete columns C-D (async)
sheets.sh deleteColumns '{"spreadsheetId": "uuid", "sheetId": 0, "startIndex": 2, "endIndex": 4}'

# Auto-resize columns A-E (async)
sheets.sh autoResizeColumns '{"spreadsheetId": "uuid", "sheetId": 0, "startIndex": 0, "endIndex": 5}'

# Format cells bold with background color (async)
sheets.sh formatCells '{"spreadsheetId": "uuid", "range": "Sheet1!A1:D1", "bold": true, "backgroundColor": {"red": 0.9, "green": 0.9, "blue": 0.9}}'

# Set borders (async)
sheets.sh setBorders '{"spreadsheetId": "uuid", "range": "Sheet1!A1:D10", "top": {"style": "SOLID"}, "bottom": {"style": "SOLID"}, "left": {"style": "SOLID"}, "right": {"style": "SOLID"}}'

# Merge cells (async)
sheets.sh mergeCells '{"spreadsheetId": "uuid", "range": "Sheet1!A1:C1"}'

# Sort by column B descending (async)
sheets.sh sortRange '{"spreadsheetId": "uuid", "range": "Sheet1!A1:D10", "sortSpecs": [{"dimensionIndex": 1, "sortOrder": "DESCENDING"}]}'

# Find and replace (async)
sheets.sh findReplace '{"spreadsheetId": "uuid", "find": "old value", "replacement": "new value", "allSheets": true}'

# Add conditional format (async)
sheets.sh addConditionalFormat '{"spreadsheetId": "uuid", "range": "Sheet1!B2:B100", "rule": {"type": "NUMBER_GREATER", "values": [100], "format": {"backgroundColor": {"red": 0, "green": 0.8, "blue": 0}}}}'

# Set data validation — dropdown list (async)
sheets.sh setDataValidation '{"spreadsheetId": "uuid", "range": "Sheet1!D2:D100", "rule": {"type": "ONE_OF_LIST", "values": ["Active", "Inactive", "Pending"]}}'

# Add a named range (async)
sheets.sh addNamedRange '{"spreadsheetId": "uuid", "name": "Revenue", "range": "Sheet1!B2:B100"}'

# Protect a range (async)
sheets.sh protectRange '{"spreadsheetId": "uuid", "range": "Sheet1!A1:D1", "description": "Header row", "warningOnly": true}'

# Add a bar chart (async)
sheets.sh addChart '{"spreadsheetId": "uuid", "sheetId": 0, "chartType": "BAR", "sourceRange": "Sheet1!A1:C10", "title": "Sales by Region"}'

# Set basic filter (async)
sheets.sh setBasicFilter '{"spreadsheetId": "uuid", "range": "Sheet1!A1:D100"}'

# Create a filter view (async)
sheets.sh addFilterView '{"spreadsheetId": "uuid", "range": "Sheet1!A1:D100", "title": "Active Only"}'

# Add pivot table (async)
sheets.sh addPivotTable '{"spreadsheetId": "uuid", "sourceRange": "Sheet1!A1:D100", "destinationRange": "Sheet2!A1", "rows": [{"sourceColumnOffset": 0}], "columns": [{"sourceColumnOffset": 1}], "values": [{"sourceColumnOffset": 2, "summarizeFunction": "SUM"}]}'

# Get async result
sheets.sh getCommandResult '{"requestId": "uuid"}'

# Force sync
sheets.sh syncNow
```
