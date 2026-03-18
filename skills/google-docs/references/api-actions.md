# Google Docs API Actions Reference

All actions are called via `docs.sh <action> ['{"param": "value"}']`. Every request is POST with JSON body.

## Index system

Google Docs uses **1-based integer indices** (UTF-16 code units) to address content positions:
- Index `1` is the start of the document body (after the implicit body start).
- Every character, newline (`\n`), and structural element occupies one or more index units.
- A newline counts as 1 index unit.
- **Always read content first** (`getDocumentContent`) to get current indices before editing.
- **Edit from highest index to lowest** — insertions and deletions shift all subsequent indices. Working backwards prevents index invalidation.

## Resolve & track documents

| Action | Params | Description |
|--------|--------|-------------|
| `resolveDocument` | one of: `documentId`, `url`, `name`, `driveFileId` | Resolve any identifier to a tracked document. Auto-adds to tracking. |
| `listTrackedDocuments` | — | List all tracked documents |
| `getDocument` | `documentId` | Get document metadata (title, tabs, headers, footers, named ranges) |
| `getDocumentContent` | `documentId`, `tabIndex`(opt) | Get flattened document content as array of elements with indices |
| `createDocument` | `title` | Create a new blank document |

## Text operations (async)

| Action | Params | Description |
|--------|--------|-------------|
| `insertText` | `documentId`, `text`, `index` | Insert text at a specific index |
| `deleteContent` | `documentId`, `startIndex`, `endIndex` | Delete content between indices |
| `replaceAllText` | `documentId`, `find`, `replacement`, `matchCase`(opt) | Find and replace all occurrences |

## Formatting (async)

| Action | Params | Description |
|--------|--------|-------------|
| `updateTextStyle` | `documentId`, `startIndex`, `endIndex`, `bold`(opt), `italic`(opt), `underline`(opt), `strikethrough`(opt), `fontSize`(opt), `fontFamily`(opt), `foregroundColor`(opt), `backgroundColor`(opt), `link`(opt) | Update text formatting in a range |
| `updateParagraphStyle` | `documentId`, `startIndex`, `endIndex`, `namedStyleType`(opt), `alignment`(opt), `lineSpacing`(opt), `spaceAbove`(opt), `spaceBelow`(opt), `indentFirstLine`(opt), `indentStart`(opt), `indentEnd`(opt) | Update paragraph style in a range |

## Lists (async)

| Action | Params | Description |
|--------|--------|-------------|
| `createBullets` | `documentId`, `startIndex`, `endIndex`, `bulletPreset`(opt) | Apply bullet/numbered list to paragraphs |
| `deleteBullets` | `documentId`, `startIndex`, `endIndex` | Remove bullets from paragraphs |

## Tables (async)

| Action | Params | Description |
|--------|--------|-------------|
| `insertTable` | `documentId`, `rows`, `columns`, `index` | Insert a table at a specific index |
| `insertTableRow` | `documentId`, `tableStartIndex`, `rowIndex`, `insertBelow`(opt) | Insert a row in a table |
| `insertTableColumn` | `documentId`, `tableStartIndex`, `columnIndex`, `insertRight`(opt) | Insert a column in a table |
| `deleteTableRow` | `documentId`, `tableStartIndex`, `rowIndex` | Delete a row from a table |
| `deleteTableColumn` | `documentId`, `tableStartIndex`, `columnIndex` | Delete a column from a table |
| `mergeTableCells` | `documentId`, `tableStartIndex`, `rowIndex`, `columnIndex`, `rowSpan`, `columnSpan` | Merge a range of table cells |
| `unmergeTableCells` | `documentId`, `tableStartIndex`, `rowIndex`, `columnIndex`, `rowSpan`, `columnSpan` | Unmerge previously merged table cells |
| `updateTableColumnProperties` | `documentId`, `tableStartIndex`, `columnIndex`, `widthMagnitude`(opt), `widthUnit`(opt) | Set column width |
| `updateTableRowStyle` | `documentId`, `tableStartIndex`, `rowIndex`, `minRowHeight`(opt), `heightUnit`(opt) | Set minimum row height |
| `updateTableCellStyle` | `documentId`, `tableStartIndex`, `rowIndex`, `columnIndex`, `backgroundColor`(opt), `borderLeft`(opt), `borderRight`(opt), `borderTop`(opt), `borderBottom`(opt), `paddingLeft`(opt), `paddingRight`(opt), `paddingTop`(opt), `paddingBottom`(opt), `contentAlignment`(opt) | Style a table cell |
| `pinTableHeaderRows` | `documentId`, `tableStartIndex`, `pinnedHeaderRowCount` | Pin rows as table header (repeats on page break) |

