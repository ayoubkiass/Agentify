const messagesEl = document.getElementById('messages');
const welcomeEl = document.getElementById('welcome');
const form = document.getElementById('chatForm');
const input = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const viewChat = document.getElementById('viewChat');
const viewMemory = document.getElementById('viewMemory');
const viewPersonality = document.getElementById('viewPersonality');
const viewWaiting = document.getElementById('viewWaiting');
const viewDev = document.getElementById('viewDev');
const viewSettings = document.getElementById('viewSettings');
const memoryContent = document.getElementById('memoryContent');
const memorySaveBtn = document.getElementById('memorySaveBtn');
const memoryStatus = document.getElementById('memoryStatus');
const personalityContent = document.getElementById('personalityContent');
const personalitySaveBtn = document.getElementById('personalitySaveBtn');
const personalityStatus = document.getElementById('personalityStatus');
const devMarkdown = document.getElementById('devMarkdown');
const devModel = document.getElementById('devModel');
const devSystemPrompt = document.getElementById('devSystemPrompt');
const devScreenshotWrap = document.getElementById('devScreenshotWrap');
const devScreenshot = document.getElementById('devScreenshot');
const devXrayBtn = document.getElementById('devXrayBtn');
const settingsForm = document.getElementById('settingsForm');
const apiProviderSelect = document.getElementById('apiProvider');
const apiKeyInput = document.getElementById('apiKey');
const hfTokenInput = document.getElementById('hfToken');
const settingsStatus = document.getElementById('settingsStatus');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const openrouterModelRow = document.getElementById('openrouterModelRow');
const openrouterModelSelect = document.getElementById('openrouterModel');
const fetchModelsBtn = document.getElementById('fetchModelsBtn');
const fetchModelsStatus = document.getElementById('fetchModelsStatus');
const pageSummaryContent = document.getElementById('pageSummaryContent');
const refreshSummaryBtn = document.getElementById('refreshSummaryBtn');
const actionButtons = document.getElementById('actionButtons');
const stopBtn = document.getElementById('stopBtn');
const waitingList = document.getElementById('waitingList');
const includeScreenshotCheckbox = document.getElementById('includeScreenshotCheckbox');
const screenshotSentStatus = document.getElementById('screenshotSentStatus');

let currentAbortController = null;
let userRequestStopped = false;

const STORAGE_KEY = 'api_key';
const STORAGE_PROVIDER = 'api_provider';
const STORAGE_HF_TOKEN = 'hf_token';
const STORAGE_OPENROUTER_MODEL = 'openrouter_model';
const STORAGE_MEMORY = 'agent_memory';
const STORAGE_PERSONALITY = 'agent_personality';
const STORAGE_INCLUDE_SCREENSHOT = 'agent_include_screenshot';
const HF_CAPTION_MODEL = 'Salesforce/blip-image-captioning-base';

const API_CONFIG = {
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    supportsVision: true,
  },
  deepseek: {
    url: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    supportsVision: false,
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'qwen/qwen3-8b:free',
    supportsVision: false,
  },
};

const JSON_SYSTEM_PROMPT = `You are a browser automation assistant. You receive:
1) The current page URL and title
2) Text content from the page (truncated)
3) The user's task or question

You must respond with ONLY a valid JSON object. No markdown, no code fence, no explanation outside the JSON.

Use this exact shape:
{
  "message": "Optional short message to show the user",
  "done": false,
  "actions": [
    { "type": "click", "id": 0 },
    { "type": "click", "selector": "..." },
    { "type": "type", "id": 2, "value": "text" },
    { "type": "type", "selector": "...", "value": "..." },
    { "type": "fill", "selector": "...", "value": "..." },
    { "type": "navigate", "url": "https://..." },
    { "type": "scroll", "direction": "up" | "down" },
    { "type": "scroll", "selector": "..." },
    { "type": "wait", "ms": 500 },
    { "type": "switchTab", "tabId": 123 },
    { "type": "select", "id": 0, "value": "option-value" },
    { "type": "schedule", "description": "...", "intervalMinutes": 10 }
  ]
}

Scheduling: when the user asks to do something later or on a schedule (e.g. "refresh this page every 10 minutes", "tomorrow at 9am check the price of this product"), return a schedule action instead of page actions. Use {"type": "schedule", "description": "short label for the task", "intervalMinutes": N} for repeating every N minutes, or {"type": "schedule", "description": "...", "runAt": "YYYY-MM-DDTHH:mm:ss"} (ISO 8601) for once at a specific time. Optional: "action": "refresh" (refresh current tab) or "prompt" (remind with notification); "prompt": "what to run in Chat" when action is "prompt". Default action is "refresh" for interval and "prompt" for once if the user said "check" or "remind".

Select dropdowns: clickable items with tag "select" include an "options" array of { value, text }. Use {"type": "select", "id": <id>, "value": "<option value>"} to choose an option by its value.

Prefer "switchTab" over "navigate": when the user wants a site that is already open in another tab (see "Open tabs" in the message), use {"type": "switchTab", "tabId": <id>} with the tab id from that list instead of opening a new page with navigate.

When the user's request is NOT about the current page (e.g. "search Google for X", "go to Wikipedia", "open YouTube", "check weather on weather.com", or any task that clearly requires a different website), use the "navigate" action first. Provide a full URL (e.g. https://www.google.com/search?q=..., https://en.wikipedia.org/wiki/..., https://www.youtube.com). After navigation, the user will get a follow-up with the new page content so you can continue with click/type/scroll on that site. For search queries, build the search URL (e.g. Google: https://www.google.com/search?q=QUERY with query encoded).

When a "clickable" list is provided in the user message, prefer using "id" (the integer id from that list) for click and type actions instead of "selector". Each item has id, tag, text, rect. Use the id to refer to the exact element.

When the task is complete, return {"done": true, "message": "Summary of what was done"} and omit actions or use [].

You may receive follow-up messages with new page state. Return more actions or {"done": true, "message": "..."}.

If no page actions are needed, return {"message": "...", "done": true, "actions": []}.

Memory: The user message may include a "Current memory" section (saved context in markdown). Use it for user preferences and important facts. To save new information for future sessions (e.g. user name, preferences, important notes), add to your JSON: "saveToMemory": "markdown text to append". Keep entries concise and in markdown (e.g. bullet points).

Optional: For complex multi-step tasks, you may include "suggestedMaxSteps": N (number between 3 and 25) in your JSON so the session can allow more steps. Use only when the user's request clearly requires many steps (e.g. "fill the form, submit, then on the next page do X and Y").`;

