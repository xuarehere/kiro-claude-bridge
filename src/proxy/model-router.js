// src/proxy/model-router.js - Canonical live-aware model routing & cEt-compliant mapping

export const COMPLIANT_NAME_MAP = {
  'gpt-5.6-sol': 'claude-kiro-sol',
  'gpt-5.6-terra': 'claude-kiro-terra',
  'gpt-5.6-luna': 'claude-kiro-luna',
  'deepseek-3.2': 'claude-kiro-v32',
  'qwen3-coder-next': 'claude-kiro-coder',
  'glm-5': 'claude-kiro-general5',
  'minimax-m2.5': 'claude-kiro-m25',
  'minimax-m2.1': 'claude-kiro-m21',
  'grok-4.7': 'claude-kiro-xai',
  'kimi-k3': 'claude-kiro-moon3',
  'claude-opus-5.5': 'claude-opus-5-5',
  'claude-sonnet-5.5': 'claude-sonnet-5-5',
  'claude-haiku-5.5': 'claude-haiku-5-5',
  'claude-sonnet-4.5': 'claude-sonnet-4-5',
  'claude-haiku-4.5': 'claude-haiku-4-5',
  'claude-3-7-sonnet': 'claude-3-7-sonnet',
  'claude-3-5-sonnet': 'claude-3-5-sonnet',
  'claude-sonnet-5': 'claude-sonnet-5',
  'claude-opus-4-8': 'claude-opus-4-8',
  'kirin-inference-glm': 'claude-kiro-kirin',
};

const REVERSE_COMPLIANT_MAP = Object.fromEntries(
  Object.entries(COMPLIANT_NAME_MAP).map(([nativeId, compliantId]) => [compliantId.toLowerCase(), nativeId.toLowerCase()])
);

const EXACT_MAP = {
  // 1. Kiro native cloud IDs
  'gpt-5.6-sol': 'gpt-5.6-sol',
  'gpt-5.6-terra': 'gpt-5.6-terra',
  'gpt-5.6-luna': 'gpt-5.6-luna',
  'deepseek-3.2': 'deepseek-3.2',
  'qwen3-coder-next': 'qwen3-coder-next',
  'glm-5': 'glm-5',
  'minimax-m2.5': 'minimax-m2.5',
  'minimax-m2.1': 'minimax-m2.1',
  'grok-4.7': 'grok-4.7',
  'kimi-k3': 'kimi-k3',

  // 2. Claude Desktop cEt-compliant gateway IDs
  'claude-kiro-sol': 'gpt-5.6-sol',
  'claude-kiro-terra': 'gpt-5.6-terra',
  'claude-kiro-luna': 'gpt-5.6-luna',
  'claude-kiro-v32': 'deepseek-3.2',
  'claude-kiro-coder': 'qwen3-coder-next',
  'claude-kiro-general5': 'glm-5',
  'claude-kiro-m25': 'minimax-m2.5',
  'claude-kiro-m21': 'minimax-m2.1',
  'claude-kiro-xai': 'grok-4.7',
  'claude-kiro-moon3': 'kimi-k3',
  'claude-kiro-kirin': 'glm-5',

  // 3. Claude 5.5 Series
  'claude-opus-5.5': 'gpt-5.6-sol',
  'claude-opus-5-5': 'gpt-5.6-sol',
  'claude-sonnet-5.5': 'gpt-5.6-sol',
  'claude-sonnet-5-5': 'gpt-5.6-sol',
  'claude-haiku-5.5': 'gpt-5.6-luna',
  'claude-haiku-5-5': 'gpt-5.6-luna',

  // 4. Claude Other Series
  'claude-sonnet-4.5': 'gpt-5.6-sol',
  'claude-sonnet-4-5': 'gpt-5.6-sol',
  'claude-haiku-4.5': 'gpt-5.6-luna',
  'claude-haiku-4-5': 'gpt-5.6-luna',
  'claude-3-7-sonnet': 'gpt-5.6-sol',
  'claude-3-5-sonnet': 'gpt-5.6-sol',
  'claude-sonnet-5': 'gpt-5.6-sol',
  'claude-opus-4-8': 'gpt-5.6-sol',
  'kirin-inference-glm': 'glm-5',
};

