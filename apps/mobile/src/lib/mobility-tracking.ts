import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

import { getActiveMobilityRecordingId } from "./mobility-storage";
import { syncOrQueueMobilityPoints } from "./mobility-queue";
import type { MobilityPointInput } from "@/types";

export const MOBILITY_LOCATION_TASK = "daily-todo-background-location";

type LocationTaskData = {
  locations: Location.LocationObject[];
};

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

if (
  Platform.OS !== "web" &&
  !TaskManager.isTaskDefined(MOBILITY_LOCATION_TASK)
) {
  TaskManager.defineTask<LocationTaskData>(
    MOBILITY_LOCATION_TASK,
    async ({ data, error }) => {
      if (error || !data?.locations?.length) {
        return;
      }
      const recordingId = await getActiveMobilityRecordingId();
      if (!recordingId) {
        return;
      }
      try {
        await syncOrQueueMobilityPoints(
          recordingId,
          data.locations.map((location) => locationToMobilityPoint(location)),
        );
      } catch (syncError) {
        console.warn("Mobility background sync failed", syncError);
      }
    },
  );
}

export async function isMobilityLocationTrackingActive() {
  if (Platform.OS === "web") {
    return false;
  }
  return Location.hasStartedLocationUpdatesAsync(MOBILITY_LOCATION_TASK);
}

export async function startMobilityLocationTracking() {
  if (Platform.OS === "web") {
    return;
  }
  const alreadyStarted = await isMobilityLocationTrackingActive();
  if (alreadyStarted) {
    return;
  }
  await Location.startLocationUpdatesAsync(MOBILITY_LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    activityType: Location.ActivityType.Fitness,
    distanceInterval: 20,
    timeInterval: 30_000,
    deferredUpdatesDistance: 60,
    deferredUpdatesInterval: 60_000,
    foregroundService: {
      notificationTitle: "Daily Todo 正在记录足迹",
      notificationBody: "持续记录行走路线；点击可返回应用。",
      notificationColor: "#2C5745",
      killServiceOnDestroy: false,
    },
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
  });
}

export async function stopMobilityLocationTracking() {
  if (Platform.OS === "web") {
    return;
  }
  if (await isMobilityLocationTrackingActive()) {
    await Location.stopLocationUpdatesAsync(MOBILITY_LOCATION_TASK);
  }
}