const MIN_STEPS = 3;
const MAX_STEPS_CAP = 25;
const STEP_DELAY_MS = 700;

/** Dynamic max steps for this session based on prompt hardness and optional AI suggestion. */
function getMaxStepsForSession(userPrompt, aiSuggestedMax) {
  if (typeof aiSuggestedMax === 'number' && !Number.isNaN(aiSuggestedMax)) {
    return Math.max(MIN_STEPS, Math.min(MAX_STEPS_CAP, Math.round(aiSuggestedMax)));
  }
  const len = (userPrompt || '').trim().length;
  const words = (userPrompt || '').trim().split(/\s+/).filter(Boolean).length;
  if (words <= 5 && len <= 40) return 5;
  if (words <= 12 && len <= 80) return 8;
  if (words <= 25 || len <= 180) return 12;
  if (words <= 50 || len <= 350) return 16;
  return 20;
}

let currentTabId = null;
let pageContext = null;
/** What we last sent to the API – shown in Dev tab */
let lastSentModel = '';
let lastSentSystemPrompt = '';
let lastSentMarkdown = '';
let lastSentScreenshotDataUrl = null;

// --- Memory (markdown, persisted) ---
function getMemory() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_MEMORY], (r) => resolve((r[STORAGE_MEMORY] || '').trim()));
  });
}

function setMemory(markdown) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_MEMORY]: String(markdown || '') }, resolve);
  });
}

function loadMemoryView() {
  if (!memoryContent) return;
  getMemory().then((text) => {
    memoryContent.value = text;
  });
}

// --- Personality (agent tone, values; persisted, prepended to system prompt) ---
function getPersonality() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_PERSONALITY], (r) => resolve((r[STORAGE_PERSONALITY] || '').trim()));
  });
}

function setPersonality(text) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_PERSONALITY]: String(text || '') }, resolve);
  });
}

function loadPersonalityView() {
  if (!personalityContent) return;
  getPersonality().then((text) => {
    personalityContent.value = text;
  });
}

// --- Include screenshot toggle (default off; only send when user enables) ---
function getIncludeScreenshot() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_INCLUDE_SCREENSHOT], (r) => resolve(r[STORAGE_INCLUDE_SCREENSHOT] === true));
  });
}

function setIncludeScreenshot(value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_INCLUDE_SCREENSHOT]: value === true }, resolve);
  });
}

function updateScreenshotSentStatus() {
  if (!screenshotSentStatus) return;
  if (!lastSentModel && !lastSentMarkdown) {
    screenshotSentStatus.textContent = '';
    screenshotSentStatus.className = 'screenshot-sent-status';
    return;
  }
  if (lastSentScreenshotDataUrl) {
    screenshotSentStatus.textContent = 'Last request: screenshot sent';
    screenshotSentStatus.className = 'screenshot-sent-status sent';
  } else {
    screenshotSentStatus.textContent = 'Last request: text only';
    screenshotSentStatus.className = 'screenshot-sent-status';
  }
}

// --- Waiting (scheduled tasks) ---
function getWaitingTasks() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'getWaitingTasks' }, (tasks) => {
      resolve(Array.isArray(tasks) ? tasks : []);
    });
  });
}

function formatNextRun(nextRunAt) {
  if (nextRunAt == null) return { relative: '—', at: '' };
  const ts = typeof nextRunAt === 'number' ? nextRunAt : new Date(nextRunAt).getTime();
  const now = Date.now();
  const diff = ts - now;
  const d = new Date(ts);
  const atStr = d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  let relative;
  if (diff <= 0) relative = 'Running soon';
  else if (diff < 60000) relative = 'In < 1 min';
  else if (diff < 3600000) relative = 'In ' + Math.round(diff / 60000) + ' min';
  else if (diff < 86400000) relative = 'In ' + Math.round(diff / 3600000) + ' h';
  else relative = atStr;
  return { relative, at: atStr };
}

