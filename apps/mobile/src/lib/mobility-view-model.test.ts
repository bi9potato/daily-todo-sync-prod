import { mergeMobilityPoints } from "./mobility-view-model";
import type { MobilityPoint } from "@/types";

function point(recordedAt: string, latitude: number): MobilityPoint {
  return {
    recordedAt,
    latitude,
    longitude: 120,
    accuracy: 5,
    speed: 1,
    placeName: "",
  };
}

test("only appends live points newer than the persisted server tail", () => {
  const persisted = [
    point("2026-07-11T10:00:00Z", 30),
    point("2026-07-11T10:01:00Z", 31),
  ];
  const merged = mergeMobilityPoints(persisted, [
    point("2026-07-11T10:00:30Z", 99),
    point("2026-07-11T10:02:00Z", 32),
  ]);
  expect(merged.map((item) => item.latitude)).toEqual([30, 31, 32]);
});

test("keeps route endpoints while thinning very long days", () => {
  const points = Array.from({ length: 6_100 }, (_, index) =>
    point(new Date(Date.UTC(2026, 6, 11, 0, 0, index)).toISOString(), 30 + index / 100_000),
  );
  const merged = mergeMobilityPoints(points, []);
  expect(merged.length).toBeLessThanOrEqual(6_001);
  expect(merged[0]).toEqual(points[0]);
  expect(merged.at(-1)).toEqual(points.at(-1));
});
