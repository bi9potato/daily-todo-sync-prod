import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  const fastAndroidBuild = process.env.EXPO_FAST_ANDROID_BUILD === "1";
  const configuredVersionCode = config.android?.versionCode ?? 1;
  const versionCode = Number.parseInt(
    process.env.EXPO_PUBLIC_BUILD_NUMBER ?? String(configuredVersionCode),
    10,
  );

  return {
    ...config,
    name: config.name ?? "Daily Todo",
    slug: config.slug ?? "daily-todo-sync",
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