function renderWaitingList(tasks) {
  if (!waitingList) return;
  waitingList.innerHTML = '';
  for (const t of tasks) {
    const li = document.createElement('li');
    li.className = 'waiting-item';
    const actionLabel = t.action === 'refresh' ? 'Refresh tab' : (t.prompt ? 'Prompt: ' + t.prompt.slice(0, 40) + (t.prompt.length > 40 ? '…' : '') : 'Remind');
    const { relative, at } = formatNextRun(t.nextRunAt);
    const scheduleLabel = t.type === 'interval' ? 'Every ' + (t.intervalMinutes || '?') + ' min' : 'Once';
    li.innerHTML = `
      <div class="waiting-item-main">
        <div class="waiting-item-desc">${escapeHtml(t.description || actionLabel)}</div>
        <div class="waiting-item-time">${escapeHtml(relative)} · ${escapeHtml(scheduleLabel)}</div>
        <div class="waiting-item-at">${at ? 'Runs at ' + escapeHtml(at) : ''}</div>
      </div>
      <button type="button" class="waiting-item-delete" data-id="${escapeHtml(String(t.id))}">Cancel</button>
    `;
    li.querySelector('.waiting-item-delete').addEventListener('click', () => cancelWaitingTask(t.id));
    waitingList.appendChild(li);
  }
}

async function loadWaitingView() {
  const tasks = await getWaitingTasks();
  renderWaitingList(tasks);
}

async function cancelWaitingTask(id) {
  await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'cancelWaitingTask', id }, () => resolve());
  });
  await loadWaitingView();
}

// --- Get current tab and page content ---
function getCurrentTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0] || null);
    });
  });
}

/** Get all tabs in the given window for the API (so AI can switch to an existing tab). */
function getTabsInWindow(windowId) {
  return new Promise((resolve) => {
    chrome.tabs.query({ windowId: windowId || chrome.windows.WINDOW_ID_CURRENT }, (tabs) => {
      resolve(
        (tabs || []).map((t) => ({
          id: t.id,
          index: t.index,
          url: t.url || '',
          title: t.title || '',
        }))
      );
    });
  });
}

/** Inject content script and CSS into tab so it can receive messages and show X-ray styles. */
function ensureContentScriptInTab(tabId) {
  return Promise.all([
    new Promise((resolve, reject) => {
      chrome.scripting.executeScript(
        { target: { tabId }, files: ['lib/turndown.js', 'content/content.js'] },
        () => (chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve())
      );
    }),
    new Promise((resolve) => {
      chrome.scripting.insertCSS(
        { target: { tabId }, files: ['content/content.css'] },
        () => resolve()
      );
    }),
  ]).then(() => {});
}

function getPageContentFromTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'getPageContent' }, (data) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(data);
    });
  });
}

async function getPageContentFromTabWithInjection(tabId) {
  let data = await getPageContentFromTab(tabId);
  if (data === null) {
    await ensureContentScriptInTab(tabId);
    data = await getPageContentFromTab(tabId);
  }
  return data;
}

async function loadPageSummary() {
  const tab = await getCurrentTab();
  if (!tab) {
    pageSummaryContent.innerHTML = '<p class="page-summary-placeholder">No active tab.</p>';
    pageContext = null;
    return;
  }
  currentTabId = tab.id;
  if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:'))) {
    pageSummaryContent.innerHTML = '<p class="page-summary-placeholder">This page cannot be read (browser UI).</p>';
    pageContext = { url: tab.url, title: tab.title || '', text: '' };
    return;
  }
  let data = await getPageContentFromTabWithInjection(tab.id);
  if (!data) {
    pageSummaryContent.innerHTML = '<p class="page-summary-placeholder">Could not read this tab. Try reloading the page.</p>';
    pageContext = { url: tab.url, title: tab.title || '', text: '' };
    return;
  }
  pageContext = data;
  const title = data.title || 'Untitled';
  const url = data.url || '';
  const preview = (data.text || '').slice(0, 300).trim();
  pageSummaryContent.innerHTML = `
    <p><strong>${escapeHtml(title)}</strong></p>
    <p><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a></p>
    ${preview ? `<p>${escapeHtml(preview)}${data.text.length > 300 ? '…' : ''}</p>` : ''}
  `;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

refreshSummaryBtn.addEventListener('click', () => loadPageSummary());

function updateDevView() {
  if (devModel) devModel.textContent = lastSentModel || '—';
  if (devSystemPrompt) devSystemPrompt.textContent = lastSentSystemPrompt || '—';
  if (devMarkdown) devMarkdown.textContent = lastSentMarkdown || 'No request sent yet. Send a message from Chat.';
  if (devScreenshotWrap && devScreenshot) {
    if (lastSentScreenshotDataUrl) {
      devScreenshot.src = lastSentScreenshotDataUrl;
      devScreenshotWrap.classList.remove('hidden');
    } else {
      devScreenshot.src = '';
      devScreenshotWrap.classList.add('hidden');
    }
  }
  updateScreenshotSentStatus();
}

// --- Include screenshot: load preference and persist toggle ---
if (includeScreenshotCheckbox) {
  getIncludeScreenshot().then((checked) => {
    includeScreenshotCheckbox.checked = checked;
  });
  includeScreenshotCheckbox.addEventListener('change', () => {
    setIncludeScreenshot(includeScreenshotCheckbox.checked);
  });
}

// --- Tabs (Chat / Dev / Settings) ---
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const view = tab.dataset.view;
    document.querySelectorAll('.tab').forEach((t) => {
      t.classList.toggle('active', t === tab);
      t.setAttribute('aria-selected', t === tab);
    });
    viewChat.classList.toggle('hidden', view !== 'chat');
    viewMemory.classList.toggle('hidden', view !== 'memory');
    if (viewPersonality) viewPersonality.classList.toggle('hidden', view !== 'personality');
    if (viewWaiting) viewWaiting.classList.toggle('hidden', view !== 'waiting');
    viewDev.classList.toggle('hidden', view !== 'dev');
    viewSettings.classList.toggle('hidden', view !== 'settings');
    if (view === 'settings') loadSettings();
    if (view === 'chat') loadPageSummary();
    if (view === 'memory') loadMemoryView();
    if (view === 'personality') loadPersonalityView();
    if (view === 'waiting') loadWaitingView();
    if (view === 'dev') updateDevView();
  });
});

