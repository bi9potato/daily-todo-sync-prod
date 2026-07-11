import { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "@tanstack/react-query";

import { AppIcon } from "@/components/AppIcon";
import { getDeviceTimelineDay, getMobilityDay } from "@/lib/api";
import { useAppShell } from "@/lib/app-shell";
import { aggregateAppUsage } from "@/lib/device-timeline";
import { expenseTracking, formatCny, isExpenseTrackingAvailable } from "@/lib/expense-tracking";
import { colors, radius, spacing, typography } from "@/theme";
import type { AppSection } from "@/lib/app-routes";

type CardId = "tasks" | "device" | "expense" | "mobility" | "sync" | "services";
const DEFAULT_ORDER: CardId[] = ["tasks", "device", "expense", "mobility", "sync", "services"];
const STORAGE_KEY = "daily-todo-sync.android-today-overview-v1";

type Preferences = { collapsed: boolean; hidden: CardId[]; order: CardId[] };

export function TodayOverview({ doneCount, selectedDate, totalCount }: {
  doneCount: number;
  selectedDate: string;
  totalCount: number;
}) {
  const { deviceTimeline, mobilityRuntime, navigateToSection } = useAppShell();
  const [preferences, setPreferences] = useState<Preferences>({ collapsed: false, hidden: [], order: DEFAULT_ORDER });
  const deviceQuery = useQuery({
    queryKey: ["device-timeline-day", selectedDate, "overview"],
    queryFn: () => getDeviceTimelineDay(selectedDate),
    enabled: Platform.OS === "android",
  });
  const mobilityQuery = useQuery({
    queryKey: ["mobility-day", selectedDate, "overview"],
    queryFn: () => getMobilityDay(selectedDate),
    enabled: Platform.OS === "android",
  });
  const expenseQuery = useQuery({
    queryKey: ["expense-day", selectedDate, "overview"],
    queryFn: () => expenseTracking.getTransactions(selectedDate),
    enabled: Platform.OS === "android" && isExpenseTrackingAvailable(),
  });

  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as Partial<Preferences>;
        const order = Array.isArray(parsed.order)
          ? [...parsed.order.filter((id): id is CardId => DEFAULT_ORDER.includes(id as CardId)), ...DEFAULT_ORDER.filter((id) => !parsed.order?.includes(id))]
          : DEFAULT_ORDER;
        setPreferences({ collapsed: Boolean(parsed.collapsed), hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter((id): id is CardId => DEFAULT_ORDER.includes(id as CardId)) : [], order });
      } catch { /* Ignore corrupt local UI preferences. */ }
    });
  }, []);

  function update(next: Preferences) {
    setPreferences(next);
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  const totalDeviceSeconds = useMemo(
    () => aggregateAppUsage(deviceQuery.data?.timeline ?? []).reduce((sum, item) => sum + item.totalSeconds, 0),
    [deviceQuery.data?.timeline],
  );
  const expenseTotals = expenseQuery.data?.summary;
  const queueCount = mobilityRuntime.queuedPointCount + deviceTimeline.runtime.queuedEventCount;
  const serviceIssueCount = [
    mobilityRuntime.foregroundPermission,
    mobilityRuntime.backgroundPermission,
    !deviceTimeline.runtime.enabled || deviceTimeline.runtime.isRunning,
  ].filter((ok) => !ok).length;

  const cards: Record<CardId, { icon: React.ComponentProps<typeof AppIcon>["name"]; label: string; section: AppSection; value: string }> = {
    tasks: { icon: "checkmark-done-outline", label: "任务完成", section: "today", value: totalCount ? `${doneCount}/${totalCount} · ${Math.round(doneCount / totalCount * 100)}%` : "暂无任务" },
    device: { icon: "phone-portrait-outline", label: "手机使用", section: "device-timeline", value: formatDuration(totalDeviceSeconds) },
    expense: { icon: "wallet-outline", label: "今日收支", section: "expenses", value: `收 ${formatCny(expenseTotals?.incomeMinor ?? 0)} · 支 ${formatCny(expenseTotals?.expenseMinor ?? 0)}` },
    mobility: { icon: "walk-outline", label: "步数与距离", section: "mobility", value: `${mobilityQuery.data?.stepCount ?? 0} 步 · ${formatDistance(mobilityQuery.data?.distanceMeters ?? 0)}` },
    sync: { icon: "cloud-upload-outline", label: "等待同步", section: "services", value: `${queueCount} 条` },
    services: { icon: "shield-checkmark-outline", label: "后台服务", section: "services", value: serviceIssueCount ? `${serviceIssueCount} 项需要处理` : "运行正常" },
  };
  const visible = preferences.order.filter((id) => !preferences.hidden.includes(id));

  if (Platform.OS !== "android") return null;
  return <View style={styles.panel}>
    <View style={styles.header}>
      <View><Text style={styles.title}>今日总览</Text><Text style={styles.caption}>数据在本机组合，点击卡片查看详情</Text></View>
      {preferences.hidden.length ? <Pressable onPress={() => update({ ...preferences, hidden: [] })} style={styles.headerAction}><Text style={styles.headerActionText}>恢复卡片</Text></Pressable> : null}
      <Pressable accessibilityLabel={preferences.collapsed ? "展开今日总览" : "收起今日总览"} onPress={() => update({ ...preferences, collapsed: !preferences.collapsed })} style={styles.collapse}>
        <AppIcon name={preferences.collapsed ? "chevron-down" : "chevron-up"} color={colors.textMuted} size={20} />
      </Pressable>
    </View>
    {!preferences.collapsed ? <View style={styles.grid}>{visible.map((id, index) => {
      const card = cards[id];
      return <Pressable key={id} onPress={() => navigateToSection(card.section)} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
        <View style={styles.cardHeader}><AppIcon name={card.icon} color={colors.accent} size={20} /><Text style={styles.cardLabel}>{card.label}</Text>
          <Pressable accessibilityLabel={`隐藏${card.label}`} hitSlop={8} onPress={() => update({ ...preferences, hidden: [...preferences.hidden, id] })}><AppIcon name="close" color={colors.textMuted} size={16} /></Pressable>
        </View>
        <Text numberOfLines={1} style={styles.cardValue}>{card.value}</Text>
        {index > 0 ? <Pressable accessibilityLabel={`将${card.label}前移`} onPress={() => {
          const order = [...preferences.order]; const current = order.indexOf(id); [order[current - 1], order[current]] = [order[current], order[current - 1]]; update({ ...preferences, order });
        }} style={styles.move}><AppIcon name="arrow-back" color={colors.textMuted} size={14} /></Pressable> : null}
      </Pressable>;
    })}</View> : null}
  </View>;
}

