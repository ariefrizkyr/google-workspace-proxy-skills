# Google Tasks API Actions Reference

All actions are called via `tasks.sh <action> ['{"param": "value"}']`. Every request is POST with JSON body.

## Task lists

| Action | Params | Body fields |
|--------|--------|-------------|
| `listTaskLists` | — | — |
| `getTaskList` | `taskListId` | — |
| `createTaskList` | — | `title` |
| `updateTaskList` | `taskListId` | `title` |
| `deleteTaskList` | `taskListId` | — |

## Tasks

| Action | Params | Body fields |
|--------|--------|-------------|
| `listTasks` | `taskListId` | `showCompleted`, `showHidden` |
| `getTask` | `taskId` | — |
| `createTask` | `taskListId` | `title`, `notes`, `due`, `parent`, `position`, `links` |
| `updateTask` | `taskId` | `title`, `notes`, `due`, `status`, `completed` |
| `deleteTask` | `taskId` | — |
| `completeTask` | `taskId` | — |
| `uncompleteTask` | `taskId` | — |
| `moveTask` | `taskId` | `parent`, `previous`, `destinationTaskList` |
| `clearCompleted` | `taskListId` | — |

## Examples

```bash
# List all task lists
tasks.sh listTaskLists

# List tasks in a list
tasks.sh listTasks '{"taskListId": "uuid-here"}'

# Create a task
tasks.sh createTask '{"taskListId": "uuid-here", "title": "Buy groceries", "due": "2026-03-01T00:00:00.000Z"}'

# Complete a task
tasks.sh completeTask '{"taskId": "uuid-here"}'

# Move a task to another list
tasks.sh moveTask '{"taskId": "uuid-here", "destinationTaskList": "other-list-uuid"}'
```

## Date format

All dates use RFC 3339: `YYYY-MM-DDT00:00:00.000Z`

## Task status values

- `needsAction` — pending/incomplete
- `completed` — done

## IDs

All IDs returned are spreadsheet UUIDs, not Google Task IDs. Use these UUIDs in all subsequent API calls.