// --- Memory: Save button ---
if (memorySaveBtn && memoryContent) {
  memorySaveBtn.addEventListener('click', async () => {
    const text = memoryContent.value || '';
    await setMemory(text);
    if (memoryStatus) {
      memoryStatus.textContent = 'Saved.';
      memoryStatus.className = 'memory-status saved';
      setTimeout(() => { memoryStatus.textContent = ''; memoryStatus.className = 'memory-status'; }, 2000);
    }
  });
}

// --- Personality: Save button ---
if (personalitySaveBtn && personalityContent) {
  personalitySaveBtn.addEventListener('click', async () => {
    const text = personalityContent.value || '';
    await setPersonality(text);
    if (personalityStatus) {
      personalityStatus.textContent = 'Saved.';
      personalityStatus.className = 'personality-status saved';
      setTimeout(() => { personalityStatus.textContent = ''; personalityStatus.className = 'personality-status'; }, 2000);
    }
  });
}

/** Create a scheduled task from an AI schedule action. Returns Promise<{ ok, error? }>. */
async function scheduleTaskFromAction(scheduleAction, tabId) {
  const description = (scheduleAction.description && String(scheduleAction.description).trim()) || 'Scheduled task';
  const intervalMinutes = scheduleAction.intervalMinutes != null ? Math.max(1, Math.min(10080, Number(scheduleAction.intervalMinutes))) : null;
  const runAtStr = scheduleAction.runAt;
  const action = scheduleAction.action === 'prompt' ? 'prompt' : 'refresh';
  const prompt = scheduleAction.prompt != null ? String(scheduleAction.prompt).trim() : undefined;
  let nextRunAt;
  let type;
  if (intervalMinutes != null) {
    type = 'interval';
    nextRunAt = Date.now() + intervalMinutes * 60 * 1000;
  } else if (runAtStr) {
    type = 'once';
    nextRunAt = new Date(runAtStr).getTime();
    if (nextRunAt <= Date.now()) return { ok: false, error: 'runAt must be in the future' };
  } else {
    return { ok: false, error: 'schedule needs intervalMinutes or runAt' };
  }
  const task = {
    id: 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9),
    description,
    type,
    intervalMinutes: type === 'interval' ? intervalMinutes : undefined,
    runAt: type === 'once' ? nextRunAt : undefined,
    tabId: tabId || null,
    url: null,
    action,
    prompt: action === 'prompt' ? (prompt || description) : undefined,
    nextRunAt,
    createdAt: Date.now(),
  };
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'scheduleTask', task }, (res) => {
      resolve(res && res.ok ? { ok: true } : { ok: false, error: (res && res.error) || 'Failed' });
    });
  });
}

// --- Dev: X-ray button (outline on page the elements sent to the API) ---
if (devXrayBtn) {
  devXrayBtn.addEventListener('click', async () => {
    console.log('[Agent X-ray] Button clicked');
    const tab = await getCurrentTab();
    if (!tab?.id) {
      console.log('[Agent X-ray] No active tab');
      return;
    }
    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:'))) {
      console.log('[Agent X-ray] Restricted URL:', tab.url);
      return;
    }
    console.log('[Agent X-ray] Tab:', tab.id, tab.url);
    try {
      await ensureContentScriptInTab(tab.id);
      console.log('[Agent X-ray] Content script ready, sending toggleXray');
      chrome.tabs.sendMessage(tab.id, { type: 'toggleXray' }, (res) => {
        if (chrome.runtime.lastError) {
          console.log('[Agent X-ray] sendMessage error:', chrome.runtime.lastError.message);
          return;
        }
        console.log('[Agent X-ray] Response:', res);
        const elementsJsonWrap = document.getElementById('devElementsJsonWrap');
        const elementsJsonPre = document.getElementById('devElementsJson');
        if (res && res.visible) {
          devXrayBtn.textContent = 'Hide X-ray';
          if (res.elementsJson && elementsJsonWrap && elementsJsonPre) {
            elementsJsonPre.textContent = JSON.stringify(res.elementsJson, null, 2);
            elementsJsonWrap.classList.remove('hidden');
          }
        } else {
          devXrayBtn.textContent = 'X-ray';
          if (elementsJsonWrap) elementsJsonWrap.classList.add('hidden');
        }
      });
    } catch (err) {
      console.log('[Agent X-ray] Error:', err);
    }
  });
}

// --- Settings ---
function updateOpenrouterVisibility() {
  const isOpenRouter = apiProviderSelect.value === 'openrouter';
  if (openrouterModelRow) openrouterModelRow.classList.toggle('hidden', !isOpenRouter);
}

async function fetchOpenrouterModels() {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    if (fetchModelsStatus) { fetchModelsStatus.textContent = 'Enter your API key first.'; }
    return;
  }
  if (fetchModelsBtn) fetchModelsBtn.disabled = true;
  if (fetchModelsStatus) fetchModelsStatus.textContent = 'Fetching…';
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { data } = await res.json();
    if (!Array.isArray(data) || data.length === 0) throw new Error('No models returned.');
    const savedModel = openrouterModelSelect
      ? openrouterModelSelect.value || ''
      : '';
    data.sort((a, b) => (a.id || '').localeCompare(b.id || ''));
    openrouterModelSelect.innerHTML = data
      .map((m) => `<option value="${m.id}"${m.id === savedModel ? ' selected' : ''}>${m.id}</option>`)
      .join('');
    if (fetchModelsStatus) fetchModelsStatus.textContent = `${data.length} models loaded.`;
  } catch (err) {
    if (fetchModelsStatus) fetchModelsStatus.textContent = `Error: ${err.message}`;
  } finally {
    if (fetchModelsBtn) fetchModelsBtn.disabled = false;
  }
}

