import {
  coalesceTodoDelete,
  coalesceTodoReorder,
  coalesceTodoUpdate,
  type TodoQueueEntry,
} from "./todo-queue-merge";

const queuedAt = "2026-07-11T00:00:00Z";

test("folds supported edits into an offline create", () => {
  const create: TodoQueueEntry = {
    kind: "create",
    clientId: "local-1",
    date: "2026-07-11",
    payload: { text: "old" },
    queuedAt,
  };
  expect(
    coalesceTodoUpdate([create], "local-1", { text: "new", done: true }, queuedAt),
  ).toEqual([
    { ...create, payload: { text: "new" } },
    { kind: "update", occurrenceId: "local-1", payload: { done: true }, queuedAt },
  ]);
});

test("last offline update wins per field", () => {
  const first = coalesceTodoUpdate([], "server-1", { text: "first", pinned: true }, queuedAt);
  expect(
    coalesceTodoUpdate(first, "server-1", { text: "last" }, "later"),
  ).toEqual([
    {
      kind: "update",
      occurrenceId: "server-1",
      payload: { text: "last", pinned: true },
      queuedAt: "later",
    },
  ]);
});

test("deleting an unsynced create removes it without a server delete", () => {
  const create: TodoQueueEntry = {
    kind: "create",
    clientId: "local-1",
    date: "2026-07-11",
    payload: { text: "temporary" },
    queuedAt,
  };
  expect(coalesceTodoDelete([create], "local-1", queuedAt)).toEqual([]);
});

test("keeps only the newest reorder for a day", () => {
  const first = coalesceTodoReorder([], "2026-07-11", ["a", "b"], queuedAt);
  expect(coalesceTodoReorder(first, "2026-07-11", ["b", "a"], "later")).toEqual([
    { kind: "reorder", date: "2026-07-11", orderedIds: ["b", "a"], queuedAt: "later" },
  ]);
});
