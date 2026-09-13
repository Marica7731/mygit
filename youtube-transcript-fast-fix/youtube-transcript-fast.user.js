// ==UserScript==
// @name         YouTube 转写文稿时间文本提取器 - get_panel 修正版
// @namespace    https://github.com/Marica7731/mygit
// @version      2.1.0
// @description  视频页按需提取 YouTube 原生转写；一键复制“元数据 + 时间戳字幕 + GPT 总结提示词”，默认不弹窗。
// @author       Marica7731
// @match        https://www.youtube.com/*
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  if (window.top !== window.self) return;

  const LOG = '[YT-TRANSCRIPT-FAST]';
  const PANEL_ID = 'PAmodern_transcript_view';
  const ROOT_ID = 'yt-transcript-fast-root';
  const PANEL_DOM_ID = 'yt-transcript-fast-panel';
  const STYLE_ID = 'yt-transcript-fast-style';
  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  let currentVideoId = '';
  let requestSerial = 0;
  let navTimer = 0;
  const transcriptCache = new Map();

  const ui = {
    root: null,
    copyGpt: null,
    showTranscript: null,
    panel: null,
    textarea: null,
    status: null,
    refresh: null,
    copyRaw: null,
    download: null,
  };

  function log(...args) {
    console.log(LOG, ...args);
  }

  function warn(...args) {
    console.warn(LOG, ...args);
  }

  function isVideoPage(url = location.href) {
    return Boolean(getVideoId(url));
  }

  function getVideoId(url = location.href) {
    try {
      const u = new URL(url, location.origin);
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
      'X-YouTube-Client-Version': String(
        getCfg('INNERTUBE_CLIENT_VERSION') || context?.client?.clientVersion || ''
      ),
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
      body: JSON.stringify({ context, panelId: PANEL_ID, params }),
    });

    const text = await response.text();
    if (!response.ok) {
      const err = new Error(
        `get_panel HTTP ${response.status}${text ? `: ${text.slice(0, 180)}` : ''}`
      );
      err.status = response.status;
      throw err;
    }

    if (!text.trim()) throw new Error('get_panel 返回了空响应');

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

  function secondsToDuration(seconds) {
    const n = Number(seconds);
    if (!Number.isFinite(n) || n < 0) return '';
    return msToTimestamp(n * 1000);
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
          runsText(legacy.snippet) || runsText(legacy.text) || legacy.simpleText
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
    return segments
      .map(({ timestamp, text }) => (timestamp ? `${timestamp} ${text}` : text))
      .join('\n');
  }

  async function getTranscript(videoId, force = false) {
    if (!force && transcriptCache.has(videoId)) return transcriptCache.get(videoId);

    const panel = await fetchPanel(videoId);
    const segments = parseTranscriptPanel(panel);
    if (!segments.length) {
      throw new Error('没有找到可用的 transcript segment；该视频可能没有文字记录');
    }

    const text = formatTranscript(segments);
    const result = { segments, text };
    transcriptCache.set(videoId, result);
    return result;
  }

  function firstText(selectors) {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const text = normalizeText(el?.textContent || '');
      if (text) return text;
    }
    return '';
  }

  function firstHref(selectors) {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el?.href) return el.href;
    }
    return '';
  }

  function getPlayerResponse(videoId) {
    const candidates = [
      pageWindow.ytInitialPlayerResponse,
      document.querySelector('ytd-watch-flexy')?.playerData,
      document.querySelector('ytd-player')?.playerResponse,
    ];

    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object') continue;
      const details = candidate.videoDetails;
      if (!details) continue;
      if (!videoId || !details.videoId || details.videoId === videoId) return candidate;
    }
    return null;
  }

  function getVideoMeta(videoId) {
    const player = getPlayerResponse(videoId);
    const details = player?.videoDetails || {};
    const micro = player?.microformat?.playerMicroformatRenderer || {};

    const title =
      normalizeText(details.title) ||
      firstText([
        'ytd-watch-metadata h1 yt-formatted-string',
        'h1.ytd-watch-metadata yt-formatted-string',
        'meta[name="title"]',
      ]) ||
      document.title.replace(/\s*-\s*YouTube\s*$/, '');

    const channel =
      normalizeText(details.author) ||
      firstText([
        'ytd-watch-metadata #owner #channel-name a',
        'ytd-watch-metadata ytd-channel-name a',
        '#owner-name a',
      ]);

    const channelUrl =
      firstHref([
        'ytd-watch-metadata #owner #channel-name a',
        'ytd-watch-metadata ytd-channel-name a',
        '#owner-name a',
      ]) ||
      (details.channelId ? `https://www.youtube.com/channel/${details.channelId}` : '');

    const duration =
      secondsToDuration(details.lengthSeconds) ||
      (Number.isFinite(document.querySelector('video')?.duration)
        ? secondsToDuration(document.querySelector('video').duration)
        : '');

    const displayedDate = firstText([
      'ytd-watch-info-text #info yt-formatted-string',
      '#info-strings yt-formatted-string',
    ]);

    return {
      title,
      channel,
      channelUrl,
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      duration,
      published: micro.publishDate || micro.uploadDate || displayedDate || '',
      viewCount: details.viewCount || '',
    };
  }

  function buildGptPrompt(meta, transcript) {
    const lines = [
      '请总结下面这个 YouTube 视频。',
      '请以字幕内容为主要依据，不要只根据标题猜测。自动字幕可能有识别错误；涉及人名、机构名、作品名、日期、活动名等专名时，请结合上下文判断，不确定就明确说明。',
      '请先概括视频主要讲了什么，再列出重要信息、关键时间点、明确宣布的后续安排；如果存在“玩笑/调侃”和“正式告知”，请区分，不要把玩笑当成事实。',
      '',
      `视频标题：${meta.title || '未取得'}`,
      `频道：${meta.channel || '未取得'}`,
      meta.channelUrl ? `频道链接：${meta.channelUrl}` : '',
      `视频 ID：${meta.videoId}`,
      `视频链接：${meta.url}`,
      meta.published ? `发布日期/页面显示日期：${meta.published}` : '',
      meta.duration ? `时长：${meta.duration}` : '',
      meta.viewCount ? `播放量（页面数据）：${meta.viewCount}` : '',
      '',
      '以下为带时间戳字幕：',
      transcript,
    ];

    return lines.filter((line, index, arr) => line !== '' || index < 4 || arr[index - 1] !== '').join('\n');
  }

  async function writeClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}

    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }

  function showToast(message, kind = 'normal', timeout = 2200) {
    if (!document.body) return;
    const old = document.getElementById('yt-transcript-fast-toast');
    old?.remove();

    const toast = document.createElement('div');
    toast.id = 'yt-transcript-fast-toast';
    toast.textContent = message;
    toast.dataset.kind = kind;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), timeout);
  }

  function setBusy(busy) {
    if (!ui.copyGpt) return;
    ui.copyGpt.disabled = busy;
    ui.showTranscript.disabled = busy;
    ui.copyGpt.textContent = busy ? '提取中…' : '复制给 GPT';
  }

  async function copyForGpt() {
    const videoId = getVideoId();
    if (!videoId) return;

    const serial = ++requestSerial;
    setBusy(true);
    showToast('正在读取视频信息和字幕…', 'normal', 5000);

    try {
      const { text } = await getTranscript(videoId, false);
      if (serial !== requestSerial || videoId !== getVideoId()) return;

      const meta = getVideoMeta(videoId);
      const prompt = buildGptPrompt(meta, text);
      const ok = await writeClipboard(prompt);
      if (!ok) throw new Error('浏览器拒绝写入剪贴板');

      showToast(`已复制给 GPT：${meta.title || videoId}（${text.length.toLocaleString()} 字字幕）`, 'ok', 3500);
      log('copied GPT prompt', { videoId, chars: prompt.length });
    } catch (e) {
      warn('copyForGpt failed', e);
      showToast(`复制失败：${e?.message || e}`, 'error', 5000);
    } finally {
      if (serial === requestSerial) setBusy(false);
    }
  }

  function setPanelStatus(message, kind = 'normal') {
    if (!ui.status) return;
    ui.status.textContent = message;
    ui.status.dataset.kind = kind;
  }

  async function loadPanelTranscript(force = false) {
    const videoId = getVideoId();
    if (!videoId || !ui.panel) return;

    ui.refresh.disabled = true;
    setPanelStatus('读取字幕中…');
    try {
      const { text, segments } = await getTranscript(videoId, force);
      ui.textarea.value = text;
      setPanelStatus(`完成：${segments.length} 段，${text.length.toLocaleString()} 字符`, 'ok');
    } catch (e) {
      setPanelStatus(`提取失败：${e?.message || e}`, 'error');
    } finally {
      ui.refresh.disabled = false;
    }
  }

  function destroyPanel() {
    ui.panel?.remove();
    ui.panel = null;
    ui.textarea = null;
    ui.status = null;
    ui.refresh = null;
    ui.copyRaw = null;
    ui.download = null;
  }

  function openPanel() {
    if (ui.panel) {
      destroyPanel();
      return;
    }

    const panel = document.createElement('section');
    panel.id = PANEL_DOM_ID;

    const head = document.createElement('div');
    head.className = 'yt-tf-head';

    const title = document.createElement('div');
    title.className = 'yt-tf-title';
    title.textContent = 'YouTube 字幕';

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.title = '关闭';

    const actions = document.createElement('div');
    actions.className = 'yt-tf-actions';

    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.textContent = '重新提取';

    const copyRaw = document.createElement('button');
    copyRaw.type = 'button';
    copyRaw.textContent = '复制字幕';

    const download = document.createElement('button');
    download.type = 'button';
    download.textContent = '下载 TXT';

    const textarea = document.createElement('textarea');
    textarea.spellcheck = false;

    const status = document.createElement('div');
    status.className = 'yt-tf-status';

    head.append(title, close);
    actions.append(refresh, copyRaw, download);
    panel.append(head, actions, textarea, status);
    document.body.appendChild(panel);

    Object.assign(ui, { panel, textarea, status, refresh, copyRaw, download });

    close.addEventListener('click', destroyPanel);
    refresh.addEventListener('click', () => loadPanelTranscript(true));
    copyRaw.addEventListener('click', async () => {
      if (!textarea.value) await loadPanelTranscript(false);
      if (!textarea.value) return;
      const ok = await writeClipboard(textarea.value);
      setPanelStatus(ok ? '字幕已复制' : '复制失败，请手动 Ctrl+C', ok ? 'ok' : 'error');
    });
    download.addEventListener('click', async () => {
      if (!textarea.value) await loadPanelTranscript(false);
      if (!textarea.value) return;
      const id = getVideoId() || 'youtube';
      const blob = new Blob([textarea.value], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `youtube_transcript_${id}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setPanelStatus('TXT 已生成', 'ok');
    });

    loadPanelTranscript(false);
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID} {
        position: fixed;
        right: 14px;
        bottom: 14px;
        z-index: 2147483646;
        display: flex;
        gap: 5px;
        align-items: center;
        font: 12px/1.2 Arial, "Microsoft YaHei", sans-serif;
      }
      #${ROOT_ID} button,
      #${PANEL_DOM_ID} button {
        color: #f1f1f1;
        background: rgba(30, 30, 30, .92);
        border: 1px solid rgba(255,255,255,.18);
        border-radius: 8px;
        cursor: pointer;
      }
      #${ROOT_ID} button:hover,
      #${PANEL_DOM_ID} button:hover { background: rgba(55,55,55,.96); }
      #${ROOT_ID} button:disabled,
      #${PANEL_DOM_ID} button:disabled { opacity: .55; cursor: default; }
      #${ROOT_ID} .yt-tf-copy-gpt {
        padding: 7px 10px;
        font-weight: 600;
        box-shadow: 0 4px 16px rgba(0,0,0,.28);
      }
      #${ROOT_ID} .yt-tf-show {
        padding: 7px 8px;
        box-shadow: 0 4px 16px rgba(0,0,0,.22);
      }
      #${PANEL_DOM_ID} {
        position: fixed;
        right: 14px;
        bottom: 54px;
        z-index: 2147483646;
        width: min(470px, calc(100vw - 28px));
        color: #f1f1f1;
        background: rgba(24,24,24,.98);
        border: 1px solid rgba(255,255,255,.16);
        border-radius: 12px;
        box-shadow: 0 10px 32px rgba(0,0,0,.4);
        padding: 9px;
        font: 12px/1.45 Arial, "Microsoft YaHei", sans-serif;
      }
      #${PANEL_DOM_ID} .yt-tf-head {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }
      #${PANEL_DOM_ID} .yt-tf-title { flex: 1; font-weight: 600; }
      #${PANEL_DOM_ID} .yt-tf-head button { padding: 3px 8px; font-size: 16px; }
      #${PANEL_DOM_ID} .yt-tf-actions {
        display: flex;
        gap: 6px;
        margin-bottom: 8px;
      }
      #${PANEL_DOM_ID} .yt-tf-actions button { padding: 5px 8px; }
      #${PANEL_DOM_ID} textarea {
        display: block;
        width: 100%;
        height: min(42vh, 470px);
        resize: vertical;
        color: #f1f1f1;
        background: #101010;
        border: 1px solid rgba(255,255,255,.14);
        border-radius: 8px;
        padding: 8px;
        outline: none;
        font: 12px/1.55 Consolas, "Microsoft YaHei", monospace;
        white-space: pre-wrap;
      }
      #${PANEL_DOM_ID} .yt-tf-status {
        margin-top: 7px;
        min-height: 17px;
        color: #bbb;
        overflow-wrap: anywhere;
      }
      #${PANEL_DOM_ID} .yt-tf-status[data-kind="ok"] { color: #9bd89b; }
      #${PANEL_DOM_ID} .yt-tf-status[data-kind="error"] { color: #ff9f9f; }
      #yt-transcript-fast-toast {
        position: fixed;
        left: 50%;
        bottom: 74px;
        transform: translateX(-50%);
        z-index: 2147483647;
        max-width: min(680px, calc(100vw - 32px));
        padding: 9px 12px;
        border-radius: 9px;
        color: #f1f1f1;
        background: rgba(20,20,20,.96);
        border: 1px solid rgba(255,255,255,.16);
        box-shadow: 0 6px 24px rgba(0,0,0,.32);
        font: 12px/1.4 Arial, "Microsoft YaHei", sans-serif;
        pointer-events: none;
      }
      #yt-transcript-fast-toast[data-kind="ok"] { border-color: rgba(130,210,130,.55); }
      #yt-transcript-fast-toast[data-kind="error"] { border-color: rgba(255,120,120,.65); }
    `;
    document.documentElement.appendChild(style);
  }

  function mountLauncher() {
    if (!document.body || !isVideoPage()) return;
    if (document.getElementById(ROOT_ID)) return;

    ensureStyle();
    const root = document.createElement('div');
    root.id = ROOT_ID;

    const copyGpt = document.createElement('button');
    copyGpt.type = 'button';
    copyGpt.className = 'yt-tf-copy-gpt';
    copyGpt.textContent = '复制给 GPT';
    copyGpt.title = '复制视频标题、频道、链接和完整时间戳字幕，并附带总结提示词';

    const showTranscript = document.createElement('button');
    showTranscript.type = 'button';
    showTranscript.className = 'yt-tf-show';
    showTranscript.textContent = '字幕';
    showTranscript.title = '查看/复制原始字幕';

    root.append(copyGpt, showTranscript);
    document.body.appendChild(root);

    Object.assign(ui, { root, copyGpt, showTranscript });
    copyGpt.addEventListener('click', copyForGpt);
    showTranscript.addEventListener('click', openPanel);
    log('launcher mounted', getVideoId());
  }

  function unmountLauncher() {
    destroyPanel();
    ui.root?.remove();
    ui.root = null;
    ui.copyGpt = null;
    ui.showTranscript = null;
    document.getElementById('yt-transcript-fast-toast')?.remove();
  }

  function syncPage(reason = 'navigation') {
    clearTimeout(navTimer);
    navTimer = setTimeout(() => {
      const videoId = getVideoId();
      if (!videoId) {
        if (currentVideoId) ++requestSerial;
        currentVideoId = '';
        unmountLauncher();
        return;
      }

      if (videoId !== currentVideoId) {
        ++requestSerial;
        currentVideoId = videoId;
        destroyPanel();
      }
      mountLauncher();
      log('page synced', { reason, videoId });
    }, 250);
  }

  function boot() {
    const waitBody = () => {
      if (!document.body) {
        setTimeout(waitBody, 100);
        return;
      }
      syncPage('boot');
    };
    waitBody();

    document.addEventListener('yt-navigate-finish', () => syncPage('yt-navigate-finish'), true);
    window.addEventListener('popstate', () => syncPage('popstate'));

    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        syncPage('url-change');
      }
    }, 800);
  }

  boot();
})();