function loadSettings() {
  chrome.storage.local.get([STORAGE_KEY, STORAGE_PROVIDER, STORAGE_HF_TOKEN, STORAGE_OPENROUTER_MODEL, LEGACY_OPENAI_KEY], (result) => {
    let key = result[STORAGE_KEY] || '';
    if (!key && (result[STORAGE_PROVIDER] || 'openai') === 'openai') key = result[LEGACY_OPENAI_KEY] || '';
    apiKeyInput.value = key;
    apiProviderSelect.value = result[STORAGE_PROVIDER] || 'openai';
    if (hfTokenInput) hfTokenInput.value = result[STORAGE_HF_TOKEN] || '';
    const savedOrModel = result[STORAGE_OPENROUTER_MODEL] || API_CONFIG.openrouter.model;
    if (openrouterModelSelect && savedOrModel) {
      // If the select only has the placeholder, populate it with the saved model so it displays correctly
      if (openrouterModelSelect.querySelector(`option[value="${savedOrModel}"]`)) {
        openrouterModelSelect.value = savedOrModel;
      } else {
        openrouterModelSelect.innerHTML = `<option value="${savedOrModel}">${savedOrModel}</option>`;
        openrouterModelSelect.value = savedOrModel;
      }
    }
    updateOpenrouterVisibility();
    settingsStatus.textContent = '';
    settingsStatus.className = 'settings-status';
  });
}

if (apiProviderSelect) apiProviderSelect.addEventListener('change', updateOpenrouterVisibility);
if (fetchModelsBtn) fetchModelsBtn.addEventListener('click', fetchOpenrouterModels);

function showStatus(msg, type) {
  settingsStatus.textContent = msg;
  settingsStatus.className = 'settings-status ' + (type || '');
}

settingsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const key = apiKeyInput.value.trim();
  const provider = apiProviderSelect.value || 'openai';
  const hfToken = hfTokenInput ? hfTokenInput.value.trim() : '';
  const openrouterModel = (openrouterModelSelect && openrouterModelSelect.value) ? openrouterModelSelect.value : API_CONFIG.openrouter.model;
  saveSettingsBtn.disabled = true;
  chrome.storage.local.set({ [STORAGE_KEY]: key || '', [STORAGE_PROVIDER]: provider, [STORAGE_HF_TOKEN]: hfToken || '', [STORAGE_OPENROUTER_MODEL]: openrouterModel }, () => {
    saveSettingsBtn.disabled = false;
    showStatus('Saved.', 'saved');
  });
});

// --- Action buttons: set prompt and optionally send ---
actionButtons.querySelectorAll('.action-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const prompt = btn.dataset.prompt || '';
    input.value = prompt;
    input.focus();
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  });
});

// --- Chat: append message, set last agent bubble ---
function appendMessage(role, text) {
  welcomeEl.classList.add('hidden');
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;
  wrap.innerHTML = `
    <span class="msg-role">${role === 'user' ? 'You' : 'Agent'}</span>
    <div class="msg-bubble">${escapeHtml(text)}</div>
  `;
  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setLastAgentBubble(text) {
  const agentBubbles = messagesEl.querySelectorAll('.msg.agent .msg-bubble');
  const last = agentBubbles[agentBubbles.length - 1];
  if (last) last.textContent = text;
}

function setLastAgentBubbleHtml(html) {
  const agentBubbles = messagesEl.querySelectorAll('.msg.agent .msg-bubble');
  const last = agentBubbles[agentBubbles.length - 1];
  if (last) last.innerHTML = html;
}

/** Build HTML table for executed actions and their results. */
function buildActionsTableHtml(actions, results) {
  const rows = (actions || []).map((action, i) => {
    const result = results && results[i];
    const ok = result && result.ok;
    const detail =
      action.id != null
        ? (action.value != null ? `id ${action.id} → "${escapeHtml(String(action.value))}"` : `id ${action.id}`)
        : action.selector
          ? (action.value != null ? `${escapeHtml(String(action.selector))} → "${escapeHtml(String(action.value))}"` : escapeHtml(String(action.selector)))
          : action.url
            ? escapeHtml(String(action.url))
            : action.direction
              ? escapeHtml(String(action.direction))
              : action.ms != null
                ? escapeHtml(String(action.ms)) + ' ms'
                : '—';
    const resultCell = ok ? '✓' : (result && result.error ? escapeHtml(result.error) : '—');
    return `<tr><td>${i + 1}</td><td>${escapeHtml(String(action.type || '—'))}</td><td>${detail}</td><td class="action-result ${ok ? 'ok' : 'fail'}">${resultCell}</td></tr>`;
  });
  if (rows.length === 0) return '';
  return `
    <div class="actions-table-wrap">
      <table class="actions-table">
        <thead><tr><th>#</th><th>Type</th><th>Details</th><th>Result</th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`;
}

/** Build HTML for multi-step result: each step's message + table, then final message. */
function buildStepsHtml(steps, finalMessage) {
  const parts = steps.map((s, i) => {
    const msg = s.message ? escapeHtml(s.message) + '<br><br>' : '';
    const table = buildActionsTableHtml(s.actions, s.results);
    return `<div class="step-block"><strong>Step ${i + 1}</strong><br>${msg}${table}</div>`;
  });
  const final = finalMessage ? `<div class="step-block step-done"><strong>Done</strong><br>${escapeHtml(finalMessage)}</div>` : '';
  return parts.join('') + final;
}

const LEGACY_OPENAI_KEY = 'openai_api_key';

function getApiConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY, STORAGE_PROVIDER, STORAGE_OPENROUTER_MODEL, LEGACY_OPENAI_KEY], (result) => {
      const provider = (result[STORAGE_PROVIDER] || 'openai');
      let apiKey = (result[STORAGE_KEY] || '').trim();
      if (!apiKey && provider === 'openai' && result[LEGACY_OPENAI_KEY]) {
        apiKey = (result[LEGACY_OPENAI_KEY] || '').trim();
      }
      const config = { ...(API_CONFIG[provider] || API_CONFIG.openai) };
      if (provider === 'openrouter' && result[STORAGE_OPENROUTER_MODEL]) {
        config.model = result[STORAGE_OPENROUTER_MODEL];
      }
      resolve({ provider, apiKey, ...config });
    });
  });
}

