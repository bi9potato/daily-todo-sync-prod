import { Alert, AppState, PermissionsAndroid, Platform } from "react-native";
import * as Location from "expo-location";

import { flushClientLogs, recordClientLog } from "@/lib/client-logs";
import {
  isBatteryOptimizationDisabled,
  openBatteryOptimizationSettings,
} from "@/lib/mobility-native-service";
import { withTimeout } from "@/lib/with-timeout";

// The permission choreography for starting footprint recording, extracted
// from MobilityScreen. Order matters throughout: activity recognition and
// notifications before the background-location prompt, and a settle delay
// after returning from system settings (see waitForAndroidActivityToResume).

function explainBackgroundPermission() {
  if (Platform.OS !== "android") {
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      "允许后台记录",
      "授权打开后，Daily Todo 会通过常驻通知持续记录行走路线；关闭授权开关才会停止。",
      [
        { text: "暂不", style: "cancel", onPress: () => resolve(false) },
        { text: "继续", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

async function requestAndroidNotificationPermission() {
  const version =
    typeof Platform.Version === "string"
      ? Number.parseInt(Platform.Version, 10)
      : Platform.Version;
  if (
    Platform.OS !== "android" ||
    !Number.isFinite(version) ||
    version < 33
  ) {
    return;
  }
  try {
    await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
  } catch (error) {
    console.warn("Notification permission request failed", error);
  }
}

async function requestAndroidActivityRecognitionPermission() {
  const version =
    typeof Platform.Version === "string"
      ? Number.parseInt(Platform.Version, 10)
      : Platform.Version;
  if (
    Platform.OS !== "android" ||
    !Number.isFinite(version) ||
    version < 29
  ) {
    return true;
  }
  try {
    return (
      (await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
      )) === PermissionsAndroid.RESULTS.GRANTED
    );
  } catch (error) {
    console.warn("Activity recognition permission request failed", error);
    return false;
  }
}

async function waitForAndroidActivityToResume() {
  if (Platform.OS !== "android") {
    return;
  }
  if (AppState.currentState !== "active") {
    await withTimeout(
      new Promise<void>((resolve) => {
        const subscription = AppState.addEventListener("change", (state) => {
          if (state === "active") {
            subscription.remove();
            resolve();
          }
        });
      }),
      10_000,
      "应用未能从系统授权页面恢复，请返回应用后重试。",
    );
  }
  // Android can publish AppState.active slightly before the Activity window
  // regains focus. Starting a location FGS in that gap crashes API 34+.
  await new Promise<void>((resolve) => setTimeout(resolve, 600));
}

export async function requestTrackingPermissions({
  requireBackground,
}: {
  requireBackground: boolean;
}) {
  if (Platform.OS === "web") {
    throw new Error("网页端不能持续记录轨迹，请在 Android APK 中使用。");
  }
  recordClientLog("info", "Requesting foreground location permission", {
    source: "mobility",
  });
  await flushClientLogs();
  if (!(await Location.hasServicesEnabledAsync())) {
    throw new Error("请先打开系统定位服务。");
  }
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) {
    throw new Error("需要“精确位置”权限才能记录路线。");
  }
  if (!requireBackground) {
    return;
  }
  await requestAndroidActivityRecognitionPermission();
  await requestAndroidNotificationPermission();
  if (!(await explainBackgroundPermission())) {
    throw new Error("未开启后台位置权限。");
  }
  recordClientLog("info", "Requesting background location permission", {
    source: "mobility",
  });
  await flushClientLogs();
  const background = await Location.requestBackgroundPermissionsAsync();
  if (!background.granted) {
    throw new Error("需要选择“始终允许”才能在锁屏后继续记录。");
  }
  await waitForAndroidActivityToResume();
}

export async function promptForBatteryOptimization() {
  if (Platform.OS !== "android") {
    return;
  }
  if (await isBatteryOptimizationDisabled().catch(() => true)) {
    return;
  }
  Alert.alert(
    "允许持续后台记录",
    "为减少系统省电策略中断足迹，请在电池优化设置中将 Daily Todo 设为“不优化”。该设置必须由你在系统页面确认。",
    [
      { text: "稍后", style: "cancel" },
      {
        text: "去设置",
        onPress: () => {
          void openBatteryOptimizationSettings().catch((error) => {
            console.warn("Battery optimization settings unavailable", error);
          });
        },
      },
    ],
  );
}
