import { Platform } from "react-native";

import { setMobilityStepSample } from "./api";
import { getIosStepCount, isIosPedometerAvailable } from "./mobility-ios-steps";
import { isNativeStepTrackingActive } from "./mobility-native-service";
import type { MobilityRecording } from "@/types";

export type MobilityStepSource = "device" | "unavailable";

export async function reconcileMobilitySteps(
  recording: MobilityRecording,
): Promise<{
  recording: MobilityRecording | null;
  source: MobilityStepSource;
}> {
  // iOS has no background step service; instead CMPedometer can report the
  // steps taken over the recording's window (even while the app was closed),
  // so we query it on each reconcile and push the total through the same
  // /steps endpoint the Android native service uses.
  if (Platform.OS === "ios") {
    if (!(await isIosPedometerAvailable())) {
      return { recording: null, source: "unavailable" };
    }
    const recordedAt = new Date().toISOString();
    const steps = await getIosStepCount(recording.startedAt, recordedAt);
    if (steps == null) {
      return { recording: null, source: "unavailable" };
    }
    try {
      const updated = await setMobilityStepSample(recording.id, {
        sourceId: `ios-pedometer-${recording.id}`,
        stepCount: steps,
        recordedAt,
      });
      return { recording: updated, source: "device" };
    } catch (error) {
      console.warn("iOS step reconcile upload failed", error);
      return { recording: null, source: "device" };
    }
  }

  const nativeStepTracking = await isNativeStepTrackingActive().catch(
    () => false,
  );
  return {
    recording: null,
    source: nativeStepTracking ? "device" : "unavailable",
  };
}
