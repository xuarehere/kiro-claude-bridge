// Kiro-Claude-Bridge Frontend Application Logic (Zero-Dependency ES Module)

let cachedModels = [];
let cachedSettings = { models: {}, modelEfforts: {}, defaultEffort: 'high' };
let lastStatusData = null;

function renderIcons() {
  if (typeof window.renderInlineIcons === 'function') {
    window.renderInlineIcons();
  }
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  const cls = type === 'success' ? 'toast-success' : type === 'error' ? 'toast-error' : 'toast-info';

  toast.className = `toast-item ${cls} toast-enter`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('toast-enter');
  });

  setTimeout(() => {
    toast.classList.add('toast-enter');
    setTimeout(() => toast.remove(), 260);
  }, 4500);
}

function updateConflictBanner(proxyInfo) {
  const banner = document.getElementById('port-conflict-banner');
  if (!banner) return;

  const conflict = proxyInfo?.conflict;
  if (proxyInfo?.running || !conflict?.occupied) {
    banner.classList.add('hidden');
    return;
  }

  banner.classList.remove('hidden');

  const proc = conflict.primary || {};
  const titleEl = document.getElementById('conflict-title');
  const descEl = document.getElementById('conflict-desc');
  const metaEl = document.getElementById('conflict-process-meta');
  const legacyBox = document.getElementById('legacy-autostart-box');
  const switchBtnText = document.getElementById('btn-switch-port-text');

  if (conflict.hasLegacyKiroProxy) {
    titleEl.textContent = `端口 ${conflict.port} 正被旧版 @colin3191/kiro-proxy 占用，导致代理无法启动`;
    descEl.textContent = '检测到遗留工具仍在后台运行。本工具已完全独立，无需任何外部代理包；您可一键接管端口或切换备用端口。';
  } else {
    titleEl.textContent = `端口 ${conflict.port} 已被其他进程占用 (PID ${proc.pid || '未知'})`;
    descEl.textContent = '由于代理端口被占用，本地反代未就绪。您可一键终止占用进程接管端口，或切换至可用端口。';
  }

  metaEl.textContent = `占用进程: PID=${proc.pid || '?'} | 名称=${proc.name || 'unknown'} | 命令行=${proc.commandLine || 'N/A'}`;

  if (proxyInfo.legacyAutostart?.exists && legacyBox) {
    legacyBox.classList.remove('hidden');
  } else if (legacyBox) {
    legacyBox.classList.add('hidden');
  }

  const suggested = conflict.suggestedFreePort || proxyInfo.port + 2;
  if (switchBtnText) {
    switchBtnText.textContent = `切换至空闲端口 (${suggested}) 并同步配置`;
  }
  const switchBtn = document.getElementById('btn-switch-free-port');
  if (switchBtn) {
    switchBtn.setAttribute('data-free-port', String(suggested));
  }
}

