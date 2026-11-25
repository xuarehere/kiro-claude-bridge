# Changelog

## [4.0.0] - 2026-11-25
### Added
- **Zero-Dependency Plug-and-Play Engine**: Replaced `express` and `undici` with a lightweight native `node:http` router (`src/utils/http-app.js`), Node `node:sqlite` for CC Switch integration, and fully offline CSS/SVG Web UI assets (`icons.js` + `style.css`). Runs from source ZIP with zero `npm install` or internet CDN dependencies.
- **Pre-Packaged Portable Release Bundler (`npm run pack`)**: Generates both minimal source bundles and Windows self-contained portable ZIPs (`runtime/node.exe` auto-detection).
- **Full OpenAI & Anthropic Protocol Parity**: Added `POST /v1/messages/count_tokens`, `POST /v1/chat/completions`, and `POST /v1/responses`, completely eliminating any dependency on `@colin3191/kiro-proxy`.
- **Port Conflict Diagnostics & One-Click Takeover**: Added `src/proxy/port-manager.js`, HTTP `409` diagnostics, Web UI conflict banner with one-click port takeover / legacy autostart cleanup / port switching (`3458`), and `--takeover` CLI flag.
- **Root-Level One-Click Launchers**: Added root `start-web.bat`, `stop.bat`, `restore.bat`, `start.sh`, `stop.sh`.
- **Test Suite & OSS Docs**: Added `node --test` unit/integration tests (`tests/`), `LICENSE`, `.gitignore`, `CONTRIBUTING.md`, `.github/workflows/ci-release.yml`, and bilingual `README.md` / `README_zh.md`.

### Fixed
- Fixed Windows `cmd.exe` LF-only + UTF-8 corruption in `scripts/*.bat` (`'o-Claude-Bridge'`, `'姩'`, `Cannot find module '...\scripts\src\index.js'`).
- Fixed silent HTTP 500 toast bug when clicking Start/Stop Proxy in the Web Dashboard.
- Fixed `modelMeta` lookup in `/v1/messages` so custom Effort values for `Claude Opus 5.5` / `Claude Haiku 5.5` are not shadowed by fallback wire model IDs.
- Added `serverInstance.closeAllConnections()` and `AbortController` upstream cancellation.
- Strict Zero Auto-Start policy enforced across all scripts and UI.

## [3.0.0] - 2026-11-23
- Completed genuine Claude 5.5 trio (`Claude Opus 5.5`, `Claude Sonnet 5.5`, `Claude Haiku 5.5`) reaching 20 authentic models.
- Enforced strict A-Z alphabetical sorting across UI, API, and Claude Desktop config.
- Added live Kiro catalog refresh (`POST /api/models/refresh`) and schema-driven Effort/Thinking configuration.
