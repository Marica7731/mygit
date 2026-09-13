// ==UserScript==
// @name         YouTube 转写文稿时间文本提取器 - get_panel 修正版
// @namespace    https://github.com/Marica7731/mygit
// @version      2.0.0
// @description  从 YouTube 当前原生 transcript panel 接口提取“时间 + 文本”，兼容 watch/live/shorts 和站内 SPA 切换。
// @author       Marica7731
// @match        https://www.youtube.com/*
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  const LOG = '[YT-TRANSCRIPT-FAST]';
  const PANEL_ID = 'PAmodern_transcript_view';
  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  let mounted = false;
  let currentVideoId = '';
  let requestSerial = 0;
  let autoTimer = 0;

  const ui = {
    root: null,
    status: null,
    textarea: null,
    extract: null,
    copy: null,
    download: null,
    minimize: null,
    body: null,
  };

  function log(...args) {
    console.log(LOG, ...args);
  }

  function warn(...args) {
    console.warn(LOG, ...args);
  }

  function getVideoId(url = location.href) {
    try {
      const u = new URL(url, location.origin);
      const host = u.hostname.replace(/^www\./, '');
      if (host === 'youtu.be') {
        const id = u.pathname.split('/').filter(Boolean)[0];
        return /^[\w-]{11}$/.test(id || '') ? id : '';
      }

      const queryId = u.searchParams.get('v');
      if (/^[\w-]{11}$/.test(queryId || '')) return queryId;

      const m = u.pathname.match(/^\/(?:live|shorts|embed)\/([\w-]{11})(?:\/|$)/);
      return m ? m[1] : '';
    } catch {
      return '';
    }
  }

  function getCfg(key) {
    try {
      if (pageWindow.ytcfg?.get) {
        const value = pageWindow.ytcfg.get(key);
        if (value != null) return value;
      }
    } catch {}

    try {
      const data = pageWindow.ytcfg?.data_;
      if (data && key in data) return data[key];
    } catch {}

    return undefined;
  }

  function clonePlain(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }

  function getInnertubeContext() {
    const direct = getCfg('INNERTUBE_CONTEXT');
    if (direct?.client) return clonePlain(direct);

    const clientVersion = getCfg('INNERTUBE_CLIENT_VERSION');
    const visitorData = getCfg('VISITOR_DATA');
    if (clientVersion) {
      return {
        client: {
          clientName: 'WEB',
          clientVersion,
          hl: document.documentElement.lang || 'zh-CN',
          gl: getCfg('GL') || 'US',
          visitorData: visitorData || undefined,
          originalUrl: location.href,
          platform: 'DESKTOP',
          clientFormFactor: 'UNKNOWN_FORM_FACTOR',
        },
      };
    }

    throw new Error('无法读取 YouTube INNERTUBE_CONTEXT，请刷新页面后重试');
  }

  function buildTranscriptParams(videoId) {
    if (!/^[\w-]{11}$/.test(videoId)) {
      throw new Error(`非法视频 ID: ${videoId}`);
    }

    // 当前 YouTube transcript panel 的 protobuf 参数：
    // AA 09 0F 0A 0B + 11 字节 videoId + 18 02
    const idBytes = new TextEncoder().encode(videoId);
    const bytes = new Uint8Array(5 + idBytes.length + 2);
    bytes.set([0xaa, 0x09, 0x0f, 0x0a, 0x0b], 0);
    bytes.set(idBytes, 5);
    bytes.set([0x18, 0x02], 5 + idBytes.length);

    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function getCookie(name) {
    const needle = `${name}=`;
    for (const chunk of document.cookie.split(';')) {
      const item = chunk.trim();
      if (item.startsWith(needle)) {
        return decodeURIComponent(item.slice(needle.length));
      }
    }
    return '';
  }

  async function sha1Hex(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-1', bytes);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  }

  async function buildAuthorization(dual = false) {
    const origin = location.origin;
    const ts = Math.floor(Date.now() / 1000);
    const sapisid = getCookie('SAPISID') || getCookie('__Secure-3PAPISID');
    if (!sapisid) return '';

    const h1 = await sha1Hex(`${ts} ${sapisid} ${origin}`);
    if (!dual) return `SAPISIDHASH ${ts}_${h1}`;

    const sapisid3p = getCookie('__Secure-3PAPISID') || sapisid;
    const h3 = await sha1Hex(`${ts} ${sapisid3p} ${origin}`);
    return `SAPISIDHASH ${ts}_${h1}_u SAPISID3PHASH ${ts}_${h3}_u`;
  }

  function createHeaders(context, authorization = '') {
    const headers = {
      'Content-Type': 'application/json',
      'X-YouTube-Client-Name': String(getCfg('INNERTUBE_CONTEXT_CLIENT_NAME') || 1),
      'X-YouTube-Client-Version':
        String(getCfg('INNERTUBE_CLIENT_VERSION') || context?.client?.clientVersion || ''),
      'X-Origin': location.origin,
    };

    const visitor = getCfg('VISITOR_DATA') || context?.client?.visitorData;
    if (visitor) headers['X-Goog-Visitor-Id'] = String(visitor);

    const authUser = getCfg('SESSION_INDEX');
    if (authUser != null && authUser !== '') headers['X-Goog-AuthUser'] = String(authUser);

    if (authorization) headers.Authorization = authorization;
    return headers;
  }

  async function fetchWithDeadline(url, init, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function requestPanel(videoId, dualAuth = false) {
    const context = getInnertubeContext();
    const apiKey = getCfg('INNERTUBE_API_KEY');
    const params = buildTranscriptParams(videoId);
    const authorization = await buildAuthorization(dualAuth);

    const endpoint = new URL('/youtubei/v1/get_panel', location.origin);
    endpoint.searchParams.set('prettyPrint', 'false');
    if (apiKey) endpoint.searchParams.set('key', String(apiKey));

    const response = await fetchWithDeadline(endpoint.toString(), {
      method: 'POST',
      credentials: 'include',
      headers: createHeaders(context, authorization),
      body: JSON.stringify({
        context,
        panelId: PANEL_ID,
        params,
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      const err = new Error(`get_panel HTTP ${response.status}${text ? `: ${text.slice(0, 180)}` : ''}`);
      err.status = response.status;
      throw err;
    }

    if (!text.trim()) {
      throw new Error('get_panel 返回了空响应');
    }

    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error(`get_panel 返回的不是有效 JSON: ${e?.message || e}`);
    }
  }

  async function fetchPanel(videoId) {
    try {
      return await requestPanel(videoId, false);
    } catch (e) {
      if (e?.status === 401) {
        warn('single auth got 401, retrying dual auth');
        return await requestPanel(videoId, true);
      }
      throw e;
    }
  }

  function runsText(value) {
    if (!value) return '';
    if (typeof value.simpleText === 'string') return value.simpleText;
    if (Array.isArray(value.runs)) return value.runs.map(x => x?.text || '').join('');
    return '';
  }

  function msToTimestamp(ms) {
    const sec = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  }

  function normalizeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function parseTranscriptPanel(root) {
    const found = [];

    function walk(node) {
      if (!node) return;

      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }

      if (typeof node !== 'object') return;

      const vm = node.transcriptSegmentViewModel;
      if (vm) {
        const text = normalizeText(vm.simpleText || runsText(vm.snippet) || runsText(vm.text));
        const timestamp = String(vm.timestamp || '').trim();
        if (text) found.push({ timestamp, text });
      }

      const legacy = node.transcriptSegmentRenderer;
      if (legacy) {
        const text = normalizeText(
          runsText(legacy.snippet) ||
          runsText(legacy.text) ||
          legacy.simpleText
        );
        const timestamp =
          runsText(legacy.startTimeText) ||
          String(legacy.timestamp || '').trim() ||
          msToTimestamp(legacy.startMs);
        if (text) found.push({ timestamp, text });
      }

      for (const value of Object.values(node)) walk(value);
    }

    walk(root);

    const deduped = [];
    for (const seg of found) {
      const prev = deduped[deduped.length - 1];
      if (prev && prev.timestamp === seg.timestamp && prev.text === seg.text) continue;
      deduped.push(seg);
    }

    return deduped;
  }

  function formatTranscript(segments) {
    return segments.map(({ timestamp, text }) => (
      timestamp ? `${timestamp} ${text}` : text
    )).join('\n');
  }

  function setStatus(message, kind = 'normal') {
    if (!ui.status) return;
    ui.status.textContent = message;
    ui.status.dataset.kind = kind;
  }

  async function extract(reason = 'manual') {
    const videoId = getVideoId();
    if (!videoId) {
      setStatus('当前页面未识别到 YouTube 视频 ID', 'error');
      return;
    }

    const serial = ++requestSerial;
    currentVideoId = videoId;
    ui.extract.disabled = true;
    setStatus(`读取 ${videoId} 的原生转写面板…`);

    try {
      const panel = await fetchPanel(videoId);
      if (serial !== requestSerial) return;

      const segments = parseTranscriptPanel(panel);
      if (!segments.length) {
        throw new Error('get_panel 成功，但没有找到 transcript segment；该视频可能没有可用转写');
      }

      const text = formatTranscript(segments);
      ui.textarea.value = text;
      setStatus(`完成：${segments.length} 段，${text.length.toLocaleString()} 字符`, 'ok');
      log('extract success', { videoId, reason, segments: segments.length });
    } catch (e) {
      if (serial !== requestSerial) return;
      warn('extract failed:', e);
      setStatus(`提取失败：${e?.message || e}`, 'error');
    } finally {
      if (serial === requestSerial) ui.extract.disabled = false;
    }
  }

  async function copyTranscript() {
    const text = ui.textarea?.value || '';
    if (!text) {
      setStatus('没有可复制的转写文本', 'error');
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setStatus(`已复制 ${text.length.toLocaleString()} 字符`, 'ok');
      return;
    } catch {}

    ui.textarea.focus();
    ui.textarea.select();
    const ok = document.execCommand('copy');
    setStatus(ok ? `已复制 ${text.length.toLocaleString()} 字符` : '复制失败，请手动 Ctrl+C', ok ? 'ok' : 'error');
  }

  function downloadTranscript() {
    const text = ui.textarea?.value || '';
    if (!text) {
      setStatus('没有可下载的转写文本', 'error');
      return;
    }

    const id = getVideoId() || 'youtube';
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `youtube_transcript_${id}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('TXT 已生成', 'ok');
  }

  function mount() {
    if (mounted || !document.body) return;
    mounted = true;

    const style = document.createElement('style');
    style.textContent = `
      #yt-transcript-fast-panel {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483646;
        width: min(460px, calc(100vw - 32px));
        color: #f1f1f1;
        background: rgba(28, 28, 28, .97);
        border: 1px solid rgba(255,255,255,.16);
        border-radius: 12px;
        box-shadow: 0 8px 30px rgba(0,0,0,.35);
        font: 13px/1.45 Arial, "Microsoft YaHei", sans-serif;
        overflow: hidden;
      }
      #yt-transcript-fast-panel * { box-sizing: border-box; }
      #yt-transcript-fast-panel .yt-tf-head {
        height: 38px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 10px;
        background: rgba(255,255,255,.06);
        user-select: none;
      }
      #yt-transcript-fast-panel .yt-tf-title {
        flex: 1;
        font-weight: 600;
      }
      #yt-transcript-fast-panel button {
        color: inherit;
        background: rgba(255,255,255,.09);
        border: 1px solid rgba(255,255,255,.14);
        border-radius: 7px;
        padding: 5px 9px;
        cursor: pointer;
      }
      #yt-transcript-fast-panel button:hover { background: rgba(255,255,255,.16); }
      #yt-transcript-fast-panel button:disabled { opacity: .5; cursor: default; }
      #yt-transcript-fast-panel .yt-tf-body { padding: 9px; }
      #yt-transcript-fast-panel .yt-tf-actions {
        display: flex;
        gap: 7px;
        margin-bottom: 8px;
      }
      #yt-transcript-fast-panel textarea {
        display: block;
        width: 100%;
        height: min(42vh, 480px);
        resize: vertical;
        color: #f1f1f1;
        background: #111;
        border: 1px solid rgba(255,255,255,.16);
        border-radius: 8px;
        padding: 9px;
        outline: none;
        font: 12px/1.55 Consolas, "Microsoft YaHei", monospace;
        white-space: pre-wrap;
      }
      #yt-transcript-fast-panel .yt-tf-status {
        margin-top: 7px;
        min-height: 18px;
        color: #bbb;
        overflow-wrap: anywhere;
      }
      #yt-transcript-fast-panel .yt-tf-status[data-kind="ok"] { color: #9bd89b; }
      #yt-transcript-fast-panel .yt-tf-status[data-kind="error"] { color: #ff9f9f; }
      #yt-transcript-fast-panel[data-minimized="1"] .yt-tf-body { display: none; }
    `;
    document.documentElement.appendChild(style);

    const root = document.createElement('section');
    root.id = 'yt-transcript-fast-panel';

    const head = document.createElement('div');
    head.className = 'yt-tf-head';

    const title = document.createElement('div');
    title.className = 'yt-tf-title';
    title.textContent = 'YouTube 转写提取';

    const minimize = document.createElement('button');
    minimize.type = 'button';
    minimize.textContent = '—';
    minimize.title = '最小化/展开';

    const body = document.createElement('div');
    body.className = 'yt-tf-body';

    const actions = document.createElement('div');
    actions.className = 'yt-tf-actions';

    const extractBtn = document.createElement('button');
    extractBtn.type = 'button';
    extractBtn.textContent = '重新提取';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = '复制';

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.textContent = '下载 TXT';

    const textarea = document.createElement('textarea');
    textarea.spellcheck = false;
    textarea.placeholder = '进入 YouTube 视频页后会自动提取时间 + 转写文本。';

    const status = document.createElement('div');
    status.className = 'yt-tf-status';
    status.textContent = '等待视频页面…';

    actions.append(extractBtn, copyBtn, downloadBtn);
    body.append(actions, textarea, status);
    head.append(title, minimize);
    root.append(head, body);
    document.body.appendChild(root);

    Object.assign(ui, {
      root,
      status,
      textarea,
      extract: extractBtn,
      copy: copyBtn,
      download: downloadBtn,
      minimize,
      body,
    });

    extractBtn.addEventListener('click', () => extract('manual'));
    copyBtn.addEventListener('click', copyTranscript);
    downloadBtn.addEventListener('click', downloadTranscript);
    minimize.addEventListener('click', () => {
      const minimized = root.dataset.minimized === '1';
      root.dataset.minimized = minimized ? '0' : '1';
      minimize.textContent = minimized ? '—' : '+';
    });

    log('panel created');
    scheduleAutoExtract('mount', 700);
  }

  function scheduleAutoExtract(reason, delay = 500) {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      const id = getVideoId();
      if (!id) {
        currentVideoId = '';
        if (ui.textarea) ui.textarea.value = '';
        setStatus('当前不是可识别的视频页面');
        return;
      }

      if (id !== currentVideoId || !ui.textarea?.value) {
        if (id !== currentVideoId && ui.textarea) ui.textarea.value = '';
        extract(reason);
      }
    }, delay);
  }

  function onNavigation(reason) {
    const id = getVideoId();
    if (id !== currentVideoId) {
      ++requestSerial;
      currentVideoId = '';
      if (ui.textarea) ui.textarea.value = '';
      setStatus('检测到视频切换，准备提取…');
    }
    scheduleAutoExtract(reason, 700);
  }

  function boot() {
    const tryMount = () => {
      if (document.body) mount();
      else setTimeout(tryMount, 100);
    };
    tryMount();

    document.addEventListener('yt-navigate-finish', () => onNavigation('yt-navigate-finish'), true);
    window.addEventListener('popstate', () => onNavigation('popstate'));

    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        onNavigation('url-change');
      }
    }, 1000);
  }

  boot();
})();