// 1. Fetch & Render Status
async function refreshStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    lastStatusData = data;

    const proxyRunning = !!data.proxy?.running;
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('proxy-status-text');
    const btnToggleText = document.getElementById('btn-toggle-text');
    const statProxy = document.getElementById('stat-proxy-status');

    if (proxyRunning) {
      if (dot) dot.className = 'dot dot-green';
      if (text) text.textContent = `代理运行中 (端口: ${data.proxy.port})`;
      if (btnToggleText) btnToggleText.textContent = '停止代理';
      if (statProxy) {
        statProxy.textContent = '运行中 (Active)';
        statProxy.className = 'stat-value text-emerald';
      }
    } else {
      if (dot) dot.className = 'dot dot-red';
      const hasConflict = !!data.proxy?.conflict?.occupied;
      if (text) text.textContent = hasConflict ? `端口 ${data.proxy.port} 被占用` : '代理已停止';
      if (btnToggleText) btnToggleText.textContent = '启动代理';
      if (statProxy) {
        statProxy.textContent = hasConflict ? '端口冲突 (已停止)' : '已停止 (Stopped)';
        statProxy.className = 'stat-value text-rose';
      }
    }

    updateConflictBanner(data.proxy);

    const portEl = document.getElementById('stat-proxy-port');
    if (portEl) portEl.textContent = `API: http://127.0.0.1:${data.proxy.port}`;

    if (data.auth) {
      const authProvider = document.getElementById('stat-auth-provider');
      if (authProvider) {
        authProvider.textContent = data.auth.authenticated
          ? `${data.auth.provider || 'Social'} (${data.auth.authMethod || 'Google'})`
          : '未登录 Kiro IDE';
        authProvider.className = data.auth.authenticated ? 'stat-value text-emerald' : 'stat-value text-amber';
      }
      const expDate = data.auth.expiresAt ? new Date(data.auth.expiresAt).toLocaleTimeString() : 'N/A';
      const authExpiry = document.getElementById('stat-auth-expiry');
      if (authExpiry) {
        authExpiry.textContent = data.auth.expiresAt ? `到期: ${expDate} (支持自动续期)` : (data.auth.message || '请先登录 Kiro');
      }
    }

    if (data.integration?.claudeDesktop) {
      const cd = data.integration.claudeDesktop;
      const deskStatus = document.getElementById('stat-desktop-status');
      if (deskStatus) {
        deskStatus.textContent = cd.configured ? '已接入 Kiro' : '未接入';
        deskStatus.className = cd.configured ? 'stat-value text-sky' : 'stat-value text-slate-400';
      }
      const deskModels = document.getElementById('stat-desktop-models');
      if (deskModels) deskModels.textContent = `已载入 ${cd.modelCount} 款可用模型`;
    }

    if (data.stats) {
      const reqEl = document.getElementById('stat-total-requests');
      if (reqEl) reqEl.textContent = `${data.stats.totalRequests || 0} 次请求`;
      const tokEl = document.getElementById('stat-tokens');
      if (tokEl) tokEl.textContent = `Tokens 输入/输出: ${data.stats.tokensIn || 0} / ${data.stats.tokensOut || 0}`;
    }

    const footerInfo = document.getElementById('footer-runtime-info');
    if (footerInfo && data.nodeVersion) {
      footerInfo.textContent = `MIT License · Node ${data.nodeVersion} · Anthropic + OpenAI Compatible`;
    }
  } catch (err) {
    console.error('Status query error:', err);
  }
}

async function loadSettings() {
  try {
    const res = await fetch('/api/model-settings');
    if (res.ok) {
      cachedSettings = await res.json();
    }
  } catch (err) {
    console.warn('Failed to load settings:', err);
  }
}

function getConfiguredEffort(model) {
  return (
    cachedSettings.models?.[model.id]?.effort ||
    cachedSettings.models?.[model.id.replace(/\./g, '-')]?.effort ||
    cachedSettings.modelEfforts?.[model.id] ||
    model.effortSchema?.defaultLevel ||
    'medium'
  );
}