## Images (async)

| Action | Params | Description |
|--------|--------|-------------|
| `insertInlineImage` | `documentId`, `imageUrl`, `index`, `widthMagnitude`(opt), `widthUnit`(opt), `heightMagnitude`(opt), `heightUnit`(opt) | Insert an image at a specific index |

## Structure (async)

| Action | Params | Description |
|--------|--------|-------------|
| `insertPageBreak` | `documentId`, `index` | Insert a page break |
| `insertSectionBreak` | `documentId`, `index`, `sectionType`(opt) | Insert a section break |
| `createHeader` | `documentId`, `sectionType`(opt) | Create a header (returns headerId) |
| `createFooter` | `documentId`, `sectionType`(opt) | Create a footer (returns footerId) |
| `deleteHeader` | `documentId`, `headerId` | Delete a header by ID |
| `deleteFooter` | `documentId`, `footerId` | Delete a footer by ID |
| `createFootnote` | `documentId`, `index` | Create a footnote at a specific index (returns footnoteId) |

## Named ranges (async)

| Action | Params | Description |
|--------|--------|-------------|
| `createNamedRange` | `documentId`, `name`, `startIndex`, `endIndex` | Create a named range spanning indices |
| `deleteNamedRange` | `documentId`, `namedRangeId`(opt), `name`(opt) | Delete a named range by ID or name |
| `replaceNamedRangeContent` | `documentId`, `name`, `text` | Replace all content within a named range |

## Utility

| Action | Params | Description |
|--------|--------|-------------|
| `getCommandResult` | `requestId` | Poll for async command result |
| `syncNow` | — | Queue an immediate sync cycle |

## Heading levels (namedStyleType)

| Style | Usage |
|-------|-------|
| `NORMAL_TEXT` | Default body text |
| `TITLE` | Document title |
| `SUBTITLE` | Document subtitle |
| `HEADING_1` through `HEADING_6` | Section headings (H1 = largest) |

## Alignment options

`START`, `CENTER`, `END`, `JUSTIFIED`

## Bullet presets

**Unordered (bullet):**
- `BULLET_DISC_CIRCLE_SQUARE` (default)
- `BULLET_DIAMONDX_ARROW3D_SQUARE`
- `BULLET_CHECKBOX`
- `BULLET_ARROW_DIAMOND_DISC`
- `BULLET_STAR_CIRCLE_SQUARE`
- `BULLET_ARROW3D_CIRCLE_SQUARE`
- `BULLET_LEFTTRIANGLE_DIAMOND_DISC`
- `BULLET_DIAMONDX_HOLLOWDIAMOND_SQUARE`

**Ordered (numbered):**
- `NUMBERED_DECIMAL_ALPHA_ROMAN` (1. a. i.)
- `NUMBERED_DECIMAL_ALPHA_ROMAN_PARENS` (1) a) i))
- `NUMBERED_DECIMAL_NESTED` (1. 1.1. 1.1.1.)
- `NUMBERED_UPPERALPHA_ALPHA_ROMAN`
- `NUMBERED_UPPERROMAN_UPPERALPHA_DECIMAL`
- `NUMBERED_ZERODECIMAL_ALPHA_ROMAN`

## Section break types

| Type | Behavior |
|------|----------|
| `CONTINUOUS` | New section on the same page |
| `NEXT_PAGE` | New section on the next page (default) |

## Header/footer section types

| Type | Behavior |
|------|----------|
| `DEFAULT` | Default header/footer for all pages |
| `FIRST_PAGE` | Different header/footer for the first page only |

## Color format

Colors are specified as `{red, green, blue}` with values 0-1:
- Red: `{"red": 1, "green": 0, "blue": 0}`
- White: `{"red": 1, "green": 1, "blue": 1}`
- Light blue: `{"red": 0.8, "green": 0.9, "blue": 1}`

## Table cell borders

