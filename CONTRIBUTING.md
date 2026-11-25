# Contributing to Kiro-Claude-Bridge

Thank you for helping improve **Kiro-Claude-Bridge**! We adhere strictly to:
1. **Zero external runtime dependencies** (`package.json` `"dependencies": {}`). Use built-in Node.js modules (`node:http`, `node:fs`, `node:sqlite`, `node:test`).
2. **Zero external CDN dependencies in the Web UI**. Keep all CSS and SVG icons local under `src/web/static/`.
3. **Zero OS auto-start & zero system pollution**. Never touch `Startup`, `HKCU\...\Run`, or background daemons without explicit user triggers.
4. **Authentic Kiro models & schemas only**. Never fabricate fake model IDs or unsupported effort levels.

## Development Workflow

```bash
# Run built-in test suite (zero dependencies)
npm test

# Start proxy + dashboard with browser open
npm run web

# Build plug-and-play Source & Portable ZIP packages into dist/
npm run pack
```

## Windows `.bat` Script Rules
- Keep all `.bat` file contents **Pure ASCII** with **Windows CRLF (`\r\n`)** line endings. Never combine `chcp 65001` with non-ASCII UTF-8 strings in `.bat` files, as `cmd.exe` line-seek offsets can misalign and corrupt commands.
