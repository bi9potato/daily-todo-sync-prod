import type { TodoOccurrence } from "@/types";

// What the home-screen widget shows from a day's todos: the same "regular"
// bucket as the My Day screen (long-term and low-priority tasks live behind
// their own drawer routes), pinned tasks first, then the day's sort order.
export type TodayWidgetTask = {
  id: string;
  text: string;
};

export function selectWidgetTasks(
  day: {
    pending: TodoOccurrence[];
    done: TodoOccurrence[];
  },
  limit = 20,
): { pendingTasks: TodayWidgetTask[]; pendingCount: number; doneCount: number } {
  const regular = (task: TodoOccurrence) =>
    !task.isLongTerm && !task.isLowPriority;
  const pending = day.pending
    .filter(regular)
    .sort((a, b) =>
      a.isPinned === b.isPinned
        ? a.sortOrder - b.sortOrder
        : a.isPinned
          ? -1
          : 1,
    );
  return {
    pendingTasks: pending
      .slice(0, limit)
      .map((task) => ({ id: task.id, text: task.text })),
    pendingCount: pending.length,
    doneCount: day.done.filter(regular).length,
  };
}
