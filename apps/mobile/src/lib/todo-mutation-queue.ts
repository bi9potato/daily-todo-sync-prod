import { useEffect, useState } from "react";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

import {
  ApiError,
  createTask,
  deleteOccurrence,
  reorderDay,
  updateOccurrence,
} from "./api";
import type { TaskCreatePayload, TaskUpdatePayload } from "@/types";

type QueuedCreate = {
  kind: "create";
  clientId: string;
  date: string;
  payload: TaskCreatePayload;
  queuedAt: string;
};

type QueuedUpdate = {
  kind: "update";
  occurrenceId: string;
  payload: TaskUpdatePayload;
  queuedAt: string;
};

type QueuedDelete = {
  kind: "delete";
  occurrenceId: string;
  queuedAt: string;
};

type QueuedReorder = {
  kind: "reorder";
  date: string;
  orderedIds: string[];
  queuedAt: string;
};

type QueueEntry = QueuedCreate | QueuedUpdate | QueuedDelete | QueuedReorder;

// Fields the create endpoint itself understands (see TaskCreateIn on the
// backend). Anything outside this set (currently just `done`/`location`)
// can't be folded into a still-pending create's payload - it has to travel
// as its own follow-up update once the create has synced.
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
    if (CREATE_SUPPORTED_FIELDS.has(key)) {
      (createFields as Record<string, unknown>)[key] = value;
    } else {
      (updateOnlyFields as Record<string, unknown>)[key] = value;
    }
  }
  return { createFields, updateOnlyFields };
}

