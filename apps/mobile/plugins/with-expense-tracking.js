const fs = require("fs");
const path = require("path");

const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withMainApplication,
  withStringsXml,
} = require("@expo/config-plugins");

const PACKAGE_NAME = "com.dailytodosync.app";
const EXPENSE_PACKAGE_IMPORT =
  `${PACKAGE_NAME}.expenses.ExpenseTrackingPackage`;
const NATIVE_SOURCE_ROOT = path.join(
  __dirname,
  "expense-tracking",
  "android",
);

function upsertImport(source, importLine) {
  if (source.includes(importLine)) {
    return source;
  }
  return source.replace(/^(package\s+[^\r\n]+\r?\n)/m, `$1\n${importLine}\n`);
}

function withExpenseMainApplication(config) {
  return withMainApplication(config, (mainApplicationConfig) => {
    if (mainApplicationConfig.modResults.language !== "kt") {
      throw new Error("Expense tracking expects MainApplication.kt.");
    }
    let source = mainApplicationConfig.modResults.contents;
    source = upsertImport(source, `import ${EXPENSE_PACKAGE_IMPORT}`);
    const packageLine = "add(ExpenseTrackingPackage())";
    if (!source.includes(packageLine)) {
      source = source.replace(
        /(PackageList\(this\)\.packages\.apply\s*\{\s*)/,
        `$1\n          ${packageLine}\n          `,
      );
    }
    if (!source.includes(packageLine)) {
      throw new Error("Could not register ExpenseTrackingPackage.");
    }
    mainApplicationConfig.modResults.contents = source;
    return mainApplicationConfig;
  });
}

function withExpenseDependencies(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    if (gradleConfig.modResults.language !== "groovy") {
      throw new Error("Expense tracking expects app/build.gradle in Groovy.");
    }
    let source = gradleConfig.modResults.contents;
    if (!source.includes('apply plugin: "org.jetbrains.kotlin.kapt"')) {
      source = source.replace(
        'apply plugin: "org.jetbrains.kotlin.android"',
        'apply plugin: "org.jetbrains.kotlin.android"\n' +
          'apply plugin: "org.jetbrains.kotlin.kapt"',
      );
    }

    const dependencies = [
      'implementation("androidx.room:room-runtime:2.8.4")',
      'implementation("androidx.room:room-ktx:2.8.4")',
      'kapt("androidx.room:room-compiler:2.8.4")',
      'implementation("androidx.work:work-runtime-ktx:2.11.2")',
    ];
    for (const dependency of dependencies) {
      if (!source.includes(dependency)) {
        source = source.replace(
          /dependencies\s*\{/,
          `dependencies {\n    ${dependency}`,
        );
      }
    }
    gradleConfig.modResults.contents = source;
    return gradleConfig;
  });
}

function withExpenseManifest(config) {
  return withAndroidManifest(config, (manifestConfig) => {
    const manifest = manifestConfig.modResults.manifest;
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      manifestConfig.modResults,
    );
    const services = (application.service ??= []);
    const receivers = (application.receiver ??= []);
    application.$["android:fullBackupContent"] =
      "@xml/expense_backup_rules";
    application.$["android:dataExtractionRules"] =
      "@xml/expense_data_extraction_rules";

    if (
      !services.some(
        (service) =>
          service.$["android:name"] ===
          ".expenses.ExpenseNotificationListenerService",
      )
    ) {
      services.push({
        $: {
          "android:name": ".expenses.ExpenseNotificationListenerService",
          "android:exported": "true",
          "android:label": "@string/expense_notification_listener_label",
          "android:permission":
            "android.permission.BIND_NOTIFICATION_LISTENER_SERVICE",
        },
        "intent-filter": [
          {
            action: [
              {
                $: {
                  "android:name":
                    "android.service.notification.NotificationListenerService",
                },
              },
            ],
          },
        ],
      });
    }

    if (
      !receivers.some(
        (receiver) =>
          receiver.$["android:name"] === ".expenses.ExpenseUndoReceiver",
      )
    ) {
      receivers.push({
        $: {
          "android:name": ".expenses.ExpenseUndoReceiver",
          "android:exported": "false",
        },
      });
    }

    if (
      !services.some(
        (service) =>
          service.$["android:name"] === ".expenses.ExpenseAccessibilityService",
      )
    ) {
      services.push({
        $: {
          "android:name": ".expenses.ExpenseAccessibilityService",
          "android:exported": "true",
          "android:label": "@string/expense_accessibility_label",
          "android:permission": "android.permission.BIND_ACCESSIBILITY_SERVICE",
        },
        "intent-filter": [
          {
            action: [
              {
                $: {
                  "android:name": "android.accessibilityservice.AccessibilityService",
                },
              },
            ],
          },
        ],
        "meta-data": [
          {
            $: {
              "android:name": "android.accessibilityservice",
              "android:resource": "@xml/expense_accessibility_service",
            },
          },
        ],
      });
    }

    const usesPermissions = (manifest["uses-permission"] ??= []);
    if (
      !usesPermissions.some(
        (permission) =>
          permission.$["android:name"] ===
          "android.permission.QUERY_ALL_PACKAGES",
      )
    ) {
      usesPermissions.push({
        $: { "android:name": "android.permission.QUERY_ALL_PACKAGES" },
      });
    }

    return manifestConfig;
  });
}

function withExpenseStrings(config) {
  return withStringsXml(config, (stringsConfig) => {
    const resources = stringsConfig.modResults.resources;
    const strings = (resources.string ??= []);
    const values = {
      expense_notification_listener_label: "每日收支通知读取",
      expense_accessibility_label: "每日收支页面识别",
      expense_accessibility_description:
        "仅在你启用的支付、购物和银行应用中识别交易结果，用于记录收支；不会代替你点击或操作付款。",
    };

    for (const [name, value] of Object.entries(values)) {
      const existing = strings.find((entry) => entry.$?.name === name);
      if (existing) {
        existing._ = value;
      } else {
        strings.push({ $: { name }, _: value });
      }
    }
    return stringsConfig;
  });
}

function copyDirectory(sourceRoot, destinationRoot) {
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    const sourcePath = path.join(sourceRoot, entry.name);
    const destinationPath = path.join(destinationRoot, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destinationPath, { recursive: true });
      copyDirectory(sourcePath, destinationPath);
      continue;
    }
    const contents = fs.readFileSync(sourcePath);
    if (
      fs.existsSync(destinationPath) &&
      fs.readFileSync(destinationPath).equals(contents)
    ) {
      continue;
    }
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.writeFileSync(destinationPath, contents);
  }
}

function withExpenseNativeFiles(config) {
  return withDangerousMod(config, [
    "android",
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.platformProjectRoot;
      copyDirectory(
        path.join(NATIVE_SOURCE_ROOT, "java"),
        path.join(projectRoot, "app", "src", "main", "java"),
      );
      copyDirectory(
        path.join(NATIVE_SOURCE_ROOT, "res"),
        path.join(projectRoot, "app", "src", "main", "res"),
      );
      return modConfig;
    },
  ]);
}

function withExpenseTracking(config) {
  return withExpenseNativeFiles(
    withExpenseStrings(
      withExpenseMainApplication(
        withExpenseDependencies(withExpenseManifest(config)),
      ),
    ),
  );
}

module.exports = createRunOncePlugin(
  withExpenseTracking,
  "daily-todo-expense-tracking",
  "1.0.0",
);
