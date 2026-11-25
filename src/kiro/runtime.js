import crypto from 'node:crypto';
import os from 'node:os';
import { CONFIG } from '../config.js';

function parseHeaders(frame, start, length) {
  const end = start + length;
  let offset = start;
  const headers = {};

  while (offset < end) {
    const nameLength = frame.readUInt8(offset++);
    const name = frame.subarray(offset, offset + nameLength).toString('utf8');
    offset += nameLength;
    const type = frame.readUInt8(offset++);

    if (type === 7) {
      const valueLength = frame.readUInt16BE(offset);
      offset += 2;
      headers[name] = frame.subarray(offset, offset + valueLength).toString('utf8');
      offset += valueLength;
      continue;
    }
    throw new Error(`Unsupported EventStream header type: ${type}`);
  }
  return headers;
}

export async function* parseEventStream(body) {
  let pending = Buffer.alloc(0);

  for await (const chunk of body) {
    pending = Buffer.concat([pending, Buffer.from(chunk)]);
    let offset = 0;

    while (offset + 12 <= pending.length) {
      const totalLength = pending.readUInt32BE(offset);
      if (totalLength < 16) throw new Error(`Invalid event length: ${totalLength}`);
      if (offset + totalLength > pending.length) break;

      const headersLength = pending.readUInt32BE(offset + 4);
      const headersStart = offset + 12;
      const payloadStart = headersStart + headersLength;
      const payloadEnd = offset + totalLength - 4;
      if (payloadStart > payloadEnd) throw new Error('Invalid event headers length');

      const headers = parseHeaders(pending, headersStart, headersLength);
      const payloadText = pending.subarray(payloadStart, payloadEnd).toString('utf8');
      let payload = {};
      if (payloadText) {
        try {
          payload = JSON.parse(payloadText);
        } catch {
          payload = { raw: payloadText };
        }
      }

      const eventType = headers[':event-type'] || headers[':exception-type'];
      yield { type: eventType, payload, headers };
      offset += totalLength;
    }

    if (offset > 0) {
      pending = pending.subarray(offset);
    }
  }
}

function convertTools(tools) {
  if (!tools || tools.length === 0) return undefined;
  return tools
    .filter((t) => {
      const name = t.function?.name || t.name;
      return name !== 'web_search' && name !== 'websearch';
    })
    .map((t) => {
      const fn = t.function || t;
      return {
        toolSpecification: {
          name: fn.name,
          description: (fn.description?.trim() || fn.name || 'tool').slice(0, 10000),
          inputSchema: { json: fn.input_schema || fn.parameters || { type: 'object', properties: {} } },
        },
      };
    });
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b.type === 'text' || b.type === 'input_text' || b.type === 'output_text')
    .map((b) => b.text || '')
    .join('');
}

function extractToolResults(content) {
  if (!Array.isArray(content)) return [];
  return content
    .filter((b) => b.type === 'tool_result')
    .map((b) => {
      let resultContent;
      if (typeof b.content === 'string') {
        resultContent = [{ text: b.content }];
      } else if (Array.isArray(b.content)) {
        resultContent = b.content.map((c) => {
          if (typeof c === 'string') return { text: c };
          if (c.type === 'text') return { text: c.text };
          return { text: JSON.stringify(c) };
        });
      } else {
        resultContent = [{ text: '' }];
      }
      return {
        toolUseId: b.tool_use_id,
        content: resultContent,
        status: b.is_error ? 'error' : 'success',
      };
    });
}

