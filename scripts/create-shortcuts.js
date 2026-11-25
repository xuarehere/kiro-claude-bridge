import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * Create optional Windows Desktop shortcuts (strictly Desktop ONLY — never Windows Startup).
 */
export function createDesktopShortcuts(rootDir = PROJECT_ROOT) {
  if (process.platform !== 'win32') {
    return { success: false, reason: 'Desktop shortcuts helper is Windows-only', created: [] };
  }

  const desktop = path.join(os.homedir(), 'Desktop');
  const shortcuts = [
    {
      name: '启动 Kiro Bridge (Web看板).lnk',
      target: path.join(rootDir, 'start-web.bat'),
      icon: 'shell32.dll,14',
    },
    {
      name: '停止 Kiro Bridge.lnk',
      target: path.join(rootDir, 'stop.bat'),
      icon: 'shell32.dll,27',
    },
    {
      name: '恢复原始配置 (零污染回滚).lnk',
      target: path.join(rootDir, 'restore.bat'),
      icon: 'shell32.dll,238',
    },
  ];

  const created = [];
  const errors = [];

  for (const s of shortcuts) {
    const lnkPath = path.join(desktop, s.name);
    const psCmd = `$w = New-Object -ComObject WScript.Shell; $s = $w.CreateShortcut('${lnkPath.replace(/'/g, "''")}'); $s.TargetPath = '${s.target.replace(/'/g, "''")}'; $s.WorkingDirectory = '${rootDir.replace(/'/g, "''")}'; $s.IconLocation = '${s.icon}'; $s.Save();`;
    try {
      execFileSync('powershell', ['-NoProfile', '-Command', psCmd], { stdio: 'ignore' });
      created.push(s.name);
    } catch (err) {
      errors.push({ name: s.name, error: err.message });
    }
  }

  return { success: errors.length === 0, created, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const res = createDesktopShortcuts();
  if (res.created.length > 0) {
    console.log('[OK] Created optional Desktop shortcuts:', res.created.join(', '));
  }
  if (res.errors?.length > 0) {
    console.error('[ERR] Shortcut errors:', res.errors);
    process.exitCode = 1;
  }
}
