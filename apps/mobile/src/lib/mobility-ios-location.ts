import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

import {
  maybeFlushMobilityPointQueue,
  queueMobilityPoints,
} from "./mobility-queue";
import { getActiveMobilityRecordingId } from "./mobility-storage";
import type { MobilityPointInput } from "@/types";

// iOS has no equivalent of Android's foreground service. The authoritative
// Expo pattern for "keep recording the walk while backgrounded" is a
// TaskManager-defined background location task fed by
// Location.startLocationUpdatesAsync. Points collected here go through the
// exact same JS upload queue the rest of the app already uses
// (mobility-queue), so the backend contract is identical to Android's.
export const IOS_LOCATION_TASK = "daily-todo-ios-location";

// Mirror the noise handling the Android native service uses so both platforms
// record comparable trajectories: reject wildly inaccurate fixes outright, and
// require a displacement bigger than the combined GPS error before treating a
// fix as real movement instead of jitter.
const MAX_ACCURACY_METERS = 75;
const MIN_DISTANCE_METERS = 8;

type AcceptedFix = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

// The background task executor cannot capture React state, so the last
// accepted fix lives in module scope, the same way the Kotlin service keeps it
// in an instance field.
let lastAccepted: AcceptedFix | null = null;

function resetJitterFilter() {
  lastAccepted = null;
}

function distanceMeters(a: AcceptedFix, b: AcceptedFix) {
  const earthRadius = 6_371_000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function acceptLocation(location: Location.LocationObject): boolean {
  const { latitude, longitude, accuracy } = location.coords;
  const fixAccuracy = accuracy ?? MAX_ACCURACY_METERS;
  const candidate: AcceptedFix = { latitude, longitude, accuracy: fixAccuracy };
  const previous = lastAccepted;
  if (!previous) {
    lastAccepted = candidate;
    return true;
  }
  const noiseFloor = Math.max(
    MIN_DISTANCE_METERS,
    previous.accuracy + fixAccuracy,
  );
  if (distanceMeters(previous, candidate) >= noiseFloor) {
    lastAccepted = candidate;
    return true;
  }
  return false;
}

function toPointInput(location: Location.LocationObject): MobilityPointInput {
  const { coords, timestamp } = location;
  return {
    // Same clientId shape the Android service emits, so the backend and the
    // queue's dedupe-by-clientId treat both platforms consistently.
    clientId: `${timestamp}:${coords.latitude.toFixed(6)}:${coords.longitude.toFixed(6)}`,
    recordedAt: new Date(timestamp).toISOString(),
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: coords.accuracy,
    altitude: coords.altitude,
    speed: coords.speed,
    heading: coords.heading,
    placeName: "",
  };
}

// Registered only on iOS. Android never calls startLocationUpdatesAsync for
// this task (it uses the native service instead), so guarding keeps the
// Android runtime completely unaffected.
if (Platform.OS === "ios") {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
    IOS_LOCATION_TASK,
    async ({ data, error }) => {
      if (error || !data?.locations?.length) {
        return;
      }
      const recordingId = await getActiveMobilityRecordingId();
      if (!recordingId) {
        return;
      }
      const points = data.locations
        .filter(
          (location) =>
            (location.coords.accuracy ?? Number.POSITIVE_INFINITY) <=
            MAX_ACCURACY_METERS,
        )
        .filter(acceptLocation)
        .map(toPointInput);
      if (!points.length) {
        return;
      }
      await queueMobilityPoints(recordingId, points);
      await maybeFlushMobilityPointQueue();
    },
  );
}

export async function isIosLocationTrackingActive() {
  if (Platform.OS !== "ios") {
    return false;
  }
  return Location.hasStartedLocationUpdatesAsync(IOS_LOCATION_TASK).catch(
    () => false,
  );
}

export async function startIosLocationTracking() {
  if (Platform.OS !== "ios") {
    return false;
  }
  resetJitterFilter();
  await Location.startLocationUpdatesAsync(IOS_LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    activityType: Location.ActivityType.Fitness,
    // We do our own noise filtering above, but letting iOS coalesce updates by
    // distance keeps the radio from firing on every sub-meter GPS wobble.
    distanceInterval: MIN_DISTANCE_METERS,
    deferredUpdatesInterval: 5_000,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
  });
  return true;
}

export async function stopIosLocationTracking() {
  if (Platform.OS !== "ios") {
    return;
  }
  if (await isIosLocationTrackingActive()) {
    await Location.stopLocationUpdatesAsync(IOS_LOCATION_TASK);
  }
  resetJitterFilter();
}
