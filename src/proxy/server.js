import crypto from 'node:crypto';
import { createHttpApp, jsonBodyParser } from '../utils/http-app.js';
import { getAccessToken, getAuthStatus } from '../kiro/auth.js';
import { chatStream } from '../kiro/runtime.js';
import { getNormalizedModelList } from '../kiro/catalog.js';
import { resolveEffectiveModel, resolveCatalogModelMeta } from './model-router.js';
import { resolveRequestAdditionalFields } from './settings-manager.js';
import { CONFIG } from '../config.js';

// In-memory logs and stats buffer for Web UI
const logs = [];
const stats = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  tokensIn: 0,
  tokensOut: 0,
  creditsUsed: 0,
  byModel: {},
  startedAt: new Date().toISOString(),
};

let serverInstance = null;
let lastProxyError = null;

export function recordLog(entry) {
  const item = {
    id: crypto.randomUUID().slice(0, 8),
    timestamp: new Date().toISOString(),
    ...entry,
  };
  logs.unshift(item);
  if (logs.length > 200) logs.pop();
  return item;
}

export function getProxyLogs() {
  return logs;
}

export function getProxyStats() {
  return stats;
}

export function getLastProxyError() {
  return lastProxyError;
}

export function estimateInputTokens(messages = [], system = null, tools = []) {
  const payloadStr = JSON.stringify({ messages, system, tools }) || '';
  return Math.max(1, Math.round(payloadStr.length / 3.5));
}

function accumulateMetering(usage) {
  if (!usage) return;
  const numeric = typeof usage === 'number' ? usage : Number(usage.credits || usage.amount || 0);
  if (Number.isFinite(numeric) && numeric > 0) {
    stats.creditsUsed = Number((stats.creditsUsed + numeric).toFixed(4));
  }
}

function setupAbortController(req, res) {
  const ac = new AbortController();
  const onClose = () => {
    if (!res.writableFinished) {
      ac.abort();
    }
  };
  res.on('close', onClose);
  return { signal: ac.signal, cleanup: () => res.off('close', onClose) };
}

