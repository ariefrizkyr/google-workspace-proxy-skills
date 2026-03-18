# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, **please do not open a public issue or pull request.**

Instead, report it privately through one of these channels:

- **Twitter/X DM:** [@ariefrizkyr](https://x.com/ariefrizkyr)
- **Email:** [hi@prototypolab.com](mailto:hi@prototypolab.com)

Please include as much detail as possible:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Response

You can expect an initial response within 48 hours. We will work with you to understand the issue and coordinate a fix before any public disclosure.

## Scope

This policy covers:

- The shell scripts (`tasks.sh`, `calendar.sh`, `drive.sh`, `sheets.sh`)
- The Apps Script code (`PersonalProxy.gs`, `WorkSync.gs`)
- The installer (`install.sh`)
- Any credential handling or authentication logic

## General Security Reminders

- Never commit real API keys, URLs, or spreadsheet IDs. Use `YOUR_*_HERE` or `__PLACEHOLDER__` values.
- The Apps Script web app is protected by an API key. Keep it secret.
- The shared spreadsheet should only be accessible to your personal and work accounts.
