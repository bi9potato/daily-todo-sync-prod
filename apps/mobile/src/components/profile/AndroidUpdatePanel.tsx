import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon } from "@/components/AppIcon";
import { formatApkSize, hasAndroidUpdate } from "@/lib/mobile-release";
import { colors, radius, spacing, typography } from "@/theme";
import type { MobileRelease } from "@/types";

export function AndroidUpdatePanel({
  currentBuildSha,
  currentVersionCode,
  isChecking,
  latest,
  onCheck,
}: {
  currentBuildSha: string;
  currentVersionCode: number;
  isChecking: boolean;
  latest: MobileRelease | undefined;
  onCheck: () => unknown;
}) {
  const hasUpdate = hasAndroidUpdate(
    currentVersionCode,
    currentBuildSha,
    latest,
  );
  const apkSize = formatApkSize(latest?.apkSizeBytes);

  async function download() {
    if (!latest) return;
    try {
      await Linking.openURL(latest.apkUrl);
    } catch {
      Alert.alert("无法打开下载地址", "请稍后重试，或前往 GitHub Release 下载。");
    }
  }

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <View style={styles.icon}>
          {isChecking ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            <AppIcon
              name={hasUpdate ? "download-outline" : "checkmark"}
              color={colors.white}
              size={21}
            />
          )}
        </View>
        <View style={styles.copy}>
          <Text style={styles.title}>
            {isChecking
              ? "正在检查更新"
              : hasUpdate
                ? "发现新版本"
                : latest
                  ? "已是最新版"
                  : "暂时无法检查"}
          </Text>
          <Text style={styles.meta}>
            {latest
              ? `${latest.versionName} (${latest.versionCode}) · ${latest.architecture}`
              : `Build ${currentBuildSha.slice(0, 7)}`}
          </Text>
          {latest ? (
            <Text style={styles.hint}>
              {[apkSize, new Date(latest.publishedAt).toLocaleString("zh-CN")]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          ) : null}
          {hasUpdate ? <Text style={styles.hint}>下载后由 Android 确认安装</Text> : null}
        </View>
      </View>
      {hasUpdate ? (
        <Pressable
          accessibilityRole="link"
          onPress={download}
          style={({ pressed }) => [styles.download, pressed && styles.pressed]}>
          <AppIcon name="download-outline" color={colors.white} size={19} />
          <Text style={styles.downloadText}>下载并安装</Text>
        </Pressable>
      ) : null}
      <Pressable
        disabled={isChecking}
        onPress={onCheck}
        style={({ pressed }) => [styles.check, pressed && styles.pressed]}>
        <Text style={styles.checkText}>重新检查</Text>
      </Pressable>
      <Text style={styles.hint}>安装包来自公开构建仓库，并在服务器发布前校验。</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.surfaceMuted, gap: spacing.md, margin: spacing.sm, padding: spacing.md },
  header: { alignItems: "center", flexDirection: "row", gap: spacing.md },
  icon: { alignItems: "center", backgroundColor: colors.accent, borderRadius: radius.full, height: 44, justifyContent: "center", width: 44 },
  copy: { flex: 1, gap: 2 },
  title: { color: colors.text, fontSize: 17, fontWeight: "800" },
  meta: { ...typography.label, color: colors.textMuted },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: "center" },
  download: { alignItems: "center", backgroundColor: colors.accent, borderRadius: radius.sm, flexDirection: "row", gap: spacing.sm, justifyContent: "center", minHeight: 48 },
  downloadText: { ...typography.label, color: colors.white, fontWeight: "800" },
  check: { alignItems: "center", justifyContent: "center", minHeight: 42 },
  checkText: { ...typography.label, color: colors.accent },
  pressed: { opacity: 0.62 },
});
