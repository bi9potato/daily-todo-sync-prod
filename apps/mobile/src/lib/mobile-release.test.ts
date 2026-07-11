import { formatApkSize, hasAndroidUpdate } from "./mobile-release";
import type { MobileRelease } from "@/types";

const release: MobileRelease = {
  versionName: "1.0.0",
  versionCode: 216,
  buildSha: "abcdef",
  architecture: "arm64-v8a",
  apkUrl: "https://example.com/app.apk",
  releaseUrl: "https://example.com/release",
  publishedAt: "2026-07-11T00:00:00Z",
};

describe("hasAndroidUpdate", () => {
  test("detects a higher Android versionCode", () => {
    expect(hasAndroidUpdate(215, "older", release)).toBe(true);
  });

  test("does not downgrade even when the build SHA differs", () => {
    expect(hasAndroidUpdate(217, "newer", release)).toBe(false);
  });

  test("recognizes the installed release", () => {
    expect(hasAndroidUpdate(216, "abcdef", release)).toBe(false);
  });
});

test("formats APK byte size", () => {
  expect(formatApkSize(64 * 1024 * 1024)).toBe("64.0 MB");
  expect(formatApkSize(undefined)).toBeNull();
});
