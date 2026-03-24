# Contributing

Contributions are welcome! This project uses a **branch-based workflow** with a protected `main` branch.

## Branch Strategy

```
contributor → feat/xxx or fix/yyy → PR to main → review & merge
```

- **`main`** -- production branch. Protected. All PRs target `main` directly.
- **Feature/fix branches** -- created by contributors from `main`.

## How to Contribute

1. **Fork** the repository and clone it locally
2. **Create a branch** from `main` for your feature or fix:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feat/my-feature
   ```
3. **Make your changes** following the guidelines below
4. **Test your changes** by deploying the Apps Scripts and verifying the skill works end-to-end
5. **Push** your branch and open a **Pull Request to `main`**:
   ```bash
   git push origin feat/my-feature
   ```
   Then create a PR targeting the `main` branch on GitHub.
6. **Address review feedback** -- the maintainer will review your PR
7. Once approved, the PR will be merged into `main`

## Branch Naming Conventions

| Prefix | Use for | Example |
| --- | --- | --- |
| `feat/` | New features or skills | `feat/google-gmail-skill` |
| `fix/` | Bug fixes | `fix/sync-lock-timeout` |
| `docs/` | Documentation changes | `docs/update-setup-guide` |
| `refactor/` | Code refactoring | `refactor/worksync-helpers` |

## Guidelines

- Keep the spreadsheet-proxy architecture. It avoids OAuth complexity for the end user.
- Don't commit real API keys, URLs, or spreadsheet IDs. Use `YOUR_*_HERE` or `__PLACEHOLDER__` values.
- The `SKILL.md` format follows the [Agent Skills specification](https://agentskills.io/specification). Keep it portable.
- Follow the existing code style (Apps Script-compatible ES5 with JSDoc where helpful).
- Update the relevant `api-actions.md` if you add new actions.
- Update `SKILL.md` if you change the skill's behavior or add new capabilities.
- Update `install.sh` if you add a new skill (selection menu, credentials, verification, setup guide).

## Ideas for Contributions

- **More agents** -- add support for Windsurf, Cline, Roo Code, aider, etc.
- **Google Gmail skill** -- read/send emails through the same proxy pattern
- **Webhook support** -- push-based sync instead of polling every minute
- **Multi-timezone** -- configurable timezone per user instead of hardcoded +07:00
- **Batch operations** -- optimize multiple writes in a single API call
- **Conflict resolution UI** -- better handling of concurrent edits
