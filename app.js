const STORAGE_KEY = "daily-todolist.v1";
const MAX_LENGTH = 280;
const MAX_CATCH_UP_DAYS = 2000;
const TEST_TODAY = getTestToday();

const state = {
  selectedDate: getTodayKey(),
  data: loadData(),
};

const elements = {
  dayTitle: document.querySelector("#dayTitle"),
  daySubtitle: document.querySelector("#daySubtitle"),
  datePicker: document.querySelector("#datePicker"),
  prevDay: document.querySelector("#prevDay"),
  nextDay: document.querySelector("#nextDay"),
  todayButton: document.querySelector("#todayButton"),
  todoForm: document.querySelector("#todoForm"),
  todoInput: document.querySelector("#todoInput"),
  pendingCount: document.querySelector("#pendingCount"),
  doneCount: document.querySelector("#doneCount"),
  carryHint: document.querySelector("#carryHint"),
  testMode: document.querySelector("#testMode"),
  pendingList: document.querySelector("#pendingList"),
  doneList: document.querySelector("#doneList"),
  pendingEmpty: document.querySelector("#pendingEmpty"),
  doneEmpty: document.querySelector("#doneEmpty"),
  clearDone: document.querySelector("#clearDone"),
  template: document.querySelector("#todoTemplate"),
};

init();

function init() {
  normalizeData();
  syncCarryovers();
  elements.datePicker.value = state.selectedDate;
  renderTestMode();
  bindEvents();
  render();
}

function bindEvents() {
  elements.todoForm.addEventListener("submit", (event) => {
    event.preventDefault();
    addTodo(elements.todoInput.value);
  });

  elements.prevDay.addEventListener("click", () => {
    selectDate(addDays(state.selectedDate, -1));
  });

  elements.nextDay.addEventListener("click", () => {
    selectDate(addDays(state.selectedDate, 1));
  });

  elements.todayButton.addEventListener("click", () => {
    selectDate(getTodayKey());
  });

  elements.datePicker.addEventListener("change", () => {
    if (elements.datePicker.value) {
      selectDate(elements.datePicker.value);
    }
  });

  elements.clearDone.addEventListener("click", () => {
    const items = getDayItems(state.selectedDate);
    state.data.days[state.selectedDate] = items.filter((item) => !item.done);
    saveData();
    render();
  });
}

function selectDate(dateKey) {
  state.selectedDate = dateKey;
  elements.datePicker.value = dateKey;
  render();
}

function addTodo(rawText) {
  const text = rawText.trim().slice(0, MAX_LENGTH);

  if (!text) {
    return;
  }

  const id = createId();
  const item = {
    id,
    rootId: id,
    text,
    createdAt: getNow().toISOString(),
    done: false,
    completedAt: null,
    copiedFrom: null,
    copiedAt: null,
  };

  getDayItems(state.selectedDate).push(item);
  elements.todoInput.value = "";
  saveData();
  render();
}

function toggleTodo(id, done) {
  const item = findItem(state.selectedDate, id);

  if (!item) {
    return;
  }

  item.done = done;
  item.completedAt = done ? getNow().toISOString() : null;

  if (done) {
    removeFuturePendingCopies(getRootId(item), state.selectedDate);
  }

  saveData();
  render();
}

function deleteTodo(id) {
  const item = findItem(state.selectedDate, id);
  const rootId = item ? getRootId(item) : null;
  const items = getDayItems(state.selectedDate);

  state.data.days[state.selectedDate] = items.filter((todo) => todo.id !== id);

  if (rootId) {
    removeFuturePendingCopies(rootId, state.selectedDate);
  }

  saveData();
  render();
}

function render() {
  syncCarryovers();

  const items = getDayItems(state.selectedDate);
  const pending = items.filter((item) => !item.done);
  const done = items.filter((item) => item.done);

  renderDateHeader();
  renderList(elements.pendingList, pending);
  renderList(elements.doneList, done);

  elements.pendingCount.textContent = pending.length;
  elements.doneCount.textContent = done.length;
  elements.pendingEmpty.classList.toggle("is-visible", pending.length === 0);
  elements.doneEmpty.classList.toggle("is-visible", done.length === 0);
  elements.clearDone.hidden = done.length === 0;
  elements.carryHint.textContent = getCarryHint();
}

