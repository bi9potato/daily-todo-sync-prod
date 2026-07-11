import type { TaskCreatePayload, TaskUpdatePayload } from "@/types";

export type QueuedTodoCreate = {
  kind: "create";
  clientId: string;
  date: string;
  payload: TaskCreatePayload;
  queuedAt: string;
};

export type QueuedTodoUpdate = {
  kind: "update";
  occurrenceId: string;
  payload: TaskUpdatePayload;
  queuedAt: string;
};

export type QueuedTodoDelete = {
  kind: "delete";
  occurrenceId: string;
  queuedAt: string;
};

export type QueuedTodoReorder = {
  kind: "reorder";
  date: string;
  orderedIds: string[];
  queuedAt: string;
};

export type TodoQueueEntry =
  | QueuedTodoCreate
  | QueuedTodoUpdate
  | QueuedTodoDelete
  | QueuedTodoReorder;

const CREATE_SUPPORTED_FIELDS = new Set<keyof TaskUpdatePayload>([
  "text",
  "note",
  "isLongTerm",
  "isLowPriority",
  "reminderTime",
  "repeat",
]);

function splitUpdatePayload(payload: TaskUpdatePayload) {
  const createFields: Partial<TaskCreatePayload> = {};
  const updateOnlyFields: TaskUpdatePayload = {};
  for (const key of Object.keys(payload) as (keyof TaskUpdatePayload)[]) {
    const value = payload[key];
    const target = CREATE_SUPPORTED_FIELDS.has(key)
      ? createFields
      : updateOnlyFields;
    (target as Record<string, unknown>)[key] = value;
  }
  return { createFields, updateOnlyFields };
}

function mergeOrAppendUpdate(
  entries: TodoQueueEntry[],
  occurrenceId: string,
  payload: TaskUpdatePayload,
  queuedAt: string,
) {
  const existingIndex = entries.findIndex(
    (entry): entry is QueuedTodoUpdate =>
      entry.kind === "update" && entry.occurrenceId === occurrenceId,
  );
  if (existingIndex !== -1) {
    const existing = entries[existingIndex] as QueuedTodoUpdate;
    entries[existingIndex] = {
      ...existing,
      payload: { ...existing.payload, ...payload },
      queuedAt,
    };
  } else {
    entries.push({ kind: "update", occurrenceId, payload, queuedAt });
  }
}

export function coalesceTodoUpdate(
  current: TodoQueueEntry[],
  occurrenceId: string,
  payload: TaskUpdatePayload,
  queuedAt: string,
) {
  const entries = [...current];
  const pendingCreateIndex = entries.findIndex(
    (entry): entry is QueuedTodoCreate =>
      entry.kind === "create" && entry.clientId === occurrenceId,
  );
  if (pendingCreateIndex !== -1) {
    const pendingCreate = entries[pendingCreateIndex] as QueuedTodoCreate;
    const { createFields, updateOnlyFields } = splitUpdatePayload(payload);
    entries[pendingCreateIndex] = {
      ...pendingCreate,
      payload: { ...pendingCreate.payload, ...createFields },
    };
    if (Object.keys(updateOnlyFields).length) {
      mergeOrAppendUpdate(entries, occurrenceId, updateOnlyFields, queuedAt);
    }
    return entries;
  }
  mergeOrAppendUpdate(entries, occurrenceId, payload, queuedAt);
  return entries;
}

export function coalesceTodoDelete(
  current: TodoQueueEntry[],
  occurrenceId: string,
  queuedAt: string,
) {
  const hadPendingCreate = current.some(
    (entry) => entry.kind === "create" && entry.clientId === occurrenceId,
  );
  const remaining = current.filter((entry) => {
    if (entry.kind === "create") return entry.clientId !== occurrenceId;
    if (entry.kind === "update") return entry.occurrenceId !== occurrenceId;
    return true;
  });
  if (!hadPendingCreate) {
    remaining.push({ kind: "delete", occurrenceId, queuedAt });
  }
  return remaining;
}

export function coalesceTodoReorder(
  current: TodoQueueEntry[],
  date: string,
  orderedIds: string[],
  queuedAt: string,
) {
  return [
    ...current.filter(
      (entry) => !(entry.kind === "reorder" && entry.date === date),
    ),
    { kind: "reorder" as const, date, orderedIds, queuedAt },
  ];
}
