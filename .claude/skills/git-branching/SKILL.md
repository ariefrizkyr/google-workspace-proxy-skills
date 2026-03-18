---
name: git-branching
description: >
  Git branching strategy and contribution workflow for this repository.
  Use when creating branches, committing code, pushing changes, opening pull requests,
  or performing any git operations that affect remote branches. Triggers on: git checkout,
  git branch, git push, git commit, gh pr create, or any discussion of branching strategy.
---

# Git Branching Strategy

```
contributor → feat/xxx or fix/yyy → PR to dev → review & merge → maintainer merges dev to main
```

## Branches

- **`main`** — Production. Protected. Only maintainer merges into `main`.
- **`dev`** — Integration. Protected. All contributor PRs target `dev`.

## Workflow

1. Branch from `dev`:
   ```bash
   git checkout dev && git pull origin dev
   git checkout -b feat/my-feature
   ```
2. Open PR targeting **`dev`** (never `main`).
3. Maintainer promotes `dev` → `main`.

## Branch Naming

| Prefix | Purpose | Example |
| --- | --- | --- |
| `feat/` | New features or skills | `feat/google-gmail-skill` |
| `fix/` | Bug fixes | `fix/sync-lock-timeout` |
| `docs/` | Documentation | `docs/update-setup-guide` |
| `refactor/` | Code refactoring | `refactor/worksync-helpers` |

## Rules

- Never push directly to `main` or `dev` — always use pull requests.
- Always set PR base branch to `dev`.
- Pull latest `dev` before creating a new branch.
- If on `main` or `dev` when asked to commit and push, create a feature/fix branch from `dev` first.
