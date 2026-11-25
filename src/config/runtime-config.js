import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const BRIDGE_CONFIG_FILE = path.join(PROJECT_ROOT, 'config', 'bridge-config.json');

const DEFAULTS = {
  proxyPort: 3456,
  webPort: 3457,
};

export function loadBridgeConfig() {
  try {
    if (fs.existsSync(BRIDGE_CONFIG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(BRIDGE_CONFIG_FILE, 'utf8'));
      return { ...DEFAULTS, ...parsed };
    }
  } catch (err) {
    console.warn('[Config] Failed to read bridge-config.json, using defaults:', err.message);
  }
  return { ...DEFAULTS };
}

export function saveBridgeConfig(partial = {}) {
  const dir = path.dirname(BRIDGE_CONFIG_FILE);
  fs.mkdirSync(dir, { recursive: true });
  const current = loadBridgeConfig();
  const next = {
    ...current,
    ...partial,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(BRIDGE_CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}