function renderDateHeader() {
  const date = parseDateKey(state.selectedDate);
  const today = getTodayKey();
  const dayText = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);

  elements.dayTitle.textContent =
    state.selectedDate === today ? "今天" : dayText;
  elements.daySubtitle.textContent =
    state.selectedDate === today ? dayText : relativeDateLabel(state.selectedDate);
}

function renderTestMode() {
  if (!TEST_TODAY) {
    elements.testMode.hidden = true;
    return;
  }

  elements.testMode.hidden = false;
  elements.testMode.textContent = `测试日期：${TEST_TODAY}`;
}

function renderList(listElement, items) {
  listElement.replaceChildren();

  items.forEach((item) => {
    const fragment = elements.template.content.cloneNode(true);
    const row = fragment.querySelector(".todo-item");
    const checkbox = fragment.querySelector(".todo-check");
    const text = fragment.querySelector(".todo-text");
    const meta = fragment.querySelector(".todo-meta");
    const badge = fragment.querySelector(".carry-badge");
    const deleteButton = fragment.querySelector(".delete-button");
    const badgeText = getBadgeText(item);

    row.classList.toggle("is-done", item.done);
    checkbox.checked = item.done;
    checkbox.addEventListener("change", () => toggleTodo(item.id, checkbox.checked));
    text.textContent = item.text;
    meta.textContent = getMetaText(item);
    badge.textContent = badgeText;
    badge.classList.toggle("is-visible", Boolean(badgeText));
    deleteButton.addEventListener("click", () => deleteTodo(item.id));

    listElement.append(fragment);
  });
}

function getMetaText(item) {
  const parts = [`创建：${formatDateTime(item.createdAt)}`];

  if (item.copiedFrom) {
    parts.push(`来自 ${formatShortDate(item.copiedFrom)}`);
  }

  if (item.done && item.completedAt) {
    parts.push(`完成：${formatDateTime(item.completedAt)}`);
  }

  return parts.join(" · ");
}

function getBadgeText(item) {
  if (item.done) {
    return "";
  }

  const today = getTodayKey();
  const nextDay = addDays(state.selectedDate, 1);

  if (state.selectedDate === today) {
    return "会进入明天";
  }

  if (state.selectedDate < today) {
    return `已结转到 ${formatShortDate(nextDay)}`;
  }

  return "当天结束后结转";
}

function getCarryHint() {
  const today = getTodayKey();

  if (state.selectedDate === today) {
    return "未完成项会在今天结束后进入明天的 todolist。";
  }

  if (state.selectedDate > today) {
    return "未来日期不会提前同步；到了当天才会接收上一天未完成项。";
  }

  return "这天结束后，未完成项会进入下一天。";
}

function syncCarryovers() {
  let changed = false;

  changed = removePrematureCarryovers() || changed;
  changed = removeCompletedRootCopies() || changed;
  changed = ensureCarryoversThroughToday() || changed;

  if (changed) {
    saveData();
  }
}

function ensureCarryoversThroughToday() {
  const today = getTodayKey();
  const earliestDate = getEarliestDate(today);

  if (!earliestDate) {
    return false;
  }

  let currentDate = addDays(earliestDate, 1);
  let changed = false;
  let guard = 0;

  while (currentDate <= today && guard < MAX_CATCH_UP_DAYS) {
    changed = carryFromPreviousDay(currentDate) || changed;
    currentDate = addDays(currentDate, 1);
    guard += 1;
  }

  return changed;
}

function carryFromPreviousDay(dateKey) {
  const previousDate = addDays(dateKey, -1);
  const previousItems = state.data.days[previousDate] || [];
  const unfinished = previousItems.filter((item) => !item.done);

  if (unfinished.length === 0) {
    return false;
  }

  const currentItems = getDayItems(dateKey);
  const existingRoots = new Set(currentItems.map((item) => getRootId(item)));
  const now = getNow().toISOString();
  let copiedCount = 0;

  unfinished.forEach((item) => {
    const rootId = getRootId(item);

    if (existingRoots.has(rootId)) {
      return;
    }

    currentItems.push({
      ...item,
      id: createId(),
      rootId,
      done: false,
      completedAt: null,
      copiedFrom: previousDate,
      copiedAt: now,
    });
    existingRoots.add(rootId);
    copiedCount += 1;
  });

  return copiedCount > 0;
}

