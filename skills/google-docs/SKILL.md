---
name: google-docs
description: Manage Google Docs via natural language. Use when the user mentions documents, Google Docs, paragraphs, headings, text formatting, bold, italic, font, tables, bullet lists, numbered lists, images, headers, footers, footnotes, named ranges, page breaks, section breaks, or any document editing operations. Triggers include asking about document content, reading text, writing text, formatting paragraphs, inserting tables, creating lists, adding images, setting headings, or any phrase like "read the document", "insert text", "make this bold", "add a heading", "create a table", "insert a bullet list", "add an image", "create a header", "add a footnote", "find and replace", "create a Google Doc".
---
# Google Docs

Manage Google Docs through a spreadsheet-proxy architecture. **All target document operations** (reads AND writes) go through CommandQueue → WorkSync on the work email account, since the personal email may not have access to work documents.

```
Claude → docs.sh → Personal Gmail Apps Script → CommandQueue (enqueue all operations)
                                                ↕
                                     Work Email Apps Script → Docs API v1 (reads + writes)
```

## Execution

Run `scripts/docs.sh` with the action and JSON params:

```
"__SKILL_DIR__/scripts/docs.sh" <action> ['{"param": "value"}']
```

For full API actions reference, see `references/api-actions.md`.

## Sync behavior

- **All target document operations are processed server-side** — both reads and writes are queued in CommandQueue and processed by WorkSync.gs (running on the work email) via Docs API v1. Results are returned directly in the same request (typically 5-15 seconds). This is because the personal email proxy may not have access to work email documents.
- **Proxy-spreadsheet reads are instant** — `listTrackedDocuments` and `getCommandResult` read from the proxy spreadsheet directly.
- IDs are tracking UUIDs (from TrackedDocuments), not Google document IDs directly.
- **Selective tracking**: Only documents resolved via `resolveDocument` are tracked. Not all user documents are synced.
- All commands are queued and results are returned directly (typically 5-15 seconds). If the response shows `status: "processing"`, poll with `getCommandResult` after 30 seconds (max 2 retries).
- Cell limit: CommandQueue stores params as JSON in a cell (50,000 char limit). Split very large text insertions into multiple calls.
- Content limit: `getDocumentContent` truncates at ~50K chars of JSON output.

## Index system

Google Docs uses **1-based integer indices** to address positions in the document body:
- Index `1` = start of document body
- Every character occupies 1 index unit; newlines (`\n`) also count as 1
- **Always call `getDocumentContent` first** to get current indices before editing
- **Edit backwards** — when making multiple edits, work from highest index to lowest to avoid index invalidation

## Workflow

### 1. Map intent to action

**Read content:**
- "show document content", "what's in the doc" → `getDocumentContent`
- "what documents am I tracking" → `listTrackedDocuments`
- "get document details", "list tabs" → `getDocument`

**Create documents:**
- "create a Google Doc called Q1 Report" → `createDocument`

**Edit text:**
- "add text at the beginning" → `insertText` (read indices first!)
- "delete that paragraph" → `deleteContent` (read indices first!)
- "replace all instances of X with Y" → `replaceAllText`

**Format text:**
- "make this bold", "change font size" → `updateTextStyle` (read indices first!)
- "set heading level", "center-align" → `updateParagraphStyle` (read indices first!)

**Lists:**
- "create a bullet list" → `createBullets`
- "make a numbered list" → `createBullets` with numbered preset
- "remove bullets" → `deleteBullets`

**Tables:**
- "insert a table" → `insertTable`
- "add a row/column" → `insertTableRow` / `insertTableColumn`
- "delete a row/column" → `deleteTableRow` / `deleteTableColumn`
- "merge cells" → `mergeTableCells`
- "set column width" → `updateTableColumnProperties`
- "style a cell" → `updateTableCellStyle`
- "pin header row" → `pinTableHeaderRows`

**Images:**
- "insert an image" → `insertInlineImage`

