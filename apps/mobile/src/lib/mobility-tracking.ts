import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

import {
  getActiveMobilityRecordingId,
  clearActiveMobilityRecordingId,
  setActiveMobilityRecordingId,
} from "./mobility-storage";
import {
  clearMobilityPointQueue,
  syncOrQueueMobilityPoints,
} from "./mobility-queue";
import {
  readMobilityDiagnostics,
  updateMobilityDiagnostics,
} from "./mobility-diagnostics";
import type { MobilityPointInput } from "@/types";

export const MOBILITY_LOCATION_TASK = "daily-todo-background-location";
const ANDROID_DISABLED_BACKGROUND_VERSION = 36;

type LocationTaskData = {
  locations: Location.LocationObject[];
};

function androidVersionNumber() {
  return typeof Platform.Version === "string"
    ? Number.parseInt(Platform.Version, 10)
    : Platform.Version;
}

export function isMobilityNativeRuntimeDisabled() {
  const version = androidVersionNumber();
  return (
    Platform.OS === "android" &&
    Number.isFinite(version) &&
    version >= ANDROID_DISABLED_BACKGROUND_VERSION
  );
}

export const MOBILITY_DISABLED_MESSAGE =
  "Mobility tracking is temporarily disabled on Android 16 to prevent a native permission crash.";

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
  if (isMobilityNativeRuntimeDisabled()) {
    return;
  }
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
          data.locations.map((location) => locationToMobilityPoint(location)),
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

export async function isMobilityLocationTrackingActive() {
  if (Platform.OS === "web" || isMobilityNativeRuntimeDisabled()) {
    return false;
  }
  try {
    return await Location.hasStartedLocationUpdatesAsync(MOBILITY_LOCATION_TASK);
  } catch (error) {
    console.warn("Mobility location status unavailable", error);
    return false;
  }
}

export async function startMobilityLocationTracking() {
  if (Platform.OS === "web") {
    return;
  }
  if (isMobilityNativeRuntimeDisabled()) {
    await cleanupUnsupportedMobilityRuntime();
    throw new Error(MOBILITY_DISABLED_MESSAGE);
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
      killServiceOnDestroy: false,
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
  if (isMobilityNativeRuntimeDisabled()) {
    await cleanupUnsupportedMobilityRuntime();
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

export async function cleanupUnsupportedMobilityRuntime() {
  if (!isMobilityNativeRuntimeDisabled()) {
    return;
  }
  await Promise.allSettled([
    clearActiveMobilityRecordingId(),
    clearMobilityPointQueue(),
    updateMobilityDiagnostics({
      lastError: MOBILITY_DISABLED_MESSAGE,
      recoveredAt: new Date().toISOString(),
    }),
  ]);
  try {
    if (await Location.hasStartedLocationUpdatesAsync(MOBILITY_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(MOBILITY_LOCATION_TASK);
    }
  } catch (error) {
    console.warn("Legacy mobility location cleanup failed", error);
  }
  try {
    if (await TaskManager.isTaskRegisteredAsync(MOBILITY_LOCATION_TASK)) {
      await TaskManager.unregisterTaskAsync(MOBILITY_LOCATION_TASK);
    }
  } catch (error) {
    console.warn("Legacy mobility task cleanup failed", error);
  }
}

export type MobilityTrackingDiagnostics = Awaited<
  ReturnType<typeof getMobilityTrackingDiagnostics>
>;

export async function getMobilityTrackingDiagnostics() {
  if (Platform.OS === "web") {
    return {
      backgroundPermission: false,
      foregroundPermission: false,
      nativeTaskActive: false,
      ...(await readMobilityDiagnostics()),
    };
  }
  if (isMobilityNativeRuntimeDisabled()) {
    const saved = await readMobilityDiagnostics();
    return {
      backgroundPermission: false,
      foregroundPermission: false,
      nativeTaskActive: false,
      ...saved,
      lastError: saved.lastError || MOBILITY_DISABLED_MESSAGE,
    };
  }
  const [foreground, background, nativeTaskActive, saved] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
    isMobilityLocationTrackingActive(),
    readMobilityDiagnostics(),
  ]);
  return {
    backgroundPermission: background.granted,
    foregroundPermission: foreground.granted,
    nativeTaskActive,
    ...saved,
  };
}

export async function recoverMobilityLocationTracking(recordingId: string) {
  if (Platform.OS === "web") {
    return getMobilityTrackingDiagnostics();
  }
  if (isMobilityNativeRuntimeDisabled()) {
    await cleanupUnsupportedMobilityRuntime();
    return getMobilityTrackingDiagnostics();
  }
  const [foreground, background] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
  ]);
  if (!foreground.granted || !background.granted) {
    await updateMobilityDiagnostics({
      lastError: "后台定位权限已关闭，请重新打开持续记录授权",
    });
    return getMobilityTrackingDiagnostics();
  }
  await setActiveMobilityRecordingId(recordingId);
  if (!(await isMobilityLocationTrackingActive())) {
    try {
      await startMobilityLocationTracking();
    } catch (error) {
      await updateMobilityDiagnostics({
        lastError:
          error instanceof Error ? error.message : "后台定位任务恢复失败",
      });
    }
  }
  return getMobilityTrackingDiagnostics();
}
