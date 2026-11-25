# Security Policy

## Local Security Guarantees

**Kiro-Claude-Bridge** handles sensitive local developer credentials (`~/.aws/sso/cache/kiro-auth-token.json`). To protect users:

1. **Strict Loopback Enforcement**: Both the API proxy (`:3456`) and Web Management Dashboard (`:3457`) reject all non-loopback network connections (`127.0.0.1`, `::1`, `::ffff:127.0.0.1` only). Your local machine is never exposed on LAN or public interfaces.
2. **Zero External Telemetry or Exfiltration**: Credentials and prompts are transmitted **only** between your localhost client and official Kiro endpoints (`*.kiro.dev` / `oidc.*.amazonaws.com`).
3. **Zero OS Auto-Start & Zero Hidden Persistence**: The bridge runs strictly on-demand and never installs registry entries, startup shortcuts, scheduled tasks, or hidden daemons.
4. **Static Path Traversal Protection**: `serveStatic` enforces strict canonical root containment before reading any asset.

## Supported Versions

| Version | Supported |
| :--- | :---: |
| 4.x | Yes |
| < 4.0 | No (upgrade recommended) |

## Reporting a Vulnerability

Please **do not** open public GitHub issues for security vulnerabilities. Instead, report privately via GitHub Security Advisories with steps to reproduce and impact analysis.
