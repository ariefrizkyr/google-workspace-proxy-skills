---
name: create-release
description: >
  Create a release tag and publish a GitHub release with auto-generated release notes.
  Use when the user asks to create a release, tag a version, publish a release,
  cut a release, or bump the version. Triggers on: gh release create, git tag,
  create release, tag version, or any discussion of releasing a new version.
---

# Create Release

Create a Git tag and publish a GitHub release with release notes.

## Workflow

1. **Determine version** — check the latest release tag:
   ```bash
   gh release list --limit 5
   ```
   Follow [Semantic Versioning](https://semver.org/):
   - `MAJOR` — breaking changes
   - `MINOR` — new features (backwards-compatible)
   - `PATCH` — bug fixes (backwards-compatible)

2. **Generate release notes** — gather changes since last release:
   ```bash
   git log <last-tag>..HEAD --oneline
   ```
   Categorize changes into:
   - **Features** — new functionality
   - **Fixes** — bug fixes
   - **Docs** — documentation updates
   - **Refactors** — code improvements

3. **Create the release**:
   ```bash
   gh release create v<version> \
     --target main \
     --title "v<version>" \
     --notes "<release-notes>"
   ```

## Release Notes Format

```markdown
## What's Changed

### Features
- Description of feature (#PR)

### Fixes
- Description of fix (#PR)

### Docs
- Description of docs change (#PR)

### Refactors
- Description of refactor (#PR)

**Full Changelog**: https://github.com/{owner}/{repo}/compare/v<prev>...v<version>
```

## Rules

- Always create releases from `main`.
- Use semantic versioning (`vMAJOR.MINOR.PATCH`).
- Include PR numbers in release notes for traceability.
- Only include sections that have entries (skip empty categories).
