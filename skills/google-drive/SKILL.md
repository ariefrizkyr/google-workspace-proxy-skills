---
name: google-drive
description: Manage Google Drive via natural language. Use when the user mentions files, folders, documents, Drive, sharing, permissions, storage, revisions, comments, export, download, upload, or file management. Triggers include asking about files, creating documents/spreadsheets/presentations, searching for files, sharing files with people, checking storage, exporting documents to PDF, viewing revision history, adding comments, organizing folders, or any phrase like "find my document", "create a spreadsheet", "share this with", "export as PDF", "my Drive files", "move to folder", "who has access", "check storage", "empty trash".
---
# Google Drive

Manage Google Drive through a spreadsheet-proxy architecture with **selective sync** — only files Claude creates or discovers through search are tracked in the spreadsheet.

```
Claude → drive.sh → Personal Gmail Apps Script → Spreadsheet ↔ Work Email Apps Script → Google Drive API v3
```

## Execution

Run `scripts/drive.sh` with the action and JSON params:

```
"__SKILL_DIR__/scripts/drive.sh" <action> ['{"param": "value"}']
```

For full API actions reference, see `references/api-actions.md`.

## Sync behavior

- Write operations take effect in the spreadsheet immediately. Sync to Google Drive happens within 1-2 minutes.
- Read operations return data from the spreadsheet (reflects last sync).
- IDs are spreadsheet UUIDs, not Google Drive file IDs.
- **Selective sync**: Only files created by Claude or discovered via `searchFiles`/`listFolderContents` are tracked. Drive has potentially millions of files — we don't sync everything.
- Conflict resolution: last-write-wins. Claude's pending changes push before pulling from Google.
- Commands (search, sharing, export, revisions, comments, etc.) are processed server-side and return results directly (typically 5-15 seconds). If the response shows `status: "processing"`, poll with `getCommandResult` after 30 seconds (max 2 retries).
- Most advanced Drive features (export, revisions, comments, permissions, shared drives, storage) go through the CommandQueue but results are returned in the same request.

## Workflow

### 1. Map intent to action

**View files:**
- "show my files", "what's in my Drive" → `listFiles`
- "recent files", "recently modified" → `listRecentFiles`
- "show my folders" → `listFolders`
- "find [filename]", "search for [query]" → `searchFiles`- "what's in the [folder name] folder" → `listFolderContents`- "show file details" → `getFile`

**Create files:**
- "create a folder called X" → `createFolder`
- "create a text file with [content]" → `createFile`
- "create a Google Doc called X" → `createDocument`
- "create a spreadsheet called X" → `createSpreadsheet`
- "create a presentation called X" → `createPresentation`

**Modify files:**
- "rename [file] to X" → `renameFile`
- "update the description of [file]" → `updateDescription`
- "star [file]", "mark as favorite" → `starFile`
- "unstar [file]" → `unstarFile`
- "delete [file]", "trash [file]" → `trashFile`
- "restore [file] from trash" → `restoreFile`
- "move [file] to [folder]" → `moveFile`- "copy [file]" → `copyFile`
**Sharing & permissions:**
- "share [file] with [email]" → `shareFile`- "remove [email]'s access to [file]" → `unshareFile`- "who has access to [file]" → `getPermissions`- "make [file] public" → `setPublicAccess`- "remove public access from [file]" → `removePublicAccess`
**Export & content:**
- "export [doc] as PDF" → `exportFile`- "download [file]", "get the content of [file]" → `getFileContent`
**Revisions:**
- "show revision history of [file]" → `listRevisions`- "get revision [id] of [file]" → `getRevision`
**Comments:**
- "show comments on [file]" → `listComments`- "add a comment to [file]" → `addComment`- "delete comment [id]" → `deleteComment`- "show replies to comment [id]" → `listReplies`- "reply to comment [id]" → `addReply`
**Storage & maintenance:**
- "how much storage am I using" → `getStorageInfo`- "show my shared drives" → `listSharedDrives`- "empty my trash" → `emptyTrash`
### 2. Use exact API parameter names

Always use the exact parameter names from `references/api-actions.md`. Common mistakes to avoid:
- Use `fileId` (NOT `id` or `file`) for file operations
- Use `content` (NOT `body` or `text`) for file content and comments
- Use `destinationFolderId` (NOT `destination` or `dest`) for move/copy
- Use `exportMimeType` (NOT `format`) for export operations
- Use `query` (NOT `search`) for `searchFiles`

### 3. Resolve IDs

Always resolve IDs before any operation — never guess.

1. For file operations, call `listFiles`, `searchFiles`, or `listRecentFiles` to find the file, matching user's description to file name (case-insensitive, partial match OK).
2. If multiple matches, ask the user which one. If no match, try `searchFiles` (async).
3. For folder operations, call `listFolders` to find folder IDs.
4. For operations on files not yet tracked, use `searchFiles` first to discover and track them.

### 4. Handle command responses

Most advanced features (search, sharing, export, revisions, comments, shared drives, storage) are processed server-side and return results directly (typically 5-15 seconds):

1. Call the action — result is returned in the same response.
2. If the response shows `status: "processing"` (rare), poll with `getCommandResult` after 30 seconds (max 2 retries).
3. Present the results.

### 5. Present results

**File listing:**
```
## My Drive Files

📁 Project Alpha          — Folder, modified Mar 15
📄 Q1 Report.docx         — Google Doc, modified Mar 14
📊 Budget 2026.xlsx       — Google Sheet, modified Mar 12, ⭐
📋 Sprint Planning.pptx   — Google Slides, modified Mar 10
📎 notes.txt              — 2.4 KB, modified Mar 8

5 files shown
```

**File type icons:**
- 📁 Folder
- 📄 Google Doc / Word document
- 📊 Google Sheet / Excel spreadsheet
- 📋 Google Slides / PowerPoint presentation
- 📎 Other files (text, PDF, images, etc.)

**Indicators:**
- ⭐ Starred files
- 🔗 Shared files (show who has access if known)
- 🗑️ Trashed files

**Formatting rules:**
- Show file type icon based on mimeType.
- Show file size for non-Google Workspace files.
- Show modified time in relative or short date format.
- Show star indicator for starred files.
- For sharing results, show role (editor/viewer/commenter) and email.
- For destructive operations (trash, empty trash, remove access), confirm with the user first.
- Be concise in confirmations for create/update operations.

### 6. Export format reference

| Source type | Available export formats |
|------------|------------------------|
| Google Docs | PDF, DOCX, TXT, HTML |
| Google Sheets | PDF, XLSX, CSV |
| Google Slides | PDF, PPTX, PNG |
| Google Drawings | PDF, PNG, SVG |

### 7. Revision history presentation

```
## Revision History — Q1 Report

| # | Modified | Author | Size |
|---|----------|--------|------|
| 5 | Mar 15, 14:30 | Sarah | 45 KB |
| 4 | Mar 14, 11:00 | You | 42 KB |
| 3 | Mar 12, 09:15 | Alice | 38 KB |
| 2 | Mar 10, 16:45 | You | 35 KB |
| 1 | Mar 8, 10:00 | You | 28 KB |
```

### 8. Comment thread presentation

```
## Comments — Q1 Report

**Alice** (Mar 15, 14:30):
> Can we update the revenue numbers for March?

  **You** (Mar 15, 15:00):
  > Done, updated with latest figures.

**Bob** (Mar 14, 11:00) ✅ Resolved:
> Typo on page 3, "teh" should be "the"
```