/** Capture visible tab in the given window; returns data URL or null. */
function captureTabScreenshot(windowId) {
  if (windowId == null) return Promise.resolve(null);
  return new Promise((resolve) => {
    chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        resolve(null);
      } else {
        resolve(dataUrl || null);
      }
    });
  });
}

/** Get caption for an image (data URL) via Hugging Face Inference API (BLIP). Returns caption text or null. */
async function getScreenshotCaption(dataUrl, hfToken) {
  if (!dataUrl || !hfToken || !dataUrl.startsWith('data:image')) return null;
  try {
    const base64 = dataUrl.split(',')[1];
    if (!base64) return null;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'image/png' });
    const res = await fetch(`https://api-inference.huggingface.co/models/${HF_CAPTION_MODEL}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${hfToken}` },
      body: blob,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const caption = Array.isArray(data) && data[0] && data[0].generated_text ? data[0].generated_text : (data && data.generated_text) ? data.generated_text : null;
    return caption || null;
  } catch (_) {
    return null;
  }
}

// --- Call API with prompt wrapped for JSON response ---
async function callAgentForActions(userPrompt, followUp, windowId, signal, currentTabId) {
  const { apiKey, url: apiUrl, model, supportsVision } = await getApiConfig();
  if (!apiKey) return null;

  const url = pageContext?.url || '';
  const title = pageContext?.title || '';
  const clickableRaw = pageContext?.clickable || [];
  const clickable = clickableRaw.slice(0, 80);
  const clickableBlock =
    clickable.length > 0
      ? '\nClickable elements (use id for click/type/select; each has id, tag, text, rect, html; select elements also have options: [{value, text}]):\n' + JSON.stringify(clickable)
      : '';

  const allTabs = await getTabsInWindow(windowId);
  const tabsWithActive = (allTabs || []).map((t) => ({ ...t, active: t.id === currentTabId }));
  const openTabsBlock =
    tabsWithActive.length > 0
      ? '\nOpen tabs in this window (prefer switchTab with tabId instead of navigate when the target is already open):\n' + JSON.stringify(tabsWithActive)
      : '';

  const memoryText = await getMemory();
  const memoryBlock = memoryText ? `Current memory (saved context):\n${memoryText}\n\n---\n\n` : '';

  const personalityText = await getPersonality();
  const systemPrompt = personalityText
    ? `Personality and values (follow these in your behavior and decisions):\n${personalityText}\n\n---\n\n` + JSON_SYSTEM_PROMPT
    : JSON_SYSTEM_PROMPT;

  let userContent;
  if (!followUp) {
    userContent = `${memoryBlock}Current page:
URL: ${url}
Title: ${title}
${clickableBlock}
${openTabsBlock}

User request: ${userPrompt}

Respond with JSON only.`;
  } else {
    userContent = `${memoryBlock}Follow-up (step ${followUp.step}): I executed these actions:

${followUp.actions.map((a, i) => `${i + 1}. ${a.type}${a.id != null ? ' id=' + a.id : a.selector ? ': ' + a.selector : ''}${a.value != null ? ' = "' + a.value + '"' : ''}`).join('\n')}

Results: ${followUp.results.map((r, i) => `${i + 1}. ${r.ok ? '✓' : '✗ ' + (r.error || '')}`).join('\n')}

The page content is now:

URL: ${url}
Title: ${title}
${clickableBlock}
${openTabsBlock}

Original user request: ${followUp.userRequest}

Is the task complete? If yes, return {"done": true, "message": "Summary of what was accomplished"}. If not, return the next actions to perform. Respond with JSON only.`;
  }

  const includeScreenshot = await getIncludeScreenshot();
  const screenshotDataUrl = (supportsVision && includeScreenshot) ? await captureTabScreenshot(windowId) : null;
  let captionText = null;
  if (screenshotDataUrl) {
    const hfToken = (await new Promise((r) => chrome.storage.local.get([STORAGE_HF_TOKEN], (o) => r(o[STORAGE_HF_TOKEN] || '')))).trim();
    if (hfToken) captionText = await getScreenshotCaption(screenshotDataUrl, hfToken);
  }
  const contentWithCaption = captionText
    ? userContent + '\n\nScreenshot caption: ' + captionText
    : userContent + (screenshotDataUrl ? '\n\n[Screenshot of the current page is attached.]' : '');

  lastSentModel = model;
  lastSentSystemPrompt = systemPrompt;
  lastSentMarkdown = contentWithCaption;
  lastSentScreenshotDataUrl = screenshotDataUrl || null;
  updateDevView();
  updateScreenshotSentStatus();

  const userMessageContent = screenshotDataUrl
    ? [
        { type: 'text', text: contentWithCaption },
        { type: 'image_url', image_url: { url: screenshotDataUrl } },
      ]
    : userContent;

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessageContent },
    ],
  };
  console.log('[Agent] Request to API:', model, screenshotDataUrl ? 'text + screenshot' : 'text only');

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: signal || undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${res.status}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content?.trim() || '';
  console.log('[Agent] Response from API:', raw);
  return raw;
}

