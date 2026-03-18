# Google Workspace Skills for AI Coding Agents

Agent skills that let you manage **Google Tasks**, **Google Calendar**, **Google Drive**, **Google Sheets**, and **Google Docs** through natural language, right from your terminal.

> "show my tasks" / "what's on my calendar today" / "schedule a meeting with Sarah at 2pm" / "create a Google Doc called Q1 Report" / "share this file with alice@company.com" / "read the data from my Budget spreadsheet"

Works with **Claude Code**, **Gemini CLI**, **OpenAI Codex CLI**, **Cursor**, and any agent that supports the [Agent Skills](https://agentskills.io/specification) standard.

## What is this?

These are [Agent Skills](https://agentskills.io/specification) that give your AI coding agent the ability to read and write your Google Tasks, Google Calendar, Google Drive, Google Sheets, and Google Docs. Instead of switching to a browser, you talk to your agent and it handles everything.

The architecture uses a **spreadsheet-proxy** pattern:

```
AI Agent  ->  Shell Script  ->  Apps Script (Personal Gmail)  ->  Google Spreadsheet
                                                                        |
                                                          Apps Script (Work Email)  ->  Google Tasks / Calendar / Drive / Sheets / Docs API
```

**Why not call the API directly?** Google Workspace APIs require OAuth with browser-based consent flows. This proxy approach uses Apps Script (which has built-in auth) and a shared spreadsheet as the communication layer. Your agent just makes HTTP calls to your personal Apps Script web app. A sync engine on your work account syncs the spreadsheet with the actual APIs every minute.

## Supported Agents

| Agent | Global Path | Project Path |
| --- | --- | --- |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `~/.claude/skills/` | `.claude/skills/` |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `~/.gemini/skills/` | `.gemini/skills/` |
| [OpenAI Codex CLI](https://github.com/openai/codex) | `~/.codex/skills/` | `.agents/skills/` |
| [Cursor](https://cursor.com) | `~/.cursor/skills/` | `.cursor/skills/` |

The installer handles all path differences automatically. Since all these agents use the same `SKILL.md` format (the [Agent Skills](https://agentskills.io/specification) open standard), a single skill definition works across all of them.

## Features

### Google Tasks

- **View** task lists and tasks with due dates, notes, and completion status
- **Create** tasks with titles, notes, due dates, and subtasks
- **Complete / uncomplete** tasks
- **Update** task titles, notes, and due dates
- **Move** tasks between lists or reorder within a list
- **Delete** tasks and clear completed tasks
- Natural language date handling ("tomorrow", "next Monday", "end of week")

### Google Calendar

- **View** today's schedule, weekly schedule, or any date range
- **Create** timed events, all-day events, and recurring events
- **Create** Out of Office and Focus Time blocks with auto-decline
- **Update** event details, times, location, and attendees
- **RSVP** to invitations (accept, decline, tentative)
- **Manage guests** (add/remove attendees)
- **Smart scheduling** -- find available slots across multiple people's calendars
- **Check availability** for coworkers using FreeBusy API
- **Holiday awareness** -- warns about scheduling over holidays without blocking
- **Multi-calendar support** -- primary, coworker, holiday, shared, and resource calendars
- **Recurring event support** -- update/delete single instances or entire series
- **Search** across all synced calendars

### Google Drive

- **Browse** files, folders, and recent files
- **Create** folders, text files, Google Docs, Sheets, and Slides
- **Search** across your entire Drive with full-text search
- **Organize** -- rename, move, copy, star, trash, and restore files
- **Share** files with people (editor, viewer, commenter roles)
- **Permissions** -- set/remove public access, view who has access
- **Export** Google Workspace files to PDF, DOCX, XLSX, CSV, PPTX, TXT, HTML, PNG, SVG
- **Content** -- read file contents (text files and Google Workspace files)
- **Revisions** -- view revision history and specific revisions
- **Comments** -- list, add, delete comments and replies on files
- **Shared Drives** -- list accessible shared drives
- **Storage** -- check quota and usage, empty trash
- **Selective sync** -- only tracks files you create or discover (Drive has millions of files)

### Google Sheets

- **Read data** -- read single/multiple ranges, get all sheet data, list sheets/tabs, get spreadsheet metadata
- **Write data** -- write to single/multiple ranges, append rows, clear ranges
- **Sheet management** -- add, delete, duplicate, rename sheets, freeze rows/columns, hide sheets
- **Row/column operations** -- insert, delete, move, resize rows & columns, auto-resize
- **Formatting** -- bold, italic, font size/family, colors, alignment, borders, merge/unmerge cells
- **Data operations** -- sort ranges, find & replace (with regex), conditional formatting, data validation
- **Named ranges** -- create and delete named ranges
- **Protection** -- protect/unprotect ranges with editor lists or warning-only mode
- **Charts** -- add, update, delete embedded charts (16 chart types)
- **Filters** -- set/clear basic filters, create/delete filter views
- **Pivot tables** -- create pivot tables with rows, columns, values, and filters
- **Drive integration** -- resolve spreadsheets from Drive file IDs for seamless cross-skill workflows
- **Async proxy** -- all operations route through the work email (personal email may not have access to work spreadsheets)

### Google Docs

- **Read content** -- get flattened document content with element indices, types, text, and styles
- **Create documents** -- create new Google Docs with titles
- **Edit text** -- insert text at specific indices, delete content ranges, find & replace across the document
- **Formatting** -- bold, italic, underline, strikethrough, font size/family, text color, background color, hyperlinks
- **Paragraph styles** -- headings (H1-H6), title, subtitle, alignment, line spacing, indentation
- **Lists** -- create bullet lists (8 presets) and numbered lists (6 presets), remove bullets
- **Tables (10 actions)** -- insert tables, add/delete rows & columns, merge/unmerge cells, set column width, row height, cell styling, pin header rows
- **Images** -- insert inline images with optional width/height
- **Document structure** -- page breaks, section breaks, headers, footers, footnotes
- **Named ranges** -- create, delete, and replace content within named ranges
- **Drive integration** -- resolve documents from Drive file IDs for seamless cross-skill workflows
- **Index-based editing** -- content flattening with startIndex/endIndex for precise edits
- **Async proxy** -- all operations route through the work email (personal email may not have access to work documents)

## Prerequisites

- At least one supported AI coding agent installed
- A **personal Gmail account** (for the proxy Apps Script)
- A **Google Workspace account** (for Tasks/Calendar/Drive access)
- `curl` and `jq` installed on your machine
- A Google Spreadsheet shared between both accounts

## Quick Start

```bash
git clone https://github.com/ariefrizkyr/google-workspace-proxy-skills.git
cd google-workspace-proxy-skills
./install.sh
```

The installer will walk you through:

1. **Agent selection** -- pick which AI agent(s) you use (or all of them)
2. **Scope** -- install globally (all projects) or to the current project only
3. **Skill selection** -- Google Tasks, Google Calendar, Google Drive, or any combination
4. **Credentials** -- optionally configure your Apps Script URL and API key
5. **Setup guide** -- step-by-step instructions to set up the Google Apps Script backend

If you haven't set up the backend yet, skip the credentials step. The installer will print a full setup guide after installation.

## Backend Setup

The skills need a Google Apps Script backend to connect to your Google account. This is a one-time setup.

### Step 1: Create the Google Spreadsheet

1. Go to [sheets.google.com](https://sheets.google.com) (logged in as your **personal Gmail**)
2. Create a new spreadsheet
3. Share it with your **work email** (Editor access)
4. Copy the spreadsheet ID from the URL: `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`

Create the required sheet tabs by importing the CSV templates from this repo:

**For Google Tasks:**

| Sheet Tab | CSV Template |
| --- | --- |
| `TaskLists` | `skills/google-tasks/scripts/TaskLists.csv` |
| `Tasks` | `skills/google-tasks/scripts/Tasks.csv` |
| `CommandQueue` | `skills/google-tasks/scripts/CommandQueue.csv` |
| `SyncMeta` | `skills/google-tasks/scripts/SyncMeta.csv` |

**For Google Calendar:**

| Sheet Tab | CSV Template |
| --- | --- |
| `Calendars` | `skills/google-calendar/scripts/Calendars.csv` |
| `Events` | `skills/google-calendar/scripts/Events.csv` |
| `CommandQueue` | `skills/google-calendar/scripts/CommandQueue.csv` |
| `SyncMeta` | `skills/google-calendar/scripts/SyncMeta.csv` |

**For Google Drive:**

| Sheet Tab | CSV Template |
| --- | --- |
| `Files` | `skills/google-drive/scripts/Files.csv` |
| `CommandQueue` | `skills/google-drive/scripts/CommandQueue.csv` |
| `SyncMeta` | `skills/google-drive/scripts/SyncMeta.csv` |

**For Google Sheets:**

| Sheet Tab | CSV Template |
| --- | --- |
| `TrackedSpreadsheets` | `skills/google-sheets/scripts/TrackedSpreadsheets.csv` |
| `CommandQueue` | `skills/google-sheets/scripts/CommandQueue.csv` |
| `SyncMeta` | `skills/google-sheets/scripts/SyncMeta.csv` |

**For Google Docs:**

| Sheet Tab | CSV Template |
| --- | --- |
| `TrackedDocuments` | `skills/google-docs/scripts/TrackedDocuments.csv` |
| `CommandQueue` | `skills/google-docs/scripts/CommandQueue.csv` |
| `SyncMeta` | `skills/google-docs/scripts/SyncMeta.csv` |

> You can use one spreadsheet for all skills (with all sheet tabs) or separate spreadsheets.

### Step 2: Deploy the Personal Proxy (Apps Script)

This runs on your **personal Gmail** account.

1. Go to [script.google.com](https://script.google.com) (logged in as personal Gmail)
2. Create a new project
3. Paste the contents of `skills/google-tasks/scripts/PersonalProxy.gs` (or the calendar/drive version)
4. Update `CONFIG.SPREADSHEET_ID` with your spreadsheet ID
5. Set `CONFIG.API_KEY` to a random secret string (e.g., generate with `uuidgen`)
6. Deploy as web app:
  - Click **Deploy** > **New deployment**
  - Type: **Web app**
  - Execute as: **Me**
  - Who has access: **Anyone** (the API key protects it)
7. Copy the deployment URL

### Step 3: Deploy the Sync Engine (Apps Script)

This runs on your **work email** account.

1. Go to [script.google.com](https://script.google.com) (logged in as work email)
2. Create a new project
3. Paste the contents of `skills/google-tasks/scripts/WorkSync.gs` (or the calendar/drive version)
4. Update `SYNC_CONFIG.SPREADSHEET_ID` with your spreadsheet ID
5. **Enable the API service:**
  - For Tasks: Click **Services** (+) > add **Tasks API**
  - For Calendar: Click **Services** (+) > add **Calendar API** (Advanced Service)
  - For Drive: Click **Services** (+) > add **Drive API** (Advanced Service)
  - For Sheets: Click **Services** (+) > add **Sheets API** (Advanced Service)
  - For Docs: Click **Services** (+) > add **Docs API** (Advanced Service)
6. Run `initialImport()` once to seed the spreadsheet with your existing data
7. Run `setupTrigger()` to start the 1-minute sync cycle
8. Grant all permission prompts

### Step 4: Configure Credentials

Edit the shell scripts to add your deployment URL and API key:

```bash
# For Google Tasks — edit tasks.sh in each agent's skills directory:
#   Replace __GOOGLE_TASKS_URL__ with your Apps Script deployment URL
#   Replace __GOOGLE_TASKS_KEY__ with your API key

# For Google Calendar — edit calendar.sh:
#   Replace __GOOGLE_CALENDAR_URL__ with your Apps Script deployment URL
#   Replace __GOOGLE_CALENDAR_KEY__ with your API key

# For Google Drive — edit drive.sh:
#   Replace __GOOGLE_DRIVE_URL__ with your Apps Script deployment URL
#   Replace __GOOGLE_DRIVE_KEY__ with your API key

# For Google Sheets — edit sheets.sh:
#   Replace __GOOGLE_SHEETS_URL__ with your Apps Script deployment URL
#   Replace __GOOGLE_SHEETS_KEY__ with your API key

# For Google Docs — edit docs.sh:
#   Replace __GOOGLE_DOCS_URL__ with your Apps Script deployment URL
#   Replace __GOOGLE_DOCS_KEY__ with your API key
```

Or run `./install.sh` again and enter your credentials when prompted.

### Step 5: Try It Out

Open your AI agent and try:

```
> show my tasks
> what's on my calendar today
> create a task to review the PR by Friday
> schedule a 30-min meeting with sarah@company.com tomorrow
> show my Drive files
> create a Google Doc called Q1 Report
> share the report with alice@company.com as editor
> read the data from my Budget spreadsheet
> write values to Sheet1!A1:C3
> show the content of my Q1 Report document
> insert a heading at the top of the doc
```

## Manual Installation

If you prefer not to use the installer:

```bash
# Claude Code (global)
cp -r skills/google-tasks ~/.claude/skills/google-tasks
cp -r skills/google-calendar ~/.claude/skills/google-calendar
cp -r skills/google-drive ~/.claude/skills/google-drive
cp -r skills/google-sheets ~/.claude/skills/google-sheets
cp -r skills/google-docs ~/.claude/skills/google-docs

# Gemini CLI (global)
cp -r skills/google-tasks ~/.gemini/skills/google-tasks
cp -r skills/google-calendar ~/.gemini/skills/google-calendar
cp -r skills/google-drive ~/.gemini/skills/google-drive
cp -r skills/google-sheets ~/.gemini/skills/google-sheets
cp -r skills/google-docs ~/.gemini/skills/google-docs

# OpenAI Codex CLI (global)
cp -r skills/google-tasks ~/.codex/skills/google-tasks
cp -r skills/google-calendar ~/.codex/skills/google-calendar
cp -r skills/google-drive ~/.codex/skills/google-drive
cp -r skills/google-sheets ~/.codex/skills/google-sheets
cp -r skills/google-docs ~/.codex/skills/google-docs

# Cursor (global)
cp -r skills/google-tasks ~/.cursor/skills/google-tasks
cp -r skills/google-calendar ~/.cursor/skills/google-calendar
cp -r skills/google-drive ~/.cursor/skills/google-drive
cp -r skills/google-sheets ~/.cursor/skills/google-sheets
cp -r skills/google-docs ~/.cursor/skills/google-docs

# Make scripts executable
chmod +x ~/.*/skills/google-*/scripts/*.sh
```

Then update `__SKILL_DIR__` in each `SKILL.md` to the absolute path where the skill was installed, and configure the `*.sh` files with your credentials.

## How It Works

```
                    ┌──────────────┐
                    │  Your Agent  │
                    │ (Claude, Gemini, │
                    │  Codex, Cursor)  │
                    └──────┬───────┘
                           │ HTTP POST (curl)
                    ┌──────▼──────┐
                    │  tasks.sh /  │
                    │ calendar.sh /│
                    │ drive.sh /   │
                    │ sheets.sh /  │
                    │ docs.sh      │
                    └──────┬──────┘
                           │
                ┌──────────▼──────────┐
                │  Personal Proxy     │
                │  (Apps Script)      │
                │  on personal Gmail  │
                └──────────┬──────────┘
                           │ Read/Write
                ┌──────────▼──────────┐
                │  Google Spreadsheet │
                │  (shared between    │
                │   both accounts)    │
                └──────────┬──────────┘
                           │ Sync every 1 min
                ┌──────────▼──────────┐
                │  Sync Engine        │
                │  (Apps Script)      │
                │  on work email      │
                └──────────┬──────────┘
                           │
              ┌─────────────────▼──────────────────┐
              │ Google Tasks / Calendar / Drive /   │
              │ Sheets / Docs API (Workspace)      │
              └────────────────────────────────────┘
```

**Sync cycle (every minute):**
1. **Push** -- pending local changes (from your agent) are pushed to Google APIs
2. **Pull** -- new/updated items from Google are pulled into the spreadsheet
3. **Commands** -- async operations (findSlots, checkAvailability) are processed
4. **Cleanup** -- deleted rows older than 7 days are removed

## Security

- The API key in your shell script authenticates requests to your personal Apps Script
- The Apps Script web app runs as your personal Gmail account
- The spreadsheet is only shared between your two accounts
- No data passes through third-party servers
- **Never commit your configured ****`tasks.sh`****, ****`calendar.sh`****, ****`drive.sh`****, ****`sheets.sh`****, or ****`docs.sh`**** with real credentials.** The repo templates use `__PLACEHOLDER__` values that are safe to commit.

## Troubleshooting

| Issue | Solution |
| --- | --- |
| "Unauthorized" error | Check that the API key in `tasks.sh`/`calendar.sh`/`drive.sh`/`sheets.sh`/`docs.sh` matches `CONFIG.API_KEY` in PersonalProxy.gs |
| Data not syncing | Run `setupTrigger()` again in the work account's Apps Script. Check Executions log for errors. |
| "Task list not found" | Run `listTaskLists` first to get valid IDs. The skill uses spreadsheet UUIDs, not Google IDs. |
| Stale data | The sync runs every minute. If you need immediate sync, use `calendar.sh syncNow` or `drive.sh syncNow`. |
| "UrlFetchApp.fetch" permission error | Re-authorize the WorkSync.gs script: run any function and grant the `script.external_request` permission when prompted. |
| "File not found" in Drive | The file may not be tracked yet. Use `searchFiles` to discover and track it first. |
| Apps Script quota errors | Free Gmail accounts have lower quotas. Consider using a Google Workspace account for the proxy too. |
| Permission denied on `.sh` | Run `chmod +x` on the script files |
| Agent doesn't see the skill | Verify the skill is in the correct directory for your agent (see Supported Agents table) |

## Project Structure

```
google-workspace-proxy-skills/
├── README.md
├── CONTRIBUTING.md                     # Contribution guidelines
├── SECURITY.md                         # Security policy & vulnerability reporting
├── LICENSE
├── install.sh                          # Multi-agent interactive installer
├── .gitignore
└── skills/
    ├── google-tasks/
    │   ├── SKILL.md                    # Skill definition (Agent Skills standard)
    │   ├── scripts/
    │   │   ├── tasks.sh                # CLI wrapper (curl -> Apps Script)
    │   │   ├── PersonalProxy.gs        # Apps Script: HTTP -> Spreadsheet
    │   │   ├── WorkSync.gs             # Apps Script: Spreadsheet <-> Tasks API
    │   │   ├── TaskLists.csv           # Spreadsheet template
    │   │   ├── Tasks.csv
    │   │   ├── CommandQueue.csv
    │   │   └── SyncMeta.csv
    │   └── references/
    │       └── api-actions.md          # Full API reference
    ├── google-calendar/
    │   ├── SKILL.md
    │   ├── scripts/
    │   │   ├── calendar.sh
    │   │   ├── PersonalProxy.gs
    │   │   ├── WorkSync.gs
    │   │   ├── Calendars.csv
    │   │   ├── Events.csv
    │   │   ├── CommandQueue.csv
    │   │   └── SyncMeta.csv
    │   └── references/
    │       └── api-actions.md
    ├── google-drive/
    │   ├── SKILL.md
    │   ├── scripts/
    │   │   ├── drive.sh
    │   │   ├── PersonalProxy.gs
    │   │   ├── WorkSync.gs
    │   │   ├── Files.csv
    │   │   ├── CommandQueue.csv
    │   │   └── SyncMeta.csv
    │   └── references/
    │       └── api-actions.md
    ├── google-sheets/
    │   ├── SKILL.md
    │   ├── scripts/
    │   │   ├── sheets.sh
    │   │   ├── PersonalProxy.gs
    │   │   ├── WorkSync.gs
    │   │   ├── TrackedSpreadsheets.csv
    │   │   ├── CommandQueue.csv
    │   │   └── SyncMeta.csv
    │   └── references/
    │       └── api-actions.md
    └── google-docs/
        ├── SKILL.md
        ├── scripts/
        │   ├── docs.sh
        │   ├── PersonalProxy.gs
        │   ├── WorkSync.gs
        │   ├── TrackedDocuments.csv
        │   ├── CommandQueue.csv
        │   └── SyncMeta.csv
        └── references/
            └── api-actions.md
```

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for the branch strategy, guidelines, and ideas.

## Security

Found a vulnerability? **Do not open a public issue.** Report it privately via DM or email. See [SECURITY.md](SECURITY.md) for details.

## License

MIT License. See [LICENSE](LICENSE) for details.
