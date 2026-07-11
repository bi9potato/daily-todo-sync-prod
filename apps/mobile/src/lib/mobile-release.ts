import type { MobileRelease } from "@/types";

export function hasAndroidUpdate(
  currentVersionCode: number,
  currentBuildSha: string,
  latest: MobileRelease | undefined,
) {
  if (!latest) {
    return false;
  }
  if (currentBuildSha === "development") {
    return true;
  }
  return (
    latest.versionCode > currentVersionCode ||
    (latest.versionCode === currentVersionCode &&
      latest.buildSha !== currentBuildSha)
  );
}

export function formatApkSize(bytes: number | undefined) {
  if (!bytes || bytes < 0) {
    return null;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