function writeSseError(res, err) {
  if (!res.headersSent) {
    res.status(500).json({
      type: 'error',
      error: { type: 'api_error', message: err.message },
    });
  } else if (!res.writableEnded) {
    res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { message: err.message } })}\n\n`);
    res.end();
  }
}

export function createProxyApp() {
  const app = createHttpApp({ loopbackOnly: true, enableCors: true });

  // Strip /claude-desktop prefix if Claude Desktop routes via path prefix
  app.use((req, _res, next) => {
    if (req.url.startsWith('/claude-desktop')) {
      req.url = req.url.slice('/claude-desktop'.length) || '/';
    }
    next();
  });

  app.use(jsonBodyParser({ limitBytes: 15 * 1024 * 1024 }));

  // Reachability check for Claude Desktop Cowork
  app.get('/', (_req, res) => res.json({ status: 'ok', name: 'kiro-claude-bridge', version: '4.0.0' }));
  app.head('/', (_req, res) => res.status(200).end());

  // GET /health
  app.get('/health', (_req, res) => {
    try {
      const auth = getAuthStatus();
      res.json({
        status: auth.authenticated ? 'ok' : 'token_expired',
        provider: auth.provider,
        profileArn: auth.profileArn,
        expiresAt: auth.expiresAt,
        isExpired: auth.isExpired,
      });
    } catch (err) {
      res.status(503).json({ status: 'error', message: err.message });
    }
  });

  // GET /v1/models
  app.get('/v1/models', async (_req, res) => {
    try {
      const catalog = await getNormalizedModelList();
      res.json({
        object: 'list',
        data: catalog.models.map((m) => ({
          id: m.id,
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: 'amazon-kiro',
          name: m.name,
          description: m.description,
          is_default: m.isDefault,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  // GET /q/models
  app.get('/q/models', async (_req, res) => {
    try {
      const catalog = await getNormalizedModelList();
      res.json(catalog);
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  // GET /credits
  app.get('/credits', (_req, res) => {
    res.json({
      period: 'session',
      requests: stats.totalRequests,
      tokensIn: stats.tokensIn,
      tokensOut: stats.tokensOut,
      credits: stats.creditsUsed,
      byModel: stats.byModel,
    });
  });

  // POST /v1/messages/count_tokens (Required by Claude Code CLI)
  app.post('/v1/messages/count_tokens', (req, res) => {
    const { messages = [], system = null, tools = [] } = req.body || {};
    const inputTokens = estimateInputTokens(messages, system, tools);
    res.json({ input_tokens: inputTokens });
  });

  // Shared pre-flight resolution for Kiro calls
  async function prepareKiroCall(requestedModel, reqBody) {
    const catalog = await getNormalizedModelList();
    const effectiveModel = resolveEffectiveModel(requestedModel, catalog);
    const tokenData = await getAccessToken();

    const userPrefMeta = resolveCatalogModelMeta(catalog.models, requestedModel, effectiveModel);
    const wireModelMeta = catalog.models.find((m) => m.id === effectiveModel);

    // Only emit additionalModelRequestFields when the active Kiro wire model accepts effort schema
    let additionalModelRequestFields;
    if (wireModelMeta?.effortLevels?.length > 0) {
      const userResolved = resolveRequestAdditionalFields(userPrefMeta, reqBody);
      const userEffort = userResolved?.reasoning?.effort || userResolved?.output_config?.effort;
      const bodyWithUserEffort = userEffort ? { ...reqBody, effort: userEffort } : reqBody;
      additionalModelRequestFields = resolveRequestAdditionalFields(wireModelMeta, bodyWithUserEffort);
    }

    return {
      tokenData,
      effectiveModel,
      additionalModelRequestFields,
    };
  }

  // POST /v1/messages - Anthropic Messages API
  app.post('/v1/messages', async (req, res) => {
    const startTime = Date.now();
    const { model, messages, system, tools, stream } = req.body || {};

    if (!messages?.length) {
      return res.status(400).json({
        type: 'error',
        error: { type: 'invalid_request_error', message: 'messages required' },
      });
    }

    const inputTokens = estimateInputTokens(messages, system, tools);
    stats.totalRequests++;
    stats.tokensIn += inputTokens;

    const { signal, cleanup } = setupAbortController(req, res);
    let effectiveModel = resolveEffectiveModel(model);

    try {
      const prepared = await prepareKiroCall(model, req.body);
      effectiveModel = prepared.effectiveModel;
      const { tokenData, additionalModelRequestFields } = prepared;
      const opts = {
        messages,
        system,
        tools,
        profileArn: tokenData.profileArn,
        modelId: effectiveModel,
        signal,
        ...(additionalModelRequestFields && { additionalModelRequestFields }),
      };

      const usedModel = model || effectiveModel;

      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const msgId = `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
        let blockIndex = 0;
        let hasTextBlock = false;
        let outputTokens = 0;
        let hasToolUse = false;

        const send = (event, data) => {
          if (!res.writableEnded) {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          }
        };

        send('message_start', {
          type: 'message_start',
          message: {
            id: msgId,
            type: 'message',
            role: 'assistant',
            content: [],
            model: usedModel,
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: inputTokens, output_tokens: 0 },
          },
        });
        send('ping', { type: 'ping' });

        for await (const chunk of chatStream(tokenData.accessToken, opts)) {
          if (chunk.type === 'content') {
            if (!hasTextBlock) {
              send('content_block_start', {
                type: 'content_block_start',
                index: blockIndex,
                content_block: { type: 'text', text: '' },
              });
              hasTextBlock = true;
            }
            outputTokens += Math.max(1, Math.round(chunk.content.length / 3));
            send('content_block_delta', {
              type: 'content_block_delta',
              index: blockIndex,
              delta: { type: 'text_delta', text: chunk.content },
            });
          } else if (chunk.type === 'tool_use') {
            hasToolUse = true;
            if (hasTextBlock) {
              send('content_block_stop', { type: 'content_block_stop', index: blockIndex++ });
              hasTextBlock = false;
            }
            send('content_block_start', {
              type: 'content_block_start',
              index: blockIndex,
              content_block: { type: 'tool_use', id: chunk.toolUseId, name: chunk.name, input: {} },
            });
            send('content_block_delta', {
              type: 'content_block_delta',
              index: blockIndex,
              delta: { type: 'input_json_delta', partial_json: JSON.stringify(chunk.input) },
            });
            send('content_block_stop', { type: 'content_block_stop', index: blockIndex++ });
          } else if (chunk.type === 'metering') {
            accumulateMetering(chunk.usage);
          }
        }

        if (hasTextBlock) {
          send('content_block_stop', { type: 'content_block_stop', index: blockIndex });
        }

        send('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: hasToolUse ? 'tool_use' : 'end_turn', stop_sequence: null },
          usage: { output_tokens: outputTokens },
        });
        send('message_stop', { type: 'message_stop' });
        if (!res.writableEnded) res.end();

        stats.successfulRequests++;
        stats.tokensOut += outputTokens;
        stats.byModel[effectiveModel] = (stats.byModel[effectiveModel] || 0) + 1;

        recordLog({
          method: 'POST',
          path: '/v1/messages',
          model: usedModel,
          effectiveModel,
          status: 200,
          durationMs: Date.now() - startTime,
          stream: true,
        });
      } else {
        let textResult = '';
        const toolCalls = [];

        for await (const chunk of chatStream(tokenData.accessToken, opts)) {
          if (chunk.type === 'content') textResult += chunk.content;
          else if (chunk.type === 'tool_use') toolCalls.push(chunk);
          else if (chunk.type === 'metering') accumulateMetering(chunk.usage);
        }

        const content = [];
        if (textResult) content.push({ type: 'text', text: textResult });
        for (const tc of toolCalls) {
          content.push({ type: 'tool_use', id: tc.toolUseId, name: tc.name, input: tc.input });
        }

        const outputTokens = Math.max(1, Math.round(textResult.length / 3));
        stats.successfulRequests++;
        stats.tokensOut += outputTokens;
        stats.byModel[effectiveModel] = (stats.byModel[effectiveModel] || 0) + 1;

        recordLog({
          method: 'POST',
          path: '/v1/messages',
          model: usedModel,
          effectiveModel,
          status: 200,
          durationMs: Date.now() - startTime,
          stream: false,
        });

        res.json({
          id: `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`,
          type: 'message',
          role: 'assistant',
          content,
          model: usedModel,
          stop_reason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        });
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      stats.failedRequests++;
      const durationMs = Date.now() - startTime;
      recordLog({
        method: 'POST',
        path: '/v1/messages',
        model: model || effectiveModel,
        effectiveModel,
        status: 500,
        durationMs,
        error: err.message,
      });
      console.error(`[Proxy] /v1/messages failed (${durationMs}ms):`, err.message);
      writeSseError(res, err);
    } finally {
      cleanup();
    }
  });

  // POST /v1/chat/completions - OpenAI Chat Completions compatible (Full kiro-proxy replacement)
  app.post('/v1/chat/completions', async (req, res) => {
    const startTime = Date.now();
    const { model, messages, tools, stream } = req.body || {};

    if (!messages?.length) {
      return res.status(400).json({ error: { message: 'messages required', type: 'invalid_request_error' } });
    }

    let effectiveModel = resolveEffectiveModel(model);
    const usedModel = model || effectiveModel;
    const inputTokens = estimateInputTokens(messages, null, tools);
    stats.totalRequests++;
    stats.tokensIn += inputTokens;

    const { signal, cleanup } = setupAbortController(req, res);

    try {
      const prepared = await prepareKiroCall(model, req.body);
      effectiveModel = prepared.effectiveModel;
      const { tokenData, additionalModelRequestFields } = prepared;
      const opts = {
        messages,
        tools,
        profileArn: tokenData.profileArn,
        modelId: effectiveModel,
        signal,
        ...(additionalModelRequestFields && { additionalModelRequestFields }),
      };

      const completionId = `chatcmpl-${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
      const created = Math.floor(Date.now() / 1000);

      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        let outputTokens = 0;
        let toolIndex = 0;
        let hasToolCalls = false;

        res.write(`data: ${JSON.stringify({
          id: completionId,
          object: 'chat.completion.chunk',
          created,
          model: usedModel,
          choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
        })}\n\n`);

        for await (const chunk of chatStream(tokenData.accessToken, opts)) {
          if (chunk.type === 'content') {
            outputTokens += Math.max(1, Math.round(chunk.content.length / 3));
            res.write(`data: ${JSON.stringify({
              id: completionId,
              object: 'chat.completion.chunk',
              created,
              model: usedModel,
              choices: [{ index: 0, delta: { content: chunk.content }, finish_reason: null }],
            })}\n\n`);
          } else if (chunk.type === 'tool_use') {
            hasToolCalls = true;
            res.write(`data: ${JSON.stringify({
              id: completionId,
              object: 'chat.completion.chunk',
              created,
              model: usedModel,
              choices: [{
                index: 0,
                delta: {
                  tool_calls: [{
                    index: toolIndex++,
                    id: chunk.toolUseId,
                    type: 'function',
                    function: { name: chunk.name, arguments: JSON.stringify(chunk.input || {}) },
                  }],
                },
                finish_reason: null,
              }],
            })}\n\n`);
          } else if (chunk.type === 'metering') {
            accumulateMetering(chunk.usage);
          }
        }

        res.write(`data: ${JSON.stringify({
          id: completionId,
          object: 'chat.completion.chunk',
          created,
          model: usedModel,
          choices: [{ index: 0, delta: {}, finish_reason: hasToolCalls ? 'tool_calls' : 'stop' }],
        })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();

        stats.successfulRequests++;
        stats.tokensOut += outputTokens;
        stats.byModel[effectiveModel] = (stats.byModel[effectiveModel] || 0) + 1;
        recordLog({ method: 'POST', path: '/v1/chat/completions', model: usedModel, effectiveModel, status: 200, durationMs: Date.now() - startTime, stream: true });
      } else {
        let content = '';
        const toolCalls = [];

        for await (const chunk of chatStream(tokenData.accessToken, opts)) {
          if (chunk.type === 'content') content += chunk.content;
          else if (chunk.type === 'tool_use') {
            toolCalls.push({
              id: chunk.toolUseId,
              type: 'function',
              function: { name: chunk.name, arguments: JSON.stringify(chunk.input || {}) },
            });
          } else if (chunk.type === 'metering') {
            accumulateMetering(chunk.usage);
          }
        }

        const outputTokens = Math.max(1, Math.round(content.length / 3));
        stats.successfulRequests++;
        stats.tokensOut += outputTokens;
        stats.byModel[effectiveModel] = (stats.byModel[effectiveModel] || 0) + 1;
        recordLog({ method: 'POST', path: '/v1/chat/completions', model: usedModel, effectiveModel, status: 200, durationMs: Date.now() - startTime, stream: false });

        res.json({
          id: completionId,
          object: 'chat.completion',
          created,
          model: usedModel,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: content || null,
              ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
            },
            finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
          }],
          usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
        });
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      stats.failedRequests++;
      const durationMs = Date.now() - startTime;
      recordLog({ method: 'POST', path: '/v1/chat/completions', model: usedModel, effectiveModel, status: 500, durationMs, error: err.message });
      if (!res.headersSent) {
        res.status(500).json({ error: { message: err.message, type: 'api_error' } });
      } else if (!res.writableEnded) {
        res.end();
      }
    } finally {
      cleanup();
    }
  });

  // POST /v1/responses - OpenAI Responses API compatible
  app.post('/v1/responses', async (req, res) => {
    const startTime = Date.now();
    const { model, input, instructions, tools, stream } = req.body || {};

    const normalizedMessages = [];
    if (typeof input === 'string') {
      normalizedMessages.push({ role: 'user', content: input });
    } else if (Array.isArray(input)) {
      for (const item of input) {
        if (item.role && item.content !== undefined) {
          normalizedMessages.push({ role: item.role, content: item.content });
        } else if (item.type === 'message') {
          normalizedMessages.push({ role: item.role || 'user', content: item.content || '' });
        }
      }
    }

    if (normalizedMessages.length === 0) {
      return res.status(400).json({ error: { message: 'input required', type: 'invalid_request_error' } });
    }

    let effectiveModel = resolveEffectiveModel(model);
    const usedModel = model || effectiveModel;
    const inputTokens = estimateInputTokens(normalizedMessages, instructions, tools);
    stats.totalRequests++;
    stats.tokensIn += inputTokens;

    const { signal, cleanup } = setupAbortController(req, res);

    try {
      const prepared = await prepareKiroCall(model, req.body);
      effectiveModel = prepared.effectiveModel;
      const { tokenData, additionalModelRequestFields } = prepared;
      const opts = {
        messages: normalizedMessages,
        system: instructions,
        tools,
        profileArn: tokenData.profileArn,
        modelId: effectiveModel,
        signal,
        ...(additionalModelRequestFields && { additionalModelRequestFields }),
      };

      const respId = `resp_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
      const msgId = `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        let fullText = '';
        res.write(`event: response.created\ndata: ${JSON.stringify({ type: 'response.created', response: { id: respId, object: 'response', status: 'in_progress', model: usedModel } })}\n\n`);

        for await (const chunk of chatStream(tokenData.accessToken, opts)) {
          if (chunk.type === 'content') {
            fullText += chunk.content;
            res.write(`event: response.output_text.delta\ndata: ${JSON.stringify({ type: 'response.output_text.delta', item_id: msgId, output_index: 0, content_index: 0, delta: chunk.content })}\n\n`);
          } else if (chunk.type === 'metering') {
            accumulateMetering(chunk.usage);
          }
        }

        const outputTokens = Math.max(1, Math.round(fullText.length / 3));
        res.write(`event: response.completed\ndata: ${JSON.stringify({
          type: 'response.completed',
          response: {
            id: respId,
            object: 'response',
            status: 'completed',
            model: usedModel,
            output_text: fullText,
            usage: { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
          },
        })}\n\n`);
        res.end();

        stats.successfulRequests++;
        stats.tokensOut += outputTokens;
        stats.byModel[effectiveModel] = (stats.byModel[effectiveModel] || 0) + 1;
        recordLog({ method: 'POST', path: '/v1/responses', model: usedModel, effectiveModel, status: 200, durationMs: Date.now() - startTime, stream: true });
      } else {
        let fullText = '';
        for await (const chunk of chatStream(tokenData.accessToken, opts)) {
          if (chunk.type === 'content') fullText += chunk.content;
          else if (chunk.type === 'metering') accumulateMetering(chunk.usage);
        }

        const outputTokens = Math.max(1, Math.round(fullText.length / 3));
        stats.successfulRequests++;
        stats.tokensOut += outputTokens;
        stats.byModel[effectiveModel] = (stats.byModel[effectiveModel] || 0) + 1;
        recordLog({ method: 'POST', path: '/v1/responses', model: usedModel, effectiveModel, status: 200, durationMs: Date.now() - startTime, stream: false });

        res.json({
          id: respId,
          object: 'response',
          status: 'completed',
          model: usedModel,
          output_text: fullText,
          output: [{
            id: msgId,
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: fullText }],
          }],
          usage: { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
        });
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      stats.failedRequests++;
      const durationMs = Date.now() - startTime;
      recordLog({ method: 'POST', path: '/v1/responses', model: usedModel, effectiveModel, status: 500, durationMs, error: err.message });
      writeSseError(res, err);
    } finally {
      cleanup();
    }
  });

  return app;
}