function removePrematureCarryovers() {
  const today = getTodayKey();
  let changed = false;

  Object.keys(state.data.days).forEach((day) => {
    if (day <= today) {
      return;
    }

    const items = state.data.days[day];
    const filtered = items.filter((item) => !item.copiedFrom);

    if (filtered.length !== items.length) {
      state.data.days[day] = filtered;
      changed = true;
    }
  });

  return changed;
}

function removeCompletedRootCopies() {
  const completionDates = new Map();

  Object.entries(state.data.days).forEach(([day, items]) => {
    items.forEach((item) => {
      if (!item.done) {
        return;
      }

      const rootId = getRootId(item);
      const previousDate = completionDates.get(rootId);

      if (!previousDate || day < previousDate) {
        completionDates.set(rootId, day);
      }
    });
  });

  let changed = false;

  Object.entries(state.data.days).forEach(([day, items]) => {
    const filtered = items.filter((item) => {
      const completionDate = completionDates.get(getRootId(item));
      return !(
        completionDate &&
        day > completionDate &&
        item.copiedFrom &&
        !item.done
      );
    });

    if (filtered.length !== items.length) {
      state.data.days[day] = filtered;
      changed = true;
    }
  });

  return changed;
}

function removeFuturePendingCopies(rootId, dateKey) {
  let changed = false;

  Object.entries(state.data.days).forEach(([day, items]) => {
    if (day <= dateKey) {
      return;
    }

    const filtered = items.filter((item) => {
      return !(getRootId(item) === rootId && item.copiedFrom && !item.done);
    });

    if (filtered.length !== items.length) {
      state.data.days[day] = filtered;
      changed = true;
    }
  });

  return changed;
}

function getEarliestDate(limitDate) {
  const days = Object.keys(state.data.days)
    .filter((day) => day <= limitDate)
    .sort();

  return days.length > 0 ? days[0] : null;
}

function getDayItems(dateKey) {
  if (!state.data.days[dateKey]) {
    state.data.days[dateKey] = [];
  }

  return state.data.days[dateKey];
}

function findItem(dateKey, id) {
  return getDayItems(dateKey).find((item) => item.id === id);
}

function getRootId(item) {
  return item.rootId || item.id;
}

function normalizeData() {
  if (!state.data || !state.data.days) {
    state.data = { days: {} };
    return;
  }

  Object.entries(state.data.days).forEach(([day, items]) => {
    if (!Array.isArray(items)) {
      state.data.days[day] = [];
      return;
    }

    items.forEach((item) => {
      item.rootId = getRootId(item);
      item.done = Boolean(item.done);
      item.completedAt = item.completedAt || null;
      item.copiedFrom = item.copiedFrom || null;
      item.copiedAt = item.copiedAt || null;
    });
  });
}

function loadData() {
  const fallback = { days: {} };
  const rawData = localStorage.getItem(STORAGE_KEY);

  if (!rawData) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(rawData);
    return parsed && parsed.days ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
}

function createId() {
  if (globalThis.crypto && globalThis.crypto.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getTestToday() {
  const search = globalThis.location ? globalThis.location.search : "";
  const value = new URLSearchParams(search).get("today");

  return isDateKey(value) ? value : null;
}

function getNow() {
  return TEST_TODAY ? parseDateKey(TEST_TODAY) : new Date();
}

function getTodayKey() {
  return toDateKey(getNow());
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "") &&
    toDateKey(parseDateKey(value)) === value;
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function addDays(dateKey, amount) {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + amount);
  return toDateKey(date);
}

function relativeDateLabel(dateKey) {
  const today = getTodayKey();
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);

  if (dateKey === yesterday) {
    return "昨天";
  }

  if (dateKey === tomorrow) {
    return "明天";
  }

  if (dateKey > today) {
    return "未来清单";
  }

  return "历史清单";
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatShortDate(dateKey) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
  }).format(parseDateKey(dateKey));
}
