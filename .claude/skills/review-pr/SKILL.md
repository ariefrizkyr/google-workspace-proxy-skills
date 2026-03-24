---
name: review-pr
description: >
  Review an open pull request and merge it to main.
  Use when the user asks to review a PR, check a PR, approve a PR, merge a PR,
  or discuss PR feedback. Triggers on: gh pr review, gh pr merge, review PR,
  merge PR, check PR, or any discussion of reviewing submitted changes.
---

# Review PR

Review an open pull request and merge it into `main`.

## Workflow

1. **Identify the PR** — if not specified, list open PRs:
   ```bash
   gh pr list --base main
   ```

2. **Review the PR**:
   - Read the PR diff:
     ```bash
     gh pr diff <pr-number>
     ```
   - Check PR details and any existing comments:
     ```bash
     gh pr view <pr-number>
     gh api repos/{owner}/{repo}/pulls/<pr-number>/comments
     ```
   - Review the code for:
     - Correctness and completeness
     - No secrets or placeholder values committed
     - Consistent code style
     - Updated documentation if behavior changed

3. **Provide feedback** — if changes are needed:
   ```bash
   gh pr review <pr-number> --request-changes --body "<feedback>"
   ```

4. **Approve and merge** — if the PR looks good:
   ```bash
   gh pr review <pr-number> --approve --body "LGTM"
   gh pr merge <pr-number> --merge --delete-branch
   ```

## Rules

- Always review the diff before merging — never blind-merge.
- Use `--merge` strategy (merge commit) to preserve branch history.
- Delete the feature branch after merging with `--delete-branch`.
- If the PR has conflicts, ask the contributor to rebase before merging.