export function startProxyServer(port = CONFIG.PROXY_PORT) {
  if (serverInstance) return Promise.resolve(serverInstance);

  return new Promise((resolve, reject) => {
    const app = createProxyApp();
    let settled = false;
    const candidate = app.listen(port);

    candidate.once('error', (err) => {
      lastProxyError = {
        code: err.code || 'LISTEN_ERROR',
        message: err.message,
        port,
        timestamp: new Date().toISOString(),
      };
      serverInstance = null;
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    candidate.once('listening', () => {
      serverInstance = candidate;
      lastProxyError = null;
      settled = true;
      console.log(`[Proxy] Kiro Proxy Server listening on http://127.0.0.1:${port}`);
      candidate.on('error', (runtimeErr) => {
        console.error('[Proxy] Runtime server error:', runtimeErr.message);
        lastProxyError = {
          code: runtimeErr.code || 'RUNTIME_ERROR',
          message: runtimeErr.message,
          port,
          timestamp: new Date().toISOString(),
        };
      });
      resolve(serverInstance);
    });
  });
}

export function stopProxyServer() {
  if (!serverInstance) return Promise.resolve();

  const closing = serverInstance;
  serverInstance = null;

  return new Promise((resolve) => {
    closing.close(() => {
      console.log('[Proxy] Kiro Proxy Server stopped');
      resolve();
    });
    // Release persistent HTTP/1.1 Keep-Alive sockets immediately
    if (typeof closing.closeAllConnections === 'function') {
      closing.closeAllConnections();
    }
  });
}

export function isProxyRunning() {
  return !!(serverInstance && serverInstance.listening);
}
