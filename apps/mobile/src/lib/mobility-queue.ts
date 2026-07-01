import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

import { addMobilityPoints } from "./api";
import type { MobilityPointInput } from "@/types";

type QueuedBatch = {
  recordingId: string;
  points: MobilityPointInput[];
};

const QUEUE_FILE = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}pending-mobility-points.json`
  : null;
const NATIVE_QUEUE_FILE = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}native-mobility-points.json`
  : null;
const NATIVE_IMPORT_FILE = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}native-mobility-points-import.json`
  : null;
const FLUSH_MARKER_FILE = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}pending-mobility-points-flush.json`
  : null;
const MAX_QUEUED_POINTS = 10_000;
const DEFAULT_FLUSH_INTERVAL_MS = 30_000;

let queueMutation: Promise<unknown> = Promise.resolve();
let flushPromise: Promise<boolean> | null = null;
let lastFlushAttemptAt = 0;

function runQueueMutation<T>(operation: () => Promise<T>) {
  const next = queueMutation.then(operation, operation);
  queueMutation = next.catch(() => undefined);
  return next;
}

async function readQueue(): Promise<QueuedBatch[]> {
  return readQueueFile(QUEUE_FILE);
}

async function readQueueFile(uri: string | null): Promise<QueuedBatch[]> {
  if (Platform.OS === "web" || !uri) {
    return [];
  }
  try {
    const content = await FileSystem.readAsStringAsync(uri);
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function getQueuedMobilityPointCount() {
  const batches = await readQueue();
  return batches.reduce((total, batch) => total + batch.points.length, 0);
}

async function writeQueue(batches: QueuedBatch[]) {
  if (Platform.OS === "web" || !QUEUE_FILE) {
    return;
  }
  const trimmed: QueuedBatch[] = [];
  let remaining = MAX_QUEUED_POINTS;
  for (const batch of [...batches].reverse()) {
    if (remaining <= 0) {
      break;
    }
    const points = batch.points.slice(-remaining);
    trimmed.unshift({ ...batch, points });
    remaining -= points.length;
  }
  if (!trimmed.length) {
    await FileSystem.deleteAsync(QUEUE_FILE, { idempotent: true });
    return;
  }
  await FileSystem.writeAsStringAsync(QUEUE_FILE, JSON.stringify(trimmed));
}

async function readLastFlushAttemptAt() {
  if (Platform.OS === "web" || !FLUSH_MARKER_FILE) {
    return lastFlushAttemptAt;
  }
  try {
    const parsed = JSON.parse(
      await FileSystem.readAsStringAsync(FLUSH_MARKER_FILE),
    );
    return typeof parsed.lastFlushAttemptAt === "number"
      ? parsed.lastFlushAttemptAt
      : lastFlushAttemptAt;
  } catch {
    return lastFlushAttemptAt;
  }
}

async function writeLastFlushAttemptAt(value: number) {
  lastFlushAttemptAt = value;
  if (Platform.OS === "web" || !FLUSH_MARKER_FILE) {
    return;
  }
  try {
    await FileSystem.writeAsStringAsync(
      FLUSH_MARKER_FILE,
      JSON.stringify({ lastFlushAttemptAt: value }),
    );
  } catch (error) {
    console.warn("Mobility upload marker write failed", error);
  }
}

function mergeBatches(batches: QueuedBatch[]) {
  const merged = new Map<string, MobilityPointInput[]>();
  for (const batch of batches) {
    const current = merged.get(batch.recordingId) ?? [];
    current.push(...batch.points);
    merged.set(batch.recordingId, current);
  }
  return [...merged].map(([recordingId, points]) => ({
    recordingId,
    points: [...new Map(points.map((point) => [point.clientId, point])).values()],
  }));
}

function isMissingRecordingError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("404") || message.toLowerCase().includes("not found");
}

export async function queueMobilityPoints(
  recordingId: string,
  points: MobilityPointInput[],
) {
  if (!points.length) {
    return;
  }
  await runQueueMutation(async () => {
    const batches = mergeBatches([
      ...(await readQueue()),
      { recordingId, points },
    ]);
    await writeQueue(batches);
  });
}

export async function syncOrQueueMobilityPoints(
  recordingId: string,
  points: MobilityPointInput[],
) {
  await queueMobilityPoints(recordingId, points);
  await flushMobilityPointQueue();
}

export async function importNativeMobilityPointQueue() {
  if (Platform.OS === "web" || !NATIVE_QUEUE_FILE || !NATIVE_IMPORT_FILE) {
    return false;
  }
  return runQueueMutation(async () => {
    try {
      await FileSystem.deleteAsync(NATIVE_IMPORT_FILE, { idempotent: true });
      await FileSystem.moveAsync({
        from: NATIVE_QUEUE_FILE,
        to: NATIVE_IMPORT_FILE,
      });
    } catch {
      return false;
    }
    const nativeBatches = await readQueueFile(NATIVE_IMPORT_FILE);
    await FileSystem.deleteAsync(NATIVE_IMPORT_FILE, { idempotent: true }).catch(
      () => undefined,
    );
    if (!nativeBatches.length) {
      return false;
    }
    await writeQueue(mergeBatches([...(await readQueue()), ...nativeBatches]));
    return true;
  });
}

export async function flushMobilityPointQueue() {
  if (flushPromise) {
    return flushPromise;
  }
  await writeLastFlushAttemptAt(Date.now());
  flushPromise = runQueueMutation(async () => {
    const batches = mergeBatches(await readQueue());
    if (!batches.length) {
      return false;
    }
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex];
      for (let offset = 0; offset < batch.points.length; offset += 250) {
        try {
          await addMobilityPoints(
            batch.recordingId,
            batch.points.slice(offset, offset + 250),
          );
        } catch (error) {
          if (isMissingRecordingError(error)) {
            console.warn(
              "Dropping stale mobility points for missing recording",
              batch.recordingId,
            );
            break;
          }
          await writeQueue([
            { ...batch, points: batch.points.slice(offset) },
            ...batches.slice(batchIndex + 1),
          ]);
          throw error;
        }
      }
    }
    await writeQueue([]);
    return true;
  }).finally(() => {
    flushPromise = null;
  });
  return flushPromise;
}

export async function maybeFlushMobilityPointQueue(
  intervalMs = DEFAULT_FLUSH_INTERVAL_MS,
) {
  if (flushPromise) {
    return flushPromise;
  }
  const now = Date.now();
  const persistedLastFlushAttemptAt = await readLastFlushAttemptAt();
  if (!persistedLastFlushAttemptAt) {
    await writeLastFlushAttemptAt(now);
    return false;
  }
  if (now - persistedLastFlushAttemptAt < intervalMs) {
    return false;
  }
  return flushMobilityPointQueue();
}

export async function clearMobilityPointQueue() {
  await runQueueMutation(() => writeQueue([]));
}
