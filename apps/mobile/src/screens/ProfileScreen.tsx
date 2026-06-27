import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppIcon } from "@/components/AppIcon";
import { ErrorState, LoadingState } from "@/components/ScreenState";
import {
  getGoogleCalendarStatus,
  getMe,
  syncGoogleCalendar,
} from "@/lib/api";
import { useSession } from "@/session";
import { colors, radius, spacing, typography } from "@/theme";

export function ProfileScreen() {
  const { signOut } = useSession();
  const queryClient = useQueryClient();
  const meQuery = useQuery({ queryKey: ["me"], queryFn: getMe });
  const calendarQuery = useQuery({
    queryKey: ["google-calendar-status"],
    queryFn: getGoogleCalendarStatus,
    retry: false,
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
        <LoadingState label="正在读取账号…" />
      </View>
    );
  }

  if (meQuery.isError) {
    return (
      <View style={styles.page}>
        <ErrorState
          message={meQuery.error.message || "账号信息加载失败"}
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
        <Text style={styles.title}>我的</Text>
        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={styles.profileCopy}>
            <Text style={styles.name}>{displayName}</Text>
            <Text style={styles.email}>{user.email}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>同步</Text>
        <View style={styles.settingsGroup}>
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
                  color={colors.borderStrong}
                  size={18}
                />
              )}
            </Pressable>
          ) : null}
        </View>
        {!calendarQuery.isPending && !calendar?.connected ? (
          <Text style={styles.help}>
            Google Calendar 授权暂在网页版完成；连接后可在此直接同步。
          </Text>
        ) : null}

        <Text style={styles.sectionTitle}>关于</Text>
        <View style={styles.settingsGroup}>
          <SettingRow icon="phone-portrait-outline" label="客户端" value="Expo · Android" />
          <SettingRow icon="shield-checkmark-outline" label="登录凭据" value="安全存储" />
        </View>

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
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  profile: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.lg,
    paddingVertical: spacing.xl,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 32,
    height: 64,
    justifyContent: "center",
    width: 64,
  },
  avatarText: {
    color: colors.white,
    fontSize: 24,
    fontWeight: "700",
  },
  profileCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  name: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
  },
  email: {
    ...typography.body,
    color: colors.textMuted,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    marginTop: spacing.xl,
  },
  settingsGroup: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
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
    maxWidth: "45%",
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
  help: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 19,
    marginTop: spacing.sm,
  },
  logout: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xxl,
    minHeight: 44,
  },
  logoutText: {
    ...typography.label,
    color: colors.danger,
  },
  pressed: {
    opacity: 0.62,
  },
});
