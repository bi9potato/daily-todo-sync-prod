import { Pedometer } from "expo-sensors";
import { Platform } from "react-native";

import { setMobilityStepSample } from "./api";
import type { MobilityRecording } from "@/types";

export type MobilityStepSource = "health-connect" | "device" | "unavailable";

const FALLBACK_SOURCE_ID = `pedometer-process-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2)}`;

let fallbackRecordingId: string | null = null;
let fallbackStepCount = 0;
let fallbackSyncedCount = 0;
let fallbackSyncTimer: ReturnType<typeof setTimeout> | null = null;
let fallbackSubscription: ReturnType<typeof Pedometer.watchStepCount> | null =
  null;

async function loadHealthConnect() {
  if (Platform.OS !== "android") {
    return null;
  }
  return import("react-native-health-connect");
}

export async function getHealthConnectStepAccess() {
  const healthConnect = await loadHealthConnect();
  if (!healthConnect) {
    return false;
  }
  try {
    const status = await healthConnect.getSdkStatus();
    if (status !== healthConnect.SdkAvailabilityStatus.SDK_AVAILABLE) {
      return false;
    }
    if (!(await healthConnect.initialize())) {
      return false;
    }
    const granted = await healthConnect.getGrantedPermissions();
    return granted.some(
      (permission) =>
        permission.accessType === "read" && permission.recordType === "Steps",
    );
  } catch {
    return false;
  }
}

export async function requestHealthConnectStepAccess() {
  const healthConnect = await loadHealthConnect();
  if (!healthConnect) {
    return false;
  }
  try {
    const status = await healthConnect.getSdkStatus();
    if (status !== healthConnect.SdkAvailabilityStatus.SDK_AVAILABLE) {
      return false;
    }
    if (!(await healthConnect.initialize())) {
      return false;
    }
    if (await getHealthConnectStepAccess()) {
      return true;
    }
    const granted = await healthConnect.requestPermission([
      { accessType: "read", recordType: "Steps" },
    ]);
    return granted.some(
      (permission) =>
        permission.accessType === "read" && permission.recordType === "Steps",
    );
  } catch {
    return false;
  }
}

export async function syncHealthConnectSteps(recording: MobilityRecording) {
  const healthConnect = await loadHealthConnect();
  if (!healthConnect || !(await getHealthConnectStepAccess())) {
    return null;
  }
  const endTime = recording.endedAt ?? new Date().toISOString();
  if (new Date(endTime) <= new Date(recording.startedAt)) {
    return null;
  }
  try {
    const result = await healthConnect.aggregateRecord({
      recordType: "Steps",
      timeRangeFilter: {
        operator: "between",
        startTime: recording.startedAt,
        endTime,
      },
    });
    const stepCount = Math.max(0, Math.round(result.COUNT_TOTAL ?? 0));
    if (stepCount === 0 && recording.stepCount > 0) {
      // Some Health Connect installations have permission but no app writing
      // step data. Do not erase a real device-sensor count in that case.
      return null;
    }
    return setMobilityStepSample(recording.id, {
      sourceId: "health-connect",
      stepCount,
      recordedAt: new Date().toISOString(),
    });
  } catch {
    return null;
  }
}

async function syncFallbackSteps() {
  const recordingId = fallbackRecordingId;
  if (!recordingId || fallbackStepCount <= fallbackSyncedCount) {
    return null;
  }
  const stepCount = fallbackStepCount;
  const recording = await setMobilityStepSample(recordingId, {
    sourceId: FALLBACK_SOURCE_ID,
    stepCount,
    recordedAt: new Date().toISOString(),
  });
  fallbackSyncedCount = stepCount;
  return recording;
}

export async function startFallbackStepTracking(recordingId: string) {
  if (Platform.OS === "web") {
    return false;
  }
  if (fallbackRecordingId === recordingId && fallbackSubscription) {
    return true;
  }
  await stopFallbackStepTracking();
  const permission = await Pedometer.requestPermissionsAsync();
  const available = await Pedometer.isAvailableAsync();
  if (!permission.granted || !available) {
    return false;
  }
  fallbackRecordingId = recordingId;
  fallbackStepCount = 0;
  fallbackSyncedCount = 0;
  fallbackSubscription = Pedometer.watchStepCount(({ steps }) => {
    fallbackStepCount = steps;
    if (fallbackSyncTimer) {
      return;
    }
    const delay = steps - fallbackSyncedCount >= 10 ? 0 : 15_000;
    fallbackSyncTimer = setTimeout(() => {
      fallbackSyncTimer = null;
      void syncFallbackSteps().catch(() => {
        // Keep the unsynced count in memory and retry on the next update/stop.
      });
    }, delay);
  });
  return true;
}

export async function stopFallbackStepTracking() {
  if (fallbackSyncTimer) {
    clearTimeout(fallbackSyncTimer);
    fallbackSyncTimer = null;
  }
  let syncedRecording: MobilityRecording | null = null;
  try {
    syncedRecording = await syncFallbackSteps();
  } finally {
    fallbackSubscription?.remove();
    fallbackSubscription = null;
    fallbackRecordingId = null;
    fallbackStepCount = 0;
    fallbackSyncedCount = 0;
  }
  return syncedRecording;
}

export async function reconcileMobilitySteps(recording: MobilityRecording) {
  const healthRecording = await syncHealthConnectSteps(recording);
  const fallbackAvailable = recording.isActive
    ? await startFallbackStepTracking(recording.id)
    : false;
  return {
    recording: healthRecording,
    source: healthRecording
      ? ("health-connect" as const)
      : fallbackAvailable
        ? ("device" as const)
        : ("unavailable" as const),
  };
}
