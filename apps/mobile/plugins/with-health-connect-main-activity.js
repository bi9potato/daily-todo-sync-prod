const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withMainActivity,
} = require("@expo/config-plugins");

const IMPORT_LINE =
  "import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate";
const SETUP_LINE =
  "HealthConnectPermissionDelegate.setPermissionDelegate(this)";
const RATIONALE_ACTION =
  "androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE";
const PERMISSION_USAGE_ACTION =
  "android.intent.action.VIEW_PERMISSION_USAGE";
const PERMISSION_USAGE_CATEGORY =
  "android.intent.category.HEALTH_PERMISSIONS";
const PERMISSION_USAGE_ALIAS = "ViewPermissionUsageActivity";

function hasAction(intentFilters, actionName) {
  return intentFilters.some((intentFilter) =>
    intentFilter.action?.some(
      (action) => action.$["android:name"] === actionName,
    ),
  );
}

function withHealthConnectManifest(config) {
  return withAndroidManifest(config, (manifestConfig) => {
    const mainApplication =
      AndroidConfig.Manifest.getMainApplicationOrThrow(
        manifestConfig.modResults,
      );
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(
      manifestConfig.modResults,
    );
    const intentFilters = (mainActivity["intent-filter"] ??= []);
    if (!hasAction(intentFilters, RATIONALE_ACTION)) {
      intentFilters.push({
        action: [{ $: { "android:name": RATIONALE_ACTION } }],
      });
    }

    const activityAliases = (mainApplication["activity-alias"] ??= []);
    if (
      !activityAliases.some(
        (alias) => alias.$["android:name"] === PERMISSION_USAGE_ALIAS,
      )
    ) {
      activityAliases.push({
        $: {
          "android:name": PERMISSION_USAGE_ALIAS,
          "android:exported": "true",
          "android:targetActivity": mainActivity.$["android:name"],
          "android:permission":
            "android.permission.START_VIEW_PERMISSION_USAGE",
        },
        "intent-filter": [
          {
            action: [{ $: { "android:name": PERMISSION_USAGE_ACTION } }],
            category: [
              { $: { "android:name": PERMISSION_USAGE_CATEGORY } },
            ],
          },
        ],
      });
    }
    return manifestConfig;
  });
}

function withHealthConnectMainActivity(config) {
  return withMainActivity(config, (mainActivityConfig) => {
    if (mainActivityConfig.modResults.language !== "kt") {
      throw new Error(
        "Health Connect config expects Expo to generate MainActivity.kt.",
      );
    }
    let source = mainActivityConfig.modResults.contents;
    if (!source.includes(IMPORT_LINE)) {
      source = source.replace(
        /^(package\s+[^\r\n]+\r?\n)/m,
        `$1\n${IMPORT_LINE}\n`,
      );
    }
    if (!source.includes(SETUP_LINE)) {
      source = source.replace(
        /(\bsuper\.onCreate\([^)]*\))/,
        `$1\n    ${SETUP_LINE}`,
      );
    }
    if (!source.includes(SETUP_LINE)) {
      throw new Error(
        "Could not install the Health Connect permission delegate in MainActivity.",
      );
    }
    mainActivityConfig.modResults.contents = source;
    return mainActivityConfig;
  });
}

function withHealthConnect(config) {
  return withHealthConnectMainActivity(withHealthConnectManifest(config));
}

module.exports = createRunOncePlugin(
  withHealthConnect,
  "daily-todo-health-connect",
  "2.0.0",
);
