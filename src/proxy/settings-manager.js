import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SETTINGS_FILE = path.resolve(__dirname, '../../config/model-settings.json');

// Default fallback settings
const DEFAULT_SETTINGS = {
  global: {
    passThroughClient: true,
    defaultEffort: 'high',
    defaultThinkingBudget: 4096,
  },
  models: {
    'claude-opus-5.5': { effort: 'max', thinkingEnabled: true },
    'claude-sonnet-5.5': { effort: 'high', thinkingEnabled: true },
    'claude-haiku-5.5': { effort: 'medium', thinkingEnabled: true },
    'gpt-5.6-sol': { effort: 'high', thinkingEnabled: true },
    'gpt-5.6-terra': { effort: 'high', thinkingEnabled: true },
    'gpt-5.6-luna': { effort: 'high', thinkingEnabled: true },
    'grok-4.7': { effort: 'high', thinkingEnabled: true },
    'kimi-k3': { effort: 'max', thinkingEnabled: true },
  },
};

function ensureConfigFile() {
  const dir = path.dirname(SETTINGS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf8');
  }
}

export function loadModelSettings() {
  ensureConfigFile();
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[SettingsManager] Failed to read model-settings.json, using defaults:', err.message);
    return DEFAULT_SETTINGS;
  }
}

export function saveModelSettings(newSettings = {}) {
  ensureConfigFile();
  const current = loadModelSettings();

  // Support both newSettings.models and newSettings.modelEfforts
  const incomingModels = { ...(newSettings.models || {}) };
  if (newSettings.modelEfforts) {
    for (const [id, effort] of Object.entries(newSettings.modelEfforts)) {
      incomingModels[id] = { ...(incomingModels[id] || current.models?.[id] || {}), effort };
    }
  }

  const merged = {
    global: { ...current.global, ...(newSettings.global || {}) },
    models: { ...current.models, ...incomingModels },
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

export function resolveRequestAdditionalFields(modelMeta, clientBody = {}) {
  if (!modelMeta || !modelMeta.effortLevels || modelMeta.effortLevels.length === 0) {
    return undefined;
  }

  const settings = loadModelSettings();
  const passThrough = settings.global?.passThroughClient !== false;

  // Check ID variations (e.g., claude-opus-5.5 and claude-opus-5-5)
  const idDots = modelMeta.id;
  const idDashes = modelMeta.id.replace(/\./g, '-');
  const modelConfig = settings.models?.[idDots] || settings.models?.[idDashes] || {};

  let finalEffort = modelConfig.effort || modelMeta.defaultEffortLevel || modelMeta.effortLevels[0];

  // 1. Check if client explicitly sent effort / reasoning_effort
  if (passThrough) {
    const clientEffort = clientBody.effort || clientBody.reasoning_effort;
    if (clientEffort && modelMeta.effortLevels.includes(clientEffort)) {
      finalEffort = clientEffort;
    } else if (clientBody.thinking) {
      if (clientBody.thinking.type === 'disabled') {
        if (modelMeta.effortLevels.includes('none')) {
          finalEffort = 'none';
        }
      } else if (clientBody.thinking.budget_tokens) {
        const budget = Number(clientBody.thinking.budget_tokens);
        if (budget <= 2048 && modelMeta.effortLevels.includes('low')) {
          finalEffort = 'low';
        } else if (budget <= 4096 && modelMeta.effortLevels.includes('medium')) {
          finalEffort = 'medium';
        } else if (budget <= 8192 && modelMeta.effortLevels.includes('high')) {
          finalEffort = 'high';
        } else if (modelMeta.effortLevels.includes('max')) {
          finalEffort = 'max';
        } else if (modelMeta.effortLevels.includes('xhigh')) {
          finalEffort = 'xhigh';
        }
      }
    }
  }

  // Ensure finalEffort is strictly within model's supported enum
  if (!modelMeta.effortLevels.includes(finalEffort)) {
    finalEffort = modelMeta.defaultEffortLevel || modelMeta.effortLevels[0];
  }

  const schemaPath = modelMeta.effortSchemaPath || 'reasoning';
  if (schemaPath === 'output_config') {
    return { output_config: { effort: finalEffort } };
  }
  return { reasoning: { effort: finalEffort } };
}
