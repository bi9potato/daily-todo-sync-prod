import { NativeModules, Platform } from "react-native";

import { API_BASE_URL } from "./api";
import { loadTokens } from "./auth-storage";
import type { MobilityPoint } from "@/types";

type NativeMobilityModule = {
  start: (
    recordingId: string,
    apiBaseUrl: string,
    accessToken: string,
  ) => Promise<boolean>;
  stop: () => Promise<boolean>;
  isRunning: () => Promise<boolean>;
  isStepTrackingActive: () => Promise<boolean>;
  getLastError: () => Promise<string>;
  getLatestPoint: () => Promise<string>;
  getQueuedPointCount: () => Promise<number>;
  isBatteryOptimizationDisabled: () => Promise<boolean>;
  openBatteryOptimizationSettings: () => Promise<boolean>;
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
  await NativeMobility.start(recordingId, API_BASE_URL, tokens.accessToken);
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