export function buildConversationRequest(messages, { modelId, system, tools } = {}) {
  const cwTools = convertTools(tools);
  const history = [];

  const systemText =
    typeof system === 'string'
      ? system
      : Array.isArray(system)
        ? system.map((s) => s.text || '').join('\n')
        : '';

  if (systemText) {
    history.push({
      userInputMessage: { content: systemText, modelId, origin: 'AI_EDITOR' },
    });
    history.push({
      assistantResponseMessage: { content: 'I understand and will follow the instructions.' },
    });
  }

  for (const msg of messages) {
    if (msg.role === 'system' || msg.role === 'developer') {
      const text = extractText(msg.content);
      if (text) {
        history.push({ userInputMessage: { content: text, modelId, origin: 'AI_EDITOR' } });
        history.push({ assistantResponseMessage: { content: 'Understood.' } });
      }
    } else if (msg.role === 'user') {
      const text = extractText(msg.content);
      const toolResults = extractToolResults(msg.content);
      if (toolResults.length > 0) {
        history.push({
          userInputMessage: {
            content: text,
            modelId,
            origin: 'AI_EDITOR',
            userInputMessageContext: { toolResults },
          },
        });
      } else {
        history.push({
          userInputMessage: { content: text || ' ', modelId, origin: 'AI_EDITOR' },
        });
      }
    } else if (msg.role === 'tool') {
      const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
      history.push({
        userInputMessage: {
          content: '',
          modelId,
          origin: 'AI_EDITOR',
          userInputMessageContext: {
            toolResults: [
              {
                toolUseId: msg.tool_call_id || msg.tool_use_id || 'tool_call',
                content: [{ text }],
                status: 'success',
              },
            ],
          },
        },
      });
    } else if (msg.role === 'assistant') {
      const text = extractText(msg.content);
      let toolUses = [];
      if (Array.isArray(msg.content)) {
        toolUses = msg.content
          .filter((b) => b.type === 'tool_use')
          .map((b) => ({ toolUseId: b.id, name: b.name, input: b.input || {} }));
      } else if (Array.isArray(msg.tool_calls)) {
        toolUses = msg.tool_calls.map((tc) => {
          let parsedArgs = {};
          try {
            parsedArgs = typeof tc.function?.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : tc.function?.arguments || {};
          } catch {}
          return {
            toolUseId: tc.id,
            name: tc.function?.name || 'tool',
            input: parsedArgs,
          };
        });
      }

      history.push({
        assistantResponseMessage: {
          content: text || '',
          ...(toolUses.length > 0 && { toolUses }),
        },
      });
    }
  }

  // Ensure conversation ends with a user message
  if (history.length === 0 || !history[history.length - 1].userInputMessage) {
    history.push({ userInputMessage: { content: 'Continue', modelId, origin: 'AI_EDITOR' } });
  }

  const currentMessage = history[history.length - 1];
  const previousHistory = history.slice(0, -1);

  return {
    conversationState: {
      conversationId: crypto.randomUUID(),
      currentMessage,
      history: previousHistory,
      chatTriggerType: 'MANUAL',
    },
    ...(cwTools && { tools: cwTools }),
  };
}

export async function* chatStream(
  accessToken,
  { messages, system, tools, profileArn, modelId, additionalModelRequestFields, signal }
) {
  const endpoint = `${CONFIG.KIRO_RUNTIME_ENDPOINT}/generateAssistantResponse`;
  const conversationReq = buildConversationRequest(messages, { modelId, system, tools });

  const payload = {
    conversationState: conversationReq.conversationState,
    ...(conversationReq.tools && { tools: conversationReq.tools }),
    ...(profileArn && { profileArn }),
    ...(additionalModelRequestFields && { additionalModelRequestFields }),
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': `kiro-ide/${CONFIG.KIRO_VERSION} md/machineId-${os.hostname()}`,
    },
    body: JSON.stringify(payload),
    ...(signal && { signal }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(errorBody);
    } catch {}
    const msg = parsed?.message || parsed?.Message || `Kiro API Error (${res.status}): ${errorBody}`;
    throw new Error(msg);
  }

  for await (const event of parseEventStream(res.body)) {
    if (event.type === 'assistantResponseEvent') {
      if (event.payload.content) {
        yield { type: 'content', content: event.payload.content };
      }
    } else if (event.type === 'toolUseEvent') {
      let parsedInput = {};
      if (typeof event.payload.input === 'string' && event.payload.input.trim()) {
        try {
          parsedInput = JSON.parse(event.payload.input);
        } catch {
          parsedInput = { raw: event.payload.input };
        }
      } else if (event.payload.input && typeof event.payload.input === 'object') {
        parsedInput = event.payload.input;
      }
      yield {
        type: 'tool_use',
        toolUseId: event.payload.toolUseId,
        name: event.payload.name,
        input: parsedInput,
      };
    } else if (event.type === 'meteringEvent') {
      yield { type: 'metering', usage: event.payload?.usage ?? event.payload };
    }
  }
}
