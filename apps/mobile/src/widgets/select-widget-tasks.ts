import { isReminderTimeUpcoming } from "@/lib/task-reminder-time";
import type { TodoOccurrence } from "@/types";

// What the home-screen widget shows from a day's todos: the same "regular"
// bucket as the My Day screen (long-term and low-priority tasks live behind
// their own drawer routes), pinned tasks first, then the day's sort order.
// Modeled on Samsung Reminders' widget rows: title plus a small time line,
// with an overdue flag so a missed reminder time can render in red.
export type TodayWidgetTask = {
  id: string;
  text: string;
  reminderTime: string | null;
  overdue: boolean;
};

export function selectWidgetTasks(
  day: {
    pending: TodoOccurrence[];
    done: TodoOccurrence[];
  },
  options: { limit?: number; date?: string; now?: number } = {},
): { pendingTasks: TodayWidgetTask[]; pendingCount: number; doneCount: number } {
  const { limit = 20, date, now = Date.now() } = options;
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
    pendingTasks: pending.slice(0, limit).map((task) => ({
      id: task.id,
      text: task.text,
      reminderTime: task.reminderTime ? task.reminderTime.slice(0, 5) : null,
      overdue: Boolean(
        task.reminderTime &&
          date &&
          !isReminderTimeUpcoming(date, task.reminderTime, now),
      ),
    })),
    pendingCount: pending.length,
    doneCount: day.done.filter(regular).length,
  };
}
