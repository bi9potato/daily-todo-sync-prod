import type { MobilityPointInput } from "@/types";

export type QueuedMobilityBatch = {
  recordingId: string;
  points: MobilityPointInput[];
};

export function mergeMobilityBatches(batches: QueuedMobilityBatch[]) {
  const merged = new Map<string, MobilityPointInput[]>();
  for (const batch of batches) {
    const current = merged.get(batch.recordingId) ?? [];
    current.push(...batch.points);
    merged.set(batch.recordingId, current);
  }
  return [...merged].map(([recordingId, points]) => ({
    recordingId,
    // A later sample with the same client id is the most recent retry and
    // therefore wins without changing its stable insertion position.
    points: [...new Map(points.map((point) => [point.clientId, point])).values()],
  }));
}
