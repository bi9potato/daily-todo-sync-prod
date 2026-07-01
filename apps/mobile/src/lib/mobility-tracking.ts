import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

import {
  getActiveMobilityRecordingId,
  setActiveMobilityRecordingId,
} from "./mobility-storage";
import { syncOrQueueMobilityPoints } from "./mobility-queue";
import {
  readMobilityDiagnostics,
  updateMobilityDiagnostics,
} from "./mobility-diagnostics";
import type { MobilityPointInput } from "@/types";

export const MOBILITY_LOCATION_TASK = "daily-todo-background-location-v2";
const LEGACY_MOBILITY_LOCATION_TASKS = ["daily-todo-background-location"];

type LocationTaskData = {
  locations: Location.LocationObject[];
};

let foregroundSubscription: Location.LocationSubscription | null = null;
let foregroundRecordingId: string | null = null;
let foregroundSyncPromise: Promise<void> = Promise.resolve();

function getAndroidApiLevel() {
  const version =
    typeof Platform.Version === "string"
      ? Number.parseInt(Platform.Version, 10)
      : Platform.Version;
  return Number.isFinite(version) ? version : null;
}

export function supportsNativeBackgroundLocationTracking() {
  if (Platform.OS === "web") {
    return false;
  }
  if (Platform.OS !== "android") {
    return true;
  }
  const apiLevel = getAndroidApiLevel();
  return apiLevel === null || apiLevel < 36;
}

export function locationToMobilityPoint(
  location: Location.LocationObject,
  placeName = "",
): MobilityPointInput {
  const { coords, timestamp } = location;
  return {
    clientId: `${Math.round(timestamp)}:${coords.latitude.toFixed(6)}:${coords.longitude.toFixed(6)}`,
    recordedAt: new Date(timestamp).toISOString(),
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: coords.accuracy,
    altitude: coords.altitude,
    speed: coords.speed,
    heading: coords.heading,
    placeName,
  };
}

function defineMobilityLocationTask() {
  try {
    if (
      Platform.OS !== "web" &&
      !TaskManager.isTaskDefined(MOBILITY_LOCATION_TASK)
    ) {
      TaskManager.defineTask<LocationTaskData>(
        MOBILITY_LOCATION_TASK,
        async ({ data, error }) => {
          if (error) {
            await updateMobilityDiagnostics({
              lastError: error.message || "后台定位任务执行失败",
            });
            return;
          }
          if (!data?.locations?.length) {
            return;
          }
          const lastLocationAt = new Date(
            data.locations.at(-1)?.timestamp ?? Date.now(),
          ).toISOString();
          await updateMobilityDiagnostics({ lastLocationAt });
          const recordingId = await getActiveMobilityRecordingId();
          if (!recordingId) {
            await updateMobilityDiagnostics({
              lastError: "收到后台定位，但本地没有活动记录 ID",
            });
            return;
          }
          try {
            await syncOrQueueMobilityPoints(
              recordingId,
              data.locations.map((location) =>
                locationToMobilityPoint(location),
              ),
            );
            await updateMobilityDiagnostics({
              lastError: "",
              lastSyncAt: new Date().toISOString(),
            });
          } catch (syncError) {
            await updateMobilityDiagnostics({
              lastError: "定位点已离线保存，等待网络恢复后同步",
            });
            console.warn("Mobility background sync failed", syncError);
          }
        },
      );
    }
  } catch (error) {
    console.warn("Mobility background task unavailable", error);
  }
}

defineMobilityLocationTask();

for (const taskName of LEGACY_MOBILITY_LOCATION_TASKS) {
  try {
    if (Platform.OS !== "web" && !TaskManager.isTaskDefined(taskName)) {
      TaskManager.defineTask(taskName, async () => undefined);
    }
  } catch {
    // Legacy task cleanup is best effort only.
  }
}

export async function isMobilityLocationTrackingActive() {
  if (Platform.OS === "web") {
    return false;
  }
  if (!supportsNativeBackgroundLocationTracking()) {
    return false;
  }
  try {
    return await Location.hasStartedLocationUpdatesAsync(MOBILITY_LOCATION_TASK);
  } catch (error) {
    console.warn("Mobility location status unavailable", error);
    return false;
  }
}

export function isForegroundMobilityTrackingActive(recordingId?: string) {
  return Boolean(
    foregroundSubscription &&
      (!recordingId || foregroundRecordingId === recordingId),
  );
}

function enqueueForegroundLocation(
  recordingId: string,
  location: Location.LocationObject,
) {
  foregroundSyncPromise = foregroundSyncPromise
    .catch(() => undefined)
    .then(async () => {
      const lastLocationAt = new Date(location.timestamp).toISOString();
      await updateMobilityDiagnostics({ lastLocationAt });
      try {
        await syncOrQueueMobilityPoints(recordingId, [
          locationToMobilityPoint(location),
        ]);
        await updateMobilityDiagnostics({
          lastError: "",
          lastSyncAt: new Date().toISOString(),
        });
      } catch (error) {
        await updateMobilityDiagnostics({
          lastError: "定位点已离线保存，等待网络恢复后同步",
        });
        console.warn("Mobility foreground sync failed", error);
      }
    });
  void foregroundSyncPromise;
}

export async function startForegroundMobilityTracking(recordingId: string) {
  if (Platform.OS === "web") {
    return false;
  }
  if (isForegroundMobilityTrackingActive(recordingId)) {
    return true;
  }
  await stopForegroundMobilityTracking();
  foregroundRecordingId = recordingId;
  foregroundSubscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.High,
      distanceInterval: 10,
      timeInterval: 10_000,
    },
    (location) => {
      const activeRecordingId = foregroundRecordingId;
      if (activeRecordingId) {
        enqueueForegroundLocation(activeRecordingId, location);
      }
    },
  );
  await updateMobilityDiagnostics({
    lastError: "",
    recoveredAt: new Date().toISOString(),
  });
  return true;
}

