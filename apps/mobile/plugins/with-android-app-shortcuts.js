const fs = require("fs");
const path = require("path");
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
} = require("@expo/config-plugins");

const SHORTCUTS_XML = `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
  <shortcut android:shortcutId="add_task" android:enabled="true"
    android:icon="@mipmap/ic_launcher" android:shortcutShortLabel="添加任务"
    android:shortcutLongLabel="快速添加任务">
    <intent android:action="android.intent.action.VIEW"
      android:targetPackage="com.dailytodosync.app"
      android:targetClass="com.dailytodosync.app.MainActivity"
      android:data="daily-todo://today?compose=1" />
  </shortcut>
  <shortcut android:shortcutId="add_expense" android:enabled="true"
    android:icon="@mipmap/ic_launcher" android:shortcutShortLabel="记一笔"
    android:shortcutLongLabel="快速手工记账">
    <intent android:action="android.intent.action.VIEW"
      android:targetPackage="com.dailytodosync.app"
      android:targetClass="com.dailytodosync.app.MainActivity"
      android:data="daily-todo://expenses?manual=1" />
  </shortcut>
</shortcuts>
`;

module.exports = function withAndroidAppShortcuts(config) {
  config = withAndroidManifest(config, (manifestConfig) => {
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(
      manifestConfig.modResults,
    );
    const metadata = (mainActivity["meta-data"] ??= []);
    if (!metadata.some((item) => item.$?.["android:name"] === "android.app.shortcuts")) {
      metadata.push({
        $: {
          "android:name": "android.app.shortcuts",
          "android:resource": "@xml/shortcuts",
        },
      });
    }
    return manifestConfig;
  });
  return withDangerousMod(config, ["android", async (modConfig) => {
    const xmlDir = path.join(modConfig.modRequest.platformProjectRoot, "app", "src", "main", "res", "xml");
    fs.mkdirSync(xmlDir, { recursive: true });
    fs.writeFileSync(path.join(xmlDir, "shortcuts.xml"), SHORTCUTS_XML);
    return modConfig;
  }]);
};
