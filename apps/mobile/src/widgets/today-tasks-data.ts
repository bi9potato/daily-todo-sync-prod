import AsyncStorage from "@react-native-async-storage/async-storage";

import { getDay } from "@/lib/api";
import { formatLongDate, toDateKey } from "@/lib/date";
import {
  enqueueTodoUpdate,
  flushTodoMutationQueue,
} from "@/lib/todo-mutation-queue";
import { withTimeout } from "@/lib/with-timeout";
import type { DayTodos } from "@/types";

import {
  selectWidgetTasks,
} from "./select-widget-tasks";
import type { TodayTasksWidgetData } from "./TodayTasksWidget";

// The widget renders from a headless JS task that may run with no network
// (or before login). Cache the last day payload so clicks and periodic
// updates degrade to slightly stale data instead of an empty card.
const CACHE_KEY = "daily-todo/today-widget-day";

type CachedDay = { date: string; pending: DayTodos["pending"]; done: DayTodos["done"] };

async function readCache(): Promise<CachedDay | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CachedDay) : null;
  } catch {
    return null;
  }
}

async function writeCache(day: CachedDay) {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(day));
  } catch {
    // The cache is best-effort; rendering continues from memory.
  }
}

export async function loadTodayWidgetData(): Promise<TodayTasksWidgetData> {
  const date = toDateKey(new Date());
  const dateLabel = formatLongDate(date);
  try {
    const day = await getDay(date);
    await writeCache({ date, pending: day.pending, done: day.done });
    return { dateLabel, offline: false, ...selectWidgetTasks(day, { date }) };
  } catch {
    const cached = await readCache();
    if (cached && cached.date === date) {
      return { dateLabel, offline: true, ...selectWidgetTasks(cached, { date }) };
    }
    return {
      dateLabel,
      offline: true,
      pendingTasks: [],
      pendingCount: 0,
      doneCount: 0,
    };
  }
}

// The instant view for right after a widget click: rebuilt from the local
// snapshot instead of refetching the day, so the tapped task disappears
// immediately. The next periodic/app-background update reconciles with the
// server.
export async function loadTodayWidgetDataFromCache(): Promise<TodayTasksWidgetData> {
  const date = toDateKey(new Date());
  const dateLabel = formatLongDate(date);
  const cached = await readCache();
  if (cached && cached.date === date) {
    return { dateLabel, offline: false, ...selectWidgetTasks(cached, { date }) };
  }
  return loadTodayWidgetData();
}

// Completion goes through the same offline queue the app uses, so a tap
// works without network and the app reconciles it on next launch. The cache
// is updated first (that is what the post-click render shows) and the
// network flush is capped so a dead connection cannot make the tap feel
// stuck; a timed-out flush stays queued and syncs later.
export async function completeTaskFromWidget(occurrenceId: string) {
  await enqueueTodoUpdate(occurrenceId, { done: true });
  const cached = await readCache();
  if (cached) {
    const completed = cached.pending.find((task) => task.id === occurrenceId);
    if (completed) {
      await writeCache({
        date: cached.date,
        pending: cached.pending.filter((task) => task.id !== occurrenceId),
        done: [...cached.done, completed],
      });
    }
  }
  await withTimeout(
    flushTodoMutationQueue(),
    4_000,
    "widget flush timed out",
  ).catch(() => {
    // Offline or slow - the queued entry syncs when the app next reaches
    // the API.
  });
}
