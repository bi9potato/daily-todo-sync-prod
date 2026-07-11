const fs = require("fs");
const path = require("path");
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
} = require("@expo/config-plugins");

const MODULE_BUILD = `plugins {
  id 'com.android.test'
  id 'org.jetbrains.kotlin.android'
}

android {
  namespace 'com.dailytodosync.benchmark'
  compileSdk rootProject.ext.compileSdkVersion
  targetProjectPath = ':app'
  experimentalProperties['android.experimental.self-instrumenting'] = true
  defaultConfig {
    minSdk 28
    targetSdk rootProject.ext.targetSdkVersion
    testInstrumentationRunner 'androidx.test.runner.AndroidJUnitRunner'
  }
  buildTypes { release {} }
}

dependencies {
  implementation 'androidx.test.ext:junit:1.2.1'
  implementation 'androidx.test.espresso:espresso-core:3.6.1'
  implementation 'androidx.test.uiautomator:uiautomator:2.3.0'
  implementation 'androidx.benchmark:benchmark-macro-junit4:1.4.1'
}
`;

const GENERATOR = `package com.dailytodosync.benchmark

import android.content.Intent
import android.net.Uri
import androidx.benchmark.macro.junit4.BaselineProfileRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.LargeTest
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
@LargeTest
class BaselineProfileGenerator {
  @get:Rule val rule = BaselineProfileRule()

  @Test fun criticalUserJourneys() = rule.collect(
    packageName = "com.dailytodosync.app",
    includeInStartupProfile = true,
  ) {
    pressHome()
    startActivityAndWait()
    device.waitForIdle()
    listOf("today", "device-timeline", "mobility", "timeline").forEach { route ->
      startActivityAndWait(
        Intent(Intent.ACTION_VIEW, Uri.parse("daily-todo://$route"))
          .setPackage("com.dailytodosync.app")
      )
      device.waitForIdle()
      device.swipe(device.displayWidth / 2, device.displayHeight * 3 / 4,
        device.displayWidth / 2, device.displayHeight / 4, 12)
    }
  }
}
`;

const BENCHMARK = `package com.dailytodosync.benchmark

import androidx.benchmark.macro.CompilationMode
import androidx.benchmark.macro.FrameTimingMetric
import androidx.benchmark.macro.StartupMode
import androidx.benchmark.macro.StartupTimingMetric
import androidx.benchmark.macro.junit4.MacrobenchmarkRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.LargeTest
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
@LargeTest
class StartupAndNavigationBenchmark {
  @get:Rule val rule = MacrobenchmarkRule()

  @Test fun coldStartup() = rule.measureRepeated(
    packageName = "com.dailytodosync.app",
    metrics = listOf(StartupTimingMetric(), FrameTimingMetric()),
    compilationMode = CompilationMode.Partial(),
    startupMode = StartupMode.COLD,
    iterations = 5,
    setupBlock = { pressHome() },
  ) { startActivityAndWait() }
}
`;

const BASELINE_PROFILE = `# Bootstrap profile; regenerate on a physical Android 13+ device with
# :macrobenchmark:connectedNonMinifiedReleaseAndroidTest and replace this
# file with BaselineProfileGenerator output before performance releases.
HSPLcom/dailytodosync/app/MainActivity;->**(**)**
HSPLcom/dailytodosync/app/MainApplication;->**(**)**
HSPLcom/dailytodosync/app/mobility/**;->**(**)**
HSPLcom/dailytodosync/app/devicetimeline/**;->**(**)**
`;

module.exports = function withAndroidPerformanceBenchmark(config) {
  config = withAndroidManifest(config, (manifestConfig) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      manifestConfig.modResults,
    );
    application.profileable = [{ $: { "android:shell": "true" } }];
    return manifestConfig;
  });
  return withDangerousMod(config, ["android", async (modConfig) => {
    const root = modConfig.modRequest.platformProjectRoot;
    const settingsPath = path.join(root, "settings.gradle");
    let settings = fs.readFileSync(settingsPath, "utf8");
    if (!settings.includes("include ':macrobenchmark'")) {
      settings += "\ninclude ':macrobenchmark'\n";
      fs.writeFileSync(settingsPath, settings);
    }
    const appBuildPath = path.join(root, "app", "build.gradle");
    let appBuild = fs.readFileSync(appBuildPath, "utf8");
    const dependency = 'implementation("androidx.profileinstaller:profileinstaller:1.4.1")';
    if (!appBuild.includes(dependency)) {
      appBuild = appBuild.replace("dependencies {", `dependencies {\n    ${dependency}`);
      fs.writeFileSync(appBuildPath, appBuild);
    }
    const moduleRoot = path.join(root, "macrobenchmark");
    const sourceRoot = path.join(moduleRoot, "src", "main", "java", "com", "dailytodosync", "benchmark");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(path.join(moduleRoot, "build.gradle"), MODULE_BUILD);
    fs.writeFileSync(path.join(sourceRoot, "BaselineProfileGenerator.kt"), GENERATOR);
    fs.writeFileSync(path.join(sourceRoot, "StartupAndNavigationBenchmark.kt"), BENCHMARK);
    const profileDir = path.join(root, "app", "src", "main");
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, "baseline-prof.txt"), BASELINE_PROFILE);
    return modConfig;
  }]);
};
