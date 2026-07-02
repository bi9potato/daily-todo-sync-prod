import { Pedometer } from "expo-sensors";
import { Platform } from "react-native";

// iOS CMPedometer (surfaced through expo-sensors' Pedometer) can report the
// step count for an arbitrary past window - including steps taken while the app
// was backgrounded or killed - which is exactly what the "reconcile on
// foreground" model needs. Android cannot do this range query, which is why it
// keeps its own foreground-service step counter instead.
export async function isIosPedometerAvailable() {
  if (Platform.OS !== "ios") {
    return false;
  }
  return Pedometer.isAvailableAsync().catch(() => false);
}

export async function getIosStepCount(
  startISO: string,
  endISO: string,
): Promise<number | null> {
  if (Platform.OS !== "ios") {
    return null;
  }
  try {
    const { steps } = await Pedometer.getStepCountAsync(
      new Date(startISO),
      new Date(endISO),
    );
    return Number.isFinite(steps) ? steps : null;
  } catch {
    return null;
  }
}
