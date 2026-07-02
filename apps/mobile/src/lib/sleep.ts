import { Platform } from "react-native";
import {
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  openHealthConnectSettings,
  readRecords,
  requestPermission,
  SdkAvailabilityStatus,
  SleepStageType,
} from "react-native-health-connect";

// Sleep data comes from Android's Health Connect store (written there by
// the user's band/watch companion app), read on-device for display only -
// it is never uploaded to the API, and the query that holds it is excluded
// from the persisted cache (meta.sensitive, see app/_layout.tsx).

export type SleepAccessStatus =
  | "unsupported"
  | "unavailable"
  | "update-required"
  | "denied"
  | "granted";

export type SleepStageKey =
  | "deep"
  | "light"
  | "rem"
  | "sleeping"
  | "awake"
  | "outOfBed";

export type SleepNight = {
  id: string;
  startTime: string;
  endTime: string;
  minutesInBed: number;
  // In-bed minutes minus awake/out-of-bed stages when the source provides
  // stages; equal to minutesInBed otherwise.
  minutesAsleep: number;
  hasStages: boolean;
  stageMinutes: Record<SleepStageKey, number>;
};

const SLEEP_READ_PERMISSION = {
  accessType: "read",
  recordType: "SleepSession",
} as const;

// androidx SleepSessionRecord stage constants -> our display buckets.
// AWAKE_IN_BED (7) exists in newer Health Connect versions but not in the
// library's constant set, so it is matched by value.
const STAGE_BUCKET: Record<number, SleepStageKey> = {
  [SleepStageType.DEEP]: "deep",
  [SleepStageType.LIGHT]: "light",
  [SleepStageType.REM]: "rem",
  [SleepStageType.SLEEPING]: "sleeping",
  [SleepStageType.AWAKE]: "awake",
  [SleepStageType.OUT_OF_BED]: "outOfBed",
  7: "awake",
};

const EMPTY_STAGE_MINUTES: Record<SleepStageKey, number> = {
  deep: 0,
  light: 0,
  rem: 0,
  sleeping: 0,
  awake: 0,
  outOfBed: 0,
};

function minutesBetween(startTime: string, endTime: string) {
  return Math.max(
    0,
    Math.round(
      (new Date(endTime).getTime() - new Date(startTime).getTime()) / 60_000,
    ),
  );
}

function grantedForSleep(
  permissions: { accessType?: string; recordType?: string }[],
) {
  return permissions.some(
    (permission) =>
      permission.accessType === "read" &&
      permission.recordType === "SleepSession",
  );
}

export function isSleepSupported() {
  return Platform.OS === "android";
}

export async function getSleepAccessStatus(): Promise<SleepAccessStatus> {
  if (!isSleepSupported()) {
    return "unsupported";
  }
  const status = await getSdkStatus();
  if (status === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) {
    return "update-required";
  }
  if (status !== SdkAvailabilityStatus.SDK_AVAILABLE) {
    return "unavailable";
  }
  if (!(await initialize())) {
    return "unavailable";
  }
  return grantedForSleep(await getGrantedPermissions()) ? "granted" : "denied";
}

// Opens Health Connect's own permission sheet; resolves once the user
// returns to the app.
export async function requestSleepPermission(): Promise<boolean> {
  if (!isSleepSupported() || !(await initialize())) {
    return false;
  }
  return grantedForSleep(await requestPermission([SLEEP_READ_PERMISSION]));
}

export async function readSleepNights(days = 7): Promise<SleepNight[]> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const { records } = await readRecords("SleepSession", {
    timeRangeFilter: {
      operator: "between",
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    },
  });
  return records
    .map((record) => {
      const stages = record.stages ?? [];
      const stageMinutes = { ...EMPTY_STAGE_MINUTES };
      for (const stage of stages) {
        const bucket = STAGE_BUCKET[stage.stage];
        if (bucket) {
          stageMinutes[bucket] += minutesBetween(stage.startTime, stage.endTime);
        }
      }
      const minutesInBed = minutesBetween(record.startTime, record.endTime);
      const hasStages = stages.length > 0;
      const minutesAsleep = hasStages
        ? stageMinutes.deep +
          stageMinutes.light +
          stageMinutes.rem +
          stageMinutes.sleeping
        : minutesInBed;
      return {
        id:
          record.metadata?.id ?? `${record.startTime}-${record.endTime}`,
        startTime: record.startTime,
        endTime: record.endTime,
        minutesInBed,
        minutesAsleep,
        hasStages,
        stageMinutes,
      };
    })
    .sort(
      (left, right) =>
        new Date(right.endTime).getTime() - new Date(left.endTime).getTime(),
    );
}

export function openSleepSourceSettings() {
  openHealthConnectSettings();
}