**Document structure:**
- "add a page break" → `insertPageBreak`
- "add a section break" → `insertSectionBreak`
- "create a header/footer" → `createHeader` / `createFooter`
- "add a footnote" → `createFootnote`

**Named ranges:**
- "name this section" → `createNamedRange`
- "update the introduction" → `replaceNamedRangeContent`
- "delete the named range" → `deleteNamedRange`

### 2. Use exact API parameter names

Always use the exact parameter names from `references/api-actions.md`. Common mistakes to avoid:
- Use `documentId` (NOT `id` or `docId`) for document operations
- Use `index` (NOT `pos` or `position`) for insertion points
- Use `startIndex` / `endIndex` (NOT `start` / `end`) for ranges
- Use `tableStartIndex` (NOT `tableStart`) for table operations
- Use `text` (NOT `content` or `txt`) for text content
- Use `title` (NOT `name`) for document titles (but `name` for named ranges)

### 3. Resolve document IDs

Always resolve the document before any operation — never guess.

1. If the user provides a URL, name, or Drive file ID, call `resolveDocument` first.
2. `resolveDocument` returns a tracking UUID as `documentId`. Use this in all subsequent calls.
3. If the user says "that document" or refers to one by name, call `listTrackedDocuments` to find it.
4. To get headers, footers, and named ranges, call `getDocument` on the document.
5. **Drive integration**: When Drive skill encounters `application/vnd.google-apps.document`, call `resolveDocument` with the `driveFileId` to get a Docs tracking ID.

### 4. Index system guide

**Before ANY edit**, call `getDocumentContent` to get current indices:

```bash
docs.sh getDocumentContent '{"documentId": "uuid"}'
```

This returns elements with `startIndex` and `endIndex`. Use these to target edits.

**Edit backwards rule**: When making multiple edits in one session, always start from the highest index and work down:

```
# 1. Read content → get indices
# 2. Edit at index 200 first
# 3. Then edit at index 50
# (NOT the other way around — editing at 50 would shift index 200)
```

Each edit returns a `requestId`. If you need updated indices after an edit, call `getDocumentContent` again after the command completes.

### 5. Handle command responses

All operations return results directly (typically 5-15 seconds, except `listTrackedDocuments` and `getCommandResult` which are instant):

1. Call the action — result is returned in the same response.
2. If the response shows `status: "processing"` (rare), poll with `getCommandResult` after 30 seconds (max 2 retries).
3. Present the results.

### 6. Present results

**Document content:**
```
## Q1 Report

Content elements (showing first 10):

| # | Type | Index | Text (preview) | Style |
|---|------|-------|----------------|-------|
| 1 | text | 1-15 | "Q1 Report\n" | TITLE, bold |
| 2 | text | 15-30 | "Introduction\n" | HEADING_1 |
| 3 | text | 30-120 | "This quarter we..." | NORMAL_TEXT |
| 4 | table | 120-250 | — | 3 rows x 4 cols |
| ... | ... | ... | ... | ... |

42 elements total
```

**Document listing:**
```
## Tracked Documents

📄 Q1 Report (id: uuid-1) — 2 tabs
📄 Meeting Notes (id: uuid-2) — 1 tab
📄 Project Plan (id: uuid-3) — 1 tab

3 documents tracked
```

**Formatting rules:**
- Show content as markdown tables with index ranges and style info.
- For large documents, summarize and show element count.
- Show document emoji 📄 for document listings.
- For write confirmations, be concise: "Text inserted at index 1."
- For destructive operations (delete content), confirm with the user first.
- Always include index information when showing content — the user needs it for edits.

### 7. Drive integration

When the Drive skill encounters a file with mimeType `application/vnd.google-apps.document`:
1. The Drive skill tracks it with a `fileId` (Drive tracking UUID).
2. Call `docs.sh resolveDocument '{"driveFileId": "<driveFileId>"}'` to get a Docs tracking ID.
3. Use the returned `documentId` for all Docs operations.
4. Prefer Docs skill over Drive's `getFileContent` for document files — Docs provides richer element-level access vs flat text export.
