import os from 'os';
import { getAccessToken } from './auth.js';
import { CONFIG } from '../config.js';

let cachedCatalog = null;
let catalogExpiresAt = 0;
const CATALOG_TTL = 5 * 60 * 1000;

function regionFromArn(arn) {
  if (!arn) return 'us-east-1';
  const parts = arn.split(':');
  return parts.length >= 4 ? parts[3] : 'us-east-1';
}

export function parseModelEffortSchema(schema) {
  if (!schema || typeof schema !== 'object') return null;

  // 1. Check reasoning.properties.effort (standard Kiro reasoning schema)
  const reasoningEffort = schema.properties?.reasoning?.properties?.effort;
  if (reasoningEffort?.enum && Array.isArray(reasoningEffort.enum) && reasoningEffort.enum.length > 0) {
    return {
      schemaPath: 'reasoning',
      effortLevels: reasoningEffort.enum,
      defaultEffortLevel: reasoningEffort.default || reasoningEffort.enum[0],
    };
  }

  // 2. Check output_config.properties.effort (alternative schema path)
  const outputConfigEffort = schema.properties?.output_config?.properties?.effort;
  if (outputConfigEffort?.enum && Array.isArray(outputConfigEffort.enum) && outputConfigEffort.enum.length > 0) {
    return {
      schemaPath: 'output_config',
      effortLevels: outputConfigEffort.enum,
      defaultEffortLevel: outputConfigEffort.default || outputConfigEffort.enum[0],
    };
  }

  return null;
}

export const KIRO_NATIVE_CLAUDE_MODELS = [
  {
    id: 'claude-3-5-sonnet',
    name: 'Claude 3.5 Sonnet',
    description: 'Anthropic Claude 3.5 Sonnet (Standard Production)',
    maxInputTokens: 200000,
    contextFormatted: '200K',
    rateMultiplier: 3.0,
    rateUnit: 'Credit',
    supportsPromptCaching: true,
    supportsVision: true,
    isDefault: false,
    effortLevels: ['none', 'low', 'medium', 'high'],
    defaultEffortLevel: 'medium',
    effortSchemaPath: 'reasoning',
  },
  {
    id: 'claude-3-7-sonnet',
    name: 'Claude 3.7 Sonnet',
    description: 'Anthropic Claude 3.7 Sonnet (Hybrid Reasoning)',
    maxInputTokens: 200000,
    contextFormatted: '200K',
    rateMultiplier: 3.0,
    rateUnit: 'Credit',
    supportsPromptCaching: true,
    supportsVision: true,
    isDefault: false,
    effortLevels: ['none', 'low', 'medium', 'high', 'max'],
    defaultEffortLevel: 'high',
    effortSchemaPath: 'reasoning',
  },
  {
    id: 'claude-haiku-4.5',
    name: 'Claude Haiku 4.5',
    description: 'Anthropic Claude Haiku 4.5 (Kiro IDE fast agentic execution)',
    maxInputTokens: 200000,
    contextFormatted: '200K',
    rateMultiplier: 0.8,
    rateUnit: 'Credit',
    supportsPromptCaching: true,
    supportsVision: true,
    isDefault: false,
    effortLevels: ['none', 'low', 'medium', 'high'],
    defaultEffortLevel: 'medium',
    effortSchemaPath: 'reasoning',
  },
  {
    id: 'claude-haiku-5.5',
    name: 'Claude Haiku 5.5',
    description: 'Anthropic Claude Haiku 5.5 (Kiro IDE 5.5-gen fast agentic model)',
    maxInputTokens: 200000,
    contextFormatted: '200K',
    rateMultiplier: 1.0,
    rateUnit: 'Credit',
    supportsPromptCaching: true,
    supportsVision: true,
    isDefault: false,
    effortLevels: ['none', 'low', 'medium', 'high'],
    defaultEffortLevel: 'medium',
    effortSchemaPath: 'reasoning',
  },
  {
    id: 'claude-opus-4-8',
    name: 'Claude Opus 4.8',
    description: 'Claude Opus 4.8 (Deep reasoning preview, 1M context)',
    maxInputTokens: 1000000,
    contextFormatted: '1M',
    rateMultiplier: 4.4,
    rateUnit: 'Credit',
    supportsPromptCaching: true,
    supportsVision: true,
    isDefault: false,
    effortLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffortLevel: 'high',
    effortSchemaPath: 'reasoning',
  },
  {
    id: 'claude-opus-5.5',
    name: 'Claude Opus 5.5',
    description: 'Anthropic Claude Opus 5.5 (Kiro IDE 5.5-gen flagship, 1M context with max reasoning)',
    maxInputTokens: 1000000,
    contextFormatted: '1M',
    rateMultiplier: 4.4,
    rateUnit: 'Credit',
    supportsPromptCaching: true,
    supportsVision: true,
    isDefault: false,
    effortLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffortLevel: 'max',
    effortSchemaPath: 'reasoning',
  },
  {
    id: 'claude-sonnet-4.5',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic Claude Sonnet 4.5 (Kiro IDE flagship coding & reasoning)',
    maxInputTokens: 200000,
    contextFormatted: '200K',
    rateMultiplier: 3.0,
    rateUnit: 'Credit',
    supportsPromptCaching: true,
    supportsVision: true,
    isDefault: false,
    effortLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffortLevel: 'high',
    effortSchemaPath: 'reasoning',
  },
  {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    description: 'Claude Sonnet 5 (High-intelligence preview, 1M context)',
    maxInputTokens: 1000000,
    contextFormatted: '1M',
    rateMultiplier: 4.4,
    rateUnit: 'Credit',
    supportsPromptCaching: true,
    supportsVision: true,
    isDefault: false,
    effortLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffortLevel: 'high',
    effortSchemaPath: 'reasoning',
  },
  {
    id: 'claude-sonnet-5.5',
    name: 'Claude Sonnet 5.5',
    description: 'Anthropic Claude Sonnet 5.5 (Kiro IDE 5.5-gen flagship coding & general intelligence, 1M context)',
    maxInputTokens: 1000000,
    contextFormatted: '1M',
    rateMultiplier: 3.5,
    rateUnit: 'Credit',
    supportsPromptCaching: true,
    supportsVision: true,
    isDefault: false,
    effortLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffortLevel: 'high',
    effortSchemaPath: 'reasoning',
  },
  {
    id: 'kirin-inference-glm',
    name: 'Kirin Inference GLM',
    description: 'Kiro built-in Kirin GLM high-speed inference engine',
    maxInputTokens: 128000,
    contextFormatted: '128K',
    rateMultiplier: 0.2,
    rateUnit: 'Credit',
    supportsPromptCaching: false,
    supportsVision: false,
    isDefault: false,
  },
];

