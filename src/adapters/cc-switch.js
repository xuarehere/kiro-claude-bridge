import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { CONFIG } from '../config.js';
import { getNormalizedModelList } from '../kiro/catalog.js';
import { COMPLIANT_NAME_MAP } from '../proxy/model-router.js';

export function isCCSwitchAvailable() {
  return fs.existsSync(CONFIG.PATHS.CC_SWITCH_DB);
}

async function openNodeSqlite(dbPath) {
  try {
    const sqlite = await import('node:sqlite');
    if (sqlite?.DatabaseSync) {
      return new sqlite.DatabaseSync(dbPath);
    }
  } catch {}
  return null;
}

export async function syncCCSwitchToKiro() {
  if (!isCCSwitchAvailable()) return { success: false, reason: 'CC Switch DB not found' };

  const dbPath = CONFIG.PATHS.CC_SWITCH_DB;
  const proxyUrl = `http://127.0.0.1:${CONFIG.PROXY_PORT}`;
  const localUrl = `http://localhost:${CONFIG.PROXY_PORT}`;

  // Build dynamic model route map from real catalog
  const catalog = await getNormalizedModelList();
  const modelRoutes = {};
  for (const m of catalog.models) {
    const compliantId = COMPLIANT_NAME_MAP[m.id] || m.id;
    modelRoutes[compliantId] = { model: m.id, labelOverride: `${m.name} (${m.contextFormatted})` };
  }

  const desktopSettings = JSON.stringify({
    env: { ANTHROPIC_BASE_URL: proxyUrl, ANTHROPIC_AUTH_TOKEN: 'any' },
  });
  const desktopMeta = JSON.stringify({
    claudeDesktopMode: 'direct',
    claudeDesktopModelRoutes: modelRoutes,
    apiFormat: 'anthropic',
  });
  const claudeSettings = JSON.stringify({
    env: {
      ANTHROPIC_AUTH_TOKEN: 'any',
      ANTHROPIC_BASE_URL: localUrl,
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5.5',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5.5',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-5.5',
      API_TIMEOUT_MS: '3000000',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1,
      CLAUDE_CODE_SUBAGENT_MODEL: 'gpt-5.6-sol',
    },
    model: 'sonnet',
    includeCoAuthoredBy: false,
  });
  const claudeMeta = JSON.stringify({ apiFormat: 'anthropic' });
  const nowMs = Date.now();

  // Prefer Node built-in node:sqlite (zero Python dependency)
  const db = await openNodeSqlite(dbPath);
  if (db) {
    try {
      db.prepare('DELETE FROM providers WHERE id IN (?, ?)').run('kiro-desktop', 'kiro-claude');
      const insertStmt = db.prepare(`
        INSERT INTO providers (id, app_type, name, settings_config, website_url, category, created_at, icon, icon_color, meta, is_current, in_failover_queue, cost_multiplier)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertStmt.run('kiro-desktop', 'claude-desktop', 'Kiro IDE Proxy', desktopSettings, localUrl, 'custom', nowMs, 'kiro', '#00A4E4', desktopMeta, 1, 0, '1.0');
      insertStmt.run('kiro-claude', 'claude', 'Kiro IDE Proxy', claudeSettings, localUrl, 'custom', nowMs, 'kiro', '#00A4E4', claudeMeta, 1, 0, '1.0');
      db.prepare('UPDATE providers SET is_current=0 WHERE id NOT IN (?, ?)').run('kiro-desktop', 'kiro-claude');
      db.close();
      return { success: true, engine: 'node:sqlite' };
    } catch (err) {
      try { db.close(); } catch {}
      return { success: false, error: err.message };
    }
  }

  // Graceful fallback to Python sqlite3 with parameterized sys.argv (no string interpolation)
  const pyScript = `
import sqlite3, sys
db_path, d_set, l_url, d_meta, c_set, c_meta, now_ms = sys.argv[1:8]
con = sqlite3.connect(db_path)
cur = con.cursor()
cur.execute('DELETE FROM providers WHERE id IN (?, ?)', ('kiro-desktop', 'kiro-claude'))
cur.execute('INSERT INTO providers (id, app_type, name, settings_config, website_url, category, created_at, icon, icon_color, meta, is_current, in_failover_queue, cost_multiplier) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', ('kiro-desktop', 'claude-desktop', 'Kiro IDE Proxy', d_set, l_url, 'custom', int(now_ms), 'kiro', '#00A4E4', d_meta, 1, 0, '1.0'))
cur.execute('INSERT INTO providers (id, app_type, name, settings_config, website_url, category, created_at, icon, icon_color, meta, is_current, in_failover_queue, cost_multiplier) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', ('kiro-claude', 'claude', 'Kiro IDE Proxy', c_set, l_url, 'custom', int(now_ms), 'kiro', '#00A4E4', c_meta, 1, 0, '1.0'))
cur.execute('UPDATE providers SET is_current=0 WHERE id NOT IN (?, ?)', ('kiro-desktop', 'kiro-claude'))
con.commit()
con.close()
print('OK')
`;
  try {
    const res = execFileSync(
      'python',
      ['-c', pyScript, dbPath, desktopSettings, localUrl, desktopMeta, claudeSettings, claudeMeta, String(nowMs)],
      { encoding: 'utf8' }
    );
    return { success: res.trim() === 'OK', engine: 'python' };
  } catch (err) {
    return { success: false, reason: 'No SQLite driver available', error: err.message };
  }
}

export async function restoreCCSwitchToMiniMax() {
  if (!isCCSwitchAvailable()) return { success: false, reason: 'CC Switch DB not found' };
  const dbPath = CONFIG.PATHS.CC_SWITCH_DB;

  const db = await openNodeSqlite(dbPath);
  if (db) {
    try {
      // Disable our injected Kiro providers and pick the first non-kiro provider per app_type cleanly
      db.prepare("UPDATE providers SET is_current=0 WHERE id IN ('kiro-desktop', 'kiro-claude')").run();
      for (const appType of ['claude-desktop', 'claude']) {
        const active = db.prepare('SELECT id FROM providers WHERE app_type=? AND is_current=1').get(appType);
        if (!active) {
          const fallback = db
            .prepare("SELECT id FROM providers WHERE app_type=? AND id NOT IN ('kiro-desktop', 'kiro-claude') ORDER BY created_at DESC LIMIT 1")
            .get(appType);
          if (fallback?.id) {
            db.prepare('UPDATE providers SET is_current=1 WHERE id=?').run(fallback.id);
          }
        }
      }
      db.close();
      return { success: true, engine: 'node:sqlite' };
    } catch (err) {
      try { db.close(); } catch {}
      return { success: false, error: err.message };
    }
  }

  const pyScript = `
import sqlite3, sys
con = sqlite3.connect(sys.argv[1])
cur = con.cursor()
cur.execute("UPDATE providers SET is_current=0 WHERE id IN ('kiro-desktop', 'kiro-claude')")
for app_type in ('claude-desktop', 'claude'):
    cur.execute("SELECT id FROM providers WHERE app_type=? AND is_current=1", (app_type,))
    if not cur.fetchone():
        cur.execute("SELECT id FROM providers WHERE app_type=? AND id NOT IN ('kiro-desktop', 'kiro-claude') ORDER BY created_at DESC LIMIT 1", (app_type,))
        row = cur.fetchone()
        if row:
            cur.execute("UPDATE providers SET is_current=1 WHERE id=?", (row[0],))
con.commit()
con.close()
print('OK')
`;
  try {
    const res = execFileSync('python', ['-c', pyScript, dbPath], { encoding: 'utf8' });
    return { success: res.trim() === 'OK', engine: 'python' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
