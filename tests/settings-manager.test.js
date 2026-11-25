import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRequestAdditionalFields } from '../src/proxy/settings-manager.js';

test('resolveRequestAdditionalFields binds strictly to model schema and honors pass-through', () => {
  const kimiMeta = {
    id: 'kimi-k3',
    effortLevels: ['low', 'high', 'max'],
    defaultEffortLevel: 'max',
    effortSchemaPath: 'reasoning',
  };

  // Explicit legal effort pass-through
  assert.deepEqual(resolveRequestAdditionalFields(kimiMeta, { effort: 'low' }), {
    reasoning: { effort: 'low' },
  });

  // Illegal effort rejected & clamped safely to schema default/config
  const clamped = resolveRequestAdditionalFields(kimiMeta, { effort: 'invalid-extreme-mode' });
  assert.ok(['low', 'high', 'max'].includes(clamped.reasoning.effort));

  // Anthropic thinking budget mapping
  assert.deepEqual(
    resolveRequestAdditionalFields(kimiMeta, { thinking: { type: 'enabled', budget_tokens: 1024 } }),
    { reasoning: { effort: 'low' } }
  );

  // Non-reasoning model returns undefined
  const deepseekMeta = { id: 'deepseek-3.2' };
  assert.equal(resolveRequestAdditionalFields(deepseekMeta, { effort: 'max' }), undefined);

  // output_config schema path respected
  const altMeta = {
    id: 'alt-model',
    effortLevels: ['low', 'high'],
    defaultEffortLevel: 'high',
    effortSchemaPath: 'output_config',
  };
  assert.deepEqual(resolveRequestAdditionalFields(altMeta, { effort: 'low' }), {
    output_config: { effort: 'low' },
  });
});
