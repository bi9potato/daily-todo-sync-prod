import { useState } from "react";
import { Alert, Platform } from "react-native";
import * as Location from "expo-location";

import {
  hasLocationReminderPermission,
  requestLocationReminderPermission,
} from "@/lib/location-reminders";
import { ensureNotificationPermission } from "@/lib/notifications";
import { searchNominatimPlaces } from "@/lib/place-search";
import { reverseGeocode } from "@/lib/reverse-geocode";
import { withTimeout } from "@/lib/with-timeout";
import type { PlaceSearchResult, TaskLocation } from "@/types";

// Owns the task editor's location block: the edited TaskLocation plus every
// async flow that can change it (GPS capture, place search, arrival-reminder
// permission requests). Extracted from TaskEditor so the editor itself only
// wires callbacks into UI.
export function useTaskLocationEditor(initialLocation: TaskLocation | null) {
  const [taskLocation, setTaskLocation] = useState<TaskLocation | null>(
    initialLocation,
  );
  const [isLocating, setIsLocating] = useState(false);
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [isRequestingLocationReminder, setIsRequestingLocationReminder] =
    useState(false);

  // `explicitLocation` lets callers arm the reminder for a location they
  // just picked in the same tick, before React has committed the state
  // update (the Samsung-style flow arms immediately on selection).
  async function toggleLocationReminder(
    enabled: boolean,
    explicitLocation?: TaskLocation | null,
  ) {
    const base = explicitLocation ?? taskLocation;
    if (!enabled) {
      if (base) {
        setTaskLocation({ ...base, reminderEnabled: false });
      }
      return;
    }
    if (!base) {
      setLocationError("请先输入地点或使用当前位置。");
      return;
    }
    setIsRequestingLocationReminder(true);
    setLocationError("");
    try {
      if (Platform.OS !== "android") {
        throw new Error("到达地点提醒目前仅支持 Android。");
      }
      if (!(await hasLocationReminderPermission())) {
        const shouldContinue = await new Promise<boolean>((resolve) => {
          Alert.alert(
            "允许后台位置",
            "地点提醒需要在应用未打开时判断你是否进入提醒范围。下一步请在系统设置中将位置权限设为“始终允许”。",
            [
              { text: "暂不开启", style: "cancel", onPress: () => resolve(false) },
              { text: "继续", onPress: () => resolve(true) },
            ],
            {
              cancelable: true,
              onDismiss: () => resolve(false),
            },
          );
        });
        if (!shouldContinue || !(await requestLocationReminderPermission())) {
          throw new Error("需要选择“始终允许”位置权限才能在到达时提醒。");
        }
      }
      if (!(await ensureNotificationPermission())) {
        throw new Error("需要开启通知权限，到达地点后才能弹出提醒。");
      }
      setTaskLocation({ ...base, reminderEnabled: true });
    } catch (error) {
      setLocationError(
        error instanceof Error ? error.message : "开启到达提醒失败",
      );
    } finally {
      setIsRequestingLocationReminder(false);
    }
  }

  async function searchLocation(address: string) {
    const query = address.trim();
    if (!query) {
      setLocationError("请输入地点或地址。");
      return [];
    }
    setIsSearchingLocation(true);
    setLocationError("");
    try {
      return await withTimeout(
        searchNominatimPlaces(query),
        12_000,
        "地点查找超时，请稍后重试。",
      );
    } catch (error) {
      setLocationError(
        error instanceof Error ? error.message : "无法查找这个地点",
      );
      return [];
    } finally {
      setIsSearchingLocation(false);
    }
  }

  function selectSearchResult(result: PlaceSearchResult): TaskLocation {
    setLocationError("");
    const location: TaskLocation = {
      name: result.name,
      latitude: result.latitude,
      longitude: result.longitude,
      recordedAt: new Date().toISOString(),
      reminderEnabled: taskLocation?.reminderEnabled ?? false,
      radiusMeters: Math.max(100, taskLocation?.radiusMeters ?? 150),
    };
    setTaskLocation(location);
    return location;
  }

  async function captureCurrentLocation(): Promise<TaskLocation | null> {
    setIsLocating(true);
    setLocationError("");
    try {
      if (Platform.OS === "web") {
        throw new Error("请在 Android 或 iOS 客户端中获取当前位置。");
      }
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        throw new Error("需要位置权限才能记录任务地点。");
      }
      if (!(await Location.hasServicesEnabledAsync())) {
        throw new Error("请先打开系统定位服务。");
      }
      const current = await withTimeout(
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        }),
        8000,
        "定位暂时不可用，请稍后重试。",
      );
      // The platform Geocoder resolves through whatever backend the OEM
      // wired in - on Chinese ROMs that is typically a GCJ-02-offset vendor
      // service, which mismatches the raw WGS84 GPS coordinate above and
      // silently resolves the wrong building/street (see the identical fix
      // and full rationale in reverse-geocode.ts, originally applied to
      // mobility visit points).
      const name = await reverseGeocode(
        current.coords.latitude,
        current.coords.longitude,
      ).catch(() => null);
      const location: TaskLocation = {
        name:
          name ||
          `${current.coords.latitude.toFixed(5)}, ${current.coords.longitude.toFixed(5)}`,
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
        recordedAt: new Date(current.timestamp).toISOString(),
        reminderEnabled: taskLocation?.reminderEnabled ?? false,
        radiusMeters: taskLocation?.radiusMeters ?? 150,
      };
      setTaskLocation(location);
      return location;
    } catch (error) {
      setLocationError(
        error instanceof Error ? error.message : "无法获取当前位置",
      );
      return null;
    } finally {
      setIsLocating(false);
    }
  }

  return {
    captureCurrentLocation,
    isLocating,
    isRequestingLocationReminder,
    isSearchingLocation,
    locationError,
    searchLocation,
    selectSearchResult,
    setLocationError,
    setTaskLocation,
    taskLocation,
    toggleLocationReminder,
  };
}
