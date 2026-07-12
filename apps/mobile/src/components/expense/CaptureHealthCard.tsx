import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon } from "@/components/AppIcon";
import { expenseTracking } from "@/lib/expense-tracking";
import { colors, radius, shadows, spacing, typography } from "@/theme";

import { expenseSharedStyles, type ExpenseHealth } from "./expense-shared";

export function CaptureHealthCard({
  health,
  loading,
}: {
  health: ExpenseHealth | undefined;
  loading: boolean;
}) {
  if (loading) {
    return (
      <View style={styles.healthCard}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.healthLoading}>正在检查采集服务…</Text>
      </View>
    );
  }

  const checks = [
    {
      label: "通知读取",
      ready:
        Boolean(health?.notificationAccessGranted) &&
        Boolean(health?.notificationListenerConnected),
      onPress: expenseTracking.openNotificationAccessSettings,
    },
    {
      label: "页面识别",
      ready:
        Boolean(health?.accessibilityAccessGranted) &&
        Boolean(health?.accessibilityServiceConnected),
      onPress: expenseTracking.openAccessibilitySettings,
    },
    {
      label: "后台运行",
      ready: Boolean(health?.ignoringBatteryOptimizations),
      onPress: expenseTracking.openBatteryOptimizationSettings,
    },
  ];
  const readyCount = checks.filter((check) => check.ready).length;

  return (
    <View style={styles.healthCard}>
      <View style={styles.healthHeader}>
        <View>
          <Text style={styles.cardEyebrow}>采集状态</Text>
          <Text style={styles.healthTitle}>
            {readyCount === checks.length ? "服务已就绪" : `${readyCount}/3 项就绪`}
          </Text>
        </View>
        <View
          style={[
            styles.healthDot,
            readyCount === checks.length
              ? expenseSharedStyles.healthDotReady
              : expenseSharedStyles.healthDotWarning,
          ]}
        />
      </View>
      <View style={styles.healthChecks}>
        {checks.map((check) => (
          <Pressable
            key={check.label}
            onPress={() => void check.onPress()}
            style={({ pressed }) => [
              styles.healthCheck,
              pressed && expenseSharedStyles.pressed,
            ]}>
            <AppIcon
              color={check.ready ? colors.accent : colors.danger}
              name={
                check.ready
                  ? "checkmark-circle"
                  : "alert-circle-outline"
              }
              size={18}
            />
            <Text style={styles.healthCheckLabel}>{check.label}</Text>
            {!check.ready ? (
              <Text style={styles.healthAction}>去设置</Text>
            ) : null}
          </Pressable>
        ))}
      </View>
      <Text style={styles.healthFootnote}>
        已启用 {health?.enabledSourceCount ?? 0} 个数据源；仅处理选中应用中的交易候选
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  healthCard: {
    ...shadows.card,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  healthHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  cardEyebrow: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  healthTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: "800",
    marginTop: 2,
  },
  healthDot: {
    borderRadius: radius.full,
    height: 11,
    width: 11,
  },
  healthChecks: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  healthCheck: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    gap: spacing.xs,
    minHeight: 72,
    justifyContent: "center",
    padding: spacing.xs,
  },
  healthCheckLabel: {
    ...typography.caption,
    color: colors.text,
    fontWeight: "700",
  },
  healthAction: {
    color: colors.danger,
    fontSize: 10,
    fontWeight: "700",
  },
  healthFootnote: {
    ...typography.caption,
    color: colors.textMuted,
  },
  healthLoading: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: "center",
  },
});
