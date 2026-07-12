import { selectWidgetTasks } from "./select-widget-tasks";
import type { TodoOccurrence } from "@/types";

function task(overrides: Partial<TodoOccurrence>): TodoOccurrence {
  return {
    id: "id",
    text: "task",
    isPinned: false,
    isLongTerm: false,
    isLowPriority: false,
    sortOrder: 0,
    reminderTime: null,
    ...overrides,
  } as TodoOccurrence;
}

test("shows only regular tasks, pinned first, in sort order", () => {
  const result = selectWidgetTasks({
    pending: [
      task({ id: "b", sortOrder: 2 }),
      task({ id: "long", isLongTerm: true }),
      task({ id: "low", isLowPriority: true }),
      task({ id: "a", sortOrder: 1 }),
      task({ id: "pinned", sortOrder: 9, isPinned: true }),
    ],
    done: [task({ id: "done1" }), task({ id: "done-long", isLongTerm: true })],
  });
  expect(result.pendingTasks.map((item) => item.id)).toEqual([
    "pinned",
    "a",
    "b",
  ]);
  expect(result.pendingCount).toBe(3);
  expect(result.doneCount).toBe(1);
});

test("caps the rendered list but keeps the true pending count", () => {
  const pending = Array.from({ length: 25 }, (_, index) =>
    task({ id: `t${index}`, sortOrder: index }),
  );
  const result = selectWidgetTasks({ pending, done: [] }, { limit: 20 });
  expect(result.pendingTasks).toHaveLength(20);
  expect(result.pendingCount).toBe(25);
});

test("handles an empty day", () => {
  expect(selectWidgetTasks({ pending: [], done: [] })).toEqual({
    pendingTasks: [],
    pendingCount: 0,
    doneCount: 0,
  });
});

test("carries a trimmed reminder time and flags overdue ones", () => {
  const now = new Date("2026-07-12T10:00:00").getTime();
  const result = selectWidgetTasks(
    {
      pending: [
        task({ id: "past", sortOrder: 0, reminderTime: "09:30:00" }),
        task({ id: "future", sortOrder: 1, reminderTime: "18:00" }),
        task({ id: "none", sortOrder: 2 }),
      ],
      done: [],
    },
    { date: "2026-07-12", now },
  );
  expect(result.pendingTasks).toEqual([
    { id: "past", text: "task", reminderTime: "09:30", overdue: true },
    { id: "future", text: "task", reminderTime: "18:00", overdue: false },
    { id: "none", text: "task", reminderTime: null, overdue: false },
  ]);
});

test("never flags overdue without a date to compare against", () => {
  const result = selectWidgetTasks({
    pending: [task({ id: "t", reminderTime: "00:01" })],
    done: [],
  });
  expect(result.pendingTasks[0].overdue).toBe(false);
  expect(result.pendingTasks[0].reminderTime).toBe("00:01");
});
