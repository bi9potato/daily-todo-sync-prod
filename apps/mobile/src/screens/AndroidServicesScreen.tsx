import { useCallback } from "react";
import { ActivityIndicator, Linking, PermissionsAndroid, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Location from "expo-location";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { AppIcon } from "@/components/AppIcon";
import { hasExactAlarmAccess, openExactAlarmSettings, openReminderBatteryOptimizationSettings, openReminderNotificationSettings } from "@/lib/android-reminder-settings";
import { expenseTracking, isExpenseTrackingAvailable, type ExpenseHealth } from "@/lib/expense-tracking";
import { isBatteryOptimizationDisabled, openBatteryOptimizationSettings } from "@/lib/mobility-native-service";
import { hasNotificationPermission } from "@/lib/notifications";
import { useAppShell } from "@/lib/app-shell";
import { colors, radius, shadows, spacing, typography } from "@/theme";

type PermissionSnapshot = {
  activityRecognition: boolean;
  backgroundLocation: boolean;
  exactAlarm: boolean;
  foregroundLocation: boolean;
  mobilityBatteryExempt: boolean;
  notifications: boolean;
  expense: ExpenseHealth | null;
};

async function readPermissions(): Promise<PermissionSnapshot> {
  const [foreground, background, activityRecognition, notifications, exactAlarm, mobilityBatteryExempt, expense] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
    PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION),
    hasNotificationPermission(),
    hasExactAlarmAccess(),
    isBatteryOptimizationDisabled(),
    isExpenseTrackingAvailable() ? expenseTracking.getHealth().catch(() => null) : Promise.resolve(null),
  ]);
  return {
    activityRecognition,
    backgroundLocation: background.granted,
    exactAlarm,
    foregroundLocation: foreground.granted,
    mobilityBatteryExempt,
    notifications,
    expense,
  };
}

export function AndroidServicesScreen() {
  const { deviceTimeline, mobilityRuntime } = useAppShell();
  const query = useQuery({ queryKey: ["android-service-status"], queryFn: readPermissions, staleTime: 10_000 });
  const refetch = query.refetch;
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));

  const snapshot = query.data;
  const expense = snapshot?.expense;
  const queueCount = mobilityRuntime.queuedPointCount + deviceTimeline.runtime.queuedEventCount;

  return <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <View style={styles.heading}>
      <View style={styles.headingIcon}><AppIcon name="shield-checkmark-outline" color={colors.white} size={24} /></View>
      <View style={styles.headingCopy}>
        <Text style={styles.title}>权限与后台服务</Text>
        <Text style={styles.subtitle}>权限仅在启用对应功能时需要；关闭后其他任务功能仍可使用。</Text>
      </View>
      {query.isFetching ? <ActivityIndicator color={colors.accent} /> : null}
    </View>

    <ServiceSection title="足迹">
      <ServiceRow label="前台定位" ok={snapshot?.foregroundLocation} detail="读取当前位置并绘制当天路线" onRepair={Linking.openSettings} />
      <ServiceRow label="后台定位" ok={snapshot?.backgroundLocation} detail="仅在开启足迹记录后持续采样并上传轨迹点" onRepair={Linking.openSettings} />
      <ServiceRow label="活动识别" ok={snapshot?.activityRecognition} detail="区分步行、骑行和乘车；不读取健身账户" onRepair={Linking.openSettings} />
      <ServiceRow label="足迹后台服务" ok={mobilityRuntime.nativeTaskActive} detail={mobilityRuntime.lastError || `待同步 ${mobilityRuntime.queuedPointCount} 个轨迹点`} onRepair={() => openBatteryOptimizationSettings()} />
      <ServiceRow label="足迹电池优化豁免" ok={snapshot?.mobilityBatteryExempt} detail="降低系统在长时间记录时终止服务的概率" onRepair={() => openBatteryOptimizationSettings()} />
    </ServiceSection>

    <ServiceSection title="提醒">
      <ServiceRow label="通知" ok={snapshot?.notifications} detail="发送任务提醒；不会读取其他应用通知" onRepair={() => openReminderNotificationSettings()} />
      <ServiceRow label="精确闹钟" ok={snapshot?.exactAlarm} detail="让有明确时间的提醒尽量准时触发" onRepair={() => openExactAlarmSettings()} />
      <ServiceRow label="提醒电池优化" ok={snapshot?.mobilityBatteryExempt} detail="避免省电策略延迟提醒" onRepair={() => openReminderBatteryOptimizationSettings()} />
    </ServiceSection>

    <ServiceSection title="设备时间线">
      <ServiceRow label="使用情况访问" ok={deviceTimeline.runtime.hasUsageAccess} detail="本机读取应用使用区间，不读取应用内容" onRepair={deviceTimeline.openUsageAccessSettings} />
      <ServiceRow label="时间线服务" ok={!deviceTimeline.runtime.enabled || deviceTimeline.runtime.isRunning} detail={deviceTimeline.runtime.lastError || `待同步 ${deviceTimeline.runtime.queuedEventCount} 个事件`} onRepair={deviceTimeline.openUsageAccessSettings} />
    </ServiceSection>

    <ServiceSection title="每日收支">
      <ServiceRow label="通知访问" ok={expense?.notificationAccessGranted} detail="仅解析用户选择的支付应用通知" onRepair={() => expenseTracking.openNotificationAccessSettings()} />
      <ServiceRow label="无障碍服务" ok={expense?.accessibilityAccessGranted} detail="作为通知缺失时的可选补充；不开启也可手工记账" onRepair={() => expenseTracking.openAccessibilitySettings()} />
      <ServiceRow label="收支后台运行" ok={expense?.ignoringBatteryOptimizations} detail={expense ? `已启用 ${expense.enabledSourceCount} 个来源，待确认 ${expense.pendingCandidateCount} 条` : "原生收支模块不可用"} onRepair={() => expenseTracking.openBatteryOptimizationSettings()} />
    </ServiceSection>

    <View style={styles.summary}>
      <AppIcon name={queueCount ? "cloud-upload-outline" : "checkmark-circle-outline"} color={queueCount ? "#B4846B" : colors.accent} size={20} />
      <Text style={styles.summaryText}>{queueCount ? `本机共有 ${queueCount} 条数据等待同步` : "本地后台队列已同步"}</Text>
      <Pressable onPress={() => refetch()} style={styles.refresh}><Text style={styles.refreshText}>刷新</Text></Pressable>
    </View>
  </ScrollView>;
}

