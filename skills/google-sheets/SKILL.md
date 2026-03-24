---
name: google-sheets
description: Manage Google Sheets via natural language. Use when the user mentions spreadsheets, cells, rows, columns, formulas, ranges, tabs, formatting, charts, pivot tables, filters, data validation, conditional formatting, named ranges, cell values, sheet tabs, or any spreadsheet operations. Triggers include asking about spreadsheet data, reading cells, writing values, formatting cells, adding charts, creating pivot tables, sorting data, finding and replacing, merging cells, protecting ranges, or any phrase like "read the spreadsheet", "update cell A1", "add a new tab", "format as bold", "create a chart", "sort by column", "find and replace", "merge these cells", "protect this range", "add a filter", "show sheet data".
---
# Google Sheets

Manage Google Sheets through a spreadsheet-proxy architecture. **All target spreadsheet operations** (reads AND writes) go through CommandQueue → WorkSync on the work email account, since the personal email may not have access to work spreadsheets.

```
Claude → sheets.sh → Personal Gmail Apps Script → CommandQueue (enqueue all operations)
                                                  ↕
                                       Work Email Apps Script → Sheets API v4 (reads + writes)
```

## Execution

Run `scripts/sheets.sh` with the action and JSON params:

```
"__SKILL_DIR__/scripts/sheets.sh" <action> ['{"param": "value"}']
```

For full API actions reference, see `references/api-actions.md`.

## Sync behavior

- **All target spreadsheet operations are processed server-side** — both reads and writes are queued in CommandQueue and processed by WorkSync.gs (running on the work email) via Sheets API v4. Results are returned directly in the same request (typically 5-15 seconds). This is because the personal email proxy may not have access to work email spreadsheets.
- **Proxy-spreadsheet reads are instant** — `listTrackedSpreadsheets` and `getCommandResult` read from the proxy spreadsheet directly.
- IDs are tracking UUIDs (from TrackedSpreadsheets), not Google spreadsheet IDs directly.
- **Selective tracking**: Only spreadsheets resolved via `resolveSpreadsheet` are tracked. Not all user spreadsheets are synced.
- All commands are queued and results are returned directly (typically 5-15 seconds). If the response shows `status: "processing"`, poll with `getCommandResult` after 30 seconds (max 2 retries).
- Cell limit: CommandQueue stores params as JSON in a cell (50,000 char limit). Split very large writes into multiple calls.
- Read size: `getSheetData` defaults to 500 rows / 50 cols to prevent timeouts.

## Workflow

### 1. Map intent to action

**Read data:**
- "read cell A1", "what's in column B" → `readRange`
- "read cells A1:C10 and D1:F10" → `readMultipleRanges`
- "show all data from Sheet1" → `getSheetData`
- "show spreadsheet info", "list tabs" → `listSheets`
- "what spreadsheets am I tracking" → `listTrackedSpreadsheets`
- "get spreadsheet details" → `getSpreadsheet`

**Write data:**
- "write values to A1:C3" → `writeRange`- "write to multiple ranges" → `writeMultipleRanges`- "append rows to the table" → `appendRows`- "clear cells A1:C10" → `clearRange`- "clear multiple ranges" → `clearMultipleRanges`
**Sheet/tab management:**
- "add a new sheet called Summary" → `addSheet`- "delete that sheet" → `deleteSheet`- "duplicate the sheet" → `duplicateSheet`- "rename sheet to Overview" → `renameSheet`- "freeze the top row" → `updateSheetProperties`
**Row/column operations:**
- "insert 3 rows at row 5" → `insertRows`- "insert columns B through D" → `insertColumns`- "delete rows 10 to 15" → `deleteRows`- "delete columns F through H" → `deleteColumns`- "move rows 5-7 to row 20" → `moveRows`- "resize column A to 200px" → `resizeColumns`- "auto-resize columns A through E" → `autoResizeColumns`
**Formatting:**
- "make the header row bold" → `formatCells`- "set borders on the table" → `setBorders`- "merge cells A1:C1" → `mergeCells`- "unmerge cells" → `unmergeCells`
**Data operations:**
- "sort by column B descending" → `sortRange`- "find all instances of 'foo' and replace with 'bar'" → `findReplace`- "highlight cells above 100 in green" → `addConditionalFormat`- "add dropdown validation for column D" → `setDataValidation`- "name this range 'Revenue'" → `addNamedRange`
**Protection:**
- "protect cells A1:B10" → `protectRange`- "remove protection" → `unprotectRange`
**Charts:**
- "create a bar chart from A1:C10" → `addChart`- "update the chart title" → `updateChart`- "delete the chart" → `deleteChart`
**Filters:**
- "add a filter to the data" → `setBasicFilter`- "clear the filter" → `clearBasicFilter`- "create a filter view" → `addFilterView`
**Pivot tables:**
- "create a pivot table" → `addPivotTable`
### 2. Use exact API parameter names

