import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';
import { getNormalizedModelList } from '../kiro/catalog.js';
import { COMPLIANT_NAME_MAP } from '../proxy/model-router.js';

export async function syncClaudeDesktopModels(options = {}) {
  const { customModels = null, proxyUrl = `http://127.0.0.1:${CONFIG.PROXY_PORT}` } = options;
  const configPath = CONFIG.PATHS.CLAUDE_DESKTOP_CONFIG;
  const configDir = path.dirname(configPath);

  fs.mkdirSync(configDir, { recursive: true });

  const catalog = await getNormalizedModelList();
  const modelsToSync = customModels || catalog.models;

  // Build inferenceModels array using cEt-compliant identifiers that Claude Desktop will NOT strip
  const inferenceModels = modelsToSync.map((m) => {
    let label = `${m.name} (${m.contextFormatted})`;
    if (m.isDefault) label += ' ★默认旗舰';
    if (m.supportsPromptCaching) label += ' ⚡缓存';

    const compliantName =
      COMPLIANT_NAME_MAP[m.id] ||
      (m.id.startsWith('claude-') ? m.id : `claude-kiro-${m.id.replace(/[^a-zA-Z0-9]/g, '')}`);
    const is1M = m.contextFormatted === '1M';

    return {
      name: compliantName,
      labelOverride: label,
      ...(is1M && { supports1m: true }),
    };
  });

  // Strict A-Z alphabetical sort by labelOverride
  inferenceModels.sort((a, b) =>
    a.labelOverride.localeCompare(b.labelOverride, undefined, { sensitivity: 'base' })
  );

  let configData = {};
  if (fs.existsSync(configPath)) {
    try {
      configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {}
  }

  configData.coworkEgressAllowedHosts = configData.coworkEgressAllowedHosts || ['*'];
  configData.disableDeploymentModeChooser = true;
  configData.inferenceProvider = 'gateway';
  configData.inferenceGatewayBaseUrl = proxyUrl;
  configData.inferenceGatewayAuthScheme = 'bearer';
  configData.inferenceGatewayApiKey = 'any';
  configData.inferenceModels = inferenceModels;

  fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

  // Upsert entry in _meta.json without destroying pre-existing user profiles
  const metaPath = CONFIG.PATHS.CLAUDE_DESKTOP_META;
  const bridgeId = '00000000-0000-4000-8000-000000157210';
  let metaData = { appliedId: bridgeId, entries: [] };
  if (fs.existsSync(metaPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (parsed && Array.isArray(parsed.entries)) {
        metaData = parsed;
      }
    } catch {}
  }
  metaData.appliedId = bridgeId;
  const existingIdx = metaData.entries.findIndex((e) => e.id === bridgeId);
  if (existingIdx >= 0) {
    metaData.entries[existingIdx] = { id: bridgeId, name: 'Kiro-Claude-Bridge' };
  } else {
    metaData.entries.push({ id: bridgeId, name: 'Kiro-Claude-Bridge' });
  }
  fs.writeFileSync(metaPath, JSON.stringify(metaData, null, 2));

  return {
    success: true,
    modelCount: inferenceModels.length,
    models: inferenceModels,
    configPath,
    proxyUrl,
  };
}

export function getClaudeDesktopCurrentConfig() {
  const configPath = CONFIG.PATHS.CLAUDE_DESKTOP_CONFIG;
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}