function ServiceSection({ children, title }: { children: React.ReactNode; title: string }) {
  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text><View style={styles.rows}>{children}</View></View>;
}

function ServiceRow({ detail, label, ok, onRepair }: { detail: string; label: string; ok: boolean | undefined; onRepair: () => unknown }) {
  return <View style={styles.row}>
    <AppIcon name={ok ? "checkmark-circle" : "alert-circle-outline"} color={ok ? colors.accent : "#B4846B"} size={21} />
    <View style={styles.rowCopy}><Text style={styles.rowLabel}>{label}</Text><Text style={styles.rowDetail}>{detail}</Text></View>
    {!ok ? <Pressable accessibilityRole="button" onPress={onRepair} style={styles.repair}><Text style={styles.repairText}>修复</Text></Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xxl },
  heading: { ...shadows.card, alignItems: "center", backgroundColor: colors.panel, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", gap: spacing.md, padding: spacing.md },
  headingIcon: { alignItems: "center", backgroundColor: colors.accent, borderRadius: radius.full, height: 48, justifyContent: "center", width: 48 },
  headingCopy: { flex: 1, gap: spacing.xs },
  title: { ...typography.title, color: colors.text },
  subtitle: { ...typography.caption, color: colors.textMuted, lineHeight: 18 },
  section: { ...shadows.card, backgroundColor: colors.panel, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: spacing.sm, padding: spacing.sm },
  sectionTitle: { ...typography.section, color: colors.accent, paddingHorizontal: spacing.xs, paddingTop: spacing.xs },
  rows: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.sm, borderWidth: 1, overflow: "hidden" },
  row: { alignItems: "center", borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: spacing.sm, minHeight: 68, padding: spacing.md },
  rowCopy: { flex: 1, gap: 2 },
  rowLabel: { ...typography.label, color: colors.text },
  rowDetail: { ...typography.caption, color: colors.textMuted, lineHeight: 17 },
  repair: { alignItems: "center", borderColor: colors.accent, borderRadius: radius.sm, borderWidth: 1, justifyContent: "center", minHeight: 38, paddingHorizontal: spacing.sm },
  repairText: { ...typography.label, color: colors.accent },
  summary: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, flexDirection: "row", gap: spacing.sm, padding: spacing.md },
  summaryText: { ...typography.body, color: colors.text, flex: 1 },
  refresh: { minHeight: 38, justifyContent: "center", paddingHorizontal: spacing.sm },
  refreshText: { ...typography.label, color: colors.accent },
});
