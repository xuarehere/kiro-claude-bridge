import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProxyApp } from '../src/proxy/server.js';
import { createHttpApp, serveStatic } from '../src/utils/http-app.js';

async function withServer(app, fn) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections?.();
    });
  }
}

test('proxy server exposes root, models, credits, count_tokens, and input validation', async () => {
  const app = createProxyApp();
  await withServer(app, async (baseUrl) => {
    const rootRes = await fetch(`${baseUrl}/`);
    assert.equal(rootRes.status, 200);
    const rootJson = await rootRes.json();
    assert.equal(rootJson.name, 'kiro-claude-bridge');

    // /claude-desktop prefix stripping
    const prefixRes = await fetch(`${baseUrl}/claude-desktop/credits`);
    assert.equal(prefixRes.status, 200);

    // /v1/models
    const modelsRes = await fetch(`${baseUrl}/v1/models`);
    assert.equal(modelsRes.status, 200);
    const modelsJson = await modelsRes.json();
    assert.ok(Array.isArray(modelsJson.data) && modelsJson.data.length >= 10);

    // POST /v1/messages/count_tokens (Claude Code CLI support)
    const countRes = await fetch(`${baseUrl}/v1/messages/count_tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5-5',
        messages: [{ role: 'user', content: 'Hello Claude Code' }],
      }),
    });
    assert.equal(countRes.status, 200);
    const countJson = await countRes.json();
    assert.ok(typeof countJson.input_tokens === 'number' && countJson.input_tokens > 0);

    // Validation on empty Anthropic & OpenAI bodies
    const badMsg = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-5-5', messages: [] }),
    });
    assert.equal(badMsg.status, 400);

    const badChat = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.6-sol', messages: [] }),
    });
    assert.equal(badChat.status, 400);

    const badResp = await fetch(`${baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.6-sol' }),
    });
    assert.equal(badResp.status, 400);
  });
});

test('http-app serveStatic prevents directory traversal attacks', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcb-static-'));
  fs.writeFileSync(path.join(tmpDir, 'ok.txt'), 'safe-content', 'utf8');

  const app = createHttpApp();
  app.use(serveStatic(tmpDir));

  try {
    await withServer(app, async (baseUrl) => {
      const okRes = await fetch(`${baseUrl}/ok.txt`);
      assert.equal(okRes.status, 200);
      assert.equal(await okRes.text(), 'safe-content');

      const traversalRes = await fetch(`${baseUrl}/../../package.json`);
      assert.equal(traversalRes.status, 404);
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
