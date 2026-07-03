import { NativeModules, Platform } from "react-native";

import { API_BASE_URL, getMobilityDeviceToken } from "./api";
import { loadTokens } from "./auth-storage";
import type { MobilityPoint } from "@/types";

type NativeMobilityModule = {
  start: (
    recordingId: string,
    apiBaseUrl: string,
    accessToken: string,
  ) => Promise<boolean>;
  updateAuth: (accessToken: string) => Promise<boolean>;
  stop: () => Promise<boolean>;
  isRunning: () => Promise<boolean>;
  isStepTrackingActive: () => Promise<boolean>;
  getLastError: () => Promise<string>;
  getLatestPoint: () => Promise<string>;
  getQueuedPointCount: () => Promise<number>;
  isBatteryOptimizationDisabled: () => Promise<boolean>;
  openBatteryOptimizationSettings: () => Promise<boolean>;
  clearLocalQueue: () => Promise<boolean>;
};

const NativeMobility = NativeModules.NativeMobility as
  | NativeMobilityModule
  | undefined;

export function isNativeMobilityServiceAvailable() {
  return Platform.OS === "android" && Boolean(NativeMobility);
}

export async function startNativeMobilityService(recordingId: string) {
  if (!isNativeMobilityServiceAvailable() || !NativeMobility) {
    return false;
  }
  const tokens = await loadTokens();
  if (!tokens?.accessToken) {
    throw new Error("请先登录后再开启足迹记录。");
  }
  // The service keeps uploading for days without the JS runtime awake, so
  // it gets the long-lived mobility-scoped token instead of the 15-minute
  // access token (which silently 401-ed all background uploads and the
  // midnight recording rotation once it expired). Offline fallback: the
  // access token still works for the first minutes, and the next start
  // while online replaces it.
  const uploadToken = await getMobilityDeviceToken()
    .then((result) => result.token)
    .catch(() => tokens.accessToken);
  await NativeMobility.start(recordingId, API_BASE_URL, uploadToken);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await NativeMobility.isRunning()) {
      return true;
    }
    const error = await NativeMobility.getLastError();
    if (error) {
      throw new Error(error);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("原生足迹服务未能在 2 秒内启动。");
}

export async function stopNativeMobilityService() {
  if (!isNativeMobilityServiceAvailable() || !NativeMobility) {
    return false;
  }
  return NativeMobility.stop();
}

// Hands a fresh mobility-scoped token to an already-running service, so a
// service that never restarts can still outlive the 30-day token window as
// long as the app is opened occasionally.
export async function refreshNativeMobilityAuth() {
  if (!isNativeMobilityServiceAvailable() || !NativeMobility) {
    return false;
  }
  if (!(await NativeMobility.isRunning())) {
    return false;
  }
  const { token } = await getMobilityDeviceToken();
  return NativeMobility.updateAuth(token);
}

export async function isNativeMobilityServiceRunning() {
  if (!isNativeMobilityServiceAvailable() || !NativeMobility) {
    return false;
  }
  return NativeMobility.isRunning();
}

export async function isNativeStepTrackingActive() {
  if (!isNativeMobilityServiceAvailable() || !NativeMobility) {
    return false;
  }
  return NativeMobility.isStepTrackingActive();
}

export async function getLatestNativeMobilityPoint(): Promise<MobilityPoint | null> {
  if (!isNativeMobilityServiceAvailable() || !NativeMobility) {
    return null;
  }
  const value = await NativeMobility.getLatestPoint();
  if (!value) {
    return null;
  }
  try {
    const point = JSON.parse(value) as MobilityPoint;
    if (
      !point.recordedAt ||
      !Number.isFinite(point.latitude) ||
      !Number.isFinite(point.longitude)
    ) {
      return null;
    }
    return {
      recordedAt: point.recordedAt,
      latitude: point.latitude,
      longitude: point.longitude,
      accuracy: Number.isFinite(point.accuracy) ? point.accuracy : null,
      speed: Number.isFinite(point.speed) ? point.speed : null,
      placeName: point.placeName || "",
    };
  } catch {
    return null;
  }
}

export async function isBatteryOptimizationDisabled() {
  if (!isNativeMobilityServiceAvailable() || !NativeMobility) {
    return true;
  }
  return NativeMobility.isBatteryOptimizationDisabled();
}

export async function openBatteryOptimizationSettings() {
  if (!isNativeMobilityServiceAvailable() || !NativeMobility) {
    return false;
  }
  return NativeMobility.openBatteryOptimizationSettings();
}

export async function getNativeMobilityQueuedPointCount() {
  if (!isNativeMobilityServiceAvailable() || !NativeMobility) {
    return 0;
  }
  return NativeMobility.getQueuedPointCount();
}

export async function clearNativeMobilityQueue() {
  if (!isNativeMobilityServiceAvailable() || !NativeMobility) {
    return false;
  }
  return NativeMobility.clearLocalQueue();
}
