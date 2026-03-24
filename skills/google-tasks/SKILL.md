---
name: google-tasks
description: Manage Google Tasks via natural language. Use when the user mentions tasks, todos, reminders, or to-do lists. Triggers include asking about tasks due today/tomorrow/this week, creating tasks or reminders, marking tasks done/complete, updating task details or due dates, deleting tasks, showing task lists, clearing completed tasks, rescheduling, checking off items, reopening tasks, or any phrase like "what do I have to do", "my todos", "remind me to", "add to my list", "what's pending", "I finished X", "done with X".
---
# Google Tasks

Manage Google Tasks through a spreadsheet-proxy architecture. Claude calls a personal Gmail Apps Script web app, which reads/writes a shared Google Spreadsheet. A work-email Apps Script syncs the spreadsheet with Google Tasks every minute.

```
Claude → tasks.sh → Personal Gmail Apps Script → Spreadsheet ↔ Work Email Apps Script → Google Tasks
```

## Execution

Run `scripts/tasks.sh` with the action and JSON params:

```
"__SKILL_DIR__/scripts/tasks.sh" <action> ['{"param": "value"}']
```

For full API actions reference, see `references/api-actions.md`.

## Sync behavior

- Write operations take effect in the spreadsheet immediately. Sync to Google Tasks happens within 1-2 minutes.
- Read operations return data from the spreadsheet (reflects last sync).
- IDs are spreadsheet UUIDs, not Google Task IDs.
- Conflict resolution: last-write-wins. Claude's pending changes push before pulling from Google.

## Parameter names (exact JSON keys)

Use these exact parameter names in JSON — do NOT abbreviate or rename them:

- **`taskListId`** — UUID of the task list (from `listTaskLists` response `id` field)
- **`taskId`** — UUID of the task (from `listTasks` response `id` field)

### Quick reference

```bash
# List all task lists
tasks.sh listTaskLists

# List tasks in a list (incomplete only — default)
tasks.sh listTasks '{"taskListId": "<list-uuid>", "showCompleted": false}'

# List tasks including completed (only when user asks for done/finished tasks)
tasks.sh listTasks '{"taskListId": "<list-uuid>", "showCompleted": true}'

# Create a task (with optional notes and due date)
tasks.sh createTask '{"taskListId": "<list-uuid>", "title": "Task title", "due": "2026-03-05T00:00:00.000Z"}'

# Update a task
tasks.sh updateTask '{"taskId": "<task-uuid>", "title": "New title", "due": "2026-03-10T00:00:00.000Z"}'

# Complete / uncomplete a task
tasks.sh completeTask '{"taskId": "<task-uuid>"}'
tasks.sh uncompleteTask '{"taskId": "<task-uuid>"}'

# Delete a task
tasks.sh deleteTask '{"taskId": "<task-uuid>"}'

# Move a task to another list
tasks.sh moveTask '{"taskId": "<task-uuid>", "destinationTaskList": "<other-list-uuid>"}'

# Clear completed tasks from a list
tasks.sh clearCompleted '{"taskListId": "<list-uuid>"}'
```

## Workflow

### 1. Map intent to action

- **View tasks**: "show my tasks", "what's due today", "my todos", "what's pending" → `listTasks` with `showCompleted: false` (default)
- **View completed tasks**: "what did I do today", "what have I completed", "show done tasks", "what did we finish" → `listTasks` with `showCompleted: true`
- **View lists**: "show my lists", "what lists do I have" → `listTaskLists`
- **Create**: "add task X", "remind me to X", "I need to X", "don't let me forget X" → `createTask`
- **Complete**: "mark X as done", "I finished X", "done with X", "check off X" → `completeTask`
- **Uncomplete**: "reopen X", "uncheck X", "X is not done yet" → `uncompleteTask`
- **Update**: "rename X to Y", "set due date for X", "reschedule X", "add note to X" → `updateTask`
- **Delete**: "delete X", "remove X", "get rid of X" → `deleteTask`
- **Move**: "move X to list Y" → `moveTask`
- **Housekeeping**: "clear completed", "clean up done tasks" → `clearCompleted`

> **Default: hide completed tasks.** Always pass `"showCompleted": false` unless the user explicitly asks about completed/done/finished tasks. This reduces data and keeps responses focused on actionable items.

### 2. Resolve IDs

Always resolve IDs before any operation — never guess.

1. Call `listTaskLists` to get list IDs. Use the first/default list if user doesn't specify one.
2. For task-specific operations, call `listTasks` with `{"taskListId": "<list-uuid>", "showCompleted": false}` and match user's description to a task title (case-insensitive, partial match OK). If the user is referencing a completed task (e.g., "uncomplete X", "reopen X"), use `"showCompleted": true` instead.
3. If multiple matches, ask the user which one. If no match, say so.

### 3. Handle dates

Convert relative dates to RFC 3339 (`YYYY-MM-DDT00:00:00.000Z`):
- "today" → current date, "tomorrow" → +1 day, "next Monday" → calculate, "end of week" → next Sunday
- For date range filters (`dueMin`/`dueMax`), set start/end of day boundaries.

### 4. Present results

```
## List Name (N tasks)

- [ ] Task title — due: Mar 1, 2026
- [ ] Another task — due: Feb 28, 2026
      Note: Some details here
- [x] Done task — completed: Feb 24, 2026
```

- Sort by due date (earliest first), then position.
- Be concise in confirmations for create/update/delete.
- For destructive operations (delete), confirm with the user first.
- If multiple steps needed (e.g., "create 3 tasks"), execute sequentially.
