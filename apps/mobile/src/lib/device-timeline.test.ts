import { aggregateAppUsage, deviceTimelineDurationSeconds } from "./device-timeline";
import type { DeviceTimelineItem } from "@/types";

function app(overrides: Partial<DeviceTimelineItem>): DeviceTimelineItem {
  return {
    type: "app",
    time: null,
    startTime: null,
    endTime: null,
    durationMinutes: null,
    packageName: "com.example.app",
    appLabel: "Example",
    ...overrides,
  };
}

test("calculates an interval across a timezone boundary", () => {
  expect(
    deviceTimelineDurationSeconds(
      app({
        startTime: "2026-07-11T23:59:30+08:00",
        endTime: "2026-07-12T00:00:30+08:00",
      }),
    ),
  ).toBe(60);
});

test("aggregates sessions by package and ignores device markers", () => {
  const marker: DeviceTimelineItem = {
    ...app({}),
    type: "unlock",
    time: "2026-07-11T10:00:00+08:00",
  };
  const usage = aggregateAppUsage([
    app({ durationMinutes: 2 }),
    app({ durationMinutes: 3 }),
    app({ packageName: "com.other", appLabel: "Other", durationMinutes: 8 }),
    marker,
  ]);
  expect(usage).toEqual([
    {
      appLabel: "Other",
      packageName: "com.other",
      sessionCount: 1,
      totalSeconds: 480,
    },
    {
      appLabel: "Example",
      packageName: "com.example.app",
      sessionCount: 2,
      totalSeconds: 300,
    },
  ]);
});

test("clamps corrupt negative durations", () => {
  expect(
    deviceTimelineDurationSeconds(
      app({
        startTime: "2026-07-11T10:05:00Z",
        endTime: "2026-07-11T10:00:00Z",
      }),
    ),
  ).toBe(0);
});
