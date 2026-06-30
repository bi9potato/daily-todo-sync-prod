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
const MAX_QUEUED_POINTS = 10_000;

async function readQueue(): Promise<QueuedBatch[]> {
  if (Platform.OS === "web" || !QUEUE_FILE) {
    return [];
  }
  try {
    const content = await FileSystem.readAsStringAsync(QUEUE_FILE);
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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

export async function syncOrQueueMobilityPoints(
  recordingId: string,
  points: MobilityPointInput[],
) {
  const batches = mergeBatches([
    ...(await readQueue()),
    { recordingId, points },
  ]);
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    for (let offset = 0; offset < batch.points.length; offset += 250) {
      try {
        await addMobilityPoints(
          batch.recordingId,
          batch.points.slice(offset, offset + 250),
        );
      } catch (error) {
        await writeQueue([
          { ...batch, points: batch.points.slice(offset) },
          ...batches.slice(batchIndex + 1),
        ]);
        throw error;
      }
    }
  }
  await writeQueue([]);
}

export async function flushMobilityPointQueue() {
  const batches = await readQueue();
  if (!batches.length) {
    return;
  }
  const [first, ...rest] = batches;
  await writeQueue(rest);
  try {
    await syncOrQueueMobilityPoints(first.recordingId, first.points);
  } catch {
    // The sync helper has restored all unsent points to the queue.
  }
}
