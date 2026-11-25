import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CONFIG } from '../src/config.js';
import { checkLegacyAutoStart } from '../src/proxy/port-manager.js';

async function runFullVerification() {
  console.log('================================================================');
  console.log('  Kiro-Claude-Bridge v4 End-to-End Verification Suite');
  console.log('================================================================\n');

  const webBase = `http://127.0.0.1:${CONFIG.WEB_PORT}`;
  const proxyBase = `http://127.0.0.1:${CONFIG.PROXY_PORT}`;

  const results = {
    webOfflineHtml: false,
    apiStatus: false,
    zeroAutoStart: false,
    dynamicModelsFetched: false,
    alphabeticalOrder: false,
    claude55Trio: false,
    effortSchemaBound: false,
    dynamicRefresh: false,
    modelSettingsPersist: false,
    claudeDesktopSync: false,
    anthropicChat: false,
    openaiChatAndCount: false,
  };

  // 1. Verify Offline Web HTML & Zero CDN
  console.log(`[1/12] Verifying Offline Web Dashboard HTML (${webBase})...`);
  try {
    const htmlRes = await fetch(webBase);
    const htmlText = await htmlRes.text();
    const zeroCdn = !htmlText.includes('cdn.tailwindcss.com') && !htmlText.includes('unpkg.com');
    const hasConflictBanner = htmlText.includes('id="port-conflict-banner"');
    const hasModal = htmlText.includes('id="effort-modal"');
    if (htmlRes.status === 200 && zeroCdn && hasConflictBanner && hasModal) {
      console.log('  [OK] Web HTML loaded cleanly with Zero-CDN local styles/icons & Conflict Banner.');
      results.webOfflineHtml = true;
    }
  } catch (err) {
    console.error('  [FAIL] Web HTML check:', err.message);
  }

  // 2. Verify Status
  console.log('\n[2/12] Verifying /api/status...');
  try {
    const res = await fetch(`${webBase}/api/status`);
    const status = await res.json();
    if (status.proxy?.running && status.zeroDependency === true && status.autoStartEnabled === false) {
      console.log(`  [OK] Proxy active on :${status.proxy.port}, Auth=${status.auth?.provider}`);
      results.apiStatus = true;
    }
  } catch (err) {
    console.error('  [FAIL] /api/status:', err.message);
  }

  // 3. Verify Zero Auto-Start on OS
  console.log('\n[3/12] Verifying Zero Auto-Start Guarantee...');
  const legacyCheck = checkLegacyAutoStart();
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const startupDir = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  let ownStartupFound = false;
  if (fs.existsSync(startupDir)) {
    for (const file of fs.readdirSync(startupDir)) {
      if (/kiro-claude-bridge|kiro bridge/i.test(file)) ownStartupFound = true;
    }
  }
  if (!legacyCheck.exists && !ownStartupFound) {
    console.log('  [OK] Zero Kiro/Bridge auto-start entries in Windows Startup folder.');
    results.zeroAutoStart = true;
  } else {
    console.error(`  [FAIL] Found startup artifact: legacy=${legacyCheck.exists}, own=${ownStartupFound}`);
  }

  // 4. Verify Model Matrix dynamically (no hardcoded count!)
  console.log('\n[4/12] Verifying /api/models (Dynamic)...');
  let catalog = null;
  let models = [];
  try {
    const res = await fetch(`${webBase}/api/models`);
    catalog = await res.json();
    models = catalog.models || [];
    if (models.length >= 10 && catalog.defaultModelId) {
      console.log(`  [OK] Retrieved ${models.length} genuine models dynamically (live=${catalog.isLive}, default=${catalog.defaultModelId}).`);
      results.dynamicModelsFetched = true;
    }
  } catch (err) {
    console.error('  [FAIL] /api/models:', err.message);
  }

  // 5. Verify Strict A-Z Alphabetical Sort
  console.log('\n[5/12] Verifying Strict A-Z Sort...');
  let sorted = models.length > 0;
  for (let i = 0; i < models.length - 1; i++) {
    if (models[i].name.localeCompare(models[i + 1].name, undefined, { sensitivity: 'base' }) > 0) {
      sorted = false;
      break;
    }
  }
  if (sorted) {
    console.log(`  [OK] Strict A-Z verified (#1 ${models[0].name} ... #${models.length} ${models[models.length - 1].name})`);
    results.alphabeticalOrder = true;
  }

  // 6. Verify Claude 5.5 Trio
  console.log('\n[6/12] Verifying Genuine Claude 5.5 Trio...');
  const hasOpus = models.some((m) => m.name === 'Claude Opus 5.5');
  const hasSonnet = models.some((m) => m.name === 'Claude Sonnet 5.5');
  const hasHaiku = models.some((m) => m.name === 'Claude Haiku 5.5');
  if (hasOpus && hasSonnet && hasHaiku) {
    console.log('  [OK] Claude Opus 5.5, Claude Sonnet 5.5, Claude Haiku 5.5 all present.');
    results.claude55Trio = true;
  }

  // 7. Verify Effort Schema Binding
  console.log('\n[7/12] Verifying Effort Schema Binding...');
  const opus55 = models.find((m) => m.id === 'claude-opus-5.5');
  const haiku55 = models.find((m) => m.id === 'claude-haiku-5.5');
  const ds = models.find((m) => m.id === 'deepseek-3.2');
  if (
    opus55?.effortSchema?.supportsReasoning &&
    opus55.effortSchema.defaultLevel === 'max' &&
    haiku55?.effortSchema?.defaultLevel === 'medium' &&
    ds?.effortSchema?.supportsReasoning === false
  ) {
    console.log('  [OK] Effort schemas bound accurately per model.');
    results.effortSchemaBound = true;
  }

  // 8. Verify Dynamic Live Fetch
  console.log('\n[8/12] Verifying Live Refresh (/api/models/refresh)...');
  let refreshedCount = models.length;
  try {
    const res = await fetch(`${webBase}/api/models/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true }),
    });
    const data = await res.json();
    if (res.ok && data.success && data.modelCount === models.length) {
      refreshedCount = data.modelCount;
      console.log(`  [OK] Live refresh synced ${refreshedCount} models to Claude Desktop.`);
      results.dynamicRefresh = true;
    }
  } catch (err) {
    console.error('  [FAIL] refresh:', err.message);
  }

  // 9. Verify Model Settings Persistence (and restore clean template state afterwards)
  console.log('\n[9/12] Verifying /api/model-settings...');
  try {
    const settingsFile = path.resolve(CONFIG.PROJECT_ROOT, 'config', 'model-settings.json');
    const priorRaw = fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, 'utf8') : null;
    await fetch(`${webBase}/api/model-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelEfforts: {
          'claude-opus-5.5': 'max',
          'claude-sonnet-5.5': 'high',
          'claude-haiku-5.5': 'medium',
        },
      }),
    });
    const getRes = await fetch(`${webBase}/api/model-settings`);
    const getData = await getRes.json();
    if (getData.models?.['claude-opus-5.5']?.effort === 'max') {
      console.log('  [OK] Settings persisted cleanly.');
      results.modelSettingsPersist = true;
    }
    if (priorRaw !== null) {
      fs.writeFileSync(settingsFile, priorRaw, 'utf8');
    }
  } catch (err) {
    console.error('  [FAIL] settings:', err.message);
  }

  // 10. Verify Claude Desktop Config File
  console.log('\n[10/12] Verifying Claude Desktop Config File...');
  try {
    const content = JSON.parse(fs.readFileSync(CONFIG.PATHS.CLAUDE_DESKTOP_CONFIG, 'utf8'));
    if (
      content.inferenceModels?.length === refreshedCount &&
      content.inferenceGatewayBaseUrl === `http://127.0.0.1:${CONFIG.PROXY_PORT}`
    ) {
      console.log(`  [OK] Desktop config synced: ${refreshedCount} models -> ${content.inferenceGatewayBaseUrl}`);
      results.claudeDesktopSync = true;
    }
  } catch (err) {
    console.error('  [FAIL] Desktop config:', err.message);
  }

  // 11. Verify Anthropic End-to-End Chat (Claude Opus 5.5 dynamically routed & effort-safe)
  console.log('\n[11/12] Verifying Anthropic /v1/messages (Claude Opus 5.5)...');
  try {
    const chatRes = await fetch(`${proxyBase}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-5-5',
        max_tokens: 60,
        messages: [{ role: 'user', content: 'Reply "Opus 5.5 OK" in 3 words.' }],
        effort: 'max',
      }),
    });
    const chatData = await chatRes.json();
    if (chatRes.status === 200 && chatData.content?.[0]?.text) {
      console.log(`  [OK] Anthropic /v1/messages reply: "${chatData.content[0].text.trim()}"`);
      results.anthropicChat = true;
    } else {
      console.error('  [FAIL] Anthropic response:', chatData);
    }
  } catch (err) {
    console.error('  [FAIL] Anthropic chat:', err.message);
  }

  // 12. Verify OpenAI Chat Completions + Anthropic count_tokens
  console.log('\n[12/12] Verifying OpenAI /v1/chat/completions & /v1/messages/count_tokens...');
  try {
    const countRes = await fetch(`${proxyBase}/v1/messages/count_tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5-5',
        messages: [{ role: 'user', content: 'Count these tokens' }],
      }),
    });
    const countJson = await countRes.json();

    const openaiModel = catalog?.liveCloudIds?.[0] || 'deepseek-3.2';
    const openaiRes = await fetch(`${proxyBase}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: openaiModel,
        messages: [{ role: 'user', content: 'Reply "OpenAI OK" in 2 words.' }],
      }),
    });
    const openaiData = await openaiRes.json();
    if (
      countRes.status === 200 &&
      countJson.input_tokens > 0 &&
      openaiRes.status === 200 &&
      openaiData.choices?.[0]?.message?.content
    ) {
      console.log(`  [OK] count_tokens=${countJson.input_tokens}, OpenAI (${openaiModel}) reply="${openaiData.choices[0].message.content.trim()}"`);
      results.openaiChatAndCount = true;
    } else {
      console.error('  [FAIL] OpenAI response:', openaiData);
    }
  } catch (err) {
    console.error('  [FAIL] OpenAI/count_tokens:', err.message);
  }

  console.log('\n================================================================');
  console.log('  Verification Summary');
  console.log('================================================================');
  let passed = 0;
  for (const [k, ok] of Object.entries(results)) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'} | ${k}`);
    if (ok) passed++;
  }
  console.log(`\nScore: ${passed} / ${Object.keys(results).length} Checks Passed.`);
  if (passed !== Object.keys(results).length) {
    process.exitCode = 1;
  }
}

runFullVerification();
