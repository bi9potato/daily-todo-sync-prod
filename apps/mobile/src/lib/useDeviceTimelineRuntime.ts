import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

import {
  getDeviceTimelineEnabled,
  setDeviceTimelineEnabled,
} from "./device-timeline-storage";
import {
  clearNativeDeviceTimelineQueue,
  getNativeDeviceTimelineQueuedEventCount,
  hasDeviceTimelineUsageAccess,
  isNativeDeviceTimelineServiceAvailable,
  isNativeDeviceTimelineServiceRunning,
  openDeviceTimelineUsageAccessSettings,
  refreshNativeDeviceTimelineAuth,
  startNativeDeviceTimelineService,
  stopNativeDeviceTimelineService,
} from "./device-timeline-native-service";

export type DeviceTimelineRuntimeState = {
  available: boolean;
  enabled: boolean;
  hasUsageAccess: boolean;
  isRunning: boolean;
  lastError: string;
  queuedEventCount: number;
};

const INITIAL_STATE: DeviceTimelineRuntimeState = {
  available: false,
  enabled: false,
  hasUsageAccess: false,
  isRunning: false,
  lastError: "",
  queuedEventCount: 0,
};

// The running service holds a long-lived scoped upload token; refreshing it
// once per app launch (rather than on every reconcile) keeps that window
// topped up without re-minting a token every time the app resumes.
let nativeAuthRefreshedThisLaunch = false;

async function refreshNativeAuthOncePerLaunch() {
  if (nativeAuthRefreshedThisLaunch) {
    return;
  }
  nativeAuthRefreshedThisLaunch = true;
  try {
    await refreshNativeDeviceTimelineAuth();
  } catch (error) {
    nativeAuthRefreshedThisLaunch = false;
    console.warn("Device timeline upload token refresh failed", error);
  }
}

function sameRuntimeState(
  a: DeviceTimelineRuntimeState,
  b: DeviceTimelineRuntimeState,
) {
  return (
    a.available === b.available &&
    a.enabled === b.enabled &&
    a.hasUsageAccess === b.hasUsageAccess &&
    a.isRunning === b.isRunning &&
    a.lastError === b.lastError &&
    a.queuedEventCount === b.queuedEventCount
  );
}

export function useDeviceTimelineRuntime() {
  const [runtime, setRuntimeState] = useState(INITIAL_STATE);
  const runtimeRef = useRef(runtime);
  const reconcilingRef = useRef(false);

  const setRuntime = useCallback((next: DeviceTimelineRuntimeState) => {
    runtimeRef.current = next;
    setRuntimeState((current) =>
      sameRuntimeState(current, next) ? current : next,
    );
  }, []);

  const reconcile = useCallback(async () => {
    if (Platform.OS !== "android" || reconcilingRef.current) {
      return;
    }
    reconcilingRef.current = true;
    try {
      if (!isNativeDeviceTimelineServiceAvailable()) {
        setRuntime({ ...INITIAL_STATE, available: false });
        return;
      }
      const [enabled, hasUsageAccess, wasRunning, queuedEventCount] =
        await Promise.all([
          getDeviceTimelineEnabled(),
          hasDeviceTimelineUsageAccess(),
          isNativeDeviceTimelineServiceRunning(),
          getNativeDeviceTimelineQueuedEventCount(),
        ]);

      let isRunning = wasRunning;
      let lastError = "";
      if (enabled && hasUsageAccess && !wasRunning) {
        try {
          isRunning = await startNativeDeviceTimelineService();
        } catch (error) {
          lastError =
            error instanceof Error ? error.message : "设备时间线服务恢复失败";
        }
      } else if (enabled && !hasUsageAccess) {
        lastError = "使用情况访问权限已关闭，设备时间线记录已暂停。";
      } else if (enabled && wasRunning) {
        await refreshNativeAuthOncePerLaunch();
      } else if (!enabled && wasRunning) {
        // The preference and the native service disagree (e.g. the user
        // disabled it from another device, or the app crashed mid-toggle);
        // stop is idempotent either way.
        await stopNativeDeviceTimelineService().catch(() => undefined);
        isRunning = false;
      }

      setRuntime({
        available: true,
        enabled,
        hasUsageAccess,
        isRunning,
        lastError,
        queuedEventCount,
      });
    } finally {
      reconcilingRef.current = false;
    }
  }, [setRuntime]);

  useEffect(() => {
    void reconcile();
  }, [reconcile]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void reconcile();
      }
    });
    return () => subscription.remove();
  }, [reconcile]);

  const enable = useCallback(async () => {
    if (!(await hasDeviceTimelineUsageAccess())) {
      await openDeviceTimelineUsageAccessSettings();
      throw new Error(
        "请在系统设置中开启“使用情况访问权限”后重试。",
      );
    }
    await setDeviceTimelineEnabled(true);
    await startNativeDeviceTimelineService();
    await reconcile();
  }, [reconcile]);

  const disable = useCallback(async () => {
    await setDeviceTimelineEnabled(false);
    await stopNativeDeviceTimelineService();
    await reconcile();
  }, [reconcile]);

  const clearHistory = useCallback(async () => {
    await clearNativeDeviceTimelineQueue().catch(() => undefined);
    await reconcile();
  }, [reconcile]);

  return {
    runtime,
    enable,
    disable,
    clearHistory,
    openUsageAccessSettings: openDeviceTimelineUsageAccessSettings,
  };
}

export type DeviceTimelineRuntime = ReturnType<typeof useDeviceTimelineRuntime>;
