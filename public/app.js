/* ==========================================================
   中矩视界 · 绘图工作台 前端逻辑
   后端：本地代理 -> ai.taufran.com /api/draw/*
   ========================================================== */
(() => {
  'use strict';

  /* ------------------------------ 常量 ------------------------------ */

  const LS = {
    key: 'tf.key',
    base: 'tf.base',
    pref: 'tf.pref.v1',
    turns: 'tf.turns.v1',
    format: 'tf.format',
  };

  const RATIO_NAME = {
    '1:1': '方图',
    '16:9': '横图',
    '9:16': '竖图',
    '4:3': '横图',
    '3:4': '竖图',
    '3:2': '横图',
    '2:3': '竖图',
  };

  const RATIO_CLASS = {
    '1:1': '',
    '4:3': 'wide',
    '3:2': 'wide',
    '16:9': 'ultrawide',
    '3:4': 'tall',
    '2:3': 'tall',
    '9:16': 'poster',
  };

  const SIZE_TABLE = {
    '1:1': { '1K': '1080x1080', '2K': '2048x2048', '4K': '4096x4096' },
    '16:9': { '1K': '1920x1080', '2K': '2560x1440', '4K': '3840x2160' },
    '9:16': { '1K': '1080x1920', '2K': '1440x2560', '4K': '2160x3840' },
    '4:3': { '1K': '1440x1080', '2K': '2048x1536', '4K': '3840x2880' },
    '3:4': { '1K': '1080x1440', '2K': '1536x2048', '4K': '2880x3840' },
    '3:2': { '1K': '1620x1080', '2K': '2160x1440', '4K': '3840x2560' },
    '2:3': { '1K': '1080x1620', '2K': '1440x2160', '4K': '2560x3840' },
  };

  const GROUPS = {
    默认组: null,
    高清精修组: { tier: '4K' },
    极速草稿组: { model: 'gpt-image-2', tier: '1K', count: 1 },
  };

  const RING_SVG =
    '<svg viewBox="0 0 20 20" class="ring" aria-hidden="true">' +
    '<circle cx="10" cy="10" r="7.2" fill="none" stroke="#3f6fe4" stroke-width="1.6"/>' +
    '<circle cx="10" cy="10" r="3.1" fill="#3f6fe4"/>' +
    '</svg>';

  const EMPTY_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="4.5" width="18" height="15" rx="2.6"/>' +
    '<circle cx="8.6" cy="9.6" r="1.5"/>' +
    '<path d="M3.9 16.6 9 11.8l3.7 3.4 2.5-2.1 4.9 4.4"/></svg>';

  /* ------------------------------ 状态 ------------------------------ */

  const S = {
    key: localStorage.getItem(LS.key) || '',
    base: localStorage.getItem(LS.base) || '',
    format: localStorage.getItem(LS.format) || 'GPT原生图片',
    sites: [],
    catalog: null,
    models: [],
    modelId: 'gpt-image-2',
    ratio: '1:1',
    tier: '1K',
    custom: '',
    group: '默认组',
    count: 1,
    refs: [],
    mode: 'single',
    targets: [],
    batchRefs: [],
    turns: [],
    busy: 0,
    batchTotal: 0,
    batchDone: 0,
    histFilter: 'all',
    // 历史记录单独存储（刷新后不显示在主界面）
    historyData: null,
    selectedHistory: new Set(),
    maxRefBytes: 1024 * 1024,
    maxRefEdge: 1536,
  };

  /* ------------------------------ DOM ------------------------------ */

  const $ = (id) => document.getElementById(id);
  const dom = {
    stage: $('stage'),
    thread: $('thread'),
    refs: $('refs'),
    prompt: $('prompt'),
    send: $('btn-send'),
    attach: $('btn-attach'),
    file: $('fileInput'),
    refresh: $('btn-refresh'),
    settings: $('settings'),
    keyInput: $('keyInput'),
    keyLabel: $('key-label'),
    keyEye: $('keyEye'),
    keySave: $('keySave'),
    keyClear: $('keyClear'),
    keyTest: $('keyTest'),
    routeSelect: $('routeSelect'),
    status: $('settings-status'),
    menu: $('menu'),
    toasts: $('toasts'),
    customSize: $('customSize'),
    tabs: $('tabs'),
    modeSeg: $('modeSeg'),
    batch: $('batch'),
    dropTarget: $('dropTarget'),
    dropRef: $('dropRef'),
    targetThumbs: $('targetThumbs'),
    refThumbs: $('refThumbs'),
    targetCount: $('targetCount'),
    refCount: $('refCount'),
    targetHint: $('targetHint'),
    refHint: $('refHint'),
    batchState: $('batchState'),
    targetInput: $('targetInput'),
    refInput: $('refInput'),
    btnHistory: $('btn-history'),
    historyCount: $('historyCount'),
    drawer: $('drawer'),
    drawerMask: $('drawerMask'),
    drawerBody: $('drawerBody'),
    drawerCount: $('drawerCount'),
    histFilters: $('histFilters'),
    batchSelectBtn: $('batchSelectBtn'),
    batchDeleteBtn: $('batchDeleteBtn'),
    selectedCount: $('selectedCount'),
  };

  /* ------------------------------ 工具 ------------------------------ */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const div = (cls) => {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    return d;
  };

  function toast(text, kind = '', ms = 3200) {
    const t = div('toast' + (kind ? ' ' + kind : ''));
    t.textContent = text;
    dom.toasts.appendChild(t);
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 220);
    }, ms);
  }

  function fingerprint(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i += 1) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return 'k' + (h >>> 0).toString(36);
  }

  function newRequestId() {
    const rand = Math.random().toString(36).slice(2, 8);
    return `draw-${Date.now().toString(36)}-${rand}`;
  }

  function presetKey(ratio, tier) {
    return ratio + '|' + tier;
  }

  // 目录价格是 0.015000000000000001 这类浮点结果，展示前统一裁掉尾数
  function money(n) {
    const v = Number(n);
    if (!isFinite(v)) return '';
    return '$' + (Math.round(v * 1e6) / 1e6).toString();
  }

  // result.url 可能是站点相对路径（以 / 开头）。直接丢给 <img> 会被当成
  // 本地 127.0.0.1 路径解析，必然 404，所以要补回服务地址。
  const DEFAULT_BASE = 'https://ai.taufran.com';
  function absImageUrl(u) {
    if (!u) return '';
    if (/^https?:\/\//i.test(u)) return u;
    const base = S.base || DEFAULT_BASE;
    return base.replace(/\/+$/, '') + (u.startsWith('/') ? u : '/' + u);
  }

  /* ------------------------------ 接口 ------------------------------ */

  async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers);
    if (S.key) headers.Authorization = 'Bearer ' + S.key;
    if (S.base) headers['x-taufran-base'] = S.base;
    if (opts.body) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await fetch(path, Object.assign({}, opts, { headers }));
    } catch (e) {
      const err = new Error('网络异常：' + e.message);
      err.network = true;
      throw err;
    }

    const ct = res.headers.get('content-type') || '';
    let data = null;
    if (ct.includes('json')) {
      try {
        data = await res.json();
      } catch {
        data = null;
      }
    }

    if (!res.ok || (data && data.ok === false)) {
      const detail = data && (data.error || data.errorDetails?.message);
      const err = new Error(detail || `请求失败（HTTP ${res.status}）`);
      err.status = res.status;
      err.data = data;
      err.network = !!(data && data.networkError);
      throw err;
    }
    return data;
  }

  /* ------------------------------ 模型目录 ------------------------------ */

  function fallbackPresets(supported) {
    const out = [];
    for (const ratio of Object.keys(SIZE_TABLE)) {
      for (const tier of supported) {
        const size = SIZE_TABLE[ratio][tier];
        if (size) out.push({ ratio, tier, label: tier === '1K' ? '1080p' : tier, size, price: 0 });
      }
    }
    return out;
  }

  function normalizeModel(raw) {
    const model = {
      id: raw.modelId || raw.id,
      name: raw.name || raw.modelId,
      available: raw.available !== false,
      supportedTiers: Array.isArray(raw.supportedTiers) ? raw.supportedTiers : ['1K'],
      tierPrices: raw.tierPrices || {},
      caps: raw.capabilities || {},
      presets: Array.isArray(raw.outputPresets) && raw.outputPresets.length
        ? raw.outputPresets.map((p) => ({
            ratio: p.ratio,
            tier: p.tier,
            label: p.label || p.tier,
            size: p.size,
            price: typeof p.price === 'number' ? p.price : 0,
            billingTier: p.billingTier,
          }))
        : fallbackPresets(raw.supportedTiers || ['1K']),
      note: (raw.capabilities && raw.capabilities.note) || '',
    };
    model.presets.sort((a, b) => {
      const order = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'];
      const d = order.indexOf(a.ratio) - order.indexOf(b.ratio);
      if (d) return d;
      return a.tier.localeCompare(b.tier);
    });
    const prices = Object.values(model.tierPrices).filter((n) => typeof n === 'number');
    model.minPrice = prices.length ? Math.min(...prices) : 0;
    return model;
  }

  function currentModel() {
    return S.models.find((m) => m.id === S.modelId) || S.models[0] || null;
  }

  function currentPreset() {
    const model = currentModel();
    if (!model) return null;
    return (
      model.presets.find((p) => p.ratio === S.ratio && p.tier === S.tier) ||
      model.presets.find((p) => p.ratio === S.ratio) ||
      model.presets[0] ||
      null
    );
  }

  function resolveSize() {
    if (S.custom) return S.custom;
    const p = currentPreset();
    return p ? p.size : '1080x1080';
  }

  function sizeLabel() {
    if (S.custom) {
      const [w, h] = S.custom.split('x');
      return `自定义 ${w}×${h}`;
    }
    const p = currentPreset();
    if (!p) return '—';
    return `${RATIO_NAME[p.ratio] || ''} ${p.ratio} · ${p.tier}`;
  }

  async function loadCatalog(notify = false) {
    dom.refresh.classList.add('spin');
    try {
      const data = await api('/api/draw/models');
      S.catalog = data;
      S.models = (data.models || []).map(normalizeModel);
      if (typeof data.maxReferenceBytes === 'number') S.maxRefBytes = data.maxReferenceBytes;
      if (typeof data.maxReferenceEdge === 'number') S.maxRefEdge = data.maxReferenceEdge;

      if (!S.models.some((m) => m.id === S.modelId)) {
        const preferred = S.models.find((m) => m.id === 'gpt-image-2' && m.available);
        S.modelId = (preferred || S.models.find((m) => m.available) || S.models[0] || {}).id || '';
      }
      ensureTier();
      renderControls();
      renderBatch();
      renderBatchState();
      markKeyState(S.key ? 'ok' : 'empty');
      if (notify) toast(`模型目录已刷新：${S.models.length} 个模型`, 'ok', 2000);
    } catch (e) {
      if (e.status === 401 || e.status === 403) {
        markKeyState('bad');
        if (notify) toast('Key 无效或额度不足：' + e.message, 'err');
      } else if (notify) {
        toast('模型目录加载失败：' + e.message, 'err');
      }
      if (!S.models.length) S.models = [];
      renderControls();
      renderBatchState();
    } finally {
      dom.refresh.classList.remove('spin');
    }
  }

  function ensureTier() {
    const model = currentModel();
    if (!model) return;
    if (!model.presets.some((p) => p.ratio === S.ratio && p.tier === S.tier)) {
      const alt = model.presets.find((p) => p.ratio === S.ratio) || model.presets[0];
      if (alt) {
        S.ratio = alt.ratio;
        S.tier = alt.tier;
      }
    }
  }

  function tierAvailable(tier) {
    const model = currentModel();
    return !!model && model.presets.some((p) => p.ratio === S.ratio && p.tier === tier);
  }

  /* ------------------------------ 菜单 ------------------------------ */

  let menuAnchor = null;

  function closeMenu() {
    dom.menu.hidden = true;
    dom.menu.innerHTML = '';
    if (menuAnchor) menuAnchor.classList.remove('menu-open');
    menuAnchor = null;
  }

  function openMenu(anchor, items, onPick, opts = {}) {
    if (menuAnchor === anchor) {
      closeMenu();
      return;
    }
    closeMenu();
    menuAnchor = anchor;

    for (const it of items) {
      if (it.title) {
        const t = div('menu-title');
        t.textContent = it.title;
        dom.menu.appendChild(t);
        continue;
      }
      const row = div('menu-item' + (it.active ? ' active' : '') + (it.disabled ? ' disabled' : ''));
      const main = div('mi-main');
      main.textContent = it.label;
      if (it.sub) {
        const s = div('mi-sub');
        s.textContent = it.sub;
        main.appendChild(s);
      }
      row.appendChild(main);
      if (it.hint) {
        const h = div('mi-hint');
        h.textContent = it.hint;
        row.appendChild(h);
      }
      row.addEventListener('click', () => {
        if (it.disabled) return;
        closeMenu();
        onPick(it);
      });
      dom.menu.appendChild(row);
    }

    dom.menu.hidden = false;
    if (opts.width) dom.menu.style.width = opts.width + 'px';
    else dom.menu.style.width = '';

    const r = anchor.getBoundingClientRect();
    const mw = dom.menu.offsetWidth;
    const mh = dom.menu.offsetHeight;
    let left = opts.align === 'right' ? r.right - mw : r.left;
    left = Math.max(12, Math.min(left, window.innerWidth - mw - 12));
    let top = r.top - mh - 8;
    if (top < 12) top = Math.min(r.bottom + 8, window.innerHeight - mh - 12);
    dom.menu.style.left = Math.round(left) + 'px';
    dom.menu.style.top = Math.round(top) + 'px';
  }

  document.addEventListener('mousedown', (e) => {
    if (dom.menu.hidden) return;
    if (dom.menu.contains(e.target)) return;
    if (menuAnchor && menuAnchor.contains(e.target)) return;
    closeMenu();
  });

  window.addEventListener('resize', closeMenu);
  dom.stage.addEventListener('scroll', closeMenu, { passive: true });

  /* ------------------------------ 控件渲染 ------------------------------ */

  function renderControls() {
    const model = currentModel();
    $('val-model').textContent = model ? model.name : '加载中…';
    $('val-size').textContent = sizeLabel();
    $('val-quality').textContent =
      S.custom ? '自定义' : S.tier === '1K' ? '自动' : S.tier === '2K' ? '高清 2K' : '超清 4K';
    $('val-count').textContent = String(S.count);
    $('val-group').textContent = S.group;
    $('val-format').textContent = S.format;

    if (S.custom) {
      dom.customSize.classList.add('filled');
      if (dom.customSize.value !== S.custom) dom.customSize.value = S.custom;
    } else {
      dom.customSize.classList.remove('filled');
    }
    dom.send.disabled = S.busy > 0;
    dom.attach.classList.toggle('has-ref', S.refs.length > 0);
    // 批量模式下每张待修改图各出 1 张，“数量”不参与
    $('ctl-count').hidden = S.mode === 'batch';
    $('val-count').textContent = S.mode === 'batch' ? String(S.targets.length) : String(S.count);
    updateHistoryBadge();
  }

  function updateHistoryBadge() {
    const n = countHistory();
    dom.historyCount.textContent = String(n);
    dom.historyCount.hidden = n === 0;
  }

  dom.customSize.addEventListener('input', () => {
    const raw = dom.customSize.value.trim().toLowerCase().replace(/[×*]/g, 'x');
    const m = raw.match(/^(\d{2,5})\s*x\s*(\d{2,5})$/);
    if (!raw) {
      S.custom = '';
    } else if (m) {
      const w = Number(m[1]);
      const h = Number(m[2]);
      if (w < 64 || h < 64 || w > 8192 || h > 8192) {
        S.custom = '';
        toast('自定义尺寸需在 64–8192 像素之间', 'err', 2400);
      } else {
        S.custom = `${w}x${h}`;
      }
    } else {
      S.custom = '';
    }
    renderControls();
  });

  dom.customSize.addEventListener('blur', () => {
    if (!dom.customSize.value.trim()) S.custom = '';
    renderControls();
  });

  /* 模型 */
  $('ctl-model').addEventListener('click', (e) => {
    const items = S.models.length
      ? S.models.map((m) => ({
          label: m.name,
          sub: [
            `${m.supportedTiers.join(' / ')}`,
            m.minPrice ? `${money(m.minPrice)}/张` : '',
            m.caps.canEdit ? '可改图' : '',
            m.caps.canMultiReference ? `多图 ${m.caps.maxReferenceImages || 0}` : '',
          ]
            .filter(Boolean)
            .join(' ｜ '),
          hint: m.available ? '' : '暂不可用',
          active: m.id === S.modelId,
          disabled: !m.available,
          id: m.id,
        }))
      : [{ label: '目录加载中…', disabled: true }];

    openMenu(e.currentTarget, items, (it) => {
      S.modelId = it.id;
      ensureTier();
      renderControls();
    }, { width: 320 });
  });

  /* 尺寸 */
  $('ctl-size').addEventListener('click', (e) => {
    const model = currentModel();
    if (!model) return;
    const items = [];
    let lastRatio = '';
    model.presets.forEach((p) => {
      if (p.ratio !== lastRatio) {
        lastRatio = p.ratio;
        items.push({ title: `${RATIO_NAME[p.ratio] || ''} ${p.ratio}` });
      }
      items.push({
        label: `${p.tier === '1K' ? '1080p' : p.tier} · ${p.size.replace('x', ' × ')}`,
        hint: p.price ? money(p.price) : '',
        active: p.ratio === S.ratio && p.tier === S.tier && !S.custom,
        ratio: p.ratio,
        tier: p.tier,
      });
    });
    openMenu(e.currentTarget, items, (it) => {
      S.ratio = it.ratio;
      S.tier = it.tier;
      S.custom = '';
      dom.customSize.value = '';
      renderControls();
    }, { width: 260 });
  });

  /* 质量 */
  $('ctl-quality').addEventListener('click', (e) => {
    const defs = [
      { label: '自动', sub: '跟随尺寸里的档位', tier: 'auto' },
      { label: '标准 1080p', tier: '1K' },
      { label: '高清 2K', tier: '2K' },
      { label: '超清 4K', tier: '4K' },
    ];
    const items = defs.map((d) => {
      const ok = d.tier === 'auto' || tierAvailable(d.tier);
      return {
        label: d.label,
        sub: d.sub,
        tier: d.tier,
        disabled: !ok,
        active:
          (d.tier === 'auto' && S.tier === '1K' && !S.custom) || (d.tier !== 'auto' && S.tier === d.tier),
        hint: ok ? '' : '该模型未开放',
      };
    });
    openMenu(e.currentTarget, items, (it) => {
      S.custom = '';
      dom.customSize.value = '';
      if (it.tier !== 'auto') S.tier = it.tier;
      ensureTier();
      renderControls();
    }, { width: 230 });
  });

  /* 数量 */
  $('ctl-count').addEventListener('click', (e) => {
    const items = [1, 2, 3, 4].map((n) => ({
      label: `${n} 张`,
      sub: n > 1 ? '每张独立提交一次生成' : '',
      active: S.count === n,
      n,
    }));
    openMenu(e.currentTarget, items, (it) => {
      S.count = it.n;
      renderControls();
    }, { width: 210 });
  });

  /* 生图组 */
  $('ctl-group').addEventListener('click', (e) => {
    const items = Object.keys(GROUPS).map((name) => ({
      label: name,
      sub:
        name === '默认组'
          ? '沿用当前参数'
          : name === '高清精修组'
            ? '优先 4K 档位'
            : 'gpt-image-2 · 1K',
      active: S.group === name,
      name,
    }));
    openMenu(e.currentTarget, items, (it) => {
      S.group = it.name;
      const preset = GROUPS[it.name];
      if (preset) {
        if (preset.model && S.models.some((m) => m.id === preset.model && m.available)) {
          S.modelId = preset.model;
        }
        if (preset.tier) {
          const m = currentModel();
          const hit = m && m.presets.find((p) => p.ratio === S.ratio && p.tier === preset.tier);
          if (hit) S.tier = preset.tier;
          else toast('当前模型未开放该档位，已保留可用尺寸', 'err', 2400);
        }
        if (preset.count) S.count = preset.count;
        S.custom = '';
        dom.customSize.value = '';
      }
      ensureTier();
      renderControls();
    }, { width: 230 });
  });

  /* 输出格式 */
  $('ctl-format').addEventListener('click', (e) => {
    const items = ['GPT原生图片', 'PNG', 'JPEG', 'WebP'].map((f) => ({
      label: f,
      sub: f === 'GPT原生图片' ? '按服务端返回的原格式下载' : `下载时转存为 ${f}`,
      active: S.format === f,
      f,
    }));
    openMenu(e.currentTarget, items, (it) => {
      S.format = it.f;
      localStorage.setItem(LS.format, it.f);
      renderControls();
    }, { width: 260 });
  });

  /* 刷新 */
  dom.refresh.addEventListener('click', () => loadCatalog(true));

  /* Tab */
  dom.tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    if (btn.dataset.mode === '生图') return;
    toast(`${btn.dataset.mode}能力尚未接入当前绘图服务，请使用「生图」`, '', 2600);
  });

  /* ------------------------------ 参考图 ------------------------------ */

  dom.attach.addEventListener('click', () => dom.file.click());
  dom.file.addEventListener('change', () => {
    addFiles(Array.from(dom.file.files || []));
    dom.file.value = '';
  });

  async function addFiles(files) {
    if (!files.length) return;
    for (const file of files) {
      if (S.refs.length >= 14) {
        toast('参考图最多 14 张', 'err');
        break;
      }
      try {
        const ref = await prepareFile(file);
        S.refs.push(ref);
      } catch (e) {
        toast(`${file.name}：${e.message}`, 'err');
      }
    }
    renderRefs();
    renderControls();
  }

  function toBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error('读取失败'));
      fr.readAsDataURL(blob);
    });
  }

  async function prepareFile(file) {
    if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) {
      throw new Error('仅支持 PNG / JPEG / WebP');
    }
    let bmp;
    try {
      bmp = await createImageBitmap(file);
    } catch {
      throw new Error('图片无法解析');
    }

    const maxEdge = S.maxRefEdge || 1536;
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);

    const preferWebp = file.type === 'image/png';
    const type = preferWebp ? 'image/webp' : 'image/jpeg';
    let quality = 0.94;
    let blob = await toBlob(canvas, type, quality);
    const limit = S.maxRefBytes || 1024 * 1024;

    while (blob && blob.size > limit && quality > 0.42) {
      quality -= 0.08;
      blob = await toBlob(canvas, type, quality);
    }
    if (!blob || blob.size > limit) throw new Error('压缩后仍超过 1MB，请换更小的图');

    // 72px 缩略图，用于会话记录与气泡展示
    const tScale = Math.min(1, 72 / Math.max(w, h));
    const tc = document.createElement('canvas');
    tc.width = Math.max(1, Math.round(w * tScale));
    tc.height = Math.max(1, Math.round(h * tScale));
    tc.getContext('2d').drawImage(canvas, 0, 0, tc.width, tc.height);
    const thumb = tc.toDataURL('image/jpeg', 0.72);

    bmp.close && bmp.close();
    return {
      name: file.name,
      dataUrl: await blobToDataUrl(blob),
      thumb,
      bytes: blob.size,
      w,
      h,
    };
  }

  function renderRefs() {
    // 批量模式下参考图有独立上传区，不再重复占用单次模式的参考图条
    if (S.mode === 'batch') {
      dom.refs.innerHTML = '';
      dom.refs.hidden = true;
      return;
    }
    dom.refs.innerHTML = '';
    if (!S.refs.length) {
      dom.refs.hidden = true;
      return;
    }
    dom.refs.hidden = false;
    S.refs.forEach((ref, i) => {
      const item = div('ref');
      const img = document.createElement('img');
      img.src = ref.thumb;
      img.alt = ref.name;
      const idx = div('idx');
      idx.textContent = String(i + 1);
      const rm = document.createElement('button');
      rm.className = 'rm';
      rm.type = 'button';
      rm.textContent = '×';
      rm.title = '移除';
      rm.addEventListener('click', () => {
        S.refs.splice(i, 1);
        renderRefs();
        renderControls();
      });
      item.append(img, idx, rm);
      dom.refs.appendChild(item);
    });
    const hint = div('ref-hint');
    hint.textContent = `${S.refs.length} 张参考图 · 提示词里用「图1 / 图2」对应编号`;
    dom.refs.appendChild(hint);
  }

  // 粘贴图片
  document.addEventListener('paste', (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const files = items.filter((i) => i.type.startsWith('image/')).map((i) => i.getAsFile()).filter(Boolean);
    if (files.length) {
      e.preventDefault();
      if (S.mode === 'batch') {
        addTargets(files);
      } else {
        addFiles(files);
      }
    }
  });

  // 拖拽
  ['dragenter', 'dragover'].forEach((ev) =>
    window.addEventListener(ev, (e) => {
      if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
    })
  );
  window.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    if (S.mode === 'batch') {
      const onTarget = dom.dropTarget.matches(':hover');
      if (onTarget) addTargets(Array.from(e.dataTransfer.files));
      else addRefs(Array.from(e.dataTransfer.files));
    } else {
      addFiles(Array.from(e.dataTransfer.files));
    }
  });

  /* ------------------------------ 模式切换 ------------------------------ */

  dom.modeSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg');
    if (!btn) return;
    setMode(btn.dataset.mode);
  });

  function setMode(mode) {
    if (mode !== 'single' && mode !== 'batch') return;
    if (S.mode === mode) return;
    const leavingBatch = S.mode === 'batch' && S.targets.length > 0;
    S.mode = mode;
    dom.modeSeg.querySelectorAll('.seg').forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    dom.batch.hidden = mode !== 'batch';
    dom.attach.hidden = mode === 'batch';
    dom.prompt.placeholder =
      mode === 'batch'
        ? '描述要应用在每一张待修改图上的修改要求...'
        : '描述你想要的画面；上传参考图即为图生图...';
    if (mode === 'batch') {
      renderBatch();
    }
    // 两种模式的参考图各自存放，切模式只重画不互相清空：
    // 单次模式的参考图条在批量模式下必须收起来。
    renderRefs();
    renderControls();
    // 空状态文案随模式变化，只在还没有会话时才需要重画
    if (!S.turns.length) renderThread();
    if (mode === 'single' && leavingBatch) {
      toast(`${S.targets.length} 张待修改图已保留，切回批量修改即可继续`, '', 2800);
    }
  }

  $('btn-batch-to-single').addEventListener('click', () => setMode('single'));

  /* ------------------------------ 批量上传 ------------------------------ */

  dom.dropTarget.addEventListener('click', (e) => {
    if (e.target.closest('.trm')) return;
    if (e.target.closest('.drop-clear')) return;
    dom.targetInput.click();
  });

  dom.dropRef.addEventListener('click', (e) => {
    if (e.target.closest('.trm')) return;
    if (e.target.closest('.drop-clear')) return;
    dom.refInput.click();
  });

  dom.batch.addEventListener('click', (e) => {
    const clear = e.target.closest('.drop-clear');
    if (!clear) return;
    e.stopPropagation();
    if (clear.dataset.clear === 'target') S.targets = [];
    else S.batchRefs = [];
    renderBatch();
    renderControls();
  });

  dom.targetInput.addEventListener('change', () => {
    addTargets(Array.from(dom.targetInput.files || []));
    dom.targetInput.value = '';
  });

  dom.refInput.addEventListener('change', () => {
    addRefs(Array.from(dom.refInput.files || []));
    dom.refInput.value = '';
  });

  [dom.dropTarget, dom.dropRef].forEach((zone) => {
    ['dragenter', 'dragover'].forEach((ev) =>
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.add('over');
      })
    );
    ['dragleave', 'drop'].forEach((ev) =>
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove('over');
      })
    );
  });

  dom.dropTarget.addEventListener('drop', (e) => {
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) addTargets(files);
  });

  dom.dropRef.addEventListener('drop', (e) => {
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) addRefs(files);
  });

  async function addTargets(files) {
    if (!files.length) return;
    if (S.mode !== 'batch') setMode('batch');
    for (const file of files) {
      if (S.targets.length >= 20) {
        toast('单次批量最多 20 张待修改图', 'err');
        break;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const item = await prepareFile(file);
        S.targets.push({ ...item, status: '', error: '' });
      } catch (e) {
        toast(`${file.name}：${e.message}`, 'err');
      }
    }
    renderBatch();
    renderControls();
  }

  async function addRefs(files) {
    if (!files.length) return;
    if (S.mode !== 'batch') setMode('batch');
    for (const file of files) {
      if (S.batchRefs.length >= 14) {
        toast('参考图最多 14 张', 'err');
        break;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const ref = await prepareFile(file);
        S.batchRefs.push(ref);
      } catch (e) {
        toast(`${file.name}：${e.message}`, 'err');
      }
    }
    renderBatch();
    renderRefs();
    renderControls();
  }

  function renderBatch() {
    renderThumbList(dom.targetThumbs, S.targets, 'target');
    renderThumbList(dom.refThumbs, S.batchRefs, 'ref');
    dom.targetCount.textContent = String(S.targets.length);
    dom.refCount.textContent = String(S.batchRefs.length);
    dom.dropTarget.classList.toggle('has-items', S.targets.length > 0);
    dom.dropRef.classList.toggle('has-items', S.batchRefs.length > 0);
    dom.dropTarget.querySelector('[data-clear="target"]').hidden = S.targets.length === 0;
    dom.dropRef.querySelector('[data-clear="ref"]').hidden = S.batchRefs.length === 0;

    const model = currentModel();
    const caps = (model && model.caps) || {};

    const tHint = dom.targetHint;
    tHint.classList.remove('warn');
    if (!S.targets.length) {
      tHint.textContent = '点击选择，或把图片拖进来 · 每张图单独生成 1 个任务';
    } else {
      tHint.textContent = `${S.targets.length} 张待修改 · 共提交 ${S.targets.length} 个独立任务`;
    }

    const rHint = dom.refHint;
    rHint.classList.remove('warn');
    if (!S.batchRefs.length) {
      rHint.textContent = '所有待修改图共用这套参考 · 提示词里用「图1 / 图2」对应编号';
    } else if (model) {
      const perJob = 1 + S.batchRefs.length;
      const max = caps.maxReferenceImages || 0;
      if (!caps.canMultiReference) {
        rHint.textContent = `${model.name} 不支持多图参考，只传 1 张时会按单图修改处理`;
        rHint.classList.add('warn');
      } else if (max && perJob > max) {
        rHint.textContent = `每个任务会带 ${perJob} 张图，超出 ${model.name} 的 ${max} 张上限`;
        rHint.classList.add('warn');
      } else {
        rHint.textContent = `${S.batchRefs.length} 张参考 · 每个任务共 ${perJob} 张图（1 待改 + ${S.batchRefs.length} 参考）`;
      }
    }

    renderBatchState();
  }

  function renderBatchState() {
    const el = dom.batchState;
    el.innerHTML = '';
    const add = (text, tag) => {
      const s = document.createElement(tag || 'span');
      if (tag === 'b') s.textContent = text;
      else s.appendChild(document.createTextNode(text));
      el.appendChild(s);
    };

    if (S.batchTotal > 0) {
      const done = S.batchDone;
      add('批量进度 ', 'span');
      add(`${done} / ${S.batchTotal}`, 'b');
      add(done >= S.batchTotal ? ' · 已全部提交' : ' · 正在逐张提交');
      return;
    }

    const model = currentModel();
    if (!S.targets.length) {
      add('等待上传待修改图片');
      return;
    }
    if (model && !model.caps.canEdit) {
      add(`${model.name} 不支持改图，请换一个可改图模型`, 'b');
      return;
    }
    add(`${S.targets.length} 张待修改`, 'b');
    if (S.batchRefs.length) {
      const paired = Math.min(S.targets.length, S.batchRefs.length);
      const solo = S.targets.length - paired;
      add(` · 与 ${S.batchRefs.length} 张参考图按位配对`, 'span');
      if (solo > 0) add(`，其中 ${solo} 张无对应参考`);
    }
  }

  function renderThumbList(box, list, kind) {
    box.innerHTML = '';
    list.forEach((it, i) => {
      const node = div('titem' + (it.status ? ' ' + it.status : ''));
      const img = document.createElement('img');
      img.src = it.thumb;
      img.alt = it.name || '';
      img.title = it.name || '';
      node.appendChild(img);
      if (kind === 'target') {
        const idx = div('tidx');
        idx.textContent = String(i + 1);
        node.appendChild(idx);
      }
      if (it.status === 'processing') {
        const flag = div('tflag');
        flag.textContent = '生成中';
        node.appendChild(flag);
      } else if (it.status === 'failed') {
        const flag = div('tflag');
        flag.textContent = '失败';
        node.title = it.error || '生成失败';
        node.appendChild(flag);
      }
      const rm = document.createElement('button');
      rm.className = 'trm';
      rm.type = 'button';
      rm.textContent = '×';
      rm.title = '移除';
      rm.addEventListener('click', (e) => {
        e.stopPropagation();
        list.splice(i, 1);
        renderBatch();
        renderRefs();
        renderControls();
      });
      node.appendChild(rm);
      box.appendChild(node);
    });
  }

  /* ------------------------------ 会话渲染 ------------------------------ */

  function emptyEl() {
    const box = div('empty');
    const mark = div('mark');
    mark.innerHTML = EMPTY_SVG;
    const a = document.createElement('strong');
    const batch = S.mode === 'batch';
    a.textContent = batch ? '批量修改一批图片' : '描述你想要的画面';
    const b = document.createElement('span');
    b.textContent = batch
      ? '分别上传要修改的图片和参考图，每张待改图会单独生成一个结果'
      : '上传参考图即为图生图，可一次放入多张做组合参考';
    box.append(mark, a, b);
    return box;
  }

  function tagEl(text, accent) {
    const t = document.createElement('span');
    t.className = 'tag' + (accent ? ' accent' : '');
    t.textContent = text;
    return t;
  }

  function turnEl(t) {
    const wrap = div('turn');

    /* --- 用户气泡 --- */
    const bubble = div('bubble');
    const meta = div('bubble-meta');
    if (t.kind === 'batch') {
      const thumbs = div('bubble-thumbs');
      (t.targets || []).slice(0, 4).forEach((r) => {
        const img = document.createElement('img');
        img.src = r.thumb;
        img.alt = r.name || '';
        thumbs.appendChild(img);
      });
      const more = div('count-more');
      more.textContent = `改 ${(t.targets || []).length}`;
      thumbs.appendChild(more);
      if ((t.refs || []).length) {
        const refTag = document.createElement('span');
        refTag.className = 'count-more';
        refTag.textContent = `参 ${t.refs.length}`;
        thumbs.appendChild(refTag);
      }
      meta.appendChild(thumbs);
    } else if (t.refs.length) {
      const thumbs = div('bubble-thumbs');
      t.refs.slice(0, 3).forEach((r) => {
        const img = document.createElement('img');
        img.src = r.thumb;
        img.alt = r.name || '';
        thumbs.appendChild(img);
      });
      if (t.refs.length > 3) {
        const more = div('count-more');
        more.textContent = '+' + (t.refs.length - 3);
        thumbs.appendChild(more);
      }
      meta.appendChild(thumbs);
    }
    meta.append(tagEl(t.model), tagEl(t.mode), tagEl(t.size.replace('x', 'x')));
    const text = div('bubble-text');
    text.textContent = t.prompt;
    bubble.append(meta, text);
    const withdrawBtn = div('bubble-withdraw');
    withdrawBtn.className = 'h-withdraw';
    withdrawBtn.title = '撤回这一轮的提示词与图片，重新填写';
    withdrawBtn.innerHTML =
      '<span class="h-w-text">撤回</span>' +
      '<svg class="h-w-ic" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M4.5 7.5h9A3.5 3.5 0 0 1 17 11v0a3.5 3.5 0 0 1-3.5 3.5H8"/>' +
      '<path d="M7 4.5 4 7.5l3 3"/></svg>';
    withdrawBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      withdrawTurn(t);
    });
    bubble.appendChild(withdrawBtn);
    wrap.appendChild(bubble);

    /* --- 助手回复 --- */
    const ai = div('ai');
    const persona = div('persona');
    persona.innerHTML = RING_SVG;
    const pname = document.createElement('span');
    pname.textContent = t.persona || '中矩视界';
    persona.appendChild(pname);
    ai.appendChild(persona);

    const cards = div('cards');
    t.jobs.forEach((j) => {
      const node = cardEl(t, j);
      j._el = node;
      cards.appendChild(node);
    });
    t._cards = cards;
    ai.appendChild(cards);
    wrap.appendChild(ai);
    return wrap;
  }

  function parseRatio(size) {
    const m = String(size || '').match(/^(\d+)\s*x\s*(\d+)$/);
    if (!m) return 1;
    return Number(m[1]) / Number(m[2]);
  }

  function ratioClass(size) {
    const ar = parseRatio(size);
    if (ar > 1.9) return 'ultrawide';
    if (ar > 1.42) return 'wide';
    if (ar < 0.55) return 'poster';
    if (ar < 0.72) return 'tall';
    return '';
  }

  function cardEl(t, j) {
    const card = div('card');

    if (t.kind === 'batch' && j.targetThumb) {
      const src = div('card-src');
      const sImg = document.createElement('img');
      sImg.src = j.targetThumb;
      sImg.alt = '';
      const sLabel = document.createElement('span');
      sLabel.textContent = `原图 ${(j.index ?? 0) + 1}`;
      src.append(sImg, sLabel);
      card.appendChild(src);
    }

    if (j.status === 'done' && j.imageUrl) {
      const img = document.createElement('img');
      img.className = 'card-img';
      img.src = j.imageUrl;
      img.alt = '生成结果';
      img.addEventListener('click', () => openLightbox(j.imageUrl));
      card.appendChild(img);

      const bar = div('card-bar');
      const meta = document.createElement('span');
      meta.className = 'chip meta';
      meta.textContent = j.outSize || t.size.replace('x', ' × ');
      bar.appendChild(meta);

      bar.appendChild(chipBtn('放大', () => openLightbox(j.imageUrl)));
      bar.appendChild(chipBtn('下载原图', () => downloadJob(t, j)));
      bar.appendChild(chipBtn('回填', () => refill(t)));
      card.appendChild(bar);
      return card;
    }

    if (j.status === 'failed' || j.status === 'timeout') {
      const box = div('card-error');
      const strong = document.createElement('strong');
      strong.textContent = j.status === 'timeout' ? '等待超时' : '生成失败';
      const msg = document.createElement('div');
      msg.textContent = j.error || '任务未返回结果';
      box.append(strong, msg);

      const acts = div('acts');
      if (j.status === 'timeout') {
        acts.appendChild(chipBtn('继续查询', () => pollJob(t, j, true)));
      }
      acts.appendChild(chipBtn('重新生成', () => regenerate(t, j.index)));
      box.appendChild(acts);
      card.appendChild(box);
      return card;
    }

    // 生成中
    const ph = div('card-ph ' + ratioClass(t.size));
    const gen = document.createElement('span');
    gen.className = 'gen-text';
    gen.innerHTML =
      (j.status === 'loading' ? '读取图片' : '生成中') +
      '<span class="dots"><i>.</i><i>.</i><i>.</i></span>';
    ph.appendChild(gen);
    card.appendChild(ph);
    return card;
  }

  function chipBtn(label, onClick) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  function paintCard(t, j) {
    const node = cardEl(t, j);
    if (j._el && j._el.parentNode) {
      j._el.parentNode.replaceChild(node, j._el);
      j._el = node;
      return;
    }
    // 首次渲染：这一轮会话还没画出来（任务对象在 renderThread 之后才创建）。
    if (!t._cards) {
      // 会话尚未渲染到 DOM，先整体重建一次以拿到容器。
      renderThread();
      return;
    }
    t._cards.appendChild(node);
    j._el = node;
  }

  function renderThread() {
    dom.thread.innerHTML = '';
    if (!S.turns.length) {
      dom.thread.appendChild(emptyEl());
      return;
    }
    S.turns.forEach((t) => {
      t._cards = null;
      dom.thread.appendChild(turnEl(t));
    });
  }

  function scrollToBottom(smooth) {
    dom.stage.scrollTo({ top: dom.stage.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }

  /* ------------------------------ 批量执行 ------------------------------ */

  // 任务在服务端是异步完成的，提交循环早就结束了，但 pollJob/loadImage
  // 之后才会把 job.status 改成 done/failed。上传区靠 batchIndex 找回原图，
  // 用序号索引会在图片被移除后错位，所以每张待改图都记了自己的原始位置。
  function syncBatchTargets(turn) {
    if (!turn || turn.kind !== 'batch') return;
    const byIndex = new Map();
    turn.jobs.forEach((j) => byIndex.set(j.index, j));
    S.targets = S.targets.filter((t) => {
      if (t.batchIndex === undefined) return true;
      const job = byIndex.get(t.batchIndex);
      if (!job) return true;
      if (job.status === 'done') {
        // 成功的图移出上传区，生成结果由结果卡负责
        return false;
      }
      if (job.status === 'failed') {
        t.status = 'failed';
        t.error = job.error || '生成失败';
        return true;
      }
      if (job.status === 'timeout') {
        t.status = 'processing';
        return true;
      }
      t.status = 'processing';
      return true;
    });
    renderBatch();
  }

  // 每张待修改图一个独立任务，串行提交避免限流。
  // 单张失败不影响其余图片，失败卡片可以直接重试。
  async function runBatch(model, prompt) {
    const size = resolveSize();
    // 每轮重新编号：上一轮失败的图留在上传区里，带着旧 batchIndex 重跑会撞号
    const targets = S.targets.map((t, i) => ({ ...t, batchIndex: i }));
    S.targets = targets.slice();
    const refs = S.batchRefs.map((r) => ({ name: r.name, thumb: r.thumb, dataUrl: r.dataUrl, w: r.w, h: r.h }));

    const turn = {
      id: 'turn-' + Date.now().toString(36),
      at: Date.now(),
      keyFp: fingerprint(S.key),
      prompt,
      model: model.id,
      size,
      sizeLabel: sizeLabel(),
      mode: `批量修改 ×${targets.length}`,
      kind: 'batch',
      ratio: S.ratio,
      tier: S.tier,
      refs: refs.map((r) => ({ ...r })),
      targets: targets.map((t, i) => ({
        index: i,
        name: t.name,
        thumb: t.thumb,
        dataUrl: t.dataUrl,
        w: t.w,
        h: t.h,
      })),
      jobs: [],
      persona: '中矩视界',
    };

    S.turns.push(turn);
    if (S.turns.length > 20) S.turns.splice(0, S.turns.length - 20);
    renderThread();
    scrollToBottom(true);
    persistTurns();

    dom.prompt.value = '';
    autosize();
    // 待修改图在提交期间留在上传区显示逐张进度；
    // 参考图已按 index 固化进 turn.refs 并在各任务提交时消费，这里清空避免误用
    S.targets = targets.slice();
    S.batchRefs = [];
    renderBatch();
    renderRefs();
    renderControls();

    S.batchTotal = targets.length;
    S.batchDone = 0;
    renderBatchState();

    for (let i = 0; i < targets.length; i += 1) {
      const job = {
        index: i,
        requestId: newRequestId(),
        id: '',
        status: 'queued',
        error: '',
        createdAt: Date.now(),
        targetThumb: targets[i].thumb,
        targetName: targets[i].name,
        _el: null,
      };
      turn.jobs.push(job);
      targets[i].status = 'processing';
      S.batchDone += 1;
      renderBatch();
      renderBatchState();
      // eslint-disable-next-line no-await-in-loop
      await submitOne(turn, i);
      syncBatchTargets(turn);
    }

    S.batchTotal = 0;
    renderBatchState();
    const failed = turn.jobs.filter((j) => j.status === 'failed').length;
    if (failed) {
      toast(`已提交 ${turn.jobs.length} 个任务，其中 ${failed} 张提交失败，可在卡片上重新生成`, 'err', 4600);
    } else {
      toast(`已提交 ${turn.jobs.length} 个任务，正在逐张生成`, 'ok', 2600);
    }
    updateHistoryBadge();
  }

  /* ------------------------------ 生成 ------------------------------ */

  function validateRefs(model) {
    const n = S.refs.length;
    const caps = model.caps || {};
    if (n === 0) return '';
    const max = caps.maxReferenceImages || 0;
    if (n === 1 && !caps.canEdit) return `${model.name} 暂不支持单图修改，请移除参考图或换模型`;
    if (n >= 2 && !caps.canMultiReference) return `${model.name} 不支持多图参考`;
    if (max && n > max) return `${model.name} 最多 ${max} 张参考图`;
    if (caps.minReferenceImages && n < caps.minReferenceImages && n > 0) {
      return `${model.name} 参考模式至少 ${caps.minReferenceImages} 张`;
    }
    return '';
  }

  // 批量模式按位配对：第 i 张待改图带第 i 张参考图，
  // 没有对应参考图的任务只提交待改图本身。
  // 多图能力校验按单个任务的真实图片数（1 或 2 张）算。
  function validateBatch(model) {
    const caps = model.caps || {};
    if (!S.targets.length) return '请先上传要修改的图片';
    if (!caps.canEdit) return `${model.name} 不支持改图，请切换到支持改图的模型`;
    if (!S.batchRefs.length) return '';
    // 配对模式下每个任务要么 1 张图（无参考），要么 2 张图（待改+参考）
    // 只有当某个任务真的携带 2 张图时才需要检查多图能力
    const pairedJobs = Math.min(S.targets.length, S.batchRefs.length);
    if (pairedJobs > 0 && !caps.canMultiReference) {
      return `${model.name} 不支持多图参考，配对后每个任务需要 2 张图（待改 + 参考）`;
    }
    return '';
  }

  async function generate() {
    if (!S.key) {
      openSettings('请先填写 API Key');
      return;
    }
    if (S.busy > 0) return;

    const prompt = dom.prompt.value.trim();
    if (!prompt) {
      toast('请先描述你想要的画面');
      dom.prompt.focus();
      return;
    }

    const model = currentModel();
    if (!model) {
      toast('模型目录还没加载完成，请稍候或点刷新', 'err');
      return;
    }
    if (!model.available) {
      toast(`${model.name} 当前不可用，请换一个模型`, 'err');
      return;
    }

    if (S.mode === 'batch') {
      const batchError = validateBatch(model);
      if (batchError) {
        toast(batchError, 'err');
        return;
      }
      await runBatch(model, prompt);
      return;
    }

    const refError = validateRefs(model);
    if (refError) {
      toast(refError, 'err');
      return;
    }

    const size = resolveSize();
    const turn = {
      id: 'turn-' + Date.now().toString(36),
      at: Date.now(),
      keyFp: fingerprint(S.key),
      prompt,
      model: model.id,
      size,
      sizeLabel: sizeLabel(),
      mode: S.refs.length ? `图生图 ×${S.refs.length}` : '文生图',
      ratio: S.ratio,
      tier: S.tier,
      refs: S.refs.map((r) => ({ name: r.name, thumb: r.thumb, dataUrl: r.dataUrl, w: r.w, h: r.h })),
      jobs: [],
      persona: '中矩视界',
    };

    S.turns.push(turn);
    if (S.turns.length > 20) S.turns.splice(0, S.turns.length - 20);
    renderThread();
    scrollToBottom(true);

    dom.prompt.value = '';
    autosize();
    S.refs = [];
    renderRefs();
    renderControls();
    persistTurns();

    for (let i = 0; i < S.count; i += 1) {
      // 顺序提交，避免瞬时并发触发限流
      // eslint-disable-next-line no-await-in-loop
      await submitOne(turn, i);
    }
  }

  async function submitOne(turn, index, existing) {
    // existing 非空表示“重新生成”：复用原槽位，把失败卡片原地换成新任务，
    // 否则会出现一张失败卡片 + 一张新卡片并排的错位。
    const job = existing || {
      index,
      requestId: newRequestId(),
      id: '',
      status: 'queued',
      error: '',
      createdAt: Date.now(),
      _el: null,
    };
    if (existing) {
      job.requestId = newRequestId();
      job.id = '';
      job.status = 'queued';
      job.error = '';
      job.note = '';
      job.createdAt = Date.now();
      // 保留 job._el，paintCard 会用它把失败卡片原地替换成新的占位卡片
      job._polling = false;
      job.imageUrl = '';
      job.blob = null;
    } else {
      turn.jobs.push(job);
    }
    const imageUrls = [];
    if (turn.kind === 'batch') {
      const target = (turn.targets || [])[index];
      if (target && target.dataUrl) imageUrls.push(target.dataUrl);
      // 批量改图按位配对：第 index 张待改图只配第 index 张参考图。
      const ref = (turn.refs || [])[index];
      if (ref && ref.dataUrl) imageUrls.push(ref.dataUrl);
    } else {
      (turn.refs || []).forEach((r) => {
        if (r.dataUrl) imageUrls.push(r.dataUrl);
      });
    }

    paintCard(turn, job);
    S.busy += 1;
    renderControls();
    persistTurns();

    const payload = {
      requestId: job.requestId,
      model: turn.model,
      prompt: turn.prompt,
      size: turn.size,
      // 新服务端要求同时给出成品尺寸，只发 size 会被判为“该分辨率未配置”
      outputSize: turn.size,
      n: 1,
      stream: false,
      image_urls: imageUrls,
    };

    try {
      const res = await api('/api/draw/jobs', { method: 'POST', body: JSON.stringify(payload) });
      job.id = (res.job && res.job.id) || '';
      job.status = 'processing';
    } catch (e) {
      if (e.network) {
        // 提交响应丢失：绝不重发，按 requestId 找回原任务
        job.status = 'processing';
        job.note = '提交响应丢失，正在按 requestId 找回原任务';
        toast('提交响应丢失，正在按原 requestId 找回任务（不会重复生成）', 'err', 4200);
      } else if (e.status === 401 || e.status === 403) {
        job.status = 'failed';
        job.error = 'API Key 无效或额度不足：' + e.message;
        markKeyState('bad');
      } else {
        job.status = 'failed';
        job.error = e.message;
      }
    }

    paintCard(turn, job);
    S.busy = Math.max(0, S.busy - 1);
    renderControls();
    persistTurns();

    if (job.status === 'processing') pollJob(turn, job);

    if (turn.kind === 'batch') syncBatchTargets(turn);
  }

  async function pollJob(turn, job, manual) {
    if (job._polling && !manual) return;
    job._polling = true;
    if (manual) {
      job.status = 'processing';
      delete job.error;
      if (job._el) {
        const node = cardEl(turn, job);
        job._el.parentNode.replaceChild(node, job._el);
        job._el = node;
      }
    }

    const deadline = Date.now() + 12 * 60 * 1000; // 单次等待上限 12 分钟
    let first = true;

    while (true) {
      if (Date.now() > deadline) {
        job._polling = false;
        job.status = 'timeout';
        job.error = '本次等待已到 12 分钟，任务可能仍在后台生成。可点「继续查询」只查询原任务，不会重复生成。';
        paintCard(turn, job);
        persistTurns();
        syncBatchTargets(turn);
        return;
      }

      // eslint-disable-next-line no-await-in-loop
      await sleep(first ? 900 : 2400);
      first = false;

      let data;
      try {
        const path = job.id
          ? `/api/draw/jobs/${encodeURIComponent(job.id)}`
          : `/api/draw/jobs/by-request/${encodeURIComponent(job.requestId)}`;
        // eslint-disable-next-line no-await-in-loop
        data = await api(path);
      } catch (e) {
        if (e.status === 401 || e.status === 403) {
          job._polling = false;
          job.status = 'failed';
          job.error = 'API Key 无效或额度不足：' + e.message;
          markKeyState('bad');
          paintCard(turn, job);
          persistTurns();
          syncBatchTargets(turn);
          return;
        }
        if (e.status === 404) {
          continue; // 任务可能还在排队，继续查
        }
        // eslint-disable-next-line no-await-in-loop
        await sleep(3000);
        continue;
      }

      const res = (data && data.job) || {};
      if (res.id) job.id = res.id;

      if (res.status === 'completed') {
        job.status = 'loading';
        paintCard(turn, job);
        // eslint-disable-next-line no-await-in-loop
        await loadImage(turn, job, res);
        job._polling = false;
        return;
      }

      if (res.status === 'failed' || res.status === 'interrupted' || res.status === 'unconfirmed') {
        job._polling = false;
        job.status = 'failed';
        job.error = res.error || `任务状态：${res.status}`;
        paintCard(turn, job);
        persistTurns();
        syncBatchTargets(turn);
        return;
      }

      if (res.progress !== job.progress) {
        job.progress = res.progress;
        job.status = 'processing';
      }
    }
  }

  async function loadImage(turn, job, res) {
    const result = (res && res.result) || {};
    const historyId = result.historyId;

    if (!historyId && result.url) {
      // 直接给了图片地址：相对路径要补回服务地址，否则会被当成本地路径
      job.imageUrl = absImageUrl(result.url);
      job.status = 'done';
      job.outSize = result.width && result.height ? `${result.width} × ${result.height}` : '';
      paintCard(turn, job);
      persistTurns();
      syncBatchTargets(turn);
      return;
    }

    if (!historyId) {
      job.status = 'failed';
      job.error = '任务完成但没有返回图片编号';
      paintCard(turn, job);
      persistTurns();
      syncBatchTargets(turn);
      return;
    }

    try {
      const headers = { Authorization: 'Bearer ' + S.key };
      if (S.base) headers['x-taufran-base'] = S.base;
      const response = await fetch(`/api/draw/history/${encodeURIComponent(historyId)}/image`, { headers });
      if (!response.ok) {
        throw new Error(response.status === 410 ? '图片已过期（本站保留 3 小时）' : `图片暂时无法读取：${response.status}`);
      }
      const blob = await response.blob();
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) {
        throw new Error('返回内容不是受支持的图片格式');
      }
      job.blob = blob;
      job.historyId = historyId;
      job.imageUrl = URL.createObjectURL(blob);
      job.status = 'done';
      job.outSize =
        result.width && result.height ? `${result.width} × ${result.height}` : '';
    } catch (e) {
      job.status = 'failed';
      job.error = e.message;
    }

    paintCard(turn, job);
    persistTurns();
    syncBatchTargets(turn);
  }

  function regenerate(turn, index) {
    const model = currentModel();
    if (!model) return;
    if (!S.key) {
      openSettings('请先填写 API Key');
      return;
    }
    const slot = turn.jobs.findIndex((j) => j.index === index);
    submitOne(turn, index, slot >= 0 ? turn.jobs[slot] : null);
  }

  /* ------------------------------ 图片操作 ------------------------------ */

  function mimeToExt(type) {
    if (type === 'image/jpeg') return 'jpg';
    if (type === 'image/webp') return 'webp';
    return 'png';
  }

  async function convertBlob(blob, format) {
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d');
    if (format === 'JPEG') {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(bmp, 0, 0);
    const type = format === 'JPEG' ? 'image/jpeg' : format === 'WebP' ? 'image/webp' : 'image/png';
    const quality = format === 'JPEG' || format === 'WebP' ? 0.95 : undefined;
    const out = await toBlob(canvas, type, quality);
    bmp.close && bmp.close();
    return out || blob;
  }

  async function downloadJob(turn, job) {
    try {
      let blob = job.blob;
      if (!blob && job.historyId) {
        const headers = { Authorization: 'Bearer ' + S.key };
        const r = await fetch(`/api/draw/history/${encodeURIComponent(job.historyId)}/image`, { headers });
        if (!r.ok) throw new Error('图片读取失败：' + r.status);
        blob = await r.blob();
        job.blob = blob;
      }
      if (!blob) throw new Error('图片数据不可用');

      let out = blob;
      let ext = mimeToExt(blob.type);
      if (S.format !== 'GPT原生图片') {
        out = await convertBlob(blob, S.format);
        ext = S.format === 'JPEG' ? 'jpg' : S.format.toLowerCase();
      }
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(out);
      a.download = `taufran-${stamp}-${(job.index ?? 0) + 1}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast('已开始下载原图', 'ok', 1800);
    } catch (e) {
      toast('下载失败：' + e.message, 'err');
    }
  }

  function openLightbox(url) {
    const mask = div('lightbox');
    const img = document.createElement('img');
    img.src = url;
    mask.appendChild(img);
    mask.addEventListener('click', () => mask.remove());
    document.body.appendChild(mask);
  }

  function refill(turn) {
    dom.prompt.value = turn.prompt;
    autosize();
    if (S.models.some((m) => m.id === turn.model)) S.modelId = turn.model;
    if (turn.ratio && turn.tier) {
      S.ratio = turn.ratio;
      S.tier = turn.tier;
    }
    S.custom = '';
    dom.customSize.value = '';

    if (turn.kind === 'batch') {
      setMode('batch');
      const withData = (turn.targets || []).filter((r) => r.dataUrl);
      S.targets = withData.map((r) => ({
        name: r.name,
        thumb: r.thumb,
        dataUrl: r.dataUrl,
        bytes: 0,
        w: r.w || 0,
        h: r.h || 0,
        status: '',
        error: '',
      }));
      S.batchRefs = (turn.refs || []).filter((r) => r.dataUrl).map((r) => ({
        name: r.name,
        thumb: r.thumb,
        dataUrl: r.dataUrl,
        bytes: 0,
        w: r.w || 0,
        h: r.h || 0,
      }));
      renderBatch();
      renderRefs();
      renderControls();
      dom.prompt.focus();
      toast(
        S.targets.length
          ? '已回填批量修改的提示词与参数'
          : '已回填提示词与参数，待修改图需重新上传',
        'ok',
        2400
      );
      return;
    }

    const withData = (turn.refs || []).filter((r) => r.dataUrl);
    S.refs = withData.map((r) => ({
      name: r.name,
      thumb: r.thumb,
      dataUrl: r.dataUrl,
      bytes: 0,
      w: r.w || 0,
      h: r.h || 0,
    }));
    if (turn.refs && turn.refs.length && !S.refs.length) {
      toast('参考图不在本机记录中，已回填提示词与参数', '', 3000);
    } else {
      toast('已回填提示词与参数', 'ok', 1800);
    }

    renderRefs();
    renderControls();
    dom.prompt.focus();
  }

  /* ------------------------------ 本地记录 ------------------------------ */

  function historyEntries(filter) {
    const out = [];
    // 合并当前会话的记录和刷新前保存的历史记录
    const allTurns = [...(S.historyData || []), ...S.turns];
    const seen = new Set();
    allTurns.forEach((t) => {
      if (seen.has(t.id)) return;
      seen.add(t.id);
      t.jobs.forEach((j) => {
        if (j.status !== 'done') return;
        const kind = t.kind === 'batch' ? 'batch' : t.refs && t.refs.length ? 'image' : 'text';
        if (filter && filter !== 'all' && kind !== filter) return;
        out.push({ turn: t, job: j, kind, at: j.createdAt || t.at });
      });
    });
    out.sort((a, b) => b.at - a.at);
    return out;
  }

  function countHistory() {
    let n = 0;
    const allTurns = [...(S.historyData || []), ...S.turns];
    const seen = new Set();
    allTurns.forEach((t) => {
      if (seen.has(t.id)) return;
      seen.add(t.id);
      t.jobs.forEach((j) => {
        if (j.status === 'done') n += 1;
      });
    });
    return n;
  }

  function dayLabel(ts) {
    const d = new Date(ts);
    const today = new Date();
    const same = (a, b) =>
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (same(d, today)) return '今天';
    const yest = new Date(today.getTime() - 86400000);
    if (same(d, yest)) return '昨天';
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }

  function timeLabel(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // 批量选择/删除功能
  function openDrawer() {
    renderDrawer();
    dom.drawer.hidden = false;
    dom.drawerMask.hidden = false;
    dom.btnHistory.classList.add('on');
  }

  function closeDrawer() {
    dom.drawer.hidden = true;
    dom.drawerMask.hidden = true;
    dom.btnHistory.classList.remove('on');
  }

  dom.btnHistory.addEventListener('click', () => {
    if (dom.drawer.hidden) openDrawer();
    else closeDrawer();
  });
  $('drawerClose').addEventListener('click', closeDrawer);
  dom.drawerMask.addEventListener('click', closeDrawer);

  // 批量选择/删除功能
  if (dom.batchSelectBtn) {
    dom.batchSelectBtn.addEventListener('click', () => {
      const items = historyEntries(S.histFilter);
      const checkboxes = dom.drawerBody.querySelectorAll('.hist-checkbox');
      const allChecked = Array.from(checkboxes).every((cb) => cb.checked);
      
      if (allChecked) {
        // 取消全选
        checkboxes.forEach((cb) => (cb.checked = false));
        items.forEach((item) => {
          const key = `${item.turn.id}:${item.job.requestId || ''}`;
          S.selectedHistory.delete(key);
        });
      } else {
        // 全选
        checkboxes.forEach((cb) => (cb.checked = true));
        items.forEach((item) => {
          const key = `${item.turn.id}:${item.job.requestId || ''}`;
          S.selectedHistory.add(key);
        });
      }
      
      updateSelectionUI();
    });
  }
  
  if (dom.batchDeleteBtn) {
    dom.batchDeleteBtn.addEventListener('click', () => {
      if (S.selectedHistory.size === 0) return;
      if (!confirm(`确定要删除选中的 ${S.selectedHistory.size} 张图片吗？此操作不可恢复。`)) return;
      
      deleteHistoryEntries();
    });
  }
  
  dom.histFilters.addEventListener('click', (e) => {
    const chip = e.target.closest('.fchip');
    if (!chip) return;
    S.histFilter = chip.dataset.f;
    dom.histFilters.querySelectorAll('.fchip').forEach((c) => c.classList.toggle('active', c === chip));
    renderDrawer();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dom.drawer.hidden) closeDrawer();
  });

  function renderDrawer() {
    const items = historyEntries(S.histFilter);
    dom.drawerCount.textContent = `${items.length} 张`;
    dom.drawerBody.innerHTML = '';
    if (!items.length) {
      const empty = div('hist-empty');
      empty.textContent = S.turns.length
        ? '当前筛选下还没有生成完成的图片。'
        : '还没有生成记录。完成一次生图后，图片会自动出现在这里。';
      dom.drawerBody.appendChild(empty);
      return;
    }

    let lastDay = '';
    items.forEach((it) => {
      const label = dayLabel(it.at);
      if (label !== lastDay) {
        lastDay = label;
        const d = div('hist-day');
        d.textContent = label;
        dom.drawerBody.appendChild(d);
        const grid = div('hist-grid');
        grid.dataset.day = label;
        dom.drawerBody.appendChild(grid);
      }
      const grid = dom.drawerBody.lastElementChild;
      grid.appendChild(histCell(it));
    });
  }

  function histCell(entry) {
    const { turn, job, kind } = entry;
    const cell = div('hist-cell');
    
    // 添加多选复选框
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'hist-checkbox';
    checkbox.title = '选择这张图片';
    cell.appendChild(checkbox);
    
    if (job.imageUrl || job.historyId) {
      const img = document.createElement('img');
      img.alt = turn.prompt.slice(0, 40);
      img.loading = 'lazy';
      if (job.imageUrl) img.src = job.imageUrl;
      else {
        img.classList.add('pending');
        ensureImage(turn, job).then((url) => {
          if (url) img.src = url;
          else img.classList.add('broken');
        });
      }
      cell.appendChild(img);
    } else {
      const ph = div('hist-ph');
      ph.textContent = '图片已过期';
      ph.title = '本机只保留了任务编号，图片需要重新生成或从服务端取回';
      cell.appendChild(ph);
    }
    
    cell.addEventListener('click', (e) => {
      if (e.target.closest('.h-btn')) return;
      if (e.target === checkbox) return;

      ensureImage(turn, job).then((url) => {
        if (url) openLightbox(url);
      });
    });
    
    // 复选框变化事件
    checkbox.addEventListener('change', () => {
      updateSelectionUI();
    });
    
    // 记录归属条目，供多选与批量删除直接取用
    cell._entry = { turn, job };

    const tag = document.createElement('span');
    tag.className = 'h-kind';
    tag.textContent = kind === 'batch' ? '批量' : kind === 'image' ? '图生图' : '文生图';
    cell.appendChild(tag);

    const clock = document.createElement('span');
    clock.className = 'h-time';
    clock.textContent = timeLabel(entry.at);
    cell.appendChild(clock);

    const tools = div('h-tools');
    tools.appendChild(hTool('放入批量修改', 'M5.5 5.5h9v9h-9zM7 3.5v4M3.5 7h4', () => {
      ensureImage(turn, job).then(async (url) => {
        if (!url) return;
        await addHistoryImageToBatch(turn, job, url);
      });
    }));
    tools.appendChild(hTool('重新发送', 'M10 4.5v6H7M10 4.5 8 6.5M10.5 11l2 2', () => withdrawTurn(turn)));
    tools.appendChild(hTool('下载', 'M10 3.5v8M6.5 8.5 10 12l3.5-3.5M4.5 15.5h11', () => downloadJob(turn, job)));
    cell.appendChild(tools);
    
    // 添加单独删除按钮
    const deleteBtn = hTool('删除', 'M14.5 6.5l-9 9M6.5 6.5l9 9', () => {
      if (confirm(`确定要删除这张图片吗？`)) {
        deleteHistoryEntries([{ turn, job }]);
      }
    });
    deleteBtn.className = 'h-btn delete-only';
    cell.appendChild(deleteBtn);
    
    return cell;
  }

  function updateSelectionUI() {
    const checkboxes = dom.drawerBody.querySelectorAll('.hist-checkbox:checked');
    const count = checkboxes.length;
    
    if (dom.selectedCount) dom.selectedCount.textContent = String(count);
    if (dom.batchDeleteBtn) dom.batchDeleteBtn.disabled = count === 0;
    
    // 更新全选按钮文本
    const totalCheckboxes = dom.drawerBody.querySelectorAll('.hist-checkbox').length;
    if (dom.batchSelectBtn) {
      dom.batchSelectBtn.textContent = count === totalCheckboxes && totalCheckboxes > 0 ? '取消全选' : '全选';
    }
    
    // 更新选中集合
    S.selectedHistory.clear();
    checkboxes.forEach((cb) => {
      const cell = cb.closest('.hist-cell');
      if (cell && cell._entry) {
        S.selectedHistory.add(cell._entry);
      }
    });
  }

  function deleteHistoryEntries(items) {
    const toDelete = items || Array.from(S.selectedHistory).map((key) => {
      return key; // _entry 就是 {turn, job}
    }).filter(Boolean);
    
    if (!toDelete.length) return;
    
    toDelete.forEach(({ turn, job }) => {
      const idx = turn.jobs.indexOf(job);
      if (idx > -1) {
        turn.jobs.splice(idx, 1);
      }
      if (turn.jobs.length === 0) {
        const tIdx = S.turns.indexOf(turn);
        if (tIdx > -1) S.turns.splice(tIdx, 1);
      }
    });
    
    // 清空选中状态
    S.selectedHistory.clear();
    persistTurns();
    updateHistoryBadge();
    
    // 重新渲染
    renderDrawer();
    toast(`已删除 ${toDelete.length} 张图片`, 'ok', 2400);
  }

  function hTool(title, d, onClick) {
    const b = document.createElement('button');
    b.className = 'h-btn';
    b.type = 'button';
    b.title = title;
    b.innerHTML = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  async function addHistoryImageToBatch(turn, job, url) {
    try {
      let blob = job.blob;
      if (!blob) {
        const res = await fetch(url);
        if (!res.ok) throw new Error('图片读取失败：' + res.status);
        blob = await res.blob();
        job.blob = blob;
      }
      const file = new File([blob], job.targetName || turn.prompt.slice(0, 12) + '.png', { type: blob.type });
      setMode('batch');
      await addTargets([file]);
      closeDrawer();
      toast('已放入「待修改图片」，可继续上传参考图', 'ok', 2400);
    } catch (e) {
      toast('加入批量修改失败：' + e.message, 'err');
    }
  }

  // 刷新后本地只存了 historyId，图片要按需重新取一次。
  async function ensureImage(turn, job) {
    if (job.imageUrl) return job.imageUrl;
    if (!job.historyId) return job.imageUrl || '';
    try {
      await loadImage(turn, job, { result: { historyId: job.historyId } });
    } catch {
      /* loadImage 内部已经把失败状态画到卡片上 */
    }
    return job.imageUrl || '';
  }

  function persistTurns() {
    try {
      // 合并历史记录与当前会话，去重后持久化（避免历史被覆盖丢失）
      const all = [...(S.historyData || []), ...S.turns];
      const seen = new Set();
      const merged = [];
      for (let k = all.length - 1; k >= 0; k--) {
        const t = all[k];
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        merged.push(t);
        if (merged.length >= 16) break;
      }
      merged.reverse();
      // 预算：图片 dataUrl 最多 3.6MB，超出时优先保留新条目
      const budget = { left: 3600 * 1024 };
      const pickDataUrl = (r) => {
        const d = r.dataUrl || '';
        if (!d) return '';
        if (d.length > 768 * 1024 || d.length > budget.left) return '';
        budget.left -= d.length;
        return d;
      };
      const data = merged.map((t) => ({
        id: t.id,
        at: t.at,
        keyFp: t.keyFp,
        prompt: t.prompt,
        model: t.model,
        size: t.size,
        sizeLabel: t.sizeLabel,
        mode: t.mode,
        kind: t.kind || '',
        ratio: t.ratio,
        tier: t.tier,
        persona: t.persona,
        refs: (t.refs || []).slice(0, 4).map((r) => ({ name: r.name, thumb: r.thumb, w: r.w, h: r.h, dataUrl: pickDataUrl(r) })),
        targets: (t.targets || []).slice(0, 20).map((r) => ({ name: r.name, thumb: r.thumb, w: r.w, h: r.h, dataUrl: pickDataUrl(r) })),
        jobs: t.jobs.map((j) => ({
          index: j.index,
          requestId: j.requestId,
          id: j.id,
          status: j.status,
          error: j.error,
          historyId: j.historyId,
          outSize: j.outSize,
          createdAt: j.createdAt,
          targetThumb: j.targetThumb,
          targetName: j.targetName,
        })),
      }));
      localStorage.setItem(LS.turns, JSON.stringify(data));
      localStorage.setItem(
        LS.pref,
        JSON.stringify({
          modelId: S.modelId,
          ratio: S.ratio,
          tier: S.tier,
          count: S.count,
          group: S.group,
        })
      );
    } catch {
      /* 存储受限时静默降级 */
    }
  }

  function restoreTurns() {
    try {
      const pref = JSON.parse(localStorage.getItem(LS.pref) || 'null');
      if (pref) {
        if (pref.modelId) S.modelId = pref.modelId;
        if (pref.ratio) S.ratio = pref.ratio;
        if (pref.tier) S.tier = pref.tier;
        if (pref.count) S.count = pref.count;
        if (pref.group) S.group = pref.group;
      }
      const raw = JSON.parse(localStorage.getItem(LS.turns) || '[]');
      if (!Array.isArray(raw)) return;
      const fp = fingerprint(S.key);
      // 加载历史数据到 historyData（用于历史记录抽屉）
      S.historyData = raw
        .filter((t) => !t.keyFp || t.keyFp === fp)
        .map((t) => ({
          ...t,
          refs: (t.refs || []).map((r) => ({ ...r })),
            targets: (t.targets || []).map((r) => ({ ...r })),
          jobs: (t.jobs || []).map((j) => ({ ...j, _el: null })),
        }));
      
      // 主界面清空（刷新后不显示主界面内容，只在历史记录里查看）
      S.turns = [];
    } catch {
      S.historyData = [];
      S.turns = [];
    }
  }

  function withdrawTurn(turn) {
    if (!turn) return;
    if (S.historyData && S.historyData.includes(turn)) {
      S.historyData = S.historyData.filter((t) => t !== turn);
    }
    if (!S.turns.includes(turn)) S.turns.unshift(turn);
    S.selectedHistory.clear();
    refill(turn);
    renderThread();
    renderDrawer();
    persistTurns();
    closeDrawer();
    toast('已撤回这一轮的提示词与图片，可修改后重新发送', 'ok', 2600);
    setTimeout(() => dom.prompt.focus(), 40);
  }

  function resumePending() {
    const pending = [];
    S.turns.forEach((t) => {
      t.jobs.forEach((j) => {
        if (j.status === 'processing' || j.status === 'queued') pending.push([t, j]);
        if (j.status === 'done' && j.historyId && !j.imageUrl) pending.push([t, j]);
      });
    });
    if (!pending.length) return;

    pending.forEach(([t, j]) => {
      if (j.status === 'done') {
        loadImage(t, j, { result: { historyId: j.historyId } });
      } else {
        pollJob(t, j, true);
      }
    });
    toast(`正在续查 ${pending.length} 个本机任务（不会重新生成）`, '', 3200);
  }

  /* ------------------------------ 设置 ------------------------------ */

  function markKeyState(state) {
    if (state === 'bad') {
      dom.keyLabel.textContent = 'Key 无效';
      dom.keyLabel.parentElement.classList.add('warn');
    } else if (state === 'ok') {
      dom.keyLabel.textContent = 'Key 已配置';
      dom.keyLabel.parentElement.classList.remove('warn');
    } else {
      dom.keyLabel.textContent = 'Key 未配置';
      dom.keyLabel.parentElement.classList.add('warn');
    }
  }

  function setStatus(text, kind) {
    dom.status.textContent = text;
    dom.status.className = 'status' + (kind ? ' ' + kind : '');
  }

  function openSettings(hint) {
    dom.keyInput.value = S.key;
    renderRouteOptions();
    setStatus(hint || (S.key ? '已保存 Key，可点“测试连接”确认' : '还未填写 Key，生成前需要先配置'));
    dom.settings.hidden = false;
    setTimeout(() => dom.keyInput.focus(), 60);
  }

  function closeSettings() {
    dom.settings.hidden = true;
  }

  function renderRouteOptions() {
    dom.routeSelect.innerHTML = '';
    const auto = document.createElement('option');
    auto.value = '';
    auto.textContent = '自动（优先国际线路，失败自动切换）';
    dom.routeSelect.appendChild(auto);
    S.sites.forEach((s) => {
      const o = document.createElement('option');
      o.value = s.baseUrl;
      o.textContent = `${s.name} · ${s.baseUrl.replace('https://', '')}`;
      dom.routeSelect.appendChild(o);
    });
    dom.routeSelect.value = S.base || '';
  }

  $('btn-settings').addEventListener('click', () => openSettings());
  $('settings-close').addEventListener('click', closeSettings);
  dom.settings.addEventListener('mousedown', (e) => {
    if (e.target === dom.settings) closeSettings();
  });

  dom.keyEye.addEventListener('click', () => {
    const isPwd = dom.keyInput.type === 'password';
    dom.keyInput.type = isPwd ? 'text' : 'password';
    dom.keyEye.textContent = isPwd ? '隐藏' : '显示';
  });

  dom.keySave.addEventListener('click', async () => {
    const key = dom.keyInput.value.trim();
    const base = dom.routeSelect.value;
    if (!key) {
      setStatus('请先粘贴 API Key', 'err');
      return;
    }
    S.key = key;
    S.base = base;
    localStorage.setItem(LS.key, key);
    localStorage.setItem(LS.base, base);
    markKeyState('ok');
    setStatus('已保存，正在校验…');
    await loadCatalog(false);
    if (S.models.length) {
      setStatus(`连接正常：${S.models.length} 个模型可用`, 'ok');
      toast('Key 已保存，模型目录已更新', 'ok', 2200);
      setTimeout(closeSettings, 550);
    } else {
      setStatus('已保存，但模型目录未能读取，请检查 Key 或线路', 'err');
    }
  });

  dom.keyTest.addEventListener('click', async () => {
    const key = dom.keyInput.value.trim();
    const base = dom.routeSelect.value;
    if (!key) {
      setStatus('请先粘贴 API Key', 'err');
      return;
    }
    const oldKey = S.key;
    const oldBase = S.base;
    S.key = key;
    S.base = base;
    setStatus('正在检测线路与 Key…');
    try {
      const data = await api('/api/draw/models');
      setStatus(`连接正常：${(data.models || []).length} 个模型，目录版本 ${data.catalogRevision || '-'}`, 'ok');
    } catch (e) {
      setStatus('检测失败：' + e.message, 'err');
    } finally {
      if (!dom.keySave.dataset.done) {
        S.key = oldKey;
        S.base = oldBase;
      }
    }
  });

  dom.keyClear.addEventListener('click', () => {
    S.key = '';
    S.base = '';
    localStorage.removeItem(LS.key);
    localStorage.removeItem(LS.base);
    dom.keyInput.value = '';
    markKeyState('empty');
    setStatus('已清除本机保存的 Key', 'ok');
  });

  /* ------------------------------ 输入区 ------------------------------ */

  function autosize() {
    dom.prompt.style.height = 'auto';
    dom.prompt.style.height = Math.min(dom.prompt.scrollHeight, 126) + 'px';
  }

  dom.prompt.addEventListener('input', autosize);
  dom.prompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      generate();
    }
  });
  dom.send.addEventListener('click', generate);

  /* ------------------------------ 启动 ------------------------------ */

  async function loadLocalConfig() {
    try {
      const res = await fetch('/local/config');
      const data = await res.json();
      S.sites = data.sites || [];
      if (typeof data.maxReferenceBytes === 'number') S.maxRefBytes = data.maxReferenceBytes;
      if (typeof data.maxReferenceEdge === 'number') S.maxRefEdge = data.maxReferenceEdge;
      if (data.presets && data.presets.sizes) {
        // 尺寸表以服务端目录为准，这里作为离线兜底
        Object.entries(data.presets.sizes).forEach(([ratio, tiers]) => {
          if (!SIZE_TABLE[ratio]) return;
          Object.entries(tiers).forEach(([tier, size]) => {
            SIZE_TABLE[ratio][tier] = size;
          });
        });
      }
    } catch {
      S.sites = [];
    }
  }

  async function boot() {
    await loadLocalConfig();
    restoreTurns();
    renderThread();
    renderControls();
    markKeyState(S.key ? 'ok' : 'empty');
    await loadCatalog(false);
    resumePending();
    scrollToBottom(false);
    autosize();
    renderBatch();
    updateHistoryBadge();

    if (!S.key) {
      setTimeout(() => openSettings(), 420);
    }
  }

  boot();
})();