Each border property is:
```json
{"width": 1, "dashStyle": "SOLID", "color": {"red": 0, "green": 0, "blue": 0}}
```
Dash styles: `SOLID`, `DOT`, `DASH`, `DASH_DOT`, `LONG_DASH`, `LONG_DASH_DOT`

## Table cell content alignment

`TOP`, `MIDDLE`, `BOTTOM`

## Selective tracking

The system uses **selective tracking** for documents:
- Documents accessed via `resolveDocument` are automatically tracked.
- Call `resolveDocument` with a URL, name, or Drive file ID to start tracking.
- Use `listTrackedDocuments` to see what's currently tracked.
- TrackedDocuments metadata is refreshed each sync cycle.

## IDs

- `documentId` — tracking UUID from TrackedDocuments (use in all API calls)
- `googleDocumentId` — the actual Google Docs ID (internal, resolved automatically)
- `headerId` / `footerId` — header/footer IDs (get via `getDocument`)
- `namedRangeId` — named range ID (get via `getDocument`)
- `tableStartIndex` — the index where a table begins (get via `getDocumentContent`)

## Async commands

All operations except `listTrackedDocuments` and `getCommandResult` are processed asynchronously. The response includes a `requestId`. Use `getCommandResult` to poll:

```bash
# Insert text
docs.sh insertText '{"documentId": "uuid", "text": "Hello World\n", "index": 1}'
# Returns: {"requestId": "uuid", "status": "queued"}

# Poll for result (after ~60 seconds)
docs.sh getCommandResult '{"requestId": "uuid"}'
# Returns: {"status": "completed", "result": {...}}
```

## Edit-backwards pattern

When making multiple edits, **always edit from the highest index to the lowest**. Insertions and deletions shift all subsequent indices:

```bash
# CORRECT: delete from bottom first, then top
docs.sh deleteContent '{"documentId": "uuid", "startIndex": 50, "endIndex": 60}'
docs.sh deleteContent '{"documentId": "uuid", "startIndex": 10, "endIndex": 20}'

# WRONG: deleting top first invalidates the bottom indices
docs.sh deleteContent '{"documentId": "uuid", "startIndex": 10, "endIndex": 20}'
docs.sh deleteContent '{"documentId": "uuid", "startIndex": 50, "endIndex": 60}'  # indices shifted!
```

## Limitations

- **Cell limit**: CommandQueue stores params as JSON in a cell (50,000 char limit). Split very large text insertions into multiple calls.
- **Content limit**: `getDocumentContent` truncates at ~50K chars of JSON output. For very long documents, work in sections.
- **Apps Script execution**: 6-minute limit per invocation (4-minute safety timeout used).
- **Image URLs**: `insertInlineImage` requires publicly accessible image URLs.
- **Tabs**: Multi-tab documents are supported. Use `tabIndex` in `getDocumentContent` to read specific tabs (default: 0).

## Examples

