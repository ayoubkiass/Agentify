// Content script: provide page content to extension and execute actions from API JSON
// IIFE so re-injection (e.g. from ensureContentScriptInTab) can exit without duplicate declaration
(function () {
  'use strict';
  if (window.__agentContentLoaded__) return;
  window.__agentContentLoaded__ = true;

const PAGE_TEXT_MAX = 12000;

/** Map of id -> DOM node for clickable elements (persists between getPageContent and executeActions). */
let AI_CLICKABLE_MAP = {};

/** Virtual cursor: element and last position for animating to click targets. */
let virtualCursorEl = null;
let virtualCursorPosition = { x: 0, y: 0 };

function ensureVirtualCursor() {
  if (virtualCursorEl && document.body.contains(virtualCursorEl)) return virtualCursorEl;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('class', 'virtual-cursor');
  svg.innerHTML = '<path fill="#333" stroke="#fff" stroke-width="1.2" d="M4 4l7.2 16 2.8-7 7-2.8L4 4z"/>';
  document.body.appendChild(svg);
  virtualCursorEl = svg;
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  virtualCursorPosition = { x: cx, y: cy };
  virtualCursorEl.style.left = cx - 12 + 'px';
  virtualCursorEl.style.top = cy - 12 + 'px';
  return virtualCursorEl;
}

/** Move virtual cursor to (x, y) in viewport coordinates; resolves after transition. */
function moveVirtualCursorTo(x, y) {
  const cursor = ensureVirtualCursor();
  const size = 24;
  const left = x - size / 2;
  const top = y - size / 2;
  cursor.style.left = left + 'px';
  cursor.style.top = top + 'px';
  virtualCursorPosition = { x, y };
  return new Promise((resolve) => setTimeout(resolve, 380));
}

/** Animate virtual cursor moving on the page (e.g. when user sends a prompt). */
function moveVirtualCursorOnPage() {
  const cursor = ensureVirtualCursor();
  const w = window.innerWidth;
  const h = window.innerHeight;
  const padding = 80;
  const points = [
    { x: padding, y: padding },
    { x: w - padding, y: padding },
    { x: w - padding, y: h - padding },
    { x: padding, y: h - padding },
    { x: w / 2, y: h / 2 },
  ];
  let i = 0;
  function next() {
    if (i >= points.length) return;
    const p = points[i++];
    moveVirtualCursorTo(p.x, p.y).then(next);
  }
  next();
}

const TEXT_INPUT_TYPES = ['text', 'search', 'email', 'url', 'tel', 'password', 'number'];

function getClickableElements() {
  const all = document.querySelectorAll('*');
  const clickable = [];
  all.forEach((el, index) => {
    const style = window.getComputedStyle(el);
    const isPointer = style.cursor === 'pointer';
    const tag = (el.tagName || '').toUpperCase();
    const isLink = tag === 'A' || el.getAttribute('role') === 'link';
    const isSelect = tag === 'SELECT';
    const isClickableTag =
      isLink ||
      tag === 'BUTTON' ||
      isSelect ||
      (tag === 'INPUT' && ['button', 'submit', 'checkbox', 'radio'].includes((el.type || '').toLowerCase()));
    const isTextInputOrArea =
      el.tagName === 'TEXTAREA' ||
      (el.tagName === 'INPUT' &&
        (el.type || 'text').toLowerCase() !== 'hidden' &&
        TEXT_INPUT_TYPES.includes((el.type || 'text').toLowerCase()));
    const isContentEditable = el.isContentEditable || (el.getAttribute && el.getAttribute('contenteditable') === 'true');
    const hasOnClick = typeof el.onclick === 'function' || el.hasAttribute('onclick');
    const roleButton = el.getAttribute('role') === 'button';
    if (isSelect || isLink || isPointer || isClickableTag || isTextInputOrArea || isContentEditable || hasOnClick || roleButton) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      clickable.push({
        id: index,
        node: el,
        tag: el.tagName.toLowerCase(),
        text: (el.innerText && el.innerText.trim().slice(0, 80)) || el.value || el.getAttribute('aria-label') || el.title || el.placeholder || '',
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      });
    }
  });
  return clickable;
}

function filterTopLevelClickable(elements) {
  return elements.filter((el, i) => {
    for (let j = 0; j < elements.length; j++) {
      if (i === j) continue;
      if (elements[j].node.contains(el.node)) return false;
    }
    return true;
  });
}

const CLICKABLE_HTML_MAX = 800;

function buildCleanClickableList() {
  const raw = getClickableElements();
  const filtered = filterTopLevelClickable(raw);
  AI_CLICKABLE_MAP = {};
  return filtered.map((el, idx) => {
    AI_CLICKABLE_MAP[idx] = el.node;
    const html = (el.node.innerHTML || '').trim();
    const item = {
      id: idx,
      tag: el.tag,
      text: el.text,
      rect: el.rect,
      html: html.length > CLICKABLE_HTML_MAX ? html.slice(0, CLICKABLE_HTML_MAX) + '…' : html,
    };
    if (el.node.tagName && el.node.tagName.toUpperCase() === 'SELECT' && el.node.options) {
      item.options = Array.from(el.node.options).map((opt) => ({
        value: opt.value != null ? String(opt.value) : '',
        text: (opt.text || '').trim().slice(0, 120),
      }));
    }
    return item;
  });
}

const CONTENT_SELECTORS = [
  'article',
  '[role="main"]',
  'main',
  '.post-content',
  '.article-body',
  '.content',
  '.markdown-body',
  '#content',
  '.documentation',
  '[itemprop="articleBody"]',
];

/** Get the main content element (clone so we don't mutate the page). */
function getMainContentElement() {
  for (const sel of CONTENT_SELECTORS) {
    const el = document.querySelector(sel);
    if (el) {
      const text = (el.innerText || el.textContent || '').trim();
      if (text.length > 100) return el;
    }
  }
  return document.body;
}

/** Get main content as HTML string, with noise removed. */
function getPageHtml() {
  const el = getMainContentElement();
  if (!el) return '';
  const clone = el.cloneNode(true);
  for (const tag of ['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript', 'iframe']) {
    clone.querySelectorAll(tag).forEach((n) => n.remove());
  }
  return clone.innerHTML;
}

/** Convert HTML to cleaned Markdown using Turndown. */
function htmlToMarkdown(html) {
  if (!html || typeof window.TurndownService !== 'function') {
    return '';
  }
  try {
    const turndown = new window.TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
    });
    ['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript', 'iframe'].forEach(function (tag) {
      turndown.remove(tag);
    });
    const markdown = turndown.turndown(html);
    return markdown.replace(/\n{3,}/g, '\n\n').trim();
  } catch (e) {
    return '';
  }
}