/** Strip single-line and block comments from JSON-like text so model output can be parsed. */
function stripJsonComments(str) {
  let out = '';
  let i = 0;
  const n = str.length;
  let inStr = false;
  let strChar = '';
  let inLineComment = false;
  let inBlockComment = false;
  while (i < n) {
    if (inBlockComment) {
      if (str[i] === '*' && str[i + 1] === '/') {
        i += 2;
        inBlockComment = false;
        continue;
      }
      i++;
      continue;
    }
    if (inLineComment) {
      if (str[i] === '\n') {
        inLineComment = false;
        out += '\n';
      }
      i++;
      continue;
    }
    if (inStr) {
      out += str[i];
      if (str[i] === '\\') {
        i++;
        if (i < n) out += str[i];
      } else if (str[i] === strChar) {
        inStr = false;
      }
      i++;
      continue;
    }
    if (str[i] === '"' || str[i] === "'") {
      strChar = str[i];
      inStr = true;
      out += str[i];
      i++;
      continue;
    }
    if (str[i] === '/' && str[i + 1] === '/') {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (str[i] === '/' && str[i + 1] === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }
    out += str[i];
    i++;
  }
  return out;
}

function parseJsonFromResponse(raw) {
  let s = raw.trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}') + 1;
  if (start !== -1 && end > start) {
    s = s.slice(start, end);
  }
  s = stripJsonComments(s);
  const parsed = JSON.parse(s);
  console.log('[Agent] Parsed response:', parsed);
  return parsed;
}

function executeActionsInTabRaw(tabId, actions) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'executeActions', actions }, (results) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve({ ok: true, results });
      }
    });
  });
}

/** Run switchTab actions in the panel (sequentially); return Promise<{ results, lastTabId, otherActions }>. */
async function runSwitchTabsInPanel(actions) {
  const switchTabActions = [];
  const otherActions = [];
  for (const a of actions) {
    if (a && a.type === 'switchTab') switchTabActions.push(a);
    else otherActions.push(a);
  }
  const results = [];
  let lastTabId = null;
  for (const a of switchTabActions) {
    const tid = a.tabId != null ? a.tabId : a.id;
    if (tid == null || typeof tid !== 'number') {
      results.push({ ok: false, error: 'switchTab: missing tabId' });
      continue;
    }
    const res = await new Promise((resolve) => {
      chrome.tabs.update(tid, { active: true }, () => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
        else resolve({ ok: true });
      });
    });
    results.push(res);
    if (res.ok) lastTabId = tid;
  }
  return { results, lastTabId, otherActions };
}

async function executeActionsInTab(tabId, actions) {
  const { results: switchResults, lastTabId, otherActions } = await runSwitchTabsInPanel(actions || []);
  const targetTabId = lastTabId != null ? lastTabId : tabId;
  if (otherActions.length === 0) {
    return { ok: true, results: switchResults, newTabId: lastTabId || undefined };
  }
  let result = await executeActionsInTabRaw(targetTabId, otherActions);
  if (!result.ok && result.error && result.error.includes('Receiving end does not exist')) {
    try {
      await ensureContentScriptInTab(targetTabId);
      result = await executeActionsInTabRaw(targetTabId, otherActions);
    } catch (err) {
      result = { ok: false, error: err.message };
    }
  }
  if (!result.ok) return result;
  return {
    ok: true,
    results: [...switchResults, ...(result.results || [])],
    newTabId: lastTabId || undefined,
  };
}

