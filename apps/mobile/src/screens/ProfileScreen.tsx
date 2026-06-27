import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { ReactNode } from "react";
import Constants from "expo-constants";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppIcon } from "@/components/AppIcon";
import { ErrorState, LoadingState } from "@/components/ScreenState";
import {
  getGoogleCalendarStatus,
  getLatestMobileRelease,
  getMe,
  syncGoogleCalendar,
} from "@/lib/api";
import { useSession } from "@/session";
import { colors, radius, shadows, spacing, typography } from "@/theme";
import type { MobileRelease } from "@/types";

const currentVersion = Constants.expoConfig?.version ?? "1.0.0";
const currentVersionCode = Constants.expoConfig?.android?.versionCode ?? 1;
const currentBuildSha = String(
  Constants.expoConfig?.extra?.buildSha ?? "development",
);

export function ProfileScreen() {
  const { signOut } = useSession();
  const queryClient = useQueryClient();
  const meQuery = useQuery({ queryKey: ["me"], queryFn: getMe });
  const calendarQuery = useQuery({
    queryKey: ["google-calendar-status"],
    queryFn: getGoogleCalendarStatus,
    retry: false,
  });
  const releaseQuery = useQuery({
    queryKey: ["mobile-release"],
    queryFn: getLatestMobileRelease,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const syncMutation = useMutation({
    mutationFn: () => syncGoogleCalendar(45),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["day"] });
      void queryClient.invalidateQueries({ queryKey: ["range"] });
      void queryClient.invalidateQueries({ queryKey: ["google-calendar-status"] });
      Alert.alert("同步完成", `已同步 ${result.synced} 个日历事件。`);
    },
    onError: (error) => Alert.alert("同步失败", error.message),
  });

  if (meQuery.isPending) {
    return (
      <View style={styles.page}>
        <LoadingState label="正在读取账户…" />
      </View>
    );
  }

  if (meQuery.isError) {
    return (
      <View style={styles.page}>
        <ErrorState
          message={meQuery.error.message || "账户信息加载失败"}
          onRetry={() => meQuery.refetch()}
        />
      </View>
    );
  }

  const user = meQuery.data;
  const calendar = calendarQuery.data;
  const displayName = user.displayName || user.username;
  const initial = displayName.slice(0, 1).toUpperCase();

  return (
    <View style={styles.page}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <View style={styles.titlePanel}>
          <Text style={styles.title}>我的</Text>
        </View>

        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={styles.profileCopy}>
            <Text style={styles.name}>{displayName}</Text>
            <Text numberOfLines={1} style={styles.email}>
              {user.email}
            </Text>
          </View>
        </View>

        <Section title="同步">
          <SettingRow
            icon="cloud-outline"
            label="云端数据"
            value="已连接"
            valueTone="accent"
          />
          <SettingRow
            icon="logo-google"
            label="Google Calendar"
            value={
              calendarQuery.isPending
                ? "检查中"
                : calendar?.connected
                  ? calendar.googleEmail || "已连接"
                  : "未连接"
            }
          />
          {calendar?.connected ? (
            <Pressable
              disabled={syncMutation.isPending}
              onPress={() => syncMutation.mutate()}
              style={({ pressed }) => [
                styles.actionRow,
                pressed && styles.pressed,
              ]}>
              <AppIcon name="sync-outline" color={colors.accent} size={21} />
              <Text style={styles.actionLabel}>同步未来 45 天</Text>
              {syncMutation.isPending ? (
                <ActivityIndicator color={colors.accent} size="small" />
              ) : (
                <AppIcon
                  name="chevron-forward"
                  color={colors.textMuted}
                  size={18}
                />
              )}
            </Pressable>
          ) : null}
        </Section>

        <Section title="应用更新">
          <SettingRow
            icon="information-circle-outline"
            label="当前版本"
            value={`${currentVersion} (${currentVersionCode})`}
          />
          <UpdatePanel
            isChecking={releaseQuery.isFetching}
            latest={releaseQuery.data}
            onCheck={() => releaseQuery.refetch()}
          />
        </Section>

        <Section title="关于">
          <SettingRow
            icon="phone-portrait-outline"
            label="客户端"
            value="Expo · Android"
          />
          <SettingRow
            icon="shield-checkmark-outline"
            label="登录凭据"
            value="安全存储"
          />
        </Section>

        <Pressable
          onPress={() =>
            Alert.alert("退出登录？", "本机的登录信息将被清除。", [
              { text: "取消", style: "cancel" },
              { text: "退出", style: "destructive", onPress: signOut },
            ])
          }
          style={({ pressed }) => [styles.logout, pressed && styles.pressed]}>
          <AppIcon name="log-out-outline" color={colors.danger} size={20} />
          <Text style={styles.logoutText}>退出登录</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function UpdatePanel({
  isChecking,
  latest,
  onCheck,
}: {
  isChecking: boolean;
  latest: MobileRelease | undefined;
  onCheck: () => unknown;
}) {
  const developmentBuild = currentBuildSha === "development";
  const hasUpdate =
    Boolean(latest) && (developmentBuild || latest?.buildSha !== currentBuildSha);

  async function download() {
    if (!latest) {
      return;
    }
    try {
      await Linking.openURL(latest.apkUrl);
    } catch {
      Alert.alert("无法打开下载地址", "请稍后重试，或前往 GitHub Release 下载。");
    }
  }

  return (
    <View style={styles.updatePanel}>
      <View style={styles.updateHeader}>
        <View style={styles.updateIcon}>
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
        <View style={styles.updateCopy}>
          <Text style={styles.updateTitle}>
            {isChecking
              ? "正在检查更新"
              : hasUpdate
                ? "发现新版本"
                : latest
                  ? "已是最新版"
                  : "暂时无法检查"}
          </Text>
          <Text style={styles.updateMeta}>
            {latest
              ? `${latest.versionName} (${latest.versionCode}) · ${latest.architecture}`
              : `Build ${currentBuildSha.slice(0, 7)}`}
          </Text>
          {hasUpdate ? (
            <Text style={styles.updateHint}>下载后由 Android 确认安装</Text>
          ) : null}
        </View>
      </View>

      {hasUpdate ? (
        <Pressable
          accessibilityRole="link"
          onPress={download}
          style={({ pressed }) => [
            styles.downloadButton,
            pressed && styles.pressed,
          ]}>
          <AppIcon name="download-outline" color={colors.white} size={19} />
          <Text style={styles.downloadText}>下载并安装</Text>
        </Pressable>
      ) : null}

      <Pressable
        disabled={isChecking}
        onPress={onCheck}
        style={({ pressed }) => [
          styles.checkButton,
          pressed && styles.pressed,
        ]}>
        <Text style={styles.checkButtonText}>重新检查</Text>
      </Pressable>
      <Text style={styles.privateReleaseHint}>
        私有仓库下载时，浏览器可能要求登录 GitHub。
      </Text>
    </View>
  );
}

function Section({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.settingsGroup}>{children}</View>
    </View>
  );
}