function getPageContent() {
  const clickable = buildCleanClickableList();
  return {
    url: window.location.href,
    title: document.title || '',
    text: '',
    clickable,
  };
}

/** X-ray: highlight elements that are sent to the API (clickables + main content) and readable text elements. */
let xrayVisible = false;
const XRAY_STYLE_ID = 'agent-xray-injected-styles';
/* Elements that can have readable text (including div/span with direct text) */
const READABLE_SELECTORS = 'p, h1, h2, h3, h4, h5, h6, li, td, th, label, figcaption, blockquote, div, span, [role="paragraph"]';
const READABLE_MAX = 500;

function getReadableTextElements() {
  const candidates = document.querySelectorAll(READABLE_SELECTORS);
  const result = [];
  for (const el of candidates) {
    const text = (el.innerText || el.textContent || '').trim();
    if (text.length === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    result.push(el);
    if (result.length >= READABLE_MAX) break;
  }
  return result;
}

/* X-ray: 1px green for clickable, 1px yellow for readable */
const XRAY_CLICKABLE_STYLE = 'outline: 1px solid #22c55e !important; outline-offset: 1px !important; box-sizing: border-box !important;';
const XRAY_READABLE_STYLE = 'outline: 1px solid #eab308 !important; outline-offset: 1px !important; box-sizing: border-box !important;';

function ensureXrayStylesInPage() {
  if (document.getElementById(XRAY_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = XRAY_STYLE_ID;
  style.textContent = [
    '.agent-xray-clickable { ' + XRAY_CLICKABLE_STYLE + ' }',
    '.agent-xray-content { outline: 1px solid #ca8a04 !important; outline-offset: 1px !important; box-sizing: border-box !important; }',
    '.agent-xray-readable { ' + XRAY_READABLE_STYLE + ' }',
  ].join(' ');
  (document.head || document.documentElement).appendChild(style);
}

function toggleXray() {
  const clickableClass = 'agent-xray-clickable';
  const contentClass = 'agent-xray-content';
  const readableClass = 'agent-xray-readable';
  console.log('[Agent X-ray] toggleXray called, xrayVisible=', xrayVisible);
  if (xrayVisible) {
    document.querySelectorAll('.' + clickableClass).forEach((el) => el.classList.remove(clickableClass));
    document.querySelectorAll('.' + contentClass).forEach((el) => el.classList.remove(contentClass));
    document.querySelectorAll('.' + readableClass).forEach((el) => el.classList.remove(readableClass));
    xrayVisible = false;
    return { visible: false };
  }
  ensureXrayStylesInPage();
  const raw = getClickableElements();
  const filtered = filterTopLevelClickable(raw);
  console.log('[Agent X-ray] Show:', filtered.length, 'clickables (from', raw.length, 'raw)');
  filtered.forEach((item) => item.node.classList.add(clickableClass));
  const mainContent = getMainContentElement();
  if (mainContent && mainContent !== document.body) {
    mainContent.classList.add(contentClass);
    console.log('[Agent X-ray] Main content outlined:', mainContent.tagName, mainContent.className || '(no class)');
  }
  const readableEls = getReadableTextElements();
  console.log('[Agent X-ray] Readable text elements outlined:', readableEls.length);
  readableEls.forEach((el) => el.classList.add(readableClass));
  const clickable = getPageContent().clickable;
  const readable = readableEls.map((el, i) => {
    const r = el.getBoundingClientRect();
    const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 300);
    return { i, tag: el.tagName.toLowerCase(), text, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
  });
  xrayVisible = true;
  return { visible: true, elementsJson: { clickable, readable } };
}

function findElement(selector) {
  try {
    const el = document.querySelector(selector);
    if (el) return el;
    // Fallback: try by text content
    const all = document.querySelectorAll('a, button, input, [role="button"]');
    for (const e of all) {
      if (e.textContent.trim().toLowerCase().includes(selector.toLowerCase())) return e;
    }
  } catch (_) {}
  return null;
}

function runAction(action) {
  if (!action || typeof action !== 'object') {
    return { ok: false, error: 'Invalid action object' };
  }
  const type = action.type;
  const selector = action.selector;
  const id = action.id;
  const value = action.value;
  const url = action.url;
  const direction = typeof action.direction === 'string' ? action.direction.toLowerCase() : action.direction;

  const getElForClickOrType = () => {
    if (id != null && typeof id === 'number' && AI_CLICKABLE_MAP[id]) return AI_CLICKABLE_MAP[id];
    if (selector != null && selector !== '') return findElement(selector);
    return null;
  };

  switch (type) {
    case 'click': {
      const el = getElForClickOrType();
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.click();
        return { ok: true };
      }
      return { ok: false, error: id != null ? 'Element id not found: ' + id : 'Missing selector or id for click' };
    }
    case 'type':
    case 'fill': {
      const el = getElForClickOrType();
      if (!el) return { ok: false, error: id != null ? 'Element id not found: ' + id : 'Missing selector or id for type/fill' };
      el.focus();
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const str = value != null ? String(value) : '';
      if (el.isContentEditable) {
        try {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          sel.removeAllRanges();
          sel.addRange(range);
          if (document.execCommand('insertText', false, str)) {
            el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: str }));
            return { ok: true };
          }
        } catch (_) {}
        el.innerText = str;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: str }));
      } else {
        el.value = str;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return { ok: true };
    }
    case 'select': {
      const el = id != null && typeof id === 'number' && AI_CLICKABLE_MAP[id] ? AI_CLICKABLE_MAP[id] : (selector ? findElement(selector) : null);
      if (!el) return { ok: false, error: id != null ? 'Element id not found: ' + id : 'Missing id or selector for select' };
      if ((el.tagName || '').toUpperCase() !== 'SELECT') return { ok: false, error: 'Element is not a select' };
      const val = value != null ? String(value) : '';
      el.value = val;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    }
    case 'navigate': {
      const targetUrl = url && String(url).trim();
      if (targetUrl) {
        return { ok: true, navigateUrl: targetUrl };
      }
      return { ok: false, error: 'Missing url for navigate' };
    }
    case 'scroll': {
      if (selector) {
        const el = findElement(selector);
        if (el) {
          el.scrollIntoView({ block: 'center' });
          return { ok: true };
        }
        return { ok: false, error: 'Element not found: ' + selector };
      }
      if (direction === 'up' || direction === 'down') {
        const amount = direction === 'up' ? -400 : 400;
        window.scrollBy(0, amount);
        return { ok: true };
      }
      return { ok: false, error: 'Invalid scroll: need selector or direction "up"/"down"' };
    }
    case 'wait': {
      const ms = Math.min(Number(action.ms) || 500, 3000);
      return new Promise((resolve) => setTimeout(() => resolve({ ok: true }), ms));
    }
    default:
      return { ok: false, error: 'Unknown action type: ' + (type ?? 'undefined') };
  }
}

