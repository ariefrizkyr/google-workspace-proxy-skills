#!/bin/bash
# Google Workspace Skills Installer
# Installs google-tasks and/or google-calendar skills for AI coding agents.
# Supports: Claude Code, Gemini CLI, OpenAI Codex CLI, Cursor, and more.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Colors ──────────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# ── Print helpers ───────────────────────────────────────────────────────────────

print_header() {
  echo ""
  echo -e "${BLUE}================================================${NC}"
  echo -e "${BLUE}  Google Workspace Skills for AI Coding Agents${NC}"
  echo -e "${BLUE}================================================${NC}"
  echo ""
}

print_step() {
  echo -e "  ${GREEN}+${NC} $1"
}

print_warn() {
  echo -e "  ${YELLOW}!${NC} $1"
}

print_error() {
  echo -e "  ${RED}x${NC} $1"
}

print_info() {
  echo -e "  ${DIM}$1${NC}"
}

# ── Agent definitions ───────────────────────────────────────────────────────────
# Each agent has: display name, global skills path, project skills subdirectory

AGENT_NAMES=(
  "Claude Code"
  "Gemini CLI"
  "OpenAI Codex CLI"
  "Cursor"
)

AGENT_GLOBAL_PATHS=(
  "${HOME}/.claude/skills"
  "${HOME}/.gemini/skills"
  "${HOME}/.codex/skills"
  "${HOME}/.cursor/skills"
)

AGENT_PROJECT_DIRS=(
  ".claude/skills"
  ".gemini/skills"
  ".agents/skills"
  ".cursor/skills"
)

# ── Dependency check ────────────────────────────────────────────────────────────

check_dependencies() {
  local missing=0
  for cmd in curl jq; do
    if ! command -v "$cmd" &>/dev/null; then
      print_error "Missing dependency: ${BOLD}$cmd${NC}"
      missing=1
    fi
  done
  if [[ $missing -eq 1 ]]; then
    echo ""
    echo "  Install missing dependencies:"
    echo "    macOS:  brew install curl jq"
    echo "    Ubuntu: sudo apt install curl jq"
    exit 1
  fi
}

# ── Agent selection ─────────────────────────────────────────────────────────────

SELECTED_AGENTS=()

select_agents() {
  echo -e "${BOLD}Which AI agent(s) do you use?${NC}"
  echo ""
  for i in "${!AGENT_NAMES[@]}"; do
    echo "  $((i + 1))) ${AGENT_NAMES[$i]}"
  done
  echo "  $((${#AGENT_NAMES[@]} + 1))) All of the above"
  echo ""
  read -rp "  Choose (comma-separated, e.g. 1,2): " agent_choice

  if [[ -z "$agent_choice" ]]; then
    print_error "No agent selected"
    exit 1
  fi

  # Parse comma-separated choices
  IFS=',' read -ra choices <<< "$agent_choice"
  for c in "${choices[@]}"; do
    c=$(echo "$c" | tr -d ' ')
    local all_idx=$((${#AGENT_NAMES[@]} + 1))
    if [[ "$c" == "$all_idx" ]]; then
      # Select all
      for i in "${!AGENT_NAMES[@]}"; do
        SELECTED_AGENTS+=("$i")
      done
      break
    elif [[ "$c" -ge 1 && "$c" -le "${#AGENT_NAMES[@]}" ]]; then
      SELECTED_AGENTS+=("$((c - 1))")
    else
      print_error "Invalid choice: $c"
      exit 1
    fi
  done

  # Deduplicate
  SELECTED_AGENTS=($(echo "${SELECTED_AGENTS[@]}" | tr ' ' '\n' | sort -u | tr '\n' ' '))

  echo ""
  echo -e "  Selected: ${CYAN}$(for i in "${SELECTED_AGENTS[@]}"; do echo -n "${AGENT_NAMES[$i]}, "; done | sed 's/, $//')${NC}"
  echo ""
}

# ── Scope selection ─────────────────────────────────────────────────────────────

INSTALL_SCOPE=""    # "global" or "project"
INSTALL_BASE_DIR="" # resolved base path (either global home or project .agent/)

select_scope() {
  echo -e "${BOLD}Where should the skills be installed?${NC}"
  echo ""
  echo "  1) Global — available in all your projects"

  # Show the global paths that will be used
  for i in "${SELECTED_AGENTS[@]}"; do
    print_info "    ${AGENT_NAMES[$i]}: ${AGENT_GLOBAL_PATHS[$i]}/"
  done

  echo "  2) This project — only available in the current directory"

  for i in "${SELECTED_AGENTS[@]}"; do
    print_info "    ${AGENT_NAMES[$i]}: $(pwd)/${AGENT_PROJECT_DIRS[$i]}/"
  done

  echo ""
  read -rp "  Choose [1/2] (default: 1): " scope_choice

  case "${scope_choice:-1}" in
    1)
      INSTALL_SCOPE="global"
      ;;
    2)
      INSTALL_SCOPE="project"
      ;;
    *)
      print_error "Invalid choice"
      exit 1
      ;;
  esac

  echo ""
}

