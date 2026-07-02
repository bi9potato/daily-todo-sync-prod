import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

import { flushClientLogs, recordClientLog } from "./client-logs";
import {
  readMobilityDiagnostics,
  updateMobilityDiagnostics,
} from "./mobility-diagnostics";
import {
  getLatestNativeMobilityPoint,
  getNativeMobilityQueuedPointCount,
  isNativeMobilityServiceAvailable,
  isNativeMobilityServiceRunning,
  startNativeMobilityService,
  stopNativeMobilityService,
} from "./mobility-native-service";
import {
  flushMobilityPointQueue,
  importNativeMobilityPointQueue,
} from "./mobility-queue";
import {
  getActiveMobilityRecordingId,
  setActiveMobilityRecordingId,
} from "./mobility-storage";

const LEGACY_MOBILITY_LOCATION_TASKS = [
  "daily-todo-background-location",
  "daily-todo-background-location-v2",
  "daily-todo-background-location-v3",
  "daily-todo-background-location-v4",
];

export function supportsNativeBackgroundLocationTracking() {
  return Platform.OS === "android";
}

export async function isMobilityLocationTrackingActive() {
  if (Platform.OS !== "android") {
    return false;
  }
  return isNativeMobilityServiceRunning().catch(() => false);
}

export async function startMobilityLocationTracking({
  recordingId,
}: {
  background?: boolean;
  manual?: boolean;
  recordingId?: string;
} = {}) {
  if (Platform.OS === "web") {
    return;
  }
  if (Platform.OS !== "android") {
    throw new Error("当前版本仅支持 Android 原生足迹服务。");
  }
  if (!isNativeMobilityServiceAvailable()) {
    throw new Error("原生足迹服务不可用，请安装最新 APK。");
  }
  const activeRecordingId =
    recordingId ?? (await getActiveMobilityRecordingId());
  if (!activeRecordingId) {
    throw new Error("没有活动足迹记录，无法开始定位。");
  }

  await setActiveMobilityRecordingId(activeRecordingId);
  await cleanupLegacyMobilityRuntime({ includeCurrent: true });
  recordClientLog("info", "Mobility native Android service starting", {
    source: "mobility",
    context: { androidApiLevel: Platform.Version },
  });
  // Delivering these diagnostic logs is not on the critical path of
  // "tracking is running again" - it can happen whenever the network is
  // next available instead of holding up this function on a request.
  void flushClientLogs();
  const started = await startNativeMobilityService(activeRecordingId);
  if (!started) {
    throw new Error("原生足迹服务启动失败。");
  }
  await updateMobilityDiagnostics({
    lastError: "",
    recoveredAt: new Date().toISOString(),
  });
  recordClientLog("info", "Mobility native Android service started", {
    source: "mobility",
    context: { androidApiLevel: Platform.Version },
  });
  void flushClientLogs();
}

export async function stopMobilityLocationTracking() {
  if (Platform.OS === "web") {
    return;
  }
  await stopNativeMobilityService();
  await importNativeMobilityPointQueue().catch((error) => {
    console.warn("Native mobility queue import failed", error);
  });
  await flushMobilityPointQueue().catch((error) => {
    console.warn("Mobility final upload failed", error);
  });
  await cleanupLegacyMobilityRuntime({ includeCurrent: true });
}

// Every call site passes includeCurrent: true, so one flag is enough: once
// this process has confirmed the pre-native-service TaskManager tasks are
// gone, they stay gone (nothing in the app re-registers them) until the
// next cold start. Without this, every resume-triggered restart re-ran all
// 8 sequential native calls below for no reason.
let legacyRuntimeVerifiedClean = false;

export async function cleanupLegacyMobilityRuntime({
  includeCurrent = true,
}: { includeCurrent?: boolean } = {}) {
  if (Platform.OS === "web" || legacyRuntimeVerifiedClean) {
    return;
  }
  const taskNames = includeCurrent
    ? LEGACY_MOBILITY_LOCATION_TASKS
    : LEGACY_MOBILITY_LOCATION_TASKS.slice(0, -1);
  for (const taskName of taskNames) {
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
  if (includeCurrent) {
    legacyRuntimeVerifiedClean = true;
  }
}

export async function getMobilityTrackingDiagnostics() {
  const nativeBackgroundAvailable =
    Platform.OS === "android" && isNativeMobilityServiceAvailable();
  if (Platform.OS === "web") {
    return {
      backgroundPermission: false,
      foregroundPermission: false,
      nativeTaskActive: false,
      nativeBackgroundAvailable,
      nativeQueuedPointCount: 0,
      ...(await readMobilityDiagnostics()),
    };
  }
  const [
    foreground,
    background,
    nativeTaskActive,
    nativeQueuedPointCount,
    latestPoint,
    saved,
  ] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
    isNativeMobilityServiceRunning().catch(() => false),
    getNativeMobilityQueuedPointCount().catch(() => 0),
    getLatestNativeMobilityPoint().catch(() => null),
    readMobilityDiagnostics(),
  ]);
  return {
    backgroundPermission: background.granted,
    foregroundPermission: foreground.granted,
    nativeTaskActive,
    nativeBackgroundAvailable,
    nativeQueuedPointCount,
    ...saved,
    lastLocationAt: latestPoint?.recordedAt ?? saved.lastLocationAt,
  };
}

export type MobilityTrackingDiagnostics = Awaited<
  ReturnType<typeof getMobilityTrackingDiagnostics>
>;

export async function recoverMobilityLocationTracking(recordingId: string) {
  if (Platform.OS === "web") {
    return getMobilityTrackingDiagnostics();
  }
  const [foreground, background] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
  ]);
  if (!foreground.granted || !background.granted) {
    await stopNativeMobilityService().catch(() => false);
    await updateMobilityDiagnostics({
      lastError: !foreground.granted
        ? "位置权限已关闭，请重新打开足迹记录授权"
        : "后台位置权限已关闭，需要选择“始终允许”",
    });
    return getMobilityTrackingDiagnostics();
  }
  if (!isNativeMobilityServiceAvailable()) {
    await updateMobilityDiagnostics({
      lastError: "原生足迹服务不可用，请安装最新 APK。",
    });
    return getMobilityTrackingDiagnostics();
  }
  await setActiveMobilityRecordingId(recordingId);
  // The foreground service keeps recording straight through the app being
  // backgrounded - it does not need "resuming". Restarting it anyway (the
  // previous behavior, unconditional on every resume) re-sent the start
  // command and re-ran the legacy-runtime sweep every single time, which is
  // what made returning to the app from another app or the lock screen
  // visibly stall while footprint tracking was on. Only genuine recovery
  // (e.g. Android killed the service under memory pressure) needs a start.
  if (await isNativeMobilityServiceRunning()) {
    return getMobilityTrackingDiagnostics();
  }
  try {
    await startMobilityLocationTracking({ recordingId });
  } catch (error) {
    await updateMobilityDiagnostics({
      lastError:
        error instanceof Error ? error.message : "原生足迹服务恢复失败",
    });
  }
  return getMobilityTrackingDiagnostics();
}