async function executeActions(actions) {
  const list = Array.isArray(actions) ? actions : [];
  const results = [];
  let navigateUrl = null;
  for (let i = 0; i < list.length; i++) {
    const action = list[i];
    try {
      const result = await runAction(action);
      results.push(result);
      if (result && result.navigateUrl) navigateUrl = result.navigateUrl;
    } catch (err) {
      results.push({ ok: false, error: (err && err.message) || String(err) });
    }
  }
  return { results, navigateUrl };
}

// --- Smart wait: resolve when page has updated (DOM, network idle, or fallback) ---
const SMART_WAIT_TIMEOUT_MS = 8000;
const DOM_SETTLE_MS = 150;
const NETWORK_IDLE_MS = 500;

function waitForDOMChange(timeoutMs = SMART_WAIT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    let settleTimer = null;
    let timeoutTimer = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      if (settleTimer) clearTimeout(settleTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      resolve();
    };
    const observer = new MutationObserver(() => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(finish, DOM_SETTLE_MS);
    });
    const root = document.documentElement || document.body;
    if (!root) {
      resolve();
      return;
    }
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    timeoutTimer = setTimeout(finish, timeoutMs);
  });
}

function waitForNetworkIdle(timeoutMs = SMART_WAIT_TIMEOUT_MS, idleMs = NETWORK_IDLE_MS) {
  return new Promise((resolve) => {
    let lastResourceTime = Date.now();
    let idleTimer = null;
    let timeoutTimer = null;
    const checkIdle = () => {
      if (Date.now() - lastResourceTime >= idleMs) {
        if (idleTimer) clearTimeout(idleTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        resolve();
      }
    };
    try {
      const obs = new PerformanceObserver((list) => {
        lastResourceTime = Date.now();
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(checkIdle, idleMs);
      });
      obs.observe({ type: 'resource', buffered: true });
      idleTimer = setTimeout(checkIdle, idleMs);
      timeoutTimer = setTimeout(() => {
        try { obs.disconnect(); } catch (_) {}
        if (idleTimer) clearTimeout(idleTimer);
        resolve();
      }, timeoutMs);
    } catch (_) {
      setTimeout(resolve, Math.min(idleMs + 100, timeoutMs));
    }
  });
}

function waitForElement(selector, timeoutMs = SMART_WAIT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const el = document.querySelector(selector);
    if (el && document.body && document.body.contains(el)) {
      resolve(el);
      return;
    }
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      const found = document.querySelector(selector);
      if (found && document.body && document.body.contains(found)) {
        resolve(found);
        return true;
      }
      if (Date.now() >= deadline) {
        resolve(null);
        return true;
      }
      return false;
    };
    if (check()) return;
    const interval = setInterval(() => {
      if (check()) clearInterval(interval);
    }, 50);
    setTimeout(() => {
      clearInterval(interval);
      resolve(document.querySelector(selector) || null);
    }, timeoutMs);
  });
}

async function waitForPageUpdate() {
  try {
    await Promise.race([
      waitForDOMChange(),
      waitForNetworkIdle(),
      waitForElement('body'),
    ]);
  } catch (e) {
    console.log('[Agent] waitForPageUpdate fallback', e);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'getPageContent') {
    sendResponse(getPageContent());
    return false;
  }
  if (msg.type === 'executeActions') {
    executeActions(msg.actions || []).then((out) => {
      sendResponse(out.results);
      if (out.navigateUrl) window.location.href = out.navigateUrl;
    });
    return true;
  }
  if (msg.type === 'moveVirtualCursorOnPage') {
    moveVirtualCursorOnPage();
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'toggleXray') {
    console.log('[Agent X-ray] Message received in content script');
    sendResponse(toggleXray());
    return false;
  }
  if (msg.type === 'waitForPageUpdate') {
    waitForPageUpdate().then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  return false;
});

})();
