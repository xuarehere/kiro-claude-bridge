import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHttpApp, jsonBodyParser, serveStatic } from '../utils/http-app.js';
import { CONFIG, updateConfiguredPorts } from '../config.js';
import { getAuthStatus, getAccessToken } from '../kiro/auth.js';
import { getNormalizedModelList, refreshModelCatalog } from '../kiro/catalog.js';
import {
  startProxyServer,
  stopProxyServer,
  isProxyRunning,
  getProxyLogs,
  getProxyStats,
  getLastProxyError,
} from '../proxy/server.js';
import {
  inspectPort,
  freePort,
  findAvailablePort,
  checkLegacyAutoStart,
  removeLegacyAutoStart,
} from '../proxy/port-manager.js';
import { loadModelSettings, saveModelSettings } from '../proxy/settings-manager.js';
import { syncClaudeDesktopModels, getClaudeDesktopCurrentConfig } from '../adapters/claude-desktop.js';
import { syncClaudeCodeSettings, getClaudeCodeCurrentConfig } from '../adapters/claude-code.js';
import { syncCCSwitchToKiro, restoreCCSwitchToMiniMax, isCCSwitchAvailable } from '../adapters/cc-switch.js';
import { ensureInitialBackups, restorePristineBackups } from '../adapters/backup-manager.js';
import { createDesktopShortcuts } from '../../scripts/create-shortcuts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createWebApp() {
  const app = createHttpApp({ loopbackOnly: true, enableCors: true });
  app.use(jsonBodyParser({ limitBytes: 15 * 1024 * 1024 }));
  app.use(serveStatic(path.join(__dirname, 'static')));

  async function buildConflictDiagnostics(port) {
    const inspection = await inspectPort(port);
    if (!inspection.occupied) return null;
    let suggestedFreePort = null;
    try {
      suggestedFreePort = await findAvailablePort(port + 2, [CONFIG.WEB_PORT]);
    } catch {}
    return {
      ...inspection,
      suggestedFreePort,
    };
  }

  // GET /api/status
  app.get('/api/status', async (_req, res) => {
    try {
      const auth = getAuthStatus();
      const stats = getProxyStats();
      const running = isProxyRunning();
      const desktopConfig = getClaudeDesktopCurrentConfig();
      const codeConfig = getClaudeCodeCurrentConfig();
      const legacyAutostart = checkLegacyAutoStart();
      const conflict = running ? null : await buildConflictDiagnostics(CONFIG.PROXY_PORT);
      const portStr = String(CONFIG.PROXY_PORT);

      res.json({
        app: 'kiro-claude-bridge',
        version: '4.0.0',
        platform: process.platform,
        nodeVersion: process.version,
        zeroDependency: true,
        autoStartEnabled: false, // Strictly prohibited by design
        proxy: {
          running,
          port: CONFIG.PROXY_PORT,
          webPort: CONFIG.WEB_PORT,
          url: `http://127.0.0.1:${CONFIG.PROXY_PORT}`,
          lastError: getLastProxyError(),
          conflict,
          legacyAutostart,
        },
        auth,
        stats,
        integration: {
          claudeDesktop: {
            configured: !!desktopConfig?.inferenceGatewayBaseUrl?.includes(portStr),
            modelCount: desktopConfig?.inferenceModels?.length || 0,
            baseUrl: desktopConfig?.inferenceGatewayBaseUrl || 'N/A',
          },
          claudeCode: {
            configured: !!codeConfig?.env?.ANTHROPIC_BASE_URL?.includes(portStr),
            model: codeConfig?.env?.ANTHROPIC_DEFAULT_SONNET_MODEL || 'N/A',
            baseUrl: codeConfig?.env?.ANTHROPIC_BASE_URL || 'N/A',
          },
          ccSwitch: {
            available: isCCSwitchAvailable(),
          },
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/models
  app.get('/api/models', async (req, res) => {
    try {
      const force = req.query.force === 'true';
      const catalog = await getNormalizedModelList(force);
      res.json(catalog);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/models/refresh
  app.post('/api/models/refresh', async (req, res) => {
    try {
      const force = req.body?.force !== false;
      const catalog = await refreshModelCatalog(force);
      const desktopRes = await syncClaudeDesktopModels();
      res.json({
        success: true,
        modelCount: catalog.models.length,
        models: catalog.models,
        desktop: desktopRes,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/model-settings
  app.get('/api/model-settings', (_req, res) => {
    try {
      res.json(loadModelSettings());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/model-settings
  app.post('/api/model-settings', (req, res) => {
    try {
      const updated = saveModelSettings(req.body);
      res.json({ success: true, settings: updated });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // POST /api/sync-models
  app.post('/api/sync-models', async (_req, res) => {
    try {
      ensureInitialBackups();
      const result = await syncClaudeDesktopModels();
      await syncCCSwitchToKiro();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/switch-kiro
  app.post('/api/switch-kiro', async (req, res) => {
    try {
      ensureInitialBackups();

      if (!isProxyRunning()) {
        if (req.body?.takeover) {
          await freePort(CONFIG.PROXY_PORT);
        }
        try {
          await startProxyServer(CONFIG.PROXY_PORT);
        } catch (startErr) {
          if (startErr.code === 'EADDRINUSE') {
            const conflict = await buildConflictDiagnostics(CONFIG.PROXY_PORT);
            return res.status(409).json({
              success: false,
              code: 'EADDRINUSE',
              error: `端口 ${CONFIG.PROXY_PORT} 被其他进程占用，无法启动代理`,
              conflict,
              legacyAutostart: checkLegacyAutoStart(),
            });
          }
          throw startErr;
        }
      }

      const desktopRes = await syncClaudeDesktopModels();
      const codeRes = syncClaudeCodeSettings();
      const ccRes = await syncCCSwitchToKiro();

      res.json({
        success: true,
        message: 'Successfully switched Claude Desktop and Claude Code to Kiro Proxy!',
        desktop: desktopRes,
        code: codeRes,
        ccSwitch: ccRes,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/restore-original
  app.post('/api/restore-original', async (_req, res) => {
    try {
      await stopProxyServer();
      const rollbacks = restorePristineBackups();
      await restoreCCSwitchToMiniMax();

      res.json({
        success: true,
        message: 'All settings have been restored to original state, and proxy is stopped.',
        rollbacks,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/start-proxy - Supports optional takeover, legacy autostart cleanup, or custom port switch
  app.post('/api/start-proxy', async (req, res) => {
    const { takeover = false, disableLegacyAutostart = false, port } = req.body || {};
    let targetPort = CONFIG.PROXY_PORT;
    let portChanged = false;

    try {
      if (port !== undefined && port !== null) {
        const parsedPort = Number(port);
        if (!Number.isInteger(parsedPort) || parsedPort < 1024 || parsedPort > 65535 || parsedPort === CONFIG.WEB_PORT) {
          return res.status(400).json({
            success: false,
            error: `无效的端口号: ${port}（需在 1024~65535 之间且不能与看板端口 ${CONFIG.WEB_PORT} 冲突）`,
          });
        }
        if (parsedPort !== CONFIG.PROXY_PORT) {
          targetPort = parsedPort;
          portChanged = true;
          if (isProxyRunning()) {
            await stopProxyServer();
          }
        }
      }

      if (takeover) {
        await freePort(targetPort);
      }

      let autostartResult = null;
      if (disableLegacyAutostart) {
        autostartResult = removeLegacyAutoStart();
      }

      await startProxyServer(targetPort);

      if (portChanged) {
        updateConfiguredPorts({ proxyPort: targetPort });
        // Re-sync existing clients if already configured
        const desktopCfg = getClaudeDesktopCurrentConfig();
        if (desktopCfg?.inferenceProvider === 'gateway') {
          await syncClaudeDesktopModels();
        }
        const codeCfg = getClaudeCodeCurrentConfig();
        if (codeCfg?.env?.ANTHROPIC_BASE_URL?.includes('127.0.0.1') || codeCfg?.env?.ANTHROPIC_BASE_URL?.includes('localhost')) {
          syncClaudeCodeSettings();
        }
      }

      res.json({
        success: true,
        port: targetPort,
        portChanged,
        autostartRemoved: autostartResult,
        message: `Proxy started successfully on port ${targetPort}.`,
      });
    } catch (err) {
      if (err.code === 'EADDRINUSE') {
        const conflict = await buildConflictDiagnostics(targetPort);
        return res.status(409).json({
          success: false,
          code: 'EADDRINUSE',
          error: `端口 ${targetPort} 正被外部进程占用 (${conflict?.primary?.name || 'unknown'} PID ${conflict?.primary?.pid || '?'})`,
          conflict,
          legacyAutostart: checkLegacyAutoStart(),
        });
      }
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/stop-proxy
  app.post('/api/stop-proxy', async (_req, res) => {
    try {
      await stopProxyServer();
      res.json({ success: true, message: 'Proxy stopped successfully.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/disable-legacy-autostart
  app.post('/api/disable-legacy-autostart', (_req, res) => {
    try {
      const result = removeLegacyAutoStart();
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/create-shortcuts
  app.post('/api/create-shortcuts', (_req, res) => {
    try {
      const result = createDesktopShortcuts();
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/refresh-token
  app.post('/api/refresh-token', async (_req, res) => {
    try {
      const token = await getAccessToken();
      res.json({ success: true, expiresAt: token.expiresAt, provider: token.provider });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/test-chat
  app.post('/api/test-chat', async (req, res) => {
    const { model = 'gpt-5.6-sol', prompt = 'Hello', effort } = req.body || {};
    if (!isProxyRunning()) {
      return res.status(503).json({
        error: { message: `代理服务当前未启动（端口 ${CONFIG.PROXY_PORT}），请先解决端口冲突或点击启动代理。` },
      });
    }
    try {
      const payload = {
        model,
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      };
      if (effort) payload.effort = effort;

      const fetchRes = await fetch(`http://127.0.0.1:${CONFIG.PROXY_PORT}/v1/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await fetchRes.json();
      res.status(fetchRes.status).json(data);
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  // GET /api/logs
  app.get('/api/logs', (_req, res) => {
    res.json(getProxyLogs());
  });

  return app;
}

let webServerInstance = null;

export function startWebServer(port = CONFIG.WEB_PORT) {
  if (webServerInstance) return Promise.resolve(webServerInstance);

  return new Promise((resolve, reject) => {
    const app = createWebApp();
    let settled = false;
    const candidate = app.listen(port);

    candidate.once('error', (err) => {
      webServerInstance = null;
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    candidate.once('listening', () => {
      webServerInstance = candidate;
      settled = true;
      console.log(`[Web] Kiro-Claude-Bridge Dashboard available at http://localhost:${port}`);
      resolve(webServerInstance);
    });
  });
}

export function stopWebServer() {
  if (!webServerInstance) return Promise.resolve();

  const closing = webServerInstance;
  webServerInstance = null;

  return new Promise((resolve) => {
    closing.close(() => {
      console.log('[Web] Web Server stopped');
      resolve();
    });
    if (typeof closing.closeAllConnections === 'function') {
      closing.closeAllConnections();
    }
  });
}
