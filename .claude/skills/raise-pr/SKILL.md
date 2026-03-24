---
name: raise-pr
description: >
  Commit changes, push to remote, and create a pull request targeting main.
  Use when the user asks to raise a PR, submit changes, create a pull request,
  or push their work for review. Triggers on: git push, gh pr create, raise PR,
  submit PR, open PR, or any discussion of submitting changes for review.
---

# Raise PR

Commit, push, and open a pull request targeting `main`.

## Workflow

1. **Determine branch** — check the current branch:
   - If already on a `feat/`, `fix/`, `docs/`, or `refactor/` branch, stay on it.
   - If on `main`, create a new branch from `main` using the naming conventions below.

2. **Sync with main**:
   ```bash
   git pull origin main --rebase
   ```

3. **Stage and commit** changes with a clear, conventional commit message.

4. **Push** the branch:
   ```bash
   git push -u origin <branch-name>
   ```

5. **Create PR** targeting `main`:
   ```bash
   gh pr create --base main --title "<title>" --body "<body>"
   ```

## Branch Naming

| Prefix | Purpose | Example |
| --- | --- | --- |
| `feat/` | New features or skills | `feat/google-gmail-skill` |
| `fix/` | Bug fixes | `fix/sync-lock-timeout` |
| `docs/` | Documentation changes | `docs/update-setup-guide` |
| `refactor/` | Code refactoring | `refactor/worksync-helpers` |

## Rules

- Never push directly to `main` — always use a pull request.
- All PRs target `main` as the base branch.
- Pull latest `main` before creating a new branch.
- If on `main` when asked to commit and push, create a feature/fix branch from `main` first.
- Write clear PR descriptions summarizing what changed and why.