// 2. Load & Render Model Matrix
async function loadModels(force = false) {
  const container = document.getElementById('models-grid');
  const countBadge = document.getElementById('model-count-badge');
  const playgroundSelect = document.getElementById('playground-model');

  try {
    await loadSettings();
    const res = await fetch(`/api/models?force=${force}`);
    const data = await res.json();
    const models = data.models || [];
    cachedModels = models;

    if (models.length === 0) {
      if (container) container.innerHTML = '<div class="text-slate-500">未能获取到可用模型列表</div>';
      if (countBadge) countBadge.textContent = '0 款';
      return;
    }

    if (countBadge) countBadge.textContent = `已载入 ${models.length} 款模型`;

    if (playgroundSelect) {
      const prev = playgroundSelect.value;
      playgroundSelect.innerHTML = models
        .map((m, idx) => {
          const selected = prev ? m.id === prev : m.isDefault;
          return `<option value="${m.id}" ${selected ? 'selected' : ''}>#${idx + 1} ${m.name} (${m.contextFormatted}) - ${m.rateMultiplier}x</option>`;
        })
        .join('');
      updatePlaygroundEffort();
    }

    if (container) {
      container.innerHTML = models
        .map((m, idx) => {
          const defaultBadge = m.isDefault ? '<span class="tag tag-amber">默认旗舰</span>' : '';
          const contextBadge =
            m.contextFormatted === '1M'
              ? '<span class="tag tag-purple font-mono">1M 上下文</span>'
              : `<span class="tag tag-slate font-mono">${m.contextFormatted}</span>`;
          const cacheBadge = m.supportsPromptCaching ? '<span class="tag tag-emerald-soft">缓存</span>' : '';
          const visionBadge = m.supportsVision ? '<span class="tag tag-sky-soft">视觉</span>' : '';

          const effortBadge = m.effortSchema?.supportsReasoning
            ? `<button class="effort-trigger-btn btn-effort-trigger font-mono" data-model-id="${m.id}" title="点击自定义此模型的思考强度">
                 <i data-lucide="sliders"></i>
                 <span>Effort: ${getConfiguredEffort(m)}</span>
               </button>`
            : '<span class="tag tag-disabled">无推理控制</span>';

          return `
            <div class="model-card">
              <div>
                <div class="model-top">
                  <div class="model-name-wrap">
                    <span class="model-idx font-mono">#${idx + 1}</span>
                    <span class="model-name truncate" title="${m.name}">${m.name}</span>
                  </div>
                  <div class="model-badges">${defaultBadge}${contextBadge}</div>
                </div>
                <p class="model-desc">${m.description || 'Kiro Runtime AI 模型'}</p>
              </div>
              <div style="display:flex; flex-direction:column; gap:0.5rem;">
                <div class="model-effort-row">
                  <span>思考推理:</span>
                  <div>${effortBadge}</div>
                </div>
                <div class="model-bottom font-mono">
                  <span>倍率: ${m.rateMultiplier}x</span>
                  <div style="display:flex; align-items:center; gap:0.3rem;">
                    ${cacheBadge}${visionBadge}
                    <span class="truncate" style="max-width:6rem;">${m.id}</span>
                  </div>
                </div>
              </div>
            </div>
          `;
        })
        .join('');

      container.querySelectorAll('.btn-effort-trigger').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          openEffortModal(btn.getAttribute('data-model-id'));
        });
      });
    }

    renderIcons();
  } catch (err) {
    if (container) container.innerHTML = `<div class="text-rose">加载模型矩阵失败: ${err.message}</div>`;
    if (countBadge) countBadge.textContent = '加载失败';
  }
}

function updatePlaygroundEffort() {
  const modelSelect = document.getElementById('playground-model');
  const effortSelect = document.getElementById('playground-effort');
  const hintEl = document.getElementById('playground-effort-hint');
  if (!modelSelect || !effortSelect) return;

  const model = cachedModels.find((m) => m.id === modelSelect.value);
  if (model?.effortSchema?.supportsReasoning) {
    const levels = model.effortSchema.allowedLevels || ['low', 'medium', 'high'];
    const currentEffort = getConfiguredEffort(model);

    effortSelect.disabled = false;
    effortSelect.innerHTML = levels
      .map(
        (lvl) =>
          `<option value="${lvl}" ${lvl === currentEffort ? 'selected' : ''}>${lvl.toUpperCase()} ${
            lvl === model.effortSchema.defaultLevel ? '(默认)' : ''
          }</option>`
      )
      .join('');
    if (hintEl) hintEl.textContent = `支持 ${levels.length} 级: [${levels.join(', ')}]`;
  } else {
    effortSelect.disabled = true;
    effortSelect.innerHTML = '<option value="">无推理控制 (不支持思考调节)</option>';
    if (hintEl) hintEl.textContent = '该模型不具备可调推理 Schema';
  }
}

