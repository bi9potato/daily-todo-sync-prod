import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useState, type ReactNode } from "react";
import Constants from "expo-constants";
import { LinearGradient } from "expo-linear-gradient";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppIcon } from "@/components/AppIcon";
import { ErrorState, LoadingState } from "@/components/ScreenState";
import {
  authorizeGoogleCalendar,
  bindGoogleAccount,
  clearTrash,
  disconnectGoogleAccount,
  getGoogleCalendarStatus,
  getLatestMobileRelease,
  getMe,
  getTrash,
  restoreOccurrence,
  setGoogleCalendarSyncEnabled,
  syncGoogleCalendar,
  updateMe,
} from "@/lib/api";
import { useSession } from "@/session";
import { colors, radius, shadows, spacing, typography } from "@/theme";
import type {
  DeletedTodoOccurrence,
  GoogleCalendarStatus,
  MobileRelease,
} from "@/types";

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
  const trashQuery = useQuery({
    queryKey: ["trash"],
    queryFn: getTrash,
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
  const updateProfileMutation = useMutation({
    mutationFn: updateMe,
    onSuccess: (user) => queryClient.setQueryData(["me"], user),
    onError: (error) => Alert.alert("账户名称保存失败", error.message),
  });
  const restoreMutation = useMutation({
    mutationFn: restoreOccurrence,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["trash"] });
      void queryClient.invalidateQueries({ queryKey: ["day"] });
      void queryClient.invalidateQueries({ queryKey: ["range"] });
    },
  });
  const clearTrashMutation = useMutation({
    mutationFn: clearTrash,
    onSuccess: () => queryClient.setQueryData(["trash"], []),
  });
  const toggleSyncMutation = useMutation({
    mutationFn: ({
      enabled,
      connectionId,
    }: {
      enabled: boolean;
      connectionId?: string;
    }) => setGoogleCalendarSyncEnabled(enabled, connectionId),
    onSuccess: (status) =>
      queryClient.setQueryData(["google-calendar-status"], status),
    onError: (error) => Alert.alert("同步设置失败", error.message),
  });
  const disconnectMutation = useMutation({
    mutationFn: disconnectGoogleAccount,
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ["google-calendar-status"],
      }),
  });

  if (meQuery.isPending) {
    return (
      <View style={styles.page}>
        <LoadingState
          label="正在读取账户…"
          isPaused={meQuery.fetchStatus === "paused"}
        />
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
  const googleEmails = (calendar?.accounts ?? [])
    .map((account) => account.googleEmail)
    .filter((email) => email.includes("@"));
  const accountSubtitle = googleEmails.length
    ? googleEmails.join(" · ")
    : calendar?.googleEmail.includes("@")
      ? calendar.googleEmail
      : user.email.includes("@")
        ? user.email
        : "Daily Todo Sync 账户";

  return (
    <View style={styles.page}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>我的</Text>

        <View style={styles.profile}>
          <LinearGradient
            colors={[colors.accent, colors.accentPressed]}
            end={{ x: 1, y: 1 }}
            start={{ x: 0, y: 0 }}
            style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </LinearGradient>
          <View style={styles.profileCopy}>
            <Text style={styles.name}>{displayName}</Text>
            <Text numberOfLines={2} style={styles.email}>
              {accountSubtitle}
            </Text>
          </View>
        </View>

        <ProfileNameEditor
          displayName={displayName}
          isSaving={updateProfileMutation.isPending}
          onSave={(nextName) =>
            updateProfileMutation.mutate({ displayName: nextName })
          }
        />

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
          <CalendarAccounts
            calendar={calendar}
            isBusy={
              toggleSyncMutation.isPending || disconnectMutation.isPending
            }
            onAuthorize={async (connectionId) => {
              const result = await authorizeGoogleCalendar(connectionId);
              await Linking.openURL(result.authorizationUrl);
            }}
            onBind={async () => {
              const result = await bindGoogleAccount();
              await Linking.openURL(result.authorizationUrl);
            }}
            onDisconnect={(connectionId) =>
              Alert.alert("断开 Google 账户？", "该账户将停止同步日历。", [
                { text: "取消", style: "cancel" },
                {
                  text: "断开",
                  style: "destructive",
                  onPress: () => disconnectMutation.mutate(connectionId),
                },
              ])
            }
            onRefresh={() => calendarQuery.refetch()}
            onToggle={(enabled, connectionId) =>
              toggleSyncMutation.mutate({ enabled, connectionId })
            }
          />
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

        <Section title="回收站">
          <TrashPanel
            isBusy={
              trashQuery.isFetching ||
              restoreMutation.isPending ||
              clearTrashMutation.isPending
            }
            items={trashQuery.data ?? []}
            onClear={() =>
              Alert.alert("清空回收站？", "已删除的任务将无法恢复。", [
                { text: "取消", style: "cancel" },
                {
                  text: "清空",
                  style: "destructive",
                  onPress: () => clearTrashMutation.mutate(),
                },
              ])
            }
            onRestore={(id) => restoreMutation.mutate(id)}
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

function ProfileNameEditor({
  displayName,
  isSaving,
  onSave,
}: {
  displayName: string;
  isSaving: boolean;
  onSave: (displayName: string) => void;
}) {
  const [value, setValue] = useState(displayName);
  const changed = value.trim() !== displayName && Boolean(value.trim());

  return (
    <View style={styles.nameEditor}>
      <Text style={styles.sectionTitle}>账户名称</Text>
      <View style={styles.nameEditorRow}>
        <TextInput
          accessibilityLabel="账户名称"
          editable={!isSaving}
          onChangeText={setValue}
          placeholder="账户名称"
          placeholderTextColor={colors.textMuted}
          style={styles.nameInput}
          value={value}
        />
        <Pressable
          disabled={!changed || isSaving}
          onPress={() => onSave(value.trim())}
          style={[
            styles.compactPrimaryButton,
            (!changed || isSaving) && styles.disabled,
          ]}>
          {isSaving ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <Text style={styles.compactPrimaryText}>保存</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function CalendarAccounts({
  calendar,
  isBusy,
  onAuthorize,
  onBind,
  onDisconnect,
  onRefresh,
  onToggle,
}: {
  calendar: GoogleCalendarStatus | undefined;
  isBusy: boolean;
  onAuthorize: (connectionId?: string) => Promise<void>;
  onBind: () => Promise<void>;
  onDisconnect: (connectionId?: string) => void;
  onRefresh: () => unknown;
  onToggle: (enabled: boolean, connectionId?: string) => void;
}) {
  const accounts = calendar?.accounts ?? [];

  return (
    <View style={styles.calendarAccounts}>
      {accounts.map((account) => (
        <View key={account.id} style={styles.calendarAccount}>
          <View style={styles.calendarAccountHeader}>
            <View style={styles.googleMark}>
              <Text style={styles.googleMarkText}>G</Text>
            </View>
            <View style={styles.calendarAccountCopy}>
              <Text numberOfLines={1} style={styles.calendarAccountName}>
                {account.googleName || account.googleEmail}
              </Text>
              <Text numberOfLines={1} style={styles.calendarAccountEmail}>
                {account.googleEmail}
              </Text>
            </View>
            <Switch
              disabled={!account.calendarAuthorized || isBusy}
              onValueChange={(enabled) => onToggle(enabled, account.id)}
              trackColor={{ false: colors.border, true: colors.accent }}
              value={account.syncEnabled}
            />
          </View>
          <View style={styles.inlineActions}>
            {!account.calendarAuthorized ? (
              <Pressable
                onPress={() => void onAuthorize(account.id)}
                style={styles.textAction}>
                <Text style={styles.textActionLabel}>授权 Calendar</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => onDisconnect(account.id)}
              style={styles.textAction}>
              <Text style={styles.dangerActionLabel}>断开</Text>
            </Pressable>
          </View>
        </View>
      ))}
      <View style={styles.settingsActions}>
        <Pressable onPress={() => void onBind()} style={styles.outlineButton}>
          <AppIcon name="add" color={colors.accent} size={18} />
          <Text style={styles.outlineButtonText}>绑定 Google 账户</Text>
        </Pressable>
        <Pressable onPress={onRefresh} style={styles.refreshButton}>
          <AppIcon name="refresh" color={colors.textMuted} size={18} />
          <Text style={styles.refreshButtonText}>刷新状态</Text>
        </Pressable>
      </View>
    </View>
  );
}

function TrashPanel({
  isBusy,
  items,
  onClear,
  onRestore,
}: {
  isBusy: boolean;
  items: DeletedTodoOccurrence[];
  onClear: () => void;
  onRestore: (id: string) => void;
}) {
  return (
    <View style={styles.trashPanel}>
      {items.length ? (
        items.map((item) => (
          <View key={item.id} style={styles.trashRow}>
            <View style={styles.trashCopy}>
              <Text numberOfLines={1} style={styles.trashTitle}>
                {item.text}
              </Text>
              <Text style={styles.trashMeta}>{item.taskDate}</Text>
            </View>
            <Pressable
              disabled={isBusy}
              onPress={() => onRestore(item.id)}
              style={styles.restoreButton}>
              <Text style={styles.restoreText}>恢复</Text>
            </Pressable>
          </View>
        ))
      ) : (
        <Text style={styles.emptySetting}>回收站为空。</Text>
      )}
      {items.length ? (
        <Pressable
          disabled={isBusy}
          onPress={onClear}
          style={styles.clearTrashButton}>
          <AppIcon name="trash-outline" color={colors.danger} size={18} />
          <Text style={styles.clearTrashText}>清空回收站</Text>
        </Pressable>
      ) : null}
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
  title: {
    ...typography.title,
    color: colors.text,
    marginBottom: spacing.xs,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  profile: {
    ...shadows.floating,
    alignItems: "center",
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.lg,
    padding: spacing.lg,
  },
  avatar: {
    alignItems: "center",
    borderRadius: radius.full,
    height: 60,
    justifyContent: "center",
    overflow: "hidden",
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
  nameEditor: {
    ...shadows.card,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  nameEditorRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  nameInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.text,
    flex: 1,
    fontSize: 16,
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  compactPrimaryButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    justifyContent: "center",
    minHeight: 46,
    minWidth: 64,
    paddingHorizontal: spacing.md,
  },
  compactPrimaryText: {
    ...typography.label,
    color: colors.white,
  },
  disabled: {
    opacity: 0.42,
  },
  section: {
    ...shadows.card,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: radius.lg,
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
  calendarAccounts: {
    gap: spacing.sm,
    padding: spacing.sm,
  },
  calendarAccount: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.sm,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  calendarAccountHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  googleMark: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  googleMarkText: {
    color: colors.accent,
    fontSize: 18,
    fontWeight: "800",
  },
  calendarAccountCopy: {
    flex: 1,
    minWidth: 0,
  },
  calendarAccountName: {
    ...typography.label,
    color: colors.text,
  },
  calendarAccountEmail: {
    ...typography.caption,
    color: colors.textMuted,
  },
  inlineActions: {
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "flex-end",
  },
  textAction: {
    justifyContent: "center",
    minHeight: 36,
  },
  textActionLabel: {
    ...typography.label,
    color: colors.accent,
  },
  dangerActionLabel: {
    ...typography.label,
    color: colors.danger,
  },
  settingsActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  outlineButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  outlineButtonText: {
    ...typography.label,
    color: colors.accent,
  },
  refreshButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 42,
    paddingHorizontal: spacing.sm,
  },
  refreshButtonText: {
    ...typography.label,
    color: colors.textMuted,
  },
  trashPanel: {
    gap: spacing.sm,
    padding: spacing.sm,
  },
  trashRow: {
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 54,
    padding: spacing.sm,
  },
  trashCopy: {
    flex: 1,
    minWidth: 0,
  },
  trashTitle: {
    ...typography.label,
    color: colors.text,
  },
  trashMeta: {
    ...typography.caption,
    color: colors.textMuted,
  },
  restoreButton: {
    alignItems: "center",
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  restoreText: {
    ...typography.label,
    color: colors.accent,
  },
  clearTrashButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 42,
  },
  clearTrashText: {
    ...typography.label,
    color: colors.danger,
  },
  emptySetting: {
    ...typography.body,
    color: colors.textMuted,
    padding: spacing.sm,
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
    ...shadows.card,
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: 52,
    marginTop: spacing.xs,
  },
  logoutText: {
    ...typography.label,
    color: colors.danger,
  },
  pressed: {
    opacity: 0.62,
  },
});
