import { mergeMobilityBatches } from "./mobility-queue-merge";
import type { MobilityPointInput } from "@/types";

function point(clientId: string, latitude: number): MobilityPointInput {
  return {
    clientId,
    recordedAt: "2026-07-11T00:00:00Z",
    latitude,
    longitude: 120,
  };
}

test("merges batches per recording and de-duplicates retries", () => {
  expect(
    mergeMobilityBatches([
      { recordingId: "a", points: [point("1", 30), point("2", 31)] },
      { recordingId: "b", points: [point("3", 32)] },
      { recordingId: "a", points: [point("1", 33)] },
    ]),
  ).toEqual([
    { recordingId: "a", points: [point("1", 33), point("2", 31)] },
    { recordingId: "b", points: [point("3", 32)] },
  ]);
});