function SettingRow({
  icon,
  label,
  value,
  valueTone,
}: {
  icon: React.ComponentProps<typeof AppIcon>["name"];
  label: string;
  value: string;
  valueTone?: "accent";
}) {
  return (
    <View style={styles.settingRow}>
      <AppIcon name={icon} color={colors.accent} size={21} />
      <Text style={styles.settingLabel}>{label}</Text>
      <Text
        numberOfLines={1}
        style={[styles.settingValue, valueTone === "accent" && styles.accentValue]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    gap: spacing.md,
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  titlePanel: {
    ...shadows.panel,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.lg,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  profile: {
    ...shadows.panel,
    alignItems: "center",
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.lg,
    padding: spacing.lg,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    height: 60,
    justifyContent: "center",
    width: 60,
  },
  avatarText: {
    color: colors.white,
    fontSize: 23,
    fontWeight: "800",
  },
  profileCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  name: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
  },
  email: {
    ...typography.body,
    color: colors.textMuted,
  },
  section: {
    ...shadows.panel,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  sectionTitle: {
    ...typography.section,
    color: colors.accent,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.xs,
  },
  settingsGroup: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    overflow: "hidden",
  },
  settingRow: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 58,
    paddingHorizontal: spacing.md,
  },
  settingLabel: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },
  settingValue: {
    ...typography.label,
    color: colors.textMuted,
    maxWidth: "48%",
  },
  accentValue: {
    color: colors.accent,
  },
  actionRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 58,
    paddingHorizontal: spacing.md,
  },
  actionLabel: {
    ...typography.body,
    color: colors.accent,
    flex: 1,
    fontWeight: "600",
  },
  updatePanel: {
    backgroundColor: colors.surfaceMuted,
    gap: spacing.md,
    margin: spacing.sm,
    padding: spacing.md,
  },
  updateHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  updateIcon: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  updateCopy: {
    flex: 1,
    gap: 2,
  },
  updateTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
  },
  updateMeta: {
    ...typography.label,
    color: colors.textMuted,
  },
  updateHint: {
    ...typography.caption,
    color: colors.textMuted,
  },
  downloadButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: 48,
  },
  downloadText: {
    ...typography.label,
    color: colors.white,
    fontWeight: "800",
  },
  checkButton: {
    alignItems: "center",
    minHeight: 42,
    justifyContent: "center",
  },
  checkButtonText: {
    ...typography.label,
    color: colors.accent,
  },
  privateReleaseHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: "center",
  },
  logout: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: 50,
  },
  logoutText: {
    ...typography.label,
    color: colors.danger,
  },
  pressed: {
    opacity: 0.62,
  },
});