Always use the exact parameter names from `references/api-actions.md`. Common mistakes to avoid:
- Use `spreadsheetId` (NOT `id` or `ssid`) for spreadsheet operations
- Use `sheetId` (NOT `sid` or `tabId`) for sheet-level operations — this is the numeric sheet/tab ID
- Use `sheetName` (NOT `sheet` or `tab`) for `getSheetData`
- Use `range` (NOT `r` or `a1`) for A1 notation ranges
- Use `values` (NOT `val` or `data`) for cell values
- Use `title` (NOT `name` or `t`) for sheet names

### 3. Resolve spreadsheet IDs

Always resolve the spreadsheet before any operation — never guess.

1. If the user provides a URL, name, or Drive file ID, call `resolveSpreadsheet` first.
2. `resolveSpreadsheet` returns a tracking UUID as `spreadsheetId`. Use this in all subsequent calls.
3. If the user says "that spreadsheet" or refers to one by name, call `listTrackedSpreadsheets` to find it.
4. To get sheet/tab IDs (numeric), call `listSheets` on the spreadsheet.
5. **Drive integration**: When Drive skill encounters `application/vnd.google-apps.spreadsheet`, call `resolveSpreadsheet` with the `driveFileId` to get a Sheets tracking ID.

### 4. A1 notation guide

Ranges use A1 notation with optional sheet name prefix:
- `A1` — single cell
- `A1:C10` — rectangular range
- `A:C` — entire columns A through C
- `1:5` — entire rows 1 through 5
- `Sheet1!A1:C10` — range on specific sheet
- `'My Sheet'!A1:C10` — sheet names with spaces need single quotes

### 5. Handle command responses

All operations return results directly (typically 5-15 seconds):

1. Call the action — result is returned in the same response.
2. If the response shows `status: "processing"` (rare), poll with `getCommandResult` after 30 seconds (max 2 retries).
3. Present the results.

### 6. Present results

**Cell data (small ranges):**
```
## Sheet1!A1:D5

| Name | Email | Role | Start Date |
|------|-------|------|------------|
| Alice | alice@co.com | Engineer | 2025-01-15 |
| Bob | bob@co.com | Designer | 2025-02-01 |
| Carol | carol@co.com | PM | 2025-03-10 |
| Dave | dave@co.com | Engineer | 2025-04-05 |
```

**Cell data (large ranges):**
```
## Sheet1 — 500 rows x 12 columns

Showing first 10 rows:

| A | B | C | ... |
|---|---|---|-----|
| ... | ... | ... | ... |

Total: 500 rows, 12 columns
Use readRange with specific ranges to narrow down.
```

**Sheet listing:**
```
## Budget 2026

📊 Sheet1 (id: 0) — 100 rows x 10 cols
📊 Summary (id: 123456) — 20 rows x 5 cols
📊 Charts (id: 789012) — 50 rows x 8 cols

3 sheets total
```

**Formatting rules:**
- Show cell data as markdown tables when possible (up to ~20 rows).
- For large data sets, summarize and suggest narrowing with specific ranges.
- Show sheet tab emoji 📊 for spreadsheet/sheet listings.
- For write confirmations, be concise: "Values written to A1:C5."
- For destructive operations (delete sheet, clear range), confirm with the user first.

### 7. Value input options

| Option | Behavior |
|--------|----------|
| `USER_ENTERED` | Values parsed as if typed in the UI (formulas executed, dates parsed) |
| `RAW` | Values stored exactly as provided (no parsing) |

Default is `USER_ENTERED` for most operations.

### 8. Value render options

| Option | Behavior |
|--------|----------|
| `FORMATTED_VALUE` | Values as displayed in the UI (default) |
| `UNFORMATTED_VALUE` | Raw numeric values without formatting |
| `FORMULA` | Show formulas instead of computed values |

### 9. Drive integration

When the Drive skill encounters a file with mimeType `application/vnd.google-apps.spreadsheet`:
1. The Drive skill tracks it with a `fileId` (Drive tracking UUID).
2. Call `sheets.sh resolveSpreadsheet '{"driveFileId": "<driveFileId>"}'` to get a Sheets tracking ID.
3. Use the returned `spreadsheetId` for all Sheets operations.
4. Prefer Sheets skill over Drive's `getFileContent` for spreadsheet files — Sheets provides richer cell-level access vs flat CSV export.
