import { isNativeStepTrackingActive } from "./mobility-native-service";
import type { MobilityRecording } from "@/types";

export type MobilityStepSource = "device" | "unavailable";

export async function reconcileMobilitySteps(
  _recording: MobilityRecording,
): Promise<{
  recording: MobilityRecording | null;
  source: MobilityStepSource;
}> {
  const nativeStepTracking = await isNativeStepTrackingActive().catch(
    () => false,
  );
  return {
    recording: null,
    source: nativeStepTracking ? "device" : "unavailable",
  };
}
