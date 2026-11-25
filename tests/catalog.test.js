import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseModelEffortSchema,
  getNormalizedModelList,
  KIRO_NATIVE_CLAUDE_MODELS,
} from '../src/kiro/catalog.js';

test('parseModelEffortSchema extracts reasoning and output_config enums cleanly', () => {
  const kiroSchema = {
    type: 'object',
    properties: {
      reasoning: {
        type: 'object',
        properties: {
          effort: { type: 'string', enum: ['low', 'high', 'max'], default: 'max' },
        },
      },
    },
  };
  assert.deepEqual(parseModelEffortSchema(kiroSchema), {
    schemaPath: 'reasoning',
    effortLevels: ['low', 'high', 'max'],
    defaultEffortLevel: 'max',
  });

  const altSchema = {
    type: 'object',
    properties: {
      output_config: {
        type: 'object',
        properties: {
          effort: { type: 'string', enum: ['low', 'medium', 'high'], default: 'medium' },
        },
      },
    },
  };
  assert.deepEqual(parseModelEffortSchema(altSchema), {
    schemaPath: 'output_config',
    effortLevels: ['low', 'medium', 'high'],
    defaultEffortLevel: 'medium',
  });

  assert.equal(parseModelEffortSchema(null), null);
  assert.equal(parseModelEffortSchema({ properties: {} }), null);
});

test('KIRO_NATIVE_CLAUDE_MODELS contains authentic Claude 5.5 trio and zero fabricated models', () => {
  const names = KIRO_NATIVE_CLAUDE_MODELS.map((m) => m.name);
  assert.ok(names.includes('Claude Opus 5.5'));
  assert.ok(names.includes('Claude Sonnet 5.5'));
  assert.ok(names.includes('Claude Haiku 5.5'));
  assert.equal(names.some((n) => /fable|auto/i.test(n)), false);
});

test('getNormalizedModelList adapts dynamically to Kiro IDE updates and sorts strictly A-Z', async () => {
  const catalog = await getNormalizedModelList(false);
  assert.ok(catalog.models.length >= KIRO_NATIVE_CLAUDE_MODELS.length);
  assert.ok(catalog.defaultModelId, 'Must identify an active defaultModelId');

  // Verify Claude 5.5 trio present dynamically
  const names = catalog.models.map((m) => m.name);
  assert.ok(names.includes('Claude Opus 5.5'));
  assert.ok(names.includes('Claude Sonnet 5.5'));
  assert.ok(names.includes('Claude Haiku 5.5'));

  for (let i = 0; i < catalog.models.length - 1; i++) {
    const cmp = catalog.models[i].name.localeCompare(catalog.models[i + 1].name, undefined, {
      sensitivity: 'base',
    });
    assert.ok(
      cmp <= 0,
      `Alphabetical violation: "${catalog.models[i].name}" came before "${catalog.models[i + 1].name}"`
    );
  }
});
