# Google Drive API Actions Reference

All actions are called via `drive.sh <action> ['{"param": "value"}']`. Every request is POST with JSON body.

## Read from sheet cache (synchronous)

| Action | Params | Description |
|--------|--------|-------------|
| `listFiles` | `folderId`(opt), `mimeType`(opt), `starred`(opt), `trashed`(opt), `query`(opt) | List tracked files, optionally filtered |
| `getFile` | `fileId` | Get full file details |
| `listRecentFiles` | `limit`(opt) | Get recently modified tracked files (default: 20) |
| `listFolders` | `parentId`(opt) | List tracked folders, optionally within a parent |

## Write to sheet (synchronous — sync pushes to Drive)

| Action | Params | Description |
|--------|--------|-------------|
| `createFolder` | `name`, `parentId`(opt), `description`(opt) | Create a folder |
| `createFile` | `name`, `content`, `parentId`(opt), `mimeType`(opt), `description`(opt) | Create a file with content |
| `createDocument` | `name`, `parentId`(opt), `description`(opt) | Create an empty Google Doc |
| `createSpreadsheet` | `name`, `parentId`(opt), `description`(opt) | Create an empty Google Sheet |
| `createPresentation` | `name`, `parentId`(opt), `description`(opt) | Create an empty Google Slides presentation |
| `renameFile` | `fileId`, `name` | Rename a file or folder |
| `updateDescription` | `fileId`, `description` | Update file description |
| `starFile` | `fileId` | Star a file |
| `unstarFile` | `fileId` | Remove star from a file |
| `trashFile` | `fileId` | Move file to trash |
| `restoreFile` | `fileId` | Restore file from trash |

## Search & discovery (async — use getCommandResult to poll)

| Action | Params | Description |
|--------|--------|-------------|
| `searchFiles` | `query`, `mimeType`(opt), `folderId`(opt), `trashed`(opt) | Full-text search across Drive (results auto-tracked) |
| `listFolderContents` | `folderId` | List all contents of a folder (results auto-tracked) |

## Organize (async)

| Action | Params | Description |
|--------|--------|-------------|
| `moveFile` | `fileId`, `destinationFolderId` | Move file to a different folder |
| `copyFile` | `fileId`, `name`(opt), `destinationFolderId`(opt) | Copy a file (optionally with new name/location) |

## Sharing & permissions (async)

| Action | Params | Description |
|--------|--------|-------------|
| `shareFile` | `fileId`, `email`, `role`, `sendNotification`(opt), `message`(opt) | Share file with a user |
| `unshareFile` | `fileId`, `email` | Remove user's access to file |
| `getPermissions` | `fileId` | List all permissions on a file |
| `setPublicAccess` | `fileId`, `role`(opt) | Make file accessible to anyone with the link |
| `removePublicAccess` | `fileId` | Remove public link access |

## Export & content (async)

| Action | Params | Description |
|--------|--------|-------------|
| `exportFile` | `fileId`, `exportMimeType` | Export a Google Workspace file to another format |
| `getFileContent` | `fileId` | Get the text content of a file |

## Revisions (async)

| Action | Params | Description |
|--------|--------|-------------|
| `listRevisions` | `fileId` | List revision history of a file |
| `getRevision` | `fileId`, `revisionId` | Get details of a specific revision |

## Comments & replies (async)

| Action | Params | Description |
|--------|--------|-------------|
| `listComments` | `fileId` | List all comments on a file |
| `addComment` | `fileId`, `content` | Add a comment to a file |
| `deleteComment` | `fileId`, `commentId` | Delete a comment |
| `listReplies` | `fileId`, `commentId` | List replies to a comment |
| `addReply` | `fileId`, `commentId`, `content` | Reply to a comment |

## Shared drives (async)

| Action | Params | Description |
|--------|--------|-------------|
| `listSharedDrives` | — | List all shared drives accessible to the user |

## Storage & cleanup (async)

| Action | Params | Description |
|--------|--------|-------------|
| `getStorageInfo` | — | Get storage quota and usage information |
| `emptyTrash` | — | Permanently delete all trashed files |

## Utility

| Action | Params | Description |
|--------|--------|-------------|
| `getCommandResult` | `requestId` | Poll for async command result |
| `syncNow` | — | Queue an immediate sync cycle |

## Sharing roles

- `editor` — Can edit, comment, and share
- `viewer` — Can view only
- `commenter` — Can view and comment

## Common MIME types

| Type | MIME type |
|------|----------|
| Google Doc | `application/vnd.google-apps.document` |
| Google Sheet | `application/vnd.google-apps.spreadsheet` |
| Google Slides | `application/vnd.google-apps.presentation` |
| Google Drawing | `application/vnd.google-apps.drawing` |
| Folder | `application/vnd.google-apps.folder` |
| PDF | `application/pdf` |
| Plain text | `text/plain` |
| HTML | `text/html` |
| CSV | `text/csv` |
| Word (.docx) | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| Excel (.xlsx) | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| PowerPoint (.pptx) | `application/vnd.openxmlformats-officedocument.presentationml.presentation` |
| PNG | `image/png` |
| JPEG | `image/jpeg` |
| SVG | `image/svg+xml` |

## Export MIME types reference