function resolveStaticTarget(requestedModel) {
  if (!requestedModel) return 'gpt-5.6-sol';
  const m = String(requestedModel).trim().toLowerCase();

  if (EXACT_MAP[m]) {
    return EXACT_MAP[m];
  }

  if (m.includes('v32') || m.includes('deepseek')) return 'deepseek-3.2';
  if (m.includes('coder') || m.includes('qwen')) return 'qwen3-coder-next';
  if (m.includes('general') || m.includes('glm') || m.includes('zhipu') || m.includes('kirin')) return 'glm-5';
  if (m.includes('m25') || m.includes('minimax-m2.5') || m.includes('minimax-2.5')) return 'minimax-m2.5';
  if (m.includes('m21') || m.includes('minimax-m2.1') || m.includes('minimax-2.1')) return 'minimax-m2.1';
  if (m.includes('xai') || m.includes('grok')) return 'grok-4.7';
  if (m.includes('moon') || m.includes('kimi')) return 'kimi-k3';
  if (m.includes('terra')) return 'gpt-5.6-terra';
  if (m.includes('luna') || m.includes('haiku')) return 'gpt-5.6-luna';
  if (m.includes('opus') || m.includes('sonnet') || m.includes('sol') || m.includes('claude')) return 'gpt-5.6-sol';

  return 'gpt-5.6-sol';
}

/**
 * Resolve effective Kiro backend wire model ID.
 * When liveCatalog is provided, verifies the target is active in Kiro's live control plane
 * and transparently falls back to an active flagship/fast wire model if Kiro rotated the model out.
 */
export function resolveEffectiveModel(requestedModel, liveCatalog = null) {
  const staticTarget = resolveStaticTarget(requestedModel);

  if (!liveCatalog?.isLive || !Array.isArray(liveCatalog.liveCloudIds) || liveCatalog.liveCloudIds.length === 0) {
    return staticTarget;
  }

  const liveSet = new Set(liveCatalog.liveCloudIds);
  const reqRaw = String(requestedModel || '').trim();

  if (liveSet.has(reqRaw)) return reqRaw;
  if (liveSet.has(staticTarget)) return staticTarget;

  const mLower = reqRaw.toLowerCase();
  const isFastTier = staticTarget === 'gpt-5.6-luna' || mLower.includes('haiku') || mLower.includes('luna');

  const priorityCandidates = isFastTier
    ? ['gpt-5.6-luna', 'qwen3-coder-next', 'minimax-m2.1', liveCatalog.defaultModelId, ...liveCatalog.liveCloudIds]
    : ['gpt-5.6-sol', 'gpt-5.6-terra', liveCatalog.defaultModelId, 'deepseek-3.2', 'glm-5', 'minimax-m2.5', 'qwen3-coder-next', ...liveCatalog.liveCloudIds];

  for (const candidate of priorityCandidates) {
    if (candidate && liveSet.has(candidate)) {
      return candidate;
    }
  }

  return liveCatalog.liveCloudIds[0];
}

/**
 * Resolve catalog metadata preserving original client model identity (e.g. claude-opus-5-5 -> claude-opus-5.5)
 * before falling back to wire target model metadata.
 */
export function resolveCatalogModelMeta(catalogModels = [], requestedModel, effectiveModel) {
  const reqLower = String(requestedModel || '').trim().toLowerCase();
  const reverseNativeId = REVERSE_COMPLIANT_MAP[reqLower];
  const reqDot = reqLower.replace(/-(\d+(?:-\d+)*)$/, (_, nums) => `-${nums.replace(/-/g, '.')}`);

  return (
    catalogModels.find((m) => m.id.toLowerCase() === reqLower) ||
    (reverseNativeId && catalogModels.find((m) => m.id.toLowerCase() === reverseNativeId)) ||
    catalogModels.find((m) => m.id.toLowerCase() === reqDot) ||
    catalogModels.find((m) => m.id.toLowerCase() === String(effectiveModel || '').toLowerCase()) ||
    null
  );
}
