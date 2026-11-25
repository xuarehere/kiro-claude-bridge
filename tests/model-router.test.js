import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveEffectiveModel,
  resolveCatalogModelMeta,
  COMPLIANT_NAME_MAP,
} from '../src/proxy/model-router.js';
import { KIRO_NATIVE_CLAUDE_MODELS } from '../src/kiro/catalog.js';

test('resolveEffectiveModel maps compliant & native models cleanly', () => {
  assert.equal(resolveEffectiveModel('gpt-5.6-sol'), 'gpt-5.6-sol');
  assert.equal(resolveEffectiveModel('claude-kiro-v32'), 'deepseek-3.2');
  assert.equal(resolveEffectiveModel('claude-kiro-coder'), 'qwen3-coder-next');
  assert.equal(resolveEffectiveModel('claude-kiro-general5'), 'glm-5');
  assert.equal(resolveEffectiveModel('claude-kiro-m25'), 'minimax-m2.5');
  assert.equal(resolveEffectiveModel('claude-kiro-m21'), 'minimax-m2.1');
});

test('resolveEffectiveModel dynamically adapts when Kiro control plane rotates active cloud models', () => {
  const simulatedLiveCatalog = {
    isLive: true,
    defaultModelId: 'deepseek-3.2',
    liveCloudIds: ['deepseek-3.2', 'minimax-m2.5', 'minimax-m2.1', 'glm-5', 'qwen3-coder-next'],
  };

  // When gpt-5.6-sol is not in liveCloudIds, Claude Opus 5.5 cleanly resolves to active default (deepseek-3.2)
  assert.equal(resolveEffectiveModel('claude-opus-5-5', simulatedLiveCatalog), 'deepseek-3.2');
  // When gpt-5.6-luna is not live, Haiku 5.5 routes to fast active model (qwen3-coder-next)
  assert.equal(resolveEffectiveModel('claude-haiku-5-5', simulatedLiveCatalog), 'qwen3-coder-next');

  // When Pro tier has gpt-5.6-sol live, it uses gpt-5.6-sol directly
  const proLiveCatalog = {
    isLive: true,
    defaultModelId: 'gpt-5.6-sol',
    liveCloudIds: ['gpt-5.6-sol', 'gpt-5.6-luna', 'deepseek-3.2'],
  };
  assert.equal(resolveEffectiveModel('claude-opus-5-5', proLiveCatalog), 'gpt-5.6-sol');
  assert.equal(resolveEffectiveModel('claude-haiku-5-5', proLiveCatalog), 'gpt-5.6-luna');
});

test('COMPLIANT_NAME_MAP bypasses Claude Desktop cEt non-anthropic filter regex', () => {
  const cEtRegex = /ark-code|astron|command-r|deepseek|doubao|gemini|gemma|glm|gpt|grok|hermes|hy3|kimi|lfm|\bling\b|llama|longcat|mimo|minimax|mistral|mixtral|moonshot|nemotron|openai|phi-|qianfan|qwen|tc-code|\bunic\b|yi-|stepfun|step-3|seed-|bytedance|hunyuan|granite|amazon\.nova|nova-|devstral|ministral|ernie|codex|arcee|trinity|abab|phi\d|\bk2\.|\bm2\.|jamba|arctic|solar|mercury|zamba|kat-coder|\bds-|dpsk/i;

  for (const [nativeId, compliantId] of Object.entries(COMPLIANT_NAME_MAP)) {
    assert.equal(
      cEtRegex.test(compliantId),
      false,
      `Compliant ID "${compliantId}" for "${nativeId}" must not trigger Claude Desktop cEt filter`
    );
    assert.ok(
      compliantId.startsWith('claude-'),
      `Compliant ID "${compliantId}" should carry claude- prefix`
    );
  }
});

test('resolveCatalogModelMeta preserves original model identity before wire fallback', () => {
  const sampleCatalog = [
    ...KIRO_NATIVE_CLAUDE_MODELS,
    { id: 'gpt-5.6-sol', name: 'GPT 5.6 Sol', effortLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] },
    { id: 'deepseek-3.2', name: 'Deepseek v3.2' },
    { id: 'kimi-k3', name: 'Kimi K3', effortLevels: ['low', 'high', 'max'] },
  ];

  const opusMeta = resolveCatalogModelMeta(sampleCatalog, 'claude-opus-5-5', 'deepseek-3.2');
  assert.equal(opusMeta?.id, 'claude-opus-5.5', 'Claude Opus 5.5 should keep its own metadata');

  const haikuMeta = resolveCatalogModelMeta(sampleCatalog, 'claude-haiku-5-5', 'qwen3-coder-next');
  assert.equal(haikuMeta?.id, 'claude-haiku-5.5', 'Claude Haiku 5.5 should keep its own 4-level effort schema');

  const kimiMeta = resolveCatalogModelMeta(sampleCatalog, 'claude-kiro-moon3', 'kimi-k3');
  assert.equal(kimiMeta?.id, 'kimi-k3');
});
