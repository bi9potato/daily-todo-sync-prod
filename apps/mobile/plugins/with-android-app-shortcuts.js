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
    android:icon="@mipmap/ic_launcher" android:shortcutShortLabel="@string/shortcut_add_task"
    android:shortcutLongLabel="@string/shortcut_add_task_long">
    <intent android:action="android.intent.action.VIEW"
      android:targetPackage="com.dailytodosync.app"
      android:targetClass="com.dailytodosync.app.MainActivity"
      android:data="daily-todo://today?compose=1" />
  </shortcut>
  <shortcut android:shortcutId="add_expense" android:enabled="true"
    android:icon="@mipmap/ic_launcher" android:shortcutShortLabel="@string/shortcut_add_expense"
    android:shortcutLongLabel="@string/shortcut_add_expense_long">
    <intent android:action="android.intent.action.VIEW"
      android:targetPackage="com.dailytodosync.app"
      android:targetClass="com.dailytodosync.app.MainActivity"
      android:data="daily-todo://expenses?manual=1" />
  </shortcut>
  <shortcut android:shortcutId="voice_command" android:enabled="true"
    android:icon="@mipmap/ic_launcher" android:shortcutShortLabel="@string/shortcut_voice_command"
    android:shortcutLongLabel="@string/shortcut_voice_command_long">
    <intent android:action="android.intent.action.VIEW"
      android:targetPackage="com.dailytodosync.app"
      android:targetClass="com.dailytodosync.app.MainActivity"
      android:data="daily-todo://today?voice=1" />
  </shortcut>
</shortcuts>
`;

const SHORTCUT_STRINGS_XML = `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="shortcut_add_task">添加任务</string>
  <string name="shortcut_add_task_long">快速添加任务</string>
  <string name="shortcut_add_expense">记一笔</string>
  <string name="shortcut_add_expense_long">快速手工记账</string>
  <string name="shortcut_voice_command">语音操作</string>
  <string name="shortcut_voice_command_long">语音添加或完成任务</string>
</resources>
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
    const valuesDir = path.join(modConfig.modRequest.platformProjectRoot, "app", "src", "main", "res", "values");
    fs.mkdirSync(valuesDir, { recursive: true });
    fs.writeFileSync(path.join(valuesDir, "shortcut_strings.xml"), SHORTCUT_STRINGS_XML);
    return modConfig;
  }]);
};
