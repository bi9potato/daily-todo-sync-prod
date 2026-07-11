import type { DeviceTimelineItem } from "@/types";

export type AppUsageSummary = {
  appLabel: string;
  packageName: string;
  sessionCount: number;
  totalSeconds: number;
};

export function deviceTimelineDurationSeconds(item: DeviceTimelineItem) {
  if (!item.startTime || !item.endTime) {
    return Math.max(0, (item.durationMinutes ?? 0) * 60);
  }
  const start = new Date(item.startTime).getTime();
  const end = new Date(item.endTime).getTime();
  return Number.isFinite(start) && Number.isFinite(end)
    ? Math.max(0, Math.round((end - start) / 1_000))
    : 0;
}

export function aggregateAppUsage(timeline: DeviceTimelineItem[]) {
  const byPackage = new Map<string, AppUsageSummary>();
  for (const item of timeline) {
    if (item.type !== "app") {
      continue;
    }
    const packageName = item.packageName || item.appLabel || "unknown";
    const current = byPackage.get(packageName) ?? {
      appLabel: item.appLabel || packageName,
      packageName,
      sessionCount: 0,
      totalSeconds: 0,
    };
    current.sessionCount += 1;
    current.totalSeconds += deviceTimelineDurationSeconds(item);
    byPackage.set(packageName, current);
  }
  return [...byPackage.values()]
    .filter((item) => item.totalSeconds > 0)
    .sort((left, right) => right.totalSeconds - left.totalSeconds);
}
