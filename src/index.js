import fs from 'node:fs';
import { exec } from 'node:child_process';
import { CONFIG } from './config.js';
import { ensureInitialBackups } from './adapters/backup-manager.js';
import { startProxyServer, stopProxyServer } from './proxy/server.js';
import { startWebServer, stopWebServer } from './web/web-server.js';
import { inspectPort, freePort } from './proxy/port-manager.js';

function openBrowser(url) {
  if (process.platform === 'win32') {
    exec(`cmd /c start "" "${url}"`);
  } else if (process.platform === 'darwin') {
    exec(`open "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
}

async function isBridgeAlreadyRunning(webPort) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 800);
    const res = await fetch(`http://127.0.0.1:${webPort}/api/status`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const data = await res.json();
    return data?.app === 'kiro-claude-bridge';
  } catch {
    return false;
  }
}

function writePidFile() {
  try {
    fs.writeFileSync(CONFIG.PATHS.PID_FILE, String(process.pid), 'utf8');
  } catch {}
}

function removePidFile() {
  try {
    if (fs.existsSync(CONFIG.PATHS.PID_FILE)) {
      const content = fs.readFileSync(CONFIG.PATHS.PID_FILE, 'utf8').trim();
      if (content === String(process.pid)) {
        fs.unlinkSync(CONFIG.PATHS.PID_FILE);
      }
    }
  } catch {}
}

async function main() {
  const args = process.argv.slice(2);
  const shouldOpen = args.includes('--open') || args.includes('-o');
  const shouldTakeover = args.includes('--takeover') || args.includes('-t');
  const webUrl = `http://localhost:${CONFIG.WEB_PORT}`;

  console.log('========================================================');
  console.log('  Kiro-Claude-Bridge v4.0.0 (Plug-and-Play Edition)');
  console.log('  Zero Dependencies | Zero Auto-Start | Dynamic A-Z Models');
  console.log('========================================================\n');

  // If dashboard is already running from another terminal, reuse cleanly and open UI
  if (await isBridgeAlreadyRunning(CONFIG.WEB_PORT)) {
    console.log(`[Launcher] Kiro-Claude-Bridge is already running at ${webUrl}`);
    if (shouldOpen) {
      console.log(`[Launcher] Opening existing Web Dashboard: ${webUrl}`);
      openBrowser(webUrl);
    }
    process.exit(0);
  }

  // 1. Ensure initial pristine backup
  ensureInitialBackups();
  writePidFile();

  // 2. Start core proxy server
  try {
    if (shouldTakeover) {
      const check = await inspectPort(CONFIG.PROXY_PORT);
      if (check.occupied) {
        console.log(`[Proxy] --takeover active: releasing port ${CONFIG.PROXY_PORT} (PID ${check.primary?.pid || '?'})...`);
        await freePort(CONFIG.PROXY_PORT);
      }
    }
    await startProxyServer(CONFIG.PROXY_PORT);
  } catch (err) {
    console.error(`[Error] Failed to start Proxy Server on port ${CONFIG.PROXY_PORT}: ${err.message}`);
    if (err.code === 'EADDRINUSE') {
      const conflict = await inspectPort(CONFIG.PROXY_PORT);
      if (conflict.primary) {
        console.error(
          `[Hint] Port ${CONFIG.PROXY_PORT} is occupied by PID ${conflict.primary.pid} (${conflict.primary.name}: ${conflict.primary.commandLine})`
        );
      }
      console.error(`[Hint] Web Dashboard will still launch so you can click "Take Over Port" or switch ports.`);
    }
  }

  // 3. Start Web Management Dashboard
  try {
    await startWebServer(CONFIG.WEB_PORT);
  } catch (err) {
    console.error(`[Error] Failed to start Web Server on port ${CONFIG.WEB_PORT}: ${err.message}`);
    removePidFile();
    process.exit(1);
  }

  if (shouldOpen) {
    console.log(`[Launcher] Opening Web Dashboard: ${webUrl}`);
    openBrowser(webUrl);
  }

  console.log('\nReady to use:');
  console.log(`   -> Web Dashboard: ${webUrl}`);
  console.log(`   -> API Proxy:     http://127.0.0.1:${CONFIG.PROXY_PORT}/v1/messages`);
  console.log('   -> Press Ctrl+C to stop.\n');
}

function shutdown() {
  console.log('\n[Shutdown] Stopping servers gracefully...');
  removePidFile();
  Promise.all([stopProxyServer(), stopWebServer()]).then(() => {
    console.log('[Shutdown] All services stopped. Goodbye!');
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', removePidFile);

main().catch((err) => {
  console.error('[Fatal Error]', err);
  removePidFile();
  process.exit(1);
});
