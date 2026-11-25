import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadBridgeConfig, saveBridgeConfig } from './config/runtime-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

function resolveClaudeDesktopConfigDir() {
  if (process.platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Local', 'Claude-3p', 'configLibrary');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Claude-3p', 'configLibrary');
  }
  return path.join(os.homedir(), '.config', 'Claude-3p', 'configLibrary');
}

const persisted = loadBridgeConfig();
const desktopConfigLibDir = resolveClaudeDesktopConfigDir();

export const CONFIG = {
  PROJECT_ROOT,
  PROXY_PORT: parseInt(process.env.PROXY_PORT || String(persisted.proxyPort || 3456), 10),
  WEB_PORT: parseInt(process.env.WEB_PORT || String(persisted.webPort || 3457), 10),
  KIRO_VERSION: process.env.KIRO_VERSION || '1.0.231',
  KIRO_RUNTIME_ENDPOINT: process.env.KIRO_RUNTIME_ENDPOINT || 'https://runtime.us-east-1.kiro.dev',

  // Host system integration paths
  PATHS: {
    SSO_CACHE_DIR: path.join(os.homedir(), '.aws', 'sso', 'cache'),
    KIRO_TOKEN_FILE: path.join(os.homedir(), '.aws', 'sso', 'cache', 'kiro-auth-token.json'),

    // Claude Code
    CLAUDE_DIR: path.join(os.homedir(), '.claude'),
    CLAUDE_SETTINGS: path.join(os.homedir(), '.claude', 'settings.json'),

    // Claude Desktop (3P configuration)
    CLAUDE_DESKTOP_CONFIG_LIB_DIR: desktopConfigLibDir,
    CLAUDE_DESKTOP_CONFIG: path.join(desktopConfigLibDir, '00000000-0000-4000-8000-000000157210.json'),
    CLAUDE_DESKTOP_META: path.join(desktopConfigLibDir, '_meta.json'),

    // CC Switch SQLite DB
    CC_SWITCH_DB: path.join(os.homedir(), '.cc-switch', 'cc-switch.db'),

    // Project local backups & PID lock
    BACKUP_DIR: path.join(PROJECT_ROOT, '.backups'),
    PID_FILE: path.join(PROJECT_ROOT, '.kiro-bridge.pid'),
  },
};

export function updateConfiguredPorts({ proxyPort, webPort } = {}) {
  const next = {};
  if (proxyPort && Number.isInteger(Number(proxyPort))) {
    CONFIG.PROXY_PORT = Number(proxyPort);
    next.proxyPort = CONFIG.PROXY_PORT;
  }
  if (webPort && Number.isInteger(Number(webPort))) {
    CONFIG.WEB_PORT = Number(webPort);
    next.webPort = CONFIG.WEB_PORT;
  }
  return saveBridgeConfig(next);
}