function openEffortModal(highlightModelId = null) {
  const modal = document.getElementById('effort-modal');
  const list = document.getElementById('effort-modal-list');
  if (!modal || !list) return;

  list.innerHTML = cachedModels
    .map((m, idx) => {
      const isReasoning = m.effortSchema?.supportsReasoning;
      if (!isReasoning) {
        return `
          <div class="effort-row-card opacity-50">
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <span class="font-mono text-slate-500" style="font-size:0.75rem;">#${idx + 1}</span>
              <span style="font-weight:600; font-size:0.85rem; color:#94a3b8;">${m.name}</span>
              <span class="font-mono text-slate-500" style="font-size:0.68rem;">${m.id}</span>
            </div>
            <span class="font-mono text-slate-500" style="font-size:0.72rem;">固定/不支持推理控制</span>
          </div>
        `;
      }

      const levels = m.effortSchema.allowedLevels;
      const currentVal = getConfiguredEffort(m);
      const isTarget = highlightModelId === m.id;

      return `
        <div id="effort-row-${m.id}" class="effort-row-card ${isTarget ? 'effort-row-target' : ''}">
          <div>
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <span class="font-mono text-purple" style="font-size:0.75rem;">#${idx + 1}</span>
              <span style="font-weight:700; font-size:0.875rem; color:#fff;">${m.name}</span>
              <span class="tag tag-slate font-mono">${m.contextFormatted}</span>
            </div>
            <div class="text-slate-400" style="font-size:0.7rem; margin-top:0.2rem;">
              Schema 字段: <span class="font-mono text-slate-300">${m.effortSchema.fieldName || 'reasoning.effort'}</span>
              · 默认: <span class="font-mono text-purple">${m.effortSchema.defaultLevel}</span>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:0.5rem;">
            <select data-model-id="${m.id}" class="modal-effort-select field-input font-mono" style="width:auto; padding:0.35rem 0.6rem; font-size:0.75rem;">
              ${levels
                .map(
                  (lvl) =>
                    `<option value="${lvl}" ${lvl === currentVal ? 'selected' : ''}>${lvl.toUpperCase()} ${
                      lvl === m.effortSchema.defaultLevel ? '(默认)' : ''
                    }</option>`
                )
                .join('')}
            </select>
            <button type="button" class="btn btn-slate btn-sm btn-reset-single-effort" data-model-id="${m.id}" data-default-val="${m.effortSchema.defaultLevel}">重置</button>
          </div>
        </div>
      `;
    })
    .join('');

  list.querySelectorAll('.btn-reset-single-effort').forEach((btn) => {
    btn.addEventListener('click', () => {
      const modelId = btn.getAttribute('data-model-id');
      const select = list.querySelector(`.modal-effort-select[data-model-id="${modelId}"]`);
      if (select) select.value = btn.getAttribute('data-default-val');
    });
  });

  modal.classList.remove('hidden');
  requestAnimationFrame(() => modal.classList.remove('opacity-0'));

  if (highlightModelId) {
    setTimeout(() => {
      document.getElementById(`effort-row-${highlightModelId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
  }
  renderIcons();
}

function closeEffortModal() {
  const modal = document.getElementById('effort-modal');
  if (!modal) return;
  modal.classList.add('opacity-0');
  setTimeout(() => modal.classList.add('hidden'), 200);
}

async function saveEffortSettings() {
  const list = document.getElementById('effort-modal-list');
  if (!list) return;

  const modelEfforts = {};
  list.querySelectorAll('.modal-effort-select').forEach((sel) => {
    const modelId = sel.getAttribute('data-model-id');
    if (modelId && sel.value) modelEfforts[modelId] = sel.value;
  });

  try {
    const res = await fetch('/api/model-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelEfforts }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      showToast(`保存失败: ${data.error || `HTTP ${res.status}`}`, 'error');
      return;
    }
    cachedSettings = data.settings;
    showToast('🎉 模型思考强度 (Effort) 配置已保存！', 'success');
    closeEffortModal();
    loadModels(false);
  } catch (err) {
    showToast(`保存异常: ${err.message}`, 'error');
  }
}

async function refreshLogs() {
  const container = document.getElementById('logs-container');
  if (!container) return;
  try {
    const res = await fetch('/api/logs');
    const logs = await res.json();
    if (!logs?.length) {
      container.innerHTML = '<div class="text-slate-500" style="font-size:0.75rem;">暂无转发日志，发送请求后将实时呈现...</div>';
      return;
    }
    container.innerHTML = logs
      .map((l) => {
        const statusCls = l.status === 200 ? 'text-emerald' : 'text-rose';
        const time = new Date(l.timestamp).toLocaleTimeString();
        return `
          <div class="log-row">
            <div style="display:flex; align-items:center; gap:0.5rem; min-width:0;">
              <span class="text-slate-500">${time}</span>
              <span class="text-sky" style="font-weight:700;">${l.method}</span>
              <span class="text-slate-300 truncate" style="max-width:9rem;">${l.path || ''} ${l.model || ''}</span>
            </div>
            <div style="display:flex; align-items:center; gap:0.65rem; flex-shrink:0;">
              <span class="${statusCls}" style="font-weight:700;">${l.status}</span>
              <span class="text-slate-400">${l.durationMs}ms</span>
            </div>
          </div>
        `;
      })
      .join('');
  } catch {}
}

async function startProxyWithOptions(payload = {}) {
  try {
    const res = await fetch('/api/start-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      showToast(`启动代理失败: ${data.error || `HTTP ${res.status}`}`, 'error');
      await refreshStatus();
      return false;
    }
    const extra = data.autostartRemoved?.removed ? '，并已清理旧版开机自启项' : '';
    showToast(`✅ 代理已在端口 ${data.port} 成功启动${extra}！`, 'success');
    await refreshStatus();
    return true;
  } catch (err) {
    showToast(`启动代理异常: ${err.message}`, 'error');
    return false;
  }
}

function setupEvents() {
  document.getElementById('btn-live-fetch')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-live-fetch');
    btn.disabled = true;
    showToast('🔄 正在从 Kiro IDE 实时拉取最新模型...', 'info');
    try {
      const res = await fetch('/api/models/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(`拉取失败: ${data.error || `HTTP ${res.status}`}`, 'error');
      } else {
        showToast(`🎉 成功刷新 ${data.modelCount} 款模型并同步至 Claude Desktop！`, 'success');
        await loadModels(true);
        refreshStatus();
      }
    } catch (err) {
      showToast(`请求异常: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('btn-open-effort-modal')?.addEventListener('click', () => openEffortModal());
  document.getElementById('btn-close-effort-modal')?.addEventListener('click', closeEffortModal);
  document.getElementById('btn-cancel-effort')?.addEventListener('click', closeEffortModal);
  document.getElementById('btn-save-effort')?.addEventListener('click', saveEffortSettings);

  document.getElementById('btn-takeover-port')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-takeover-port');
    btn.disabled = true;
    const disableLegacyAutostart = !!document.getElementById('chk-disable-legacy-autostart')?.checked;
    showToast('正在释放占用进程并启动代理...', 'info');
    await startProxyWithOptions({ takeover: true, disableLegacyAutostart });
    btn.disabled = false;
  });

  document.getElementById('btn-switch-free-port')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-switch-free-port');
    const port = Number(btn.getAttribute('data-free-port') || 3458);
    btn.disabled = true;
    showToast(`正在切换代理端口至 ${port} 并同步客户端配置...`, 'info');
    await startProxyWithOptions({ port });
    btn.disabled = false;
  });

  document.getElementById('btn-create-shortcuts')?.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/create-shortcuts', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`✅ 已生成可选桌面快捷方式: ${data.created.join(', ')}`, 'success');
      } else {
        showToast(`提示: ${data.reason || data.error || '当前系统不支持'}`, 'error');
      }
    } catch (err) {
      showToast(`生成失败: ${err.message}`, 'error');
    }
  });

  document.getElementById('btn-switch-kiro')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-switch-kiro');
    btn.disabled = true;
    showToast('正在执行全量切换 (Desktop UI + Code + CC Switch)...', 'info');
    try {
      const res = await fetch('/api/switch-kiro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const count = data.desktop?.modelCount || '全量';
        showToast(`🎉 成功接入 Kiro 模式！全部 ${count} 款模型已同步至 Claude Desktop！`, 'success');
        refreshStatus();
        loadModels(true);
      } else {
        showToast(`切换失败: ${data.error || `HTTP ${res.status}`}`, 'error');
        refreshStatus();
      }
    } catch (err) {
      showToast(`请求异常: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('btn-restore-original')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-restore-original');
    btn.disabled = true;
    showToast('正在还原配置并停止代理...', 'info');
    try {
      const res = await fetch('/api/restore-original', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('✨ 已彻底还原初始配置，代理已安全停止！', 'success');
        refreshStatus();
      } else {
        showToast(`还原失败: ${data.error || `HTTP ${res.status}`}`, 'error');
      }
    } catch (err) {
      showToast(`请求异常: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('btn-sync-models')?.addEventListener('click', async () => {
    showToast('正在向 Claude Desktop 注入全量模型 (严格 A-Z 排序)...', 'info');
    try {
      const res = await fetch('/api/sync-models', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`✅ 已成功将 ${data.modelCount} 款模型全量注册到 Claude Desktop！`, 'success');
        refreshStatus();
      } else {
        showToast(`同步失败: ${data.error || `HTTP ${res.status}`}`, 'error');
      }
    } catch (err) {
      showToast(`同步异常: ${err.message}`, 'error');
    }
  });

  document.getElementById('btn-toggle-proxy')?.addEventListener('click', async () => {
    const text = document.getElementById('btn-toggle-text')?.textContent || '';
    if (text.includes('启动')) {
      await startProxyWithOptions({});
      return;
    }
    try {
      const res = await fetch('/api/stop-proxy', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('代理已停止', 'success');
      } else {
        showToast(`停止失败: ${data.error || `HTTP ${res.status}`}`, 'error');
      }
      refreshStatus();
    } catch (err) {
      showToast(`操作异常: ${err.message}`, 'error');
    }
  });

  document.getElementById('playground-model')?.addEventListener('change', updatePlaygroundEffort);

  document.getElementById('btn-run-test')?.addEventListener('click', async () => {
    const model = document.getElementById('playground-model')?.value;
    const prompt = document.getElementById('playground-prompt')?.value || '';
    const effortEl = document.getElementById('playground-effort');
    const effort = effortEl && !effortEl.disabled && effortEl.value ? effortEl.value : undefined;
    const resultBox = document.getElementById('playground-result');
    const btn = document.getElementById('btn-run-test');

    if (!prompt.trim()) return;
    btn.disabled = true;
    if (resultBox) resultBox.textContent = `正在向 Kiro Runtime 发送请求 (模型: ${model}, Effort: ${effort || 'N/A'})...`;

    try {
      const payload = { model, prompt };
      if (effort) payload.effort = effort;
      const res = await fetch('/api/test-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        if (resultBox) resultBox.textContent = `[错误] ${data.error?.message || JSON.stringify(data.error || data)}`;
        showToast('测试请求失败，请查看返回结果', 'error');
      } else {
        const reply = data.content?.[0]?.text || JSON.stringify(data.content, null, 2);
        if (resultBox) resultBox.textContent = reply;
        showToast('测试请求成功响应！', 'success');
      }
    } catch (err) {
      if (resultBox) resultBox.textContent = `[网络异常] ${err.message}`;
    } finally {
      btn.disabled = false;
      refreshLogs();
      refreshStatus();
    }
  });

  document.getElementById('btn-refresh-logs')?.addEventListener('click', refreshLogs);
}

document.addEventListener('DOMContentLoaded', () => {
  renderIcons();
  setupEvents();
  refreshStatus();
  loadModels();
  refreshLogs();

  setInterval(() => {
    refreshStatus();
    refreshLogs();
  }, 3000);
});