# ── Get install path for a given agent index ────────────────────────────────────

get_skills_dir() {
  local agent_idx="$1"
  if [[ "$INSTALL_SCOPE" == "global" ]]; then
    echo "${AGENT_GLOBAL_PATHS[$agent_idx]}"
  else
    echo "$(pwd)/${AGENT_PROJECT_DIRS[$agent_idx]}"
  fi
}

# ── Install a skill to a specific agent ─────────────────────────────────────────

install_skill_for_agent() {
  local skill_name="$1"
  local agent_idx="$2"
  local skills_dir
  skills_dir="$(get_skills_dir "$agent_idx")"
  local skill_src="${REPO_DIR}/skills/${skill_name}"
  local skill_dest="${skills_dir}/${skill_name}"

  if [[ ! -d "$skill_src" ]]; then
    print_error "Skill source not found: ${skill_src}"
    return 1
  fi

  # Check if already installed
  if [[ -d "$skill_dest" ]]; then
    print_warn "${skill_name} already exists at ${skill_dest}"
    read -rp "    Overwrite? (y/N): " confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
      print_info "Skipped."
      return 0
    fi
    rm -rf "$skill_dest"
  fi

  # Copy skill files
  mkdir -p "$skill_dest"
  cp -r "$skill_src"/* "$skill_dest/"

  # Make shell scripts executable
  find "$skill_dest/scripts" -name "*.sh" -exec chmod +x {} \;

  # Patch SKILL.md path placeholder
  local skill_md="${skill_dest}/SKILL.md"
  if [[ -f "$skill_md" ]]; then
    sed -i.bak "s|__SKILL_DIR__|${skill_dest}|g" "$skill_md"
    rm -f "${skill_md}.bak"
  fi

  print_step "${AGENT_NAMES[$agent_idx]}: ${skill_name} -> ${skill_dest}"
}

# ── Credential configuration ───────────────────────────────────────────────────

configure_credentials() {
  local skill_name="$1"

  echo ""
  if [[ "$skill_name" == "google-tasks" ]]; then
    echo -e "  ${BLUE}--- Configure Google Tasks credentials ---${NC}"
    echo ""
    echo "  If you've already set up the Apps Script backend, enter your"
    echo "  credentials now. Otherwise, press Enter to skip (you can edit later)."
    echo ""
    read -rp "    Apps Script Web App URL (or Enter to skip): " web_app_url

    if [[ -z "$web_app_url" ]]; then
      print_info "Skipped. You'll configure this after the backend setup."
      return
    fi

    read -rp "    API Key: " api_key

    if [[ -z "$api_key" ]]; then
      print_warn "No API key provided. Skipping configuration."
      return
    fi

    # Patch all installed copies
    for agent_idx in "${SELECTED_AGENTS[@]}"; do
      local skills_dir
      skills_dir="$(get_skills_dir "$agent_idx")"
      local script_file="${skills_dir}/google-tasks/scripts/tasks.sh"
      if [[ -f "$script_file" ]]; then
        sed -i.bak "s|__GOOGLE_TASKS_URL__|${web_app_url}|g" "$script_file"
        sed -i.bak "s|__GOOGLE_TASKS_KEY__|${api_key}|g" "$script_file"
        rm -f "${script_file}.bak"
      fi
    done
    print_step "Configured tasks.sh credentials across all agents"

  elif [[ "$skill_name" == "google-calendar" ]]; then
    echo -e "  ${BLUE}--- Configure Google Calendar credentials ---${NC}"
    echo ""
    echo "  If you've already set up the Apps Script backend, enter your"
    echo "  credentials now. Otherwise, press Enter to skip (you can edit later)."
    echo ""
    read -rp "    Apps Script Web App URL (or Enter to skip): " web_app_url

    if [[ -z "$web_app_url" ]]; then
      print_info "Skipped. You'll configure this after the backend setup."
      return
    fi

    read -rp "    API Key: " api_key

    if [[ -z "$api_key" ]]; then
      print_warn "No API key provided. Skipping configuration."
      return
    fi

    for agent_idx in "${SELECTED_AGENTS[@]}"; do
      local skills_dir
      skills_dir="$(get_skills_dir "$agent_idx")"
      local script_file="${skills_dir}/google-calendar/scripts/calendar.sh"
      if [[ -f "$script_file" ]]; then
        sed -i.bak "s|__GOOGLE_CALENDAR_URL__|${web_app_url}|g" "$script_file"
        sed -i.bak "s|__GOOGLE_CALENDAR_KEY__|${api_key}|g" "$script_file"
        rm -f "${script_file}.bak"
      fi
    done
    print_step "Configured calendar.sh credentials across all agents"
  fi
}

# ── Verify installation ────────────────────────────────────────────────────────

verify_all() {
  echo ""
  echo -e "${BOLD}Verification${NC}"
  echo ""

  local all_ok=true
  for agent_idx in "${SELECTED_AGENTS[@]}"; do
    local skills_dir
    skills_dir="$(get_skills_dir "$agent_idx")"

    for skill in "${SELECTED_SKILLS[@]}"; do
      local script_file
      if [[ "$skill" == "google-tasks" ]]; then
        script_file="${skills_dir}/${skill}/scripts/tasks.sh"
      else
        script_file="${skills_dir}/${skill}/scripts/calendar.sh"
      fi

      if [[ ! -f "$script_file" ]]; then
        print_error "${AGENT_NAMES[$agent_idx]} / ${skill}: Not found"
        all_ok=false
      elif grep -q '__GOOGLE_' "$script_file" 2>/dev/null; then
        print_warn "${AGENT_NAMES[$agent_idx]} / ${skill}: Installed (credentials not configured yet)"
      else
        print_step "${AGENT_NAMES[$agent_idx]} / ${skill}: Ready"
      fi
    done
  done
}

# ── Post-install setup guide ────────────────────────────────────────────────────

show_setup_guide() {
  local has_unconfigured=false
  for agent_idx in "${SELECTED_AGENTS[@]}"; do
    local skills_dir
    skills_dir="$(get_skills_dir "$agent_idx")"
    for skill in "${SELECTED_SKILLS[@]}"; do
      local script_file
      if [[ "$skill" == "google-tasks" ]]; then
        script_file="${skills_dir}/${skill}/scripts/tasks.sh"
      else
        script_file="${skills_dir}/${skill}/scripts/calendar.sh"
      fi
      if [[ -f "$script_file" ]] && grep -q '__GOOGLE_' "$script_file" 2>/dev/null; then
        has_unconfigured=true
        break 2
      fi
    done
  done

  echo ""
  echo -e "${BLUE}========================================${NC}"
  echo -e "${BLUE}  Setup Guide${NC}"
  echo -e "${BLUE}========================================${NC}"
  echo ""

  if [[ "$has_unconfigured" == true ]]; then
    echo -e "  The skills are installed but need a Google Apps Script"
    echo -e "  backend to connect to your Google account. Follow these steps:"
    echo ""
    echo -e "  ${BOLD}Step 1: Create a Google Spreadsheet${NC}"
    echo ""
    echo "    a. Go to sheets.google.com (logged in as your personal Gmail)"
    echo "    b. Create a new spreadsheet"
    echo "    c. Share it with your work email (Editor access)"
    echo "    d. Note the spreadsheet ID from the URL:"
    echo -e "       ${DIM}https://docs.google.com/spreadsheets/d/${CYAN}SPREADSHEET_ID${DIM}/edit${NC}"
    echo ""

    # Show relevant sheet setup
    for skill in "${SELECTED_SKILLS[@]}"; do
      if [[ "$skill" == "google-tasks" ]]; then
        echo "    For Google Tasks, create these sheet tabs:"
        echo -e "      ${DIM}- TaskLists   (import from skills/google-tasks/scripts/TaskLists.csv)${NC}"
        echo -e "      ${DIM}- Tasks       (import from skills/google-tasks/scripts/Tasks.csv)${NC}"
        echo -e "      ${DIM}- CommandQueue (import from skills/google-tasks/scripts/CommandQueue.csv)${NC}"
        echo -e "      ${DIM}- SyncMeta    (import from skills/google-tasks/scripts/SyncMeta.csv)${NC}"
        echo ""
      fi
      if [[ "$skill" == "google-calendar" ]]; then
        echo "    For Google Calendar, create these sheet tabs:"
        echo -e "      ${DIM}- Calendars   (import from skills/google-calendar/scripts/Calendars.csv)${NC}"
        echo -e "      ${DIM}- Events      (import from skills/google-calendar/scripts/Events.csv)${NC}"
        echo -e "      ${DIM}- CommandQueue (import from skills/google-calendar/scripts/CommandQueue.csv)${NC}"
        echo -e "      ${DIM}- SyncMeta    (import from skills/google-calendar/scripts/SyncMeta.csv)${NC}"
        echo ""
      fi
    done

    echo -e "  ${BOLD}Step 2: Deploy the Personal Proxy (your personal Gmail)${NC}"
    echo ""
    echo "    a. Go to script.google.com (logged in as personal Gmail)"
    echo "    b. Create a new Apps Script project"

    for skill in "${SELECTED_SKILLS[@]}"; do
      if [[ "$skill" == "google-tasks" ]]; then
        echo "    c. Paste the contents of: skills/google-tasks/scripts/PersonalProxy.gs"
      fi
      if [[ "$skill" == "google-calendar" ]]; then
        echo "    c. Paste the contents of: skills/google-calendar/scripts/PersonalProxy.gs"
      fi
    done

    echo "    d. Set CONFIG.SPREADSHEET_ID to your spreadsheet ID"
    echo "    e. Set CONFIG.API_KEY to a random secret (run: uuidgen)"
    echo "    f. Click Deploy > New deployment > Web app"
    echo "       - Execute as: Me"
    echo "       - Who has access: Anyone"
    echo "    g. Copy the deployment URL"
    echo ""

    echo -e "  ${BOLD}Step 3: Deploy the Sync Engine (your work email)${NC}"
    echo ""
    echo "    a. Go to script.google.com (logged in as work email)"
    echo "    b. Create a new Apps Script project"

    for skill in "${SELECTED_SKILLS[@]}"; do
      if [[ "$skill" == "google-tasks" ]]; then
        echo "    c. Paste the contents of: skills/google-tasks/scripts/WorkSync.gs"
        echo "    d. Click Services (+) > add Tasks API"
      fi
      if [[ "$skill" == "google-calendar" ]]; then
        echo "    c. Paste the contents of: skills/google-calendar/scripts/WorkSync.gs"
        echo "    d. Click Services (+) > add Calendar API (Advanced Service)"
      fi
    done

    echo "    e. Set SYNC_CONFIG.SPREADSHEET_ID to your spreadsheet ID"
    echo "    f. Run initialImport() to seed your existing data"
    echo "    g. Run setupTrigger() to start the 1-minute sync"
    echo "    h. Grant all permission prompts"
    echo ""

    echo -e "  ${BOLD}Step 4: Configure the skills with your credentials${NC}"
    echo ""
    echo "    Run the installer again, or edit the script files directly:"
    echo ""

    for agent_idx in "${SELECTED_AGENTS[@]}"; do
      local skills_dir
      skills_dir="$(get_skills_dir "$agent_idx")"
      for skill in "${SELECTED_SKILLS[@]}"; do
        if [[ "$skill" == "google-tasks" ]]; then
          echo -e "      ${DIM}${skills_dir}/google-tasks/scripts/tasks.sh${NC}"
          echo "        Replace __GOOGLE_TASKS_URL__ with your deployment URL"
          echo "        Replace __GOOGLE_TASKS_KEY__ with your API key"
        fi
        if [[ "$skill" == "google-calendar" ]]; then
          echo -e "      ${DIM}${skills_dir}/google-calendar/scripts/calendar.sh${NC}"
          echo "        Replace __GOOGLE_CALENDAR_URL__ with your deployment URL"
          echo "        Replace __GOOGLE_CALENDAR_KEY__ with your API key"
        fi
      done
    done

    echo ""
    echo -e "  ${BOLD}Step 5: Try it out${NC}"
    echo ""
  else
    echo -e "  Everything is configured. Try it out:"
    echo ""
  fi

  # Show agent-specific try-it commands
  for agent_idx in "${SELECTED_AGENTS[@]}"; do
    echo -e "  ${CYAN}${AGENT_NAMES[$agent_idx]}:${NC}"
    case "$agent_idx" in
      0) # Claude Code
        echo '    $ claude'
        ;;
      1) # Gemini CLI
        echo '    $ gemini'
        ;;
      2) # Codex CLI
        echo '    $ codex'
        ;;
      3) # Cursor
        echo '    Open Cursor and use the chat panel'
        ;;
    esac

    for skill in "${SELECTED_SKILLS[@]}"; do
      if [[ "$skill" == "google-tasks" ]]; then
        echo '    > "show my tasks"'
        echo '    > "create a task to review the PR by Friday"'
      fi
      if [[ "$skill" == "google-calendar" ]]; then
        echo '    > "what'\''s on my calendar today"'
        echo '    > "schedule a 30-min meeting with sarah@company.com tomorrow"'
      fi
    done
    echo ""
  done

  echo -e "  For full documentation, see: ${BOLD}README.md${NC}"
  echo ""
}

# ── Main ────────────────────────────────────────────────────────────────────────

print_header
check_dependencies

# 1. Which agent(s)?
select_agents

# 2. Global or project?
select_scope

# 3. Which skills?
echo -e "${BOLD}Which skills would you like to install?${NC}"
echo ""
echo "  1) Google Tasks only"
echo "  2) Google Calendar only"
echo "  3) Both (recommended)"
echo ""
read -rp "  Choose [1/2/3] (default: 3): " skill_choice

SELECTED_SKILLS=()
case "${skill_choice:-3}" in
  1) SELECTED_SKILLS=("google-tasks") ;;
  2) SELECTED_SKILLS=("google-calendar") ;;
  3) SELECTED_SKILLS=("google-tasks" "google-calendar") ;;
  *)
    print_error "Invalid choice"
    exit 1
    ;;
esac

# 4. Install
echo ""
echo -e "${BOLD}Installing...${NC}"
echo ""

for skill in "${SELECTED_SKILLS[@]}"; do
  for agent_idx in "${SELECTED_AGENTS[@]}"; do
    install_skill_for_agent "$skill" "$agent_idx"
  done
done

# 5. Configure credentials (optional)
echo ""
echo -e "${BOLD}Credential configuration${NC}"

for skill in "${SELECTED_SKILLS[@]}"; do
  configure_credentials "$skill"
done

# 6. Verify
verify_all

# 7. Setup guide
show_setup_guide
