import { NativeModules, Platform } from "react-native";

import { API_BASE_URL, getDeviceTimelineDeviceToken } from "./api";
import { loadTokens } from "./auth-storage";

type NativeDeviceTimelineModule = {
  hasUsageAccess: () => Promise<boolean>;
  openUsageAccessSettings: () => Promise<boolean>;
  start: (apiBaseUrl: string, accessToken: string) => Promise<boolean>;
  stop: () => Promise<boolean>;
  updateAuth: (accessToken: string) => Promise<boolean>;
  isRunning: () => Promise<boolean>;
  getLastError: () => Promise<string>;
  getQueuedEventCount: () => Promise<number>;
  clearLocalQueue: () => Promise<boolean>;
  getApplicationIcon: (packageName: string) => Promise<string | null>;
};

const NativeDeviceTimeline = NativeModules.DeviceTimeline as
  | NativeDeviceTimelineModule
  | undefined;
const appIconCache = new Map<string, Promise<string | null>>();

export function isNativeDeviceTimelineServiceAvailable() {
  return Platform.OS === "android" && Boolean(NativeDeviceTimeline);
}

export async function hasDeviceTimelineUsageAccess() {
  if (!isNativeDeviceTimelineServiceAvailable() || !NativeDeviceTimeline) {
    return false;
  }
  return NativeDeviceTimeline.hasUsageAccess();
}

// Opens the system "Usage access" settings page - there is no runtime
// permission dialog for this special permission, the user has to flip it on
// manually, same as every other on-device screen-time app.
export async function openDeviceTimelineUsageAccessSettings() {
  if (!isNativeDeviceTimelineServiceAvailable() || !NativeDeviceTimeline) {
    return false;
  }
  return NativeDeviceTimeline.openUsageAccessSettings();
}

export async function startNativeDeviceTimelineService() {
  if (!isNativeDeviceTimelineServiceAvailable() || !NativeDeviceTimeline) {
    return false;
  }
  const tokens = await loadTokens();
  if (!tokens?.accessToken) {
    throw new Error("请先登录后再开启设备时间线记录。");
  }
  // Mirrors mobility's device token: the service uploads for days without
  // the JS runtime awake, so a 15-minute access token would silently 401
  // every background upload almost immediately.
  const uploadToken = await getDeviceTimelineDeviceToken()
    .then((result) => result.token)
    .catch(() => tokens.accessToken);
  await NativeDeviceTimeline.start(API_BASE_URL, uploadToken);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await NativeDeviceTimeline.isRunning()) {
      return true;
    }
    const error = await NativeDeviceTimeline.getLastError();
    if (error) {
      throw new Error(error);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("原生设备时间线服务未能在 2 秒内启动。");
}

export async function stopNativeDeviceTimelineService() {
  if (!isNativeDeviceTimelineServiceAvailable() || !NativeDeviceTimeline) {
    return false;
  }
  return NativeDeviceTimeline.stop();
}

export async function refreshNativeDeviceTimelineAuth() {
  if (!isNativeDeviceTimelineServiceAvailable() || !NativeDeviceTimeline) {
    return false;
  }
  if (!(await NativeDeviceTimeline.isRunning())) {
    return false;
  }
  const { token } = await getDeviceTimelineDeviceToken();
  return NativeDeviceTimeline.updateAuth(token);
}

export async function isNativeDeviceTimelineServiceRunning() {
  if (!isNativeDeviceTimelineServiceAvailable() || !NativeDeviceTimeline) {
    return false;
  }
  return NativeDeviceTimeline.isRunning();
}

export async function getNativeDeviceTimelineQueuedEventCount() {
  if (!isNativeDeviceTimelineServiceAvailable() || !NativeDeviceTimeline) {
    return 0;
  }
  return NativeDeviceTimeline.getQueuedEventCount();
}

export async function clearNativeDeviceTimelineQueue() {
  if (!isNativeDeviceTimelineServiceAvailable() || !NativeDeviceTimeline) {
    return false;
  }
  return NativeDeviceTimeline.clearLocalQueue();
}

export function getDeviceTimelineAppIcon(packageName: string) {
  if (!isNativeDeviceTimelineServiceAvailable() || !NativeDeviceTimeline) {
    return Promise.resolve(null);
  }
  const cached = appIconCache.get(packageName);
  if (cached) {
    return cached;
  }
  const request = NativeDeviceTimeline.getApplicationIcon(packageName).catch(
    () => null,
  );
  appIconCache.set(packageName, request);
  return request;
}