```bash
# Resolve a document by URL
docs.sh resolveDocument '{"url": "https://docs.google.com/document/d/abc123/edit"}'

# Resolve from Drive file ID
docs.sh resolveDocument '{"driveFileId": "drive-uuid-here"}'

# List tracked documents
docs.sh listTrackedDocuments

# Get document metadata
docs.sh getDocument '{"documentId": "uuid"}'

# Get document content (flattened)
docs.sh getDocumentContent '{"documentId": "uuid"}'

# Get content from a specific tab
docs.sh getDocumentContent '{"documentId": "uuid", "tabIndex": 1}'

# Create a new document
docs.sh createDocument '{"title": "Q1 Report"}'

# Insert text at the beginning of the document
docs.sh insertText '{"documentId": "uuid", "text": "Hello World\n", "index": 1}'

# Delete content between indices
docs.sh deleteContent '{"documentId": "uuid", "startIndex": 10, "endIndex": 25}'

# Find and replace
docs.sh replaceAllText '{"documentId": "uuid", "find": "old text", "replacement": "new text", "matchCase": true}'

# Bold text in a range
docs.sh updateTextStyle '{"documentId": "uuid", "startIndex": 1, "endIndex": 12, "bold": true}'

# Set font size and color
docs.sh updateTextStyle '{"documentId": "uuid", "startIndex": 1, "endIndex": 12, "fontSize": 18, "foregroundColor": {"red": 0, "green": 0, "blue": 0.8}}'

# Add a hyperlink
docs.sh updateTextStyle '{"documentId": "uuid", "startIndex": 1, "endIndex": 12, "link": "https://example.com"}'

# Set paragraph to Heading 1
docs.sh updateParagraphStyle '{"documentId": "uuid", "startIndex": 1, "endIndex": 12, "namedStyleType": "HEADING_1"}'

# Center-align a paragraph
docs.sh updateParagraphStyle '{"documentId": "uuid", "startIndex": 1, "endIndex": 12, "alignment": "CENTER"}'

# Create a bullet list
docs.sh createBullets '{"documentId": "uuid", "startIndex": 1, "endIndex": 50, "bulletPreset": "BULLET_DISC_CIRCLE_SQUARE"}'

# Create a numbered list
docs.sh createBullets '{"documentId": "uuid", "startIndex": 1, "endIndex": 50, "bulletPreset": "NUMBERED_DECIMAL_ALPHA_ROMAN"}'

# Remove bullets
docs.sh deleteBullets '{"documentId": "uuid", "startIndex": 1, "endIndex": 50}'

# Insert a 3x4 table
docs.sh insertTable '{"documentId": "uuid", "rows": 3, "columns": 4, "index": 1}'

# Insert a table row below row 1
docs.sh insertTableRow '{"documentId": "uuid", "tableStartIndex": 5, "rowIndex": 1, "insertBelow": true}'

# Insert a table column to the right of column 0
docs.sh insertTableColumn '{"documentId": "uuid", "tableStartIndex": 5, "columnIndex": 0, "insertRight": true}'

# Delete table row 2
docs.sh deleteTableRow '{"documentId": "uuid", "tableStartIndex": 5, "rowIndex": 2}'

# Delete table column 1
docs.sh deleteTableColumn '{"documentId": "uuid", "tableStartIndex": 5, "columnIndex": 1}'

# Merge 2x2 cells starting at row 0, column 0
docs.sh mergeTableCells '{"documentId": "uuid", "tableStartIndex": 5, "rowIndex": 0, "columnIndex": 0, "rowSpan": 2, "columnSpan": 2}'

# Set column width
docs.sh updateTableColumnProperties '{"documentId": "uuid", "tableStartIndex": 5, "columnIndex": 0, "widthMagnitude": 150, "widthUnit": "PT"}'

# Style a table cell
docs.sh updateTableCellStyle '{"documentId": "uuid", "tableStartIndex": 5, "rowIndex": 0, "columnIndex": 0, "backgroundColor": {"red": 0.9, "green": 0.9, "blue": 0.9}, "contentAlignment": "MIDDLE"}'

# Pin first row as table header
docs.sh pinTableHeaderRows '{"documentId": "uuid", "tableStartIndex": 5, "pinnedHeaderRowCount": 1}'

# Insert an image
docs.sh insertInlineImage '{"documentId": "uuid", "imageUrl": "https://example.com/logo.png", "index": 1, "widthMagnitude": 200, "widthUnit": "PT", "heightMagnitude": 100, "heightUnit": "PT"}'

# Insert a page break
docs.sh insertPageBreak '{"documentId": "uuid", "index": 50}'

# Insert a section break
docs.sh insertSectionBreak '{"documentId": "uuid", "index": 50, "sectionType": "NEXT_PAGE"}'

# Create a header
docs.sh createHeader '{"documentId": "uuid", "sectionType": "DEFAULT"}'

# Create a footer
docs.sh createFooter '{"documentId": "uuid"}'

# Delete a header
docs.sh deleteHeader '{"documentId": "uuid", "headerId": "kix.abc123"}'

# Create a footnote
docs.sh createFootnote '{"documentId": "uuid", "index": 25}'

# Create a named range
docs.sh createNamedRange '{"documentId": "uuid", "name": "introduction", "startIndex": 1, "endIndex": 100}'

# Delete a named range
docs.sh deleteNamedRange '{"documentId": "uuid", "name": "introduction"}'

# Replace named range content
docs.sh replaceNamedRangeContent '{"documentId": "uuid", "name": "introduction", "text": "Updated introduction text."}'

# Get async result
docs.sh getCommandResult '{"requestId": "uuid"}'

# Force sync
docs.sh syncNow
```