export async function fetchRawModelCatalog() {
  const tokenData = await getAccessToken();
  const region = regionFromArn(tokenData.profileArn);
  const endpoint = `https://management.${region}.kiro.dev`;

  const params = new URLSearchParams({ origin: 'AI_EDITOR' });
  if (tokenData.profileArn) params.set('profileArn', tokenData.profileArn);

  const headers = {
    'Authorization': `Bearer ${tokenData.accessToken}`,
    'User-Agent': `kiro-ide/${CONFIG.KIRO_VERSION} md/machineId-${os.hostname()}`,
    'Content-Type': 'application/json',
  };

  const allModels = [];
  let defaultModel = null;
  let nextToken;
  let page = 0;

  do {
    const url = new URL(`${endpoint}/listAvailableModels?${params.toString()}`);
    if (nextToken) url.searchParams.set('nextToken', nextToken);

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ListAvailableModels failed (${res.status}): ${body}`);
    }

    const data = await res.json();
    allModels.push(...(data.models || []));
    if (data.defaultModel && !defaultModel) defaultModel = data.defaultModel;
    nextToken = data.nextToken;
    page++;
  } while (nextToken && page < 5);

  return { models: allModels, defaultModel };
}

export async function getNormalizedModelList(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedCatalog && now < catalogExpiresAt) {
    return cachedCatalog;
  }

  let cloudModels = [];
  let defaultModelId = 'gpt-5.6-sol';
  let isLive = false;

  try {
    const raw = await fetchRawModelCatalog();
    isLive = true;
    if (raw.defaultModel?.modelId) defaultModelId = raw.defaultModel.modelId;
    cloudModels = raw.models.map(m => {
      const isDefault = defaultModelId === m.modelId;
      const maxInput = m.tokenLimits?.maxInputTokens || 200000;
      const is1M = maxInput >= 900000;
      const effortMeta = parseModelEffortSchema(m.additionalModelRequestFieldsSchema);

      return {
        id: m.modelId,
        name: m.modelName || m.modelId,
        description: m.description || '',
        maxInputTokens: maxInput,
        maxOutputTokens: m.tokenLimits?.maxOutputTokens || 64000,
        contextFormatted: is1M ? '1M' : `${Math.round(maxInput / 1000)}K`,
        rateMultiplier: m.rateMultiplier || 1.0,
        rateUnit: m.rateUnit || 'Credit',
        supportsPromptCaching: !!m.promptCaching?.supportsPromptCaching,
        supportsVision: Array.isArray(m.supportedInputTypes) && m.supportedInputTypes.includes('IMAGE'),
        isDefault,
        ...(effortMeta && {
          effortLevels: effortMeta.effortLevels,
          defaultEffortLevel: effortMeta.defaultEffortLevel,
          effortSchemaPath: effortMeta.schemaPath,
        }),
      };
    });
  } catch (err) {
    console.warn('[Catalog] Failed to fetch live models from Kiro, using built-in catalog:', err.message);
    cloudModels = [
      {
        id: 'gpt-5.6-sol',
        name: 'GPT 5.6 Sol',
        description: 'OpenAI GPT 5.6 Sol with 1M context window',
        maxInputTokens: 986000,
        contextFormatted: '1M',
        rateMultiplier: 4.4,
        isDefault: true,
        supportsVision: true,
        supportsPromptCaching: true,
        effortLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
        defaultEffortLevel: 'high',
        effortSchemaPath: 'reasoning',
      },
      {
        id: 'gpt-5.6-terra',
        name: 'GPT 5.6 Terra',
        description: 'OpenAI GPT 5.6 Terra with 1M context window',
        maxInputTokens: 986000,
        contextFormatted: '1M',
        rateMultiplier: 2.2,
        isDefault: false,
        supportsVision: true,
        supportsPromptCaching: true,
        effortLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
        defaultEffortLevel: 'high',
        effortSchemaPath: 'reasoning',
      },
      {
        id: 'gpt-5.6-luna',
        name: 'GPT 5.6 Luna',
        description: 'OpenAI GPT 5.6 Luna with 1M context window',
        maxInputTokens: 986000,
        contextFormatted: '1M',
        rateMultiplier: 0.88,
        isDefault: false,
        supportsVision: true,
        supportsPromptCaching: true,
        effortLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
        defaultEffortLevel: 'high',
        effortSchemaPath: 'reasoning',
      },
      {
        id: 'grok-4.7',
        name: 'Grok 4.7',
        description: 'xAI Grok 4.7 preview',
        maxInputTokens: 500000,
        contextFormatted: '500K',
        rateMultiplier: 2.7,
        isDefault: false,
        supportsVision: true,
        supportsPromptCaching: true,
        effortLevels: ['low', 'medium', 'high', 'xhigh'],
        defaultEffortLevel: 'high',
        effortSchemaPath: 'reasoning',
      },
      {
        id: 'kimi-k3',
        name: 'Kimi K3',
        description: 'Moonshot Kimi K3',
        maxInputTokens: 1000000,
        contextFormatted: '1M',
        rateMultiplier: 2.4,
        isDefault: false,
        supportsVision: true,
        supportsPromptCaching: true,
        effortLevels: ['low', 'high', 'max'],
        defaultEffortLevel: 'max',
        effortSchemaPath: 'reasoning',
      },
      {
        id: 'deepseek-3.2',
        name: 'DeepSeek v3.2',
        description: 'DeepSeek V3.2 model',
        maxInputTokens: 164000,
        contextFormatted: '164K',
        rateMultiplier: 0.25,
        isDefault: false,
        supportsVision: false,
        supportsPromptCaching: false,
      },
      {
        id: 'minimax-m2.5',
        name: 'MiniMax M2.5',
        description: 'MiniMax M2.5 model',
        maxInputTokens: 196000,
        contextFormatted: '196K',
        rateMultiplier: 0.25,
        isDefault: false,
        supportsVision: false,
        supportsPromptCaching: false,
      },
      {
        id: 'minimax-m2.1',
        name: 'MiniMax M2.1',
        description: 'MiniMax M2.1 model',
        maxInputTokens: 196000,
        contextFormatted: '196K',
        rateMultiplier: 0.15,
        isDefault: false,
        supportsVision: false,
        supportsPromptCaching: false,
      },
      {
        id: 'glm-5',
        name: 'GLM 5',
        description: 'GLM-5 model',
        maxInputTokens: 200000,
        contextFormatted: '200K',
        rateMultiplier: 0.5,
        isDefault: false,
        supportsVision: false,
        supportsPromptCaching: false,
      },
      {
        id: 'qwen3-coder-next',
        name: 'Qwen3 Coder Next',
        description: 'Qwen3 Coder Next preview',
        maxInputTokens: 256000,
        contextFormatted: '256K',
        rateMultiplier: 0.05,
        isDefault: false,
        supportsVision: false,
        supportsPromptCaching: false,
      },
    ];
  }

  // Merge cloud models with Kiro native Claude models
  const combinedMap = new Map();
  for (const m of cloudModels) {
    combinedMap.set(m.id, m);
  }
  for (const m of KIRO_NATIVE_CLAUDE_MODELS) {
    if (!combinedMap.has(m.id)) {
      combinedMap.set(m.id, m);
    }
  }

  const finalModels = Array.from(combinedMap.values()).map(m => {
    const supportsReasoning = Array.isArray(m.effortLevels) && m.effortLevels.length > 0;
    return {
      ...m,
      effortSchema: {
        supportsReasoning,
        allowedLevels: supportsReasoning ? m.effortLevels : [],
        defaultLevel: m.defaultEffortLevel || (supportsReasoning ? m.effortLevels[0] : null),
        fieldName: m.effortSchemaPath ? `${m.effortSchemaPath}.effort` : null,
      },
    };
  });

  // Alphabetical sort (A-Z) by model display name
  finalModels.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  cachedCatalog = {
    models: finalModels,
    defaultModelId,
    isLive,
    liveCloudIds: cloudModels.map(m => m.id),
    fetchedAt: new Date().toISOString(),
  };
  catalogExpiresAt = now + CATALOG_TTL;
  return cachedCatalog;
}

export async function refreshModelCatalog(forceLive = true) {
  cachedCatalog = null;
  catalogExpiresAt = 0;
  return await getNormalizedModelList(forceLive);
}
