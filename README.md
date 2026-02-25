# Google Workspace Skills for AI Coding Agents

Agent skills that let you manage **Google Tasks** and **Google Calendar** through natural language, right from your terminal.

> "show my tasks" / "what's on my calendar today" / "schedule a meeting with Sarah at 2pm" / "remind me to review the PR tomorrow"

Works with **Claude Code**, **Gemini CLI**, **OpenAI Codex CLI**, **Cursor**, and any agent that supports the [Agent Skills](https://agentskills.io/specification) standard.

## What is this?

These are [Agent Skills](https://agentskills.io/specification) that give your AI coding agent the ability to read and write your Google Tasks and Google Calendar. Instead of switching to a browser, you talk to your agent and it handles everything.

The architecture uses a **spreadsheet-proxy** pattern:

```
AI Agent  ->  Shell Script  ->  Apps Script (Personal Gmail)  ->  Google Spreadsheet
                                                                        |
                                                          Apps Script (Work Email)  ->  Google Tasks / Calendar API
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

## Prerequisites

- At least one supported AI coding agent installed
- A **personal Gmail account** (for the proxy Apps Script)
- A **Google Workspace account** (for Tasks/Calendar access)
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
3. **Skill selection** -- Google Tasks, Google Calendar, or both
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

> You can use one spreadsheet for both skills (with all sheet tabs) or separate spreadsheets.

### Step 2: Deploy the Personal Proxy (Apps Script)

This runs on your **personal Gmail** account.

1. Go to [script.google.com](https://script.google.com) (logged in as personal Gmail)
2. Create a new project
3. Paste the contents of `skills/google-tasks/scripts/PersonalProxy.gs` (or the calendar version)
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
3. Paste the contents of `skills/google-tasks/scripts/WorkSync.gs` (or the calendar version)
4. Update `SYNC_CONFIG.SPREADSHEET_ID` with your spreadsheet ID
5. **Enable the API service:**
  - For Tasks: Click **Services** (+) > add **Tasks API**
  - For Calendar: Click **Services** (+) > add **Calendar API** (Advanced Service)
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
```

Or run `./install.sh` again and enter your credentials when prompted.

### Step 5: Try It Out

Open your AI agent and try:

```
> show my tasks
> what's on my calendar today
> create a task to review the PR by Friday
> schedule a 30-min meeting with sarah@company.com tomorrow
```

## Manual Installation

If you prefer not to use the installer:

```bash
# Claude Code (global)
cp -r skills/google-tasks ~/.claude/skills/google-tasks
cp -r skills/google-calendar ~/.claude/skills/google-calendar

# Gemini CLI (global)
cp -r skills/google-tasks ~/.gemini/skills/google-tasks
cp -r skills/google-calendar ~/.gemini/skills/google-calendar

# OpenAI Codex CLI (global)
cp -r skills/google-tasks ~/.codex/skills/google-tasks
cp -r skills/google-calendar ~/.codex/skills/google-calendar

# Cursor (global)
cp -r skills/google-tasks ~/.cursor/skills/google-tasks
cp -r skills/google-calendar ~/.cursor/skills/google-calendar

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
                    │  tasks.sh / │
                    │ calendar.sh │
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
              ┌────────────▼────────────┐
              │ Google Tasks / Calendar │
              │ API (Workspace)        │
              └────────────────────────┘
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
- **Never commit your configured ****`tasks.sh`**** or ****`calendar.sh`**** with real credentials.** The repo templates use `__PLACEHOLDER__` values that are safe to commit.

## Troubleshooting

| Issue | Solution |
| --- | --- |
| "Unauthorized" error | Check that the API key in `tasks.sh`/`calendar.sh` matches `CONFIG.API_KEY` in PersonalProxy.gs |
| Data not syncing | Run `setupTrigger()` again in the work account's Apps Script. Check Executions log for errors. |
| "Task list not found" | Run `listTaskLists` first to get valid IDs. The skill uses spreadsheet UUIDs, not Google IDs. |
| Stale data | The sync runs every minute. If you need immediate sync, use `calendar.sh syncNow`. |
| Apps Script quota errors | Free Gmail accounts have lower quotas. Consider using a Google Workspace account for the proxy too. |
| Permission denied on `.sh` | Run `chmod +x` on the script files |
| Agent doesn't see the skill | Verify the skill is in the correct directory for your agent (see Supported Agents table) |

## Project Structure

```
google-workspace-proxy-skills/
├── README.md
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
    └── google-calendar/
        ├── SKILL.md
        ├── scripts/
        │   ├── calendar.sh
        │   ├── PersonalProxy.gs
        │   ├── WorkSync.gs
        │   ├── Calendars.csv
        │   ├── Events.csv
        │   ├── CommandQueue.csv
        │   └── SyncMeta.csv
        └── references/
            └── api-actions.md
```

## Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repository
2. **Create a branch** for your feature or fix:
```bash
   git checkout -b feature/my-feature
```
3. **Make your changes.** Key areas where help is appreciated:
  - Improving the sync engine reliability
  - Adding support for more Google Workspace APIs (Gmail, Drive, etc.)
  - Adding more AI agent targets to the installer
  - Better error handling and retry logic
  - Supporting other timezone defaults
  - Writing tests for the Apps Script code
  - Improving the installer for Windows/Linux
4. **Test your changes** by deploying the Apps Scripts and verifying the skill works end-to-end
5. **Submit a pull request** with a clear description of what you changed and why

### Guidelines

- Keep the spreadsheet-proxy architecture. It avoids OAuth complexity for the end user.
- Don't commit real API keys, URLs, or spreadsheet IDs. Use `YOUR_*_HERE` or `__PLACEHOLDER__` values.
- The `SKILL.md` format follows the [Agent Skills specification](https://agentskills.io/specification). Keep it portable.
- Follow the existing code style (Apps Script-compatible ES5 with JSDoc where helpful).
- Update the relevant `api-actions.md` if you add new actions.
- Update `SKILL.md` if you change the skill's behavior or add new capabilities.

### Ideas for Contributions

- **More agents** -- add support for Windsurf, Cline, Roo Code, aider, etc.
- **Google Gmail skill** -- read/send emails through the same proxy pattern
- **Google Drive skill** -- search and manage files
- **Webhook support** -- push-based sync instead of polling every minute
- **Multi-timezone** -- configurable timezone per user instead of hardcoded +07:00
- **Batch operations** -- optimize multiple writes in a single API call
- **Conflict resolution UI** -- better handling of concurrent edits

## License

MIT License. See [LICENSE](LICENSE) for details.
