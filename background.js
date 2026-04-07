// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

const STORAGE_WAITING_TASKS = 'agent_waiting_tasks';

function getTasks() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_WAITING_TASKS], (r) => resolve(r[STORAGE_WAITING_TASKS] || []));
  });
}

function setTasks(tasks) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_WAITING_TASKS]: tasks }, resolve);
  });
}

async function runTask(task) {
  if (task.action === 'refresh' && task.tabId) {
    try {
      await chrome.tabs.get(task.tabId);
      await chrome.tabs.reload(task.tabId);
    } catch (_) {
      // Tab may be closed
    }
  }
  if (task.action === 'prompt' && (task.prompt || task.description)) {
    try {
      await chrome.notifications.create({
        type: 'basic',
        title: 'Agent – Scheduled task',
        message: task.description || task.prompt || 'Time to run your task. Open Agent and run: ' + (task.prompt || ''),
      });
    } catch (_) {}
  }
}

async function scheduleAlarm(task) {
  const when = task.nextRunAt;
  if (typeof when !== 'number' || when <= Date.now()) return;
  await chrome.alarms.create('task_' + task.id, { when });
}

async function rescheduleOrRemove(task) {
  const tasks = await getTasks();
  const idx = tasks.findIndex((t) => t.id === task.id);
  if (idx === -1) return;
  if (task.type === 'interval' && task.intervalMinutes) {
    const nextRunAt = Date.now() + task.intervalMinutes * 60 * 1000;
    tasks[idx] = { ...tasks[idx], nextRunAt };
    await setTasks(tasks);
    await scheduleAlarm(tasks[idx]);
  } else {
    tasks.splice(idx, 1);
    await setTasks(tasks);
    try {
      await chrome.alarms.clear('task_' + task.id);
    } catch (_) {}
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name || !alarm.name.startsWith('task_')) return;
  const id = alarm.name.replace('task_', '');
  const tasks = await getTasks();
  const task = tasks.find((t) => String(t.id) === id);
  if (!task) return;
  await runTask(task);
  await rescheduleOrRemove(task);
});

// Restore alarms when extension loads (e.g. after browser restart)
chrome.runtime.onStartup.addListener(async () => {
  const tasks = await getTasks();
  const now = Date.now();
  for (const task of tasks) {
    if (task.nextRunAt && task.nextRunAt > now) await scheduleAlarm(task);
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const tasks = await getTasks();
  const now = Date.now();
  for (const task of tasks) {
    if (task.nextRunAt && task.nextRunAt > now) await scheduleAlarm(task);
  }
});

// Messages from panel: scheduleTask, cancelTask, getWaitingTasks
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'getWaitingTasks') {
    getTasks().then(sendResponse);
    return true;
  }
  if (msg.type === 'scheduleTask') {
    (async () => {
      const tasks = await getTasks();
      const task = msg.task;
      if (!task || !task.id) return { ok: false, error: 'Invalid task' };
      const nextRunAt = typeof task.nextRunAt === 'number' ? task.nextRunAt : (task.nextRunAt ? new Date(task.nextRunAt).getTime() : 0);
      if (!nextRunAt || nextRunAt <= Date.now()) return { ok: false, error: 'nextRunAt must be in the future' };
      const toStore = { ...task, nextRunAt };
      tasks.push(toStore);
      await setTasks(tasks);
      await scheduleAlarm(toStore);
      return { ok: true };
    })().then(sendResponse);
    return true;
  }
  if (msg.type === 'cancelWaitingTask') {
    (async () => {
      const tasks = await getTasks();
      const id = msg.id;
      const idx = tasks.findIndex((t) => String(t.id) === String(id));
      if (idx === -1) return { ok: false };
      const task = tasks[idx];
      tasks.splice(idx, 1);
      await setTasks(tasks);
      try {
        await chrome.alarms.clear('task_' + task.id);
      } catch (_) {}
      return { ok: true };
    })().then(sendResponse);
    return true;
  }
  return false;
});
