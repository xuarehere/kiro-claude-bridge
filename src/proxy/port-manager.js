import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync, execFileSync } from 'node:child_process';

/**
 * Probe whether a TCP port is currently free to bind.
 */
export function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port);
  });
}

/**
 * Find the next available port starting from startPort.
 */
export async function findAvailablePort(startPort = 3458, exclude = []) {
  const excluded = new Set(exclude.map(Number));
  for (let p = Number(startPort); p < 65535; p++) {
    if (excluded.has(p)) continue;
    if (await isPortFree(p)) return p;
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

function queryWindowsProcessDetails(pid) {
  const numPid = Number(pid);
  if (!Number.isInteger(numPid) || numPid <= 0) return null;

  try {
    const psScript = `Get-CimInstance Win32_Process -Filter "ProcessId = ${numPid}" | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress`;
    const raw = execFileSync('powershell', ['-NoProfile', '-Command', psScript], {
      encoding: 'utf8',
      timeout: 4000,
    }).trim();
    if (raw) {
      const info = JSON.parse(raw);
      return {
        pid: info.ProcessId || numPid,
        name: info.Name || 'unknown',
        commandLine: info.CommandLine || '',
      };
    }
  } catch {
    // Fallback to tasklist
    try {
      const out = execSync(`tasklist /FI "PID eq ${numPid}" /FO CSV /NH`, {
        encoding: 'utf8',
        timeout: 3000,
      }).trim();
      const firstCol = out.split(',')[0]?.replace(/"/g, '').trim();
      if (firstCol && !out.includes('INFO:')) {
        return { pid: numPid, name: firstCol, commandLine: '' };
      }
    } catch {}
  }
  return { pid: numPid, name: 'unknown', commandLine: '' };
}

function getWindowsListeningPids(port) {
  const pids = new Set();
  try {
    const output = execSync('netstat -ano -p tcp', { encoding: 'utf8', timeout: 4000 });
    const exactPortRegex = new RegExp(`:(?:${port})\\s+`);
    for (const line of output.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('TCP')) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 5) continue;
      const localAddr = parts[1];
      const state = parts[3];
      const pid = parts[4];
      if (state === 'LISTENING' && exactPortRegex.test(`${localAddr} `) && pid && pid !== '0') {
        pids.add(Number(pid));
      }
    }
  } catch {}
  return Array.from(pids);
}

function getPosixListeningProcesses(port) {
  const results = [];
  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -Fp`, {
      encoding: 'utf8',
      timeout: 4000,
    });
    const pids = out
      .split(/\r?\n/)
      .filter((l) => l.startsWith('p'))
      .map((l) => Number(l.slice(1)))
      .filter((n) => Number.isInteger(n) && n > 0);

    for (const pid of pids) {
      let cmd = '';
      try {
        cmd = execSync(`ps -p ${pid} -o comm=,args=`, { encoding: 'utf8', timeout: 2000 }).trim();
      } catch {}
      const parts = cmd.split(/\s+/);
      results.push({
        pid,
        name: parts[0] || 'unknown',
        commandLine: cmd,
      });
    }
  } catch {}
  return results;
}

/**
 * Inspect what process (if any) currently occupies a TCP port.
 */
export async function inspectPort(port) {
  const free = await isPortFree(port);
  if (free) {
    return { port, occupied: false, processes: [] };
  }

  let processes = [];
  if (process.platform === 'win32') {
    const pids = getWindowsListeningPids(port);
    processes = pids.map(queryWindowsProcessDetails).filter(Boolean);
  } else {
    processes = getPosixListeningProcesses(port);
  }

  const enriched = processes.map((p) => {
    const cmd = `${p.name || ''} ${p.commandLine || ''}`;
    const isSelf = p.pid === process.pid;
    const isLegacyKiroProxy = /@colin3191|kiro-proxy/i.test(cmd);
    const isSelfBridge = /kiro-claude-bridge|src[\\/]index\.js/i.test(cmd);
    return { ...p, isSelf, isLegacyKiroProxy, isSelfBridge };
  });

  return {
    port,
    occupied: true,
    processes: enriched,
    primary: enriched[0] || null,
    hasLegacyKiroProxy: enriched.some((p) => p.isLegacyKiroProxy),
    hasSelfBridge: enriched.some((p) => p.isSelfBridge),
  };
}

/**
 * Check whether legacy @colin3191/kiro-proxy Windows auto-start shortcut exists.
 */
export function checkLegacyAutoStart() {
  if (process.platform !== 'win32') {
    return { exists: false, path: null };
  }
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const legacyShortcut = path.join(
    appData,
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup',
    'Kiro Proxy.lnk'
  );
  return {
    exists: fs.existsSync(legacyShortcut),
    path: legacyShortcut,
  };
}

/**
 * Remove legacy @colin3191/kiro-proxy Windows auto-start shortcut cleanly.
 */
export function removeLegacyAutoStart() {
  const info = checkLegacyAutoStart();
  if (!info.exists) {
    return { removed: false, reason: 'Not present', path: info.path };
  }
  fs.unlinkSync(info.path);
  return { removed: true, path: info.path };
}

/**
 * Terminate external processes occupying a port and wait until it becomes available.
 */
export async function freePort(port, { waitMs = 4000 } = {}) {
  const inspection = await inspectPort(port);
  if (!inspection.occupied) {
    return { freed: true, terminated: [] };
  }

  const terminated = [];
  for (const proc of inspection.processes) {
    if (proc.pid === process.pid) continue;
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /F /PID ${proc.pid}`, { stdio: 'ignore', timeout: 4000 });
      } else {
        process.kill(proc.pid, 'SIGTERM');
      }
      terminated.push(proc);
    } catch (err) {
      throw new Error(`Failed to terminate PID ${proc.pid} (${proc.name}): ${err.message}`);
    }
  }

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (await isPortFree(port)) {
      return { freed: true, terminated };
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  // On POSIX, escalate to SIGKILL if still occupied
  if (process.platform !== 'win32') {
    for (const proc of terminated) {
      try {
        process.kill(proc.pid, 'SIGKILL');
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 250));
    if (await isPortFree(port)) {
      return { freed: true, terminated };
    }
  }

  throw new Error(`Port ${port} remained occupied after terminating process(es)`);
}