export async function stopForegroundMobilityTracking() {
  foregroundSubscription?.remove();
  foregroundSubscription = null;
  foregroundRecordingId = null;
  await foregroundSyncPromise.catch(() => undefined);
}

export async function startMobilityLocationTracking({
  background = supportsNativeBackgroundLocationTracking(),
  manual = false,
  recordingId,
}: { background?: boolean; manual?: boolean; recordingId?: string } = {}) {
  if (Platform.OS === "web") {
    return;
  }
  const activeRecordingId = recordingId ?? (await getActiveMobilityRecordingId());
  if (!activeRecordingId) {
    throw new Error("没有活动足迹记录，无法开始定位。");
  }
  await setActiveMobilityRecordingId(activeRecordingId);
  await startForegroundMobilityTracking(activeRecordingId);
  if (!manual) {
    return;
  }
  if (!background || !supportsNativeBackgroundLocationTracking()) {
    return;
  }
  defineMobilityLocationTask();
  const alreadyStarted = await isMobilityLocationTrackingActive();
  if (alreadyStarted) {
    return;
  }
  await Location.startLocationUpdatesAsync(MOBILITY_LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    activityType: Location.ActivityType.Fitness,
    distanceInterval: 10,
    timeInterval: 10_000,
    ...(Platform.OS === "ios"
      ? {
          deferredUpdatesDistance: 30,
          deferredUpdatesInterval: 30_000,
        }
      : {}),
    foregroundService: {
      notificationTitle: "Daily Todo 正在记录足迹",
      notificationBody: "持续记录行走路线；点击可返回应用。",
      notificationColor: "#2C5745",
      killServiceOnDestroy: true,
    },
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
  });
  await updateMobilityDiagnostics({
    lastError: "",
    recoveredAt: new Date().toISOString(),
  });
}

export async function stopMobilityLocationTracking() {
  if (Platform.OS === "web") {
    return;
  }
  await stopForegroundMobilityTracking();
  if (!supportsNativeBackgroundLocationTracking()) {
    return;
  }
  try {
    if (await isMobilityLocationTrackingActive()) {
      await Location.stopLocationUpdatesAsync(MOBILITY_LOCATION_TASK);
    }
  } catch (error) {
    console.warn("Mobility location stop failed", error);
  }
}

export async function cleanupLegacyMobilityRuntime() {
  if (Platform.OS === "web") {
    return;
  }
  for (const taskName of LEGACY_MOBILITY_LOCATION_TASKS) {
    try {
      if (await Location.hasStartedLocationUpdatesAsync(taskName)) {
        await Location.stopLocationUpdatesAsync(taskName);
      }
    } catch (error) {
      console.warn("Legacy mobility location cleanup failed", error);
    }
    try {
      if (await TaskManager.isTaskRegisteredAsync(taskName)) {
        await TaskManager.unregisterTaskAsync(taskName);
      }
    } catch (error) {
      console.warn("Legacy mobility task cleanup failed", error);
    }
  }
}

export type MobilityTrackingDiagnostics = Awaited<
  ReturnType<typeof getMobilityTrackingDiagnostics>
>;

export async function getMobilityTrackingDiagnostics() {
  const nativeBackgroundAvailable = supportsNativeBackgroundLocationTracking();
  const foregroundWatchActive = isForegroundMobilityTrackingActive();
  if (Platform.OS === "web") {
    return {
      backgroundPermission: false,
      foregroundPermission: false,
      nativeTaskActive: false,
      nativeBackgroundAvailable,
      foregroundWatchActive,
      ...(await readMobilityDiagnostics()),
    };
  }
  const [foreground, background, nativeTaskActive, saved] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    nativeBackgroundAvailable
      ? Location.getBackgroundPermissionsAsync()
      : Promise.resolve({ granted: false }),
    nativeBackgroundAvailable
      ? isMobilityLocationTrackingActive()
      : Promise.resolve(false),
    readMobilityDiagnostics(),
  ]);
  return {
    backgroundPermission: background.granted,
    foregroundPermission: foreground.granted,
    foregroundWatchActive,
    nativeTaskActive,
    nativeBackgroundAvailable,
    ...saved,
  };
}

export async function recoverMobilityLocationTracking(recordingId: string) {
  if (Platform.OS === "web") {
    return getMobilityTrackingDiagnostics();
  }
  const nativeBackgroundAvailable = supportsNativeBackgroundLocationTracking();
  const [foreground, background] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    nativeBackgroundAvailable
      ? Location.getBackgroundPermissionsAsync()
      : Promise.resolve({ granted: false }),
  ]);
  if (!foreground.granted) {
    await updateMobilityDiagnostics({
      lastError: "位置权限已关闭，请重新打开足迹记录授权",
    });
    return getMobilityTrackingDiagnostics();
  }
  await setActiveMobilityRecordingId(recordingId);
  try {
    await startForegroundMobilityTracking(recordingId);
  } catch (error) {
    await updateMobilityDiagnostics({
      lastError: error instanceof Error ? error.message : "实时定位恢复失败",
    });
  }
  if (
    nativeBackgroundAvailable &&
    background.granted &&
    !(await isMobilityLocationTrackingActive())
  ) {
    await updateMobilityDiagnostics({
      lastError: "后台服务未运行，当前会在应用打开时继续记录。",
    });
  }
  return getMobilityTrackingDiagnostics();
}
