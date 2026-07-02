import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  const fastAndroidBuild = process.env.EXPO_FAST_ANDROID_BUILD === "1";
  const configuredVersionCode = config.android?.versionCode ?? 1;
  const versionCode = Number.parseInt(
    process.env.EXPO_PUBLIC_BUILD_NUMBER ?? String(configuredVersionCode),
    10,
  );

  // iOS ships from the same build-number env the Android release uses, so a
  // given CI run stamps a matching, monotonic build across both platforms.
  const configuredBuildNumber = config.ios?.buildNumber ?? "1";
  const iosBuildNumber = process.env.EXPO_PUBLIC_BUILD_NUMBER ?? configuredBuildNumber;

  return {
    ...config,
    name: config.name ?? "Daily Todo",
    slug: config.slug ?? "daily-todo-sync",
    ios: {
      ...config.ios,
      buildNumber: iosBuildNumber,
    },
    android: {
      ...config.android,
      versionCode: Number.isFinite(versionCode) ? versionCode : configuredVersionCode,
    },
    extra: {
      ...config.extra,
      buildSha: process.env.EXPO_PUBLIC_BUILD_SHA ?? "development",
    },
    experiments: {
      ...(config.experiments ?? {}),
      reactCompiler: fastAndroidBuild ? false : config.experiments?.reactCompiler,
    },
  };
};