function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (!minutes) return "0 分钟";
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} 小时 ${minutes % 60} 分钟` : `${minutes} 分钟`;
}

function formatDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} 公里` : `${Math.round(meters)} 米`;
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.panel, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: spacing.sm, padding: spacing.sm },
  header: { alignItems: "center", flexDirection: "row", gap: spacing.sm, padding: spacing.xs },
  title: { ...typography.section, color: colors.text },
  caption: { ...typography.caption, color: colors.textMuted },
  headerAction: { marginLeft: "auto", minHeight: 34, justifyContent: "center" },
  headerActionText: { ...typography.caption, color: colors.accent, fontWeight: "700" },
  collapse: { alignItems: "center", height: 36, justifyContent: "center", width: 36 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, flexBasis: "47%", flexGrow: 1, gap: spacing.sm, minHeight: 92, padding: spacing.sm },
  cardHeader: { alignItems: "center", flexDirection: "row", gap: spacing.xs },
  cardLabel: { ...typography.caption, color: colors.textMuted, flex: 1 },
  cardValue: { ...typography.label, color: colors.text, fontWeight: "800" },
  move: { alignItems: "center", bottom: 2, height: 24, justifyContent: "center", position: "absolute", right: 4, width: 24 },
  pressed: { opacity: 0.65 },
});
