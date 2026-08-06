# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public GitHub issue.

Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) ("Report a vulnerability" under the repository's **Security** tab). We'll acknowledge your report and work with you on a fix and coordinated disclosure.

Please include steps to reproduce, affected version/OS, and impact. Give us a reasonable window to remediate before any public disclosure.

## Security model

Pipe Desktop is a thin native client. A few properties worth knowing:

- **The native bridge only talks to your configured hub.** The Rust side enforces that outbound hub requests go to the single origin you configured (your hub URL) — it does not act as an open proxy to arbitrary destinations. Same-origin is enforced in Rust, not just in the UI.
- **Session and 2nd-PIN tokens live in memory only.** The session token and the secret-accounts (2nd PIN) token are held in process memory for the duration of the session; they are not persisted to disk by the client.
- **No server of its own.** The client stores no user data server-side. Your data lives on your hub.

## Scope

This policy covers the desktop client in this repository. Vulnerabilities in the Pipe hub itself belong in the [hub repository](https://github.com/azweig/pipe).
