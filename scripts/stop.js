// scripts/stop.js - Cross-platform safe process stopper for Kiro-Claude-Bridge
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { CONFIG } from '../src/config.js';
import { freePort, inspectPort } from '../src/proxy/port-manager.js';

const ports = [CONFIG.PROXY_PORT, CONFIG.WEB_PORT];
console.log('[Stop] Checking configured ports:', ports.join(', '));

// 1. Terminate PID from lockfile if running
try {
  if (fs.existsSync(CONFIG.PATHS.PID_FILE)) {
    const pid = Number(fs.readFileSync(CONFIG.PATHS.PID_FILE, 'utf8').trim());
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
        } else {
          process.kill(pid, 'SIGTERM');
        }
        console.log(`[OK] Terminated bridge PID ${pid} from lockfile.`);
      } catch {}
    }
    try {
      fs.unlinkSync(CONFIG.PATHS.PID_FILE);
    } catch {}
  }
} catch {}

// 2. Cleanly release configured ports
for (const port of ports) {
  try {
    const info = await inspectPort(port);
    if (!info.occupied) {
      console.log(`[INFO] Port ${port} is already free.`);
      continue;
    }
    if (info.hasLegacyKiroProxy && !info.hasSelfBridge) {
      console.log(`[WARN] Port ${port} is held by legacy @colin3191/kiro-proxy (PID ${info.primary?.pid}). Stopping it cleanly...`);
    }
    const res = await freePort(port);
    for (const proc of res.terminated) {
      console.log(`[OK] Stopped PID ${proc.pid} (${proc.name}) on port ${port}.`);
    }
  } catch (err) {
    console.warn(`[WARN] Could not free port ${port}: ${err.message}`);
  }
}

console.log('[OK] Stop procedure complete.');