/** Smart wait for page update (DOM change, network idle, or body) in the tab. */
function waitForPageUpdateInTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'waitForPageUpdate' }, (res) => {
      if (chrome.runtime.lastError) resolve();
      else resolve(res);
    });
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  input.style.height = 'auto';

  appendMessage('user', text);
  sendBtn.disabled = true;
  userRequestStopped = false;
  currentAbortController = new AbortController();
  if (stopBtn) {
    stopBtn.classList.remove('hidden');
  }
  appendMessage('agent', '…');

  const { apiKey } = await getApiConfig();
  if (!apiKey) {
    setLastAgentBubble('Add your API key in Settings (OpenAI or DeepSeek).');
    sendBtn.disabled = false;
    if (stopBtn) stopBtn.classList.add('hidden');
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return;
  }

  // Always refresh page summary so the API gets the latest page content for this request
  await loadPageSummary();
  const tab = await getCurrentTab();
  let tabId = tab?.id;
  const windowId = tab?.windowId;
  if (!tabId) {
    setLastAgentBubble('No active tab. Switch to a page and try again.');
    sendBtn.disabled = false;
    if (stopBtn) stopBtn.classList.add('hidden');
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return;
  }

  // Move virtual cursor on the page when user sends a prompt
  (async () => {
    try {
      await ensureContentScriptInTab(tabId);
      chrome.tabs.sendMessage(tabId, { type: 'moveVirtualCursorOnPage' }, () => {});
    } catch (_) {}
  })();

  try {
    const steps = [];
    let doneMessage = '';
    let stepIndex = 0;
    let maxSteps = getMaxStepsForSession(text);

    while (stepIndex < maxSteps) {
      if (userRequestStopped) {
        setLastAgentBubbleHtml(steps.length > 0 ? buildStepsHtml(steps, 'Stopped by user.') : 'Stopped by user.');
        break;
      }
      if (stepIndex > 0) {
        await loadPageSummary();
      }
      const followUp = stepIndex === 0 ? null : {
        step: stepIndex,
        actions: steps[steps.length - 1].actions,
        results: steps[steps.length - 1].results,
        userRequest: text,
      };
      if (stepIndex > 0) {
        setLastAgentBubbleHtml(buildStepsHtml(steps, 'Step ' + (stepIndex + 1) + '…'));
      }
      let raw;
      try {
        raw = await callAgentForActions(text, followUp, windowId, currentAbortController ? currentAbortController.signal : null, tabId);
      } catch (err) {
        if (err.name === 'AbortError' || userRequestStopped) {
          setLastAgentBubbleHtml(steps.length > 0 ? buildStepsHtml(steps, 'Stopped by user.') : 'Stopped by user.');
          break;
        }
        throw err;
      }
      const parsed = parseJsonFromResponse(raw);
      const rawActions = Array.isArray(parsed.actions) ? parsed.actions : [];
      const scheduleActions = rawActions.filter((a) => a && a.type === 'schedule');
      const actions = rawActions.filter((a) => !a || a.type !== 'schedule');

      if (typeof parsed.suggestedMaxSteps === 'number' && stepIndex === 0) {
        maxSteps = getMaxStepsForSession(text, parsed.suggestedMaxSteps);
      }
      if (parsed.saveToMemory && typeof parsed.saveToMemory === 'string' && parsed.saveToMemory.trim()) {
        const current = await getMemory();
        const sep = current ? '\n\n' : '';
        await setMemory(current + sep + parsed.saveToMemory.trim());
      }

      // Process schedule actions first (even when done: true) so tasks are stored
      if (scheduleActions.length > 0) {
        for (const sa of scheduleActions) {
          const res = await scheduleTaskFromAction(sa, tabId);
          if (!res.ok) {
            setLastAgentBubbleHtml(buildStepsHtml(steps, 'Schedule failed: ' + (res.error || 'unknown')));
            break;
          }
        }
        const msg = parsed.message || 'Scheduled. See the Waiting tab for when tasks run.';
        setLastAgentBubbleHtml(buildStepsHtml(steps, msg));
        loadWaitingView();
      }

      if (parsed.done) {
        doneMessage = parsed.message || 'Task complete.';
        setLastAgentBubbleHtml(buildStepsHtml(steps, doneMessage));
        break;
      }

      if (actions.length > 0 && tabId) {
        const exec = await executeActionsInTab(tabId, actions);
        if (exec.ok && exec.results) {
          steps.push({ message: parsed.message || '', actions, results: exec.results });
          setLastAgentBubbleHtml(buildStepsHtml(steps, 'Next step…'));
          let activeTabId = tabId;
          if (exec.newTabId) {
            activeTabId = exec.newTabId;
            await loadPageSummary();
          }
          await waitForPageUpdateInTab(activeTabId);
          await new Promise((r) => setTimeout(r, STEP_DELAY_MS));
          stepIndex++;
          if (exec.newTabId) tabId = exec.newTabId;
        } else {
          setLastAgentBubbleHtml(
            buildStepsHtml(steps, 'Execution failed: ' + (exec.error || 'unknown'))
          );
          break;
        }
      } else {
        doneMessage = parsed.message || (actions.length === 0 ? 'No further actions.' : 'No active tab.');
        setLastAgentBubbleHtml(buildStepsHtml(steps, doneMessage));
        break;
      }
    }

    if (stepIndex >= maxSteps && !doneMessage) {
      setLastAgentBubbleHtml(
        buildStepsHtml(steps, 'Reached max steps (' + maxSteps + '). Task may be incomplete.')
      );
    }
  } catch (err) {
    if (err.name === 'AbortError' || userRequestStopped) {
      setLastAgentBubble('Stopped by user.');
    } else {
      setLastAgentBubble('Error: ' + (err.message || 'Request failed'));
    }
  }

  sendBtn.disabled = false;
  if (stopBtn) stopBtn.classList.add('hidden');
  currentAbortController = null;
  messagesEl.scrollTop = messagesEl.scrollHeight;
});

if (stopBtn) {
  stopBtn.addEventListener('click', () => {
    userRequestStopped = true;
    if (currentAbortController) currentAbortController.abort();
    setLastAgentBubble('Stopped by user.');
    sendBtn.disabled = false;
    stopBtn.classList.add('hidden');
    currentAbortController = null;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

// Update summary when user switches to another tab
chrome.tabs.onActivated.addListener(async () => {
  if (!viewChat.classList.contains('hidden')) await loadPageSummary();
});

// Update summary when the current tab navigates (URL change)
chrome.tabs.onUpdated.addListener((updatedTabId, changeInfo) => {
  if (updatedTabId !== currentTabId) return;
  if (viewChat.classList.contains('hidden')) return;
  if (changeInfo.url || changeInfo.status === 'complete') loadPageSummary();
});

// Load page summary when chat view is first shown
loadPageSummary();
