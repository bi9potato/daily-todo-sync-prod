const {
  createRunOncePlugin,
  withMainActivity,
} = require("@expo/config-plugins");

const IMPORT_LINE =
  "import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate";
const SETUP_LINE =
  "HealthConnectPermissionDelegate.setPermissionDelegate(this)";

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

module.exports = createRunOncePlugin(
  withHealthConnectMainActivity,
  "daily-todo-health-connect-main-activity",
  "1.0.0",
);