| Source type | Export formats |
|------------|---------------|
| Google Docs | `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `text/plain`, `text/html` |
| Google Sheets | `application/pdf`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `text/csv` |
| Google Slides | `application/pdf`, `application/vnd.openxmlformats-officedocument.presentationml.presentation`, `image/png` |
| Google Drawings | `application/pdf`, `image/png`, `image/svg+xml` |

## Selective sync

Drive has potentially millions of files. The system uses **selective sync**:

- Files created by Claude are automatically tracked.
- Files found via `searchFiles` or `listFolderContents` are automatically added to the tracking sheet.
- `initialImport` seeds the sheet with root-level files and starred files.
- Changes to tracked files are detected via `Drive.Changes.list()`.
- Untracked files are NOT automatically added — use search to discover them.

## IDs

All IDs returned are spreadsheet UUIDs, not Google Drive file IDs. Use these UUIDs in all subsequent API calls.

## Async commands

Most advanced features (search, sharing, export, revisions, comments, shared drives, storage) are processed asynchronously by the sync engine. The response includes a `requestId`. Use `getCommandResult` to poll:

```bash
# Search for files (result returned directly, typically 5-15 seconds)
drive.sh searchFiles '{"query": "Q1 Report"}'
# Returns: {"status": "completed", "result": {"items": [...]}}

# If status is "processing" (rare), poll with getCommandResult after 30 seconds:
drive.sh getCommandResult '{"requestId": "uuid"}'
```

## Examples

```bash
# List tracked files
drive.sh listFiles

# List recent files
drive.sh listRecentFiles '{"limit": 10}'

# List folders
drive.sh listFolders

# Get file details
drive.sh getFile '{"fileId": "uuid-here"}'

# Create a folder
drive.sh createFolder '{"name": "Project Alpha"}'

# Create a folder inside another folder
drive.sh createFolder '{"name": "Docs", "parentId": "uuid-of-parent-folder"}'

# Create a text file
drive.sh createFile '{"name": "notes.txt", "content": "Meeting notes from today..."}'

# Create a Google Doc
drive.sh createDocument '{"name": "Q1 Report", "description": "Quarterly report for Q1 2026"}'

# Create a Google Sheet
drive.sh createSpreadsheet '{"name": "Budget 2026"}'

# Create a Google Slides presentation
drive.sh createPresentation '{"name": "Sprint Review"}'

# Rename a file
drive.sh renameFile '{"fileId": "uuid-here", "name": "Q1 Report - Final"}'

# Update description
drive.sh updateDescription '{"fileId": "uuid-here", "description": "Updated with March data"}'

# Star a file
drive.sh starFile '{"fileId": "uuid-here"}'

# Unstar a file
drive.sh unstarFile '{"fileId": "uuid-here"}'

# Trash a file
drive.sh trashFile '{"fileId": "uuid-here"}'

# Restore from trash
drive.sh restoreFile '{"fileId": "uuid-here"}'

# Search for files (async)
drive.sh searchFiles '{"query": "budget"}'

# Search with MIME type filter
drive.sh searchFiles '{"query": "report", "mimeType": "application/vnd.google-apps.document"}'

# List folder contents (async)
drive.sh listFolderContents '{"folderId": "uuid-here"}'

# Move a file (async)
drive.sh moveFile '{"fileId": "uuid-here", "destinationFolderId": "uuid-of-dest-folder"}'

# Copy a file (async)
drive.sh copyFile '{"fileId": "uuid-here", "name": "Q1 Report - Copy"}'

# Share with someone (async)
drive.sh shareFile '{"fileId": "uuid-here", "email": "alice@company.com", "role": "editor", "sendNotification": true, "message": "Please review"}'

# Remove access (async)
drive.sh unshareFile '{"fileId": "uuid-here", "email": "alice@company.com"}'

# Check permissions (async)
drive.sh getPermissions '{"fileId": "uuid-here"}'

# Make public (async)
drive.sh setPublicAccess '{"fileId": "uuid-here", "role": "viewer"}'

# Remove public access (async)
drive.sh removePublicAccess '{"fileId": "uuid-here"}'

# Export Google Doc as PDF (async)
drive.sh exportFile '{"fileId": "uuid-here", "exportMimeType": "application/pdf"}'

# Export Google Sheet as CSV (async)
drive.sh exportFile '{"fileId": "uuid-here", "exportMimeType": "text/csv"}'

# Get file content (async)
drive.sh getFileContent '{"fileId": "uuid-here"}'

# List revisions (async)
drive.sh listRevisions '{"fileId": "uuid-here"}'

# Get specific revision (async)
drive.sh getRevision '{"fileId": "uuid-here", "revisionId": "123"}'

# List comments (async)
drive.sh listComments '{"fileId": "uuid-here"}'

# Add a comment (async)
drive.sh addComment '{"fileId": "uuid-here", "content": "Looks good, approved!"}'

# Delete a comment (async)
drive.sh deleteComment '{"fileId": "uuid-here", "commentId": "comment-id"}'

# List replies (async)
drive.sh listReplies '{"fileId": "uuid-here", "commentId": "comment-id"}'

# Reply to a comment (async)
drive.sh addReply '{"fileId": "uuid-here", "commentId": "comment-id", "content": "Thanks for the feedback!"}'

# List shared drives (async)
drive.sh listSharedDrives

# Check storage (async)
drive.sh getStorageInfo

# Empty trash (async)
drive.sh emptyTrash

# Get async result
drive.sh getCommandResult '{"requestId": "uuid-here"}'

# Force sync
drive.sh syncNow
```
