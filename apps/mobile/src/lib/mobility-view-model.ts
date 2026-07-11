import type { MobilityPoint, MobilitySegment } from "@/types";

export function mergeMobilityPoints(
  persisted: MobilityPoint[],
  live: MobilityPoint[],
) {
  const lastPersistedAt = persisted.length
    ? new Date(persisted[persisted.length - 1].recordedAt).getTime()
    : Number.NEGATIVE_INFINITY;
  const liveTail = live.filter(
    (point) => new Date(point.recordedAt).getTime() > lastPersistedAt,
  );
  const unique = new Map<string, MobilityPoint>();
  [...persisted, ...liveTail].forEach((point) => {
    unique.set(
      `${point.recordedAt}:${point.latitude.toFixed(6)}:${point.longitude.toFixed(6)}`,
      point,
    );
  });
  const sorted = [...unique.values()].sort(
    (first, second) =>
      new Date(first.recordedAt).getTime() -
      new Date(second.recordedAt).getTime(),
  );
  if (sorted.length <= 6_000) return sorted;
  const stride = Math.ceil(sorted.length / 5_999);
  return [
    sorted[0],
    ...sorted.slice(1, -1).filter((_, index) => index % stride === 0),
    sorted.at(-1)!,
  ];
}

export function mobilitySegmentKey(segment: MobilitySegment) {
  return `${segment.startTime}:${segment.latitude?.toFixed(5)}:${segment.longitude?.toFixed(5)}`;
}

export function formatMobilitySegmentTimeRange(segment: MobilitySegment) {
  const format = (value: string) =>
    new Date(value).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  return `${format(segment.startTime)} - ${format(segment.endTime)}`;
}
