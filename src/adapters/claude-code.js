import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';

export function syncClaudeCodeSettings(options = {}) {
  const {
    proxyUrl = `http://127.0.0.1:${CONFIG.PROXY_PORT}`,
    defaultModel = 'claude-sonnet-5-5',
  } = options;
  const settingsPath = CONFIG.PATHS.CLAUDE_SETTINGS;
  const settingsDir = path.dirname(settingsPath);

  fs.mkdirSync(settingsDir, { recursive: true });

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {}
  }

  settings.env = settings.env || {};
  settings.env.ANTHROPIC_AUTH_TOKEN = 'any';
  settings.env.ANTHROPIC_BASE_URL = proxyUrl;
  settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL = defaultModel;
  settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL = defaultModel;
  settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'claude-haiku-5-5';
  settings.env.API_TIMEOUT_MS = '3000000';
  settings.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = 1;
  settings.env.CLAUDE_CODE_SUBAGENT_MODEL = defaultModel;

  // Clear conflicting overrides
  delete settings.env.ANTHROPIC_MODEL;
  delete settings.env.ANTHROPIC_DEFAULT_FABLE_MODEL;
  delete settings.env.ANTHROPIC_DEFAULT_FABLE_MODEL_NAME;
  delete settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME;
  delete settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME;
  delete settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME;

  settings.model = 'sonnet';

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  return {
    success: true,
    settingsPath,
    baseUrl: proxyUrl,
    model: defaultModel,
  };
}

export function getClaudeCodeCurrentConfig() {
  const settingsPath = CONFIG.PATHS.CLAUDE_SETTINGS;
  if (!fs.existsSync(settingsPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    return null;
  }
}