const QUEUE_KEY = "daily-todo-sync.todo-mutation-queue";
const QUEUE_FILE = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}pending-todo-mutations.json`
  : null;

let queueMutation: Promise<unknown> = Promise.resolve();
let flushPromise: Promise<void> | null = null;
const listeners = new Set<(count: number) => void>();

function runQueueMutation<T>(operation: () => Promise<T>) {
  const next = queueMutation.then(operation, operation);
  queueMutation = next.catch(() => undefined);
  return next;
}

async function readQueue(): Promise<QueueEntry[]> {
  try {
    const raw =
      Platform.OS === "web"
        ? (globalThis.localStorage?.getItem(QUEUE_KEY) ?? null)
        : QUEUE_FILE
          ? await FileSystem.readAsStringAsync(QUEUE_FILE)
          : null;
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(entries: QueueEntry[]) {
  const serialized = JSON.stringify(entries);
  if (Platform.OS === "web") {
    if (entries.length) {
      globalThis.localStorage?.setItem(QUEUE_KEY, serialized);
    } else {
      globalThis.localStorage?.removeItem(QUEUE_KEY);
    }
  } else if (QUEUE_FILE) {
    if (entries.length) {
      await FileSystem.writeAsStringAsync(QUEUE_FILE, serialized);
    } else {
      await FileSystem.deleteAsync(QUEUE_FILE, { idempotent: true });
    }
  }
  listeners.forEach((listener) => listener(entries.length));
}

function now() {
  return new Date().toISOString();
}

// A dependency-free RFC4122 v4-ish id. It only needs to be unique enough to
// serve as an idempotency/identity key on a single device, not
// cryptographically strong.
export function createTodoClientId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export async function enqueueTodoCreate(
  clientId: string,
  date: string,
  payload: TaskCreatePayload,
) {
  await runQueueMutation(async () => {
    const entries = await readQueue();
    entries.push({ kind: "create", clientId, date, payload, queuedAt: now() });
    await writeQueue(entries);
  });
}

export async function enqueueTodoUpdate(
  occurrenceId: string,
  payload: TaskUpdatePayload,
) {
  await runQueueMutation(async () => {
    const entries = await readQueue();

    const pendingCreateIndex = entries.findIndex(
      (entry): entry is QueuedCreate =>
        entry.kind === "create" && entry.clientId === occurrenceId,
    );
    if (pendingCreateIndex !== -1) {
      const pendingCreate = entries[pendingCreateIndex] as QueuedCreate;
      const { createFields, updateOnlyFields } = splitUpdatePayload(payload);
      entries[pendingCreateIndex] = {
        ...pendingCreate,
        payload: { ...pendingCreate.payload, ...createFields },
      };
      if (Object.keys(updateOnlyFields).length) {
        mergeOrAppendUpdate(entries, occurrenceId, updateOnlyFields);
      }
      await writeQueue(entries);
      return;
    }

    mergeOrAppendUpdate(entries, occurrenceId, payload);
    await writeQueue(entries);
  });
}

function mergeOrAppendUpdate(
  entries: QueueEntry[],
  occurrenceId: string,
  payload: TaskUpdatePayload,
) {
  const existingIndex = entries.findIndex(
    (entry): entry is QueuedUpdate =>
      entry.kind === "update" && entry.occurrenceId === occurrenceId,
  );
  if (existingIndex !== -1) {
    const existing = entries[existingIndex] as QueuedUpdate;
    entries[existingIndex] = {
      ...existing,
      payload: { ...existing.payload, ...payload },
      queuedAt: now(),
    };
    return;
  }
  entries.push({ kind: "update", occurrenceId, payload, queuedAt: now() });
}

export async function enqueueTodoDelete(occurrenceId: string) {
  await runQueueMutation(async () => {
    const entries = await readQueue();
    const hadPendingCreate = entries.some(
      (entry) => entry.kind === "create" && entry.clientId === occurrenceId,
    );
    const remaining = entries.filter((entry) => {
      if (entry.kind === "create") {
        return entry.clientId !== occurrenceId;
      }
      if (entry.kind === "update") {
        return entry.occurrenceId !== occurrenceId;
      }
      return true;
    });
    // Never synced in the first place - nothing to tell the server about.
    if (!hadPendingCreate) {
      remaining.push({ kind: "delete", occurrenceId, queuedAt: now() });
    }
    await writeQueue(remaining);
  });
}

export async function enqueueTodoReorder(date: string, orderedIds: string[]) {
  await runQueueMutation(async () => {
    const entries = (await readQueue()).filter(
      (entry) => !(entry.kind === "reorder" && entry.date === date),
    );
    entries.push({ kind: "reorder", date, orderedIds, queuedAt: now() });
    await writeQueue(entries);
  });
}

function isNotFoundError(error: unknown) {
  return error instanceof ApiError && error.status === 404;
}

async function applyQueueEntry(entry: QueueEntry) {
  switch (entry.kind) {
    case "create":
      await createTask(entry.date, { ...entry.payload, clientId: entry.clientId });
      return;
    case "update":
      await updateOccurrence(entry.occurrenceId, entry.payload);
      return;
    case "delete":
      await deleteOccurrence(entry.occurrenceId);
      return;
    case "reorder":
      await reorderDay(entry.date, entry.orderedIds);
      return;
  }
}

export async function flushTodoMutationQueue() {
  if (flushPromise) {
    return flushPromise;
  }
  flushPromise = runQueueMutation(async () => {
    let entries = await readQueue();
    while (entries.length) {
      const [entry, ...rest] = entries;
      try {
        await applyQueueEntry(entry);
      } catch (error) {
        if (isNotFoundError(error) && entry.kind !== "create") {
          // Already gone - a later queued delete, or another client,
          // beat this entry to it. Nothing left to do.
        } else if (!(error instanceof ApiError)) {
          // Couldn't reach the server at all - stop here and leave this
          // entry (and everything after it) queued for next time.
          await writeQueue(entries);
          return;
        } else {
          console.warn(
            "Dropping todo mutation queue entry after server error",
            entry,
            error,
          );
        }
      }
      entries = rest;
      await writeQueue(entries);
    }
  }).finally(() => {
    flushPromise = null;
  });
  return flushPromise;
}

export async function getQueuedTodoMutationCount() {
  const entries = await readQueue();
  return entries.length;
}

export function useQueuedTodoMutationCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void getQueuedTodoMutationCount().then((value) => {
      if (!cancelled) {
        setCount(value);
      }
    });
    listeners.add(setCount);
    return () => {
      cancelled = true;
      listeners.delete(setCount);
    };
  }, []);
  return count;
}
