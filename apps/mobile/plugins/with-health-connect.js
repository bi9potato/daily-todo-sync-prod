const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withMainActivity,
} = require("@expo/config-plugins");

// Everything Health Connect needs at build time, kept in one place instead
// of react-native-health-connect's bundled app.plugin.js (which only adds
// the rationale intent-filter and none of the rest below).
const HEALTH_PERMISSIONS = ["android.permission.health.READ_SLEEP"];
const HEALTH_CONNECT_PROVIDER_PACKAGE = "com.google.android.apps.healthdata";
const RATIONALE_ACTION = "androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE";
const DELEGATE_IMPORT =
  "import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate";
const DELEGATE_CALL = "HealthConnectPermissionDelegate.setPermissionDelegate(this)";

function withHealthConnectManifest(config) {
  return withAndroidManifest(config, (manifestConfig) => {
    const manifest = manifestConfig.modResults.manifest;

    const usesPermissions = (manifest["uses-permission"] ??= []);
    for (const name of HEALTH_PERMISSIONS) {
      if (
        !usesPermissions.some(
          (permission) => permission.$["android:name"] === name,
        )
      ) {
        usesPermissions.push({ $: { "android:name": name } });
      }
    }

    // Package visibility, so availability checks can see the Health Connect
    // provider app on Android 13 and below (14+ ships it in the platform).
    const queries = (manifest.queries ??= []);
    if (!queries.length) {
      queries.push({});
    }
    const queryPackages = (queries[0].package ??= []);
    if (
      !queryPackages.some(
        (entry) => entry.$["android:name"] === HEALTH_CONNECT_PROVIDER_PACKAGE,
      )
    ) {
      queryPackages.push({
        $: { "android:name": HEALTH_CONNECT_PROVIDER_PACKAGE },
      });
    }

    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(
      manifestConfig.modResults,
    );
    const mainActivity = (mainApplication.activity ?? []).find(
      (activity) => activity.$["android:name"] === ".MainActivity",
    );
    if (!mainActivity) {
      throw new Error("Health Connect plugin: .MainActivity not found.");
    }

    // Android 13 and below deliver the "why do you need this" flow through
    // this action on the requesting activity.
    const intentFilters = (mainActivity["intent-filter"] ??= []);
    if (
      !intentFilters.some((filter) =>
        (filter.action ?? []).some(
          (action) => action.$["android:name"] === RATIONALE_ACTION,
        ),
      )
    ) {
      intentFilters.push({
        action: [{ $: { "android:name": RATIONALE_ACTION } }],
      });
    }

    // Android 14+ reaches the same flow through a permission-usage alias.
    const aliases = (mainApplication["activity-alias"] ??= []);
    if (
      !aliases.some(
        (alias) => alias.$["android:name"] === "ViewPermissionUsageActivity",
      )
    ) {
      aliases.push({
        $: {
          "android:name": "ViewPermissionUsageActivity",
          "android:exported": "true",
          "android:targetActivity": ".MainActivity",
          "android:permission": "android.permission.START_VIEW_PERMISSION_USAGE",
        },
        "intent-filter": [
          {
            action: [
              { $: { "android:name": "android.intent.action.VIEW_PERMISSION_USAGE" } },
            ],
            category: [
              { $: { "android:name": "android.intent.category.HEALTH_PERMISSIONS" } },
            ],
          },
        ],
      });
    }

    return manifestConfig;
  });
}

// react-native-health-connect resolves its permission request contract
// through a delegate that must be registered before any request is made.
function withHealthConnectPermissionDelegate(config) {
  return withMainActivity(config, (mainActivityConfig) => {
    if (mainActivityConfig.modResults.language !== "kt") {
      throw new Error("Health Connect plugin expects MainActivity.kt.");
    }
    let source = mainActivityConfig.modResults.contents;
    if (!source.includes(DELEGATE_IMPORT)) {
      source = source.replace(
        /^(package\s+[^\r\n]+\r?\n)/m,
        `$1\n${DELEGATE_IMPORT}\n`,
      );
    }
    if (!source.includes(DELEGATE_CALL)) {
      const updated = source.replace(
        /(super\.onCreate\([^)]*\)\s*\r?\n)/,
        `$1    ${DELEGATE_CALL}\n`,
      );
      if (updated === source) {
        throw new Error(
          "Health Connect plugin: could not find super.onCreate in MainActivity.kt.",
        );
      }
      source = updated;
    }
    mainActivityConfig.modResults.contents = source;
    return mainActivityConfig;
  });
}

module.exports = createRunOncePlugin(
  (config) => withHealthConnectPermissionDelegate(withHealthConnectManifest(config)),
  "daily-todo-health-connect",
  "1.0.0",
);
