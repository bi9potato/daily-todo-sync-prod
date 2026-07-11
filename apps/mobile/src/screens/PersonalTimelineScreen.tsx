import { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { AppIcon } from "@/components/AppIcon";
import { ErrorState, LoadingState } from "@/components/ScreenState";
import { getDay, getDeviceTimelineDay, getMobilityDay } from "@/lib/api";
import { addDays, formatLongDate } from "@/lib/date";
import { expenseTracking, isExpenseTrackingAvailable } from "@/lib/expense-tracking";
import { buildPersonalTimeline, type PersonalTimelineSource } from "@/lib/personal-timeline";
import { colors, radius, shadows, spacing, typography } from "@/theme";

const FILTERS: { id: PersonalTimelineSource; label: string }[] = [
  { id: "task", label: "任务" },
  { id: "location", label: "位置" },
  { id: "device", label: "设备" },
  { id: "expense", label: "收支" },
];

export function PersonalTimelineScreen({ today }: { today: string }) {
  const [date, setDate] = useState(today);
  const [collapsed, setCollapsed] = useState(false);
  const [enabled, setEnabled] = useState<PersonalTimelineSource[]>(FILTERS.map((item) => item.id));
  const tasks = useQuery({ queryKey: ["day", date], queryFn: () => getDay(date) });
  const mobility = useQuery({ queryKey: ["mobility-day", date], queryFn: () => getMobilityDay(date) });
  const device = useQuery({ queryKey: ["device-timeline-day", date], queryFn: () => getDeviceTimelineDay(date) });
  const expenses = useQuery({ queryKey: ["expense-day", date, "timeline"], queryFn: () => expenseTracking.getTransactions(date), enabled: Platform.OS === "android" && isExpenseTrackingAvailable() });
  const events = useMemo(
    () => buildPersonalTimeline({
      tasks: tasks.data,
      mobilitySegments: mobility.data?.segments ?? [],
      deviceItems: device.data?.timeline ?? [],
      expenses: expenses.data?.transactions ?? [],
    }).filter((event) => enabled.includes(event.source)),
    [device.data?.timeline, enabled, expenses.data?.transactions, mobility.data?.segments, tasks.data],
  );
  const pending = tasks.isPending || mobility.isPending || device.isPending;
  const error = tasks.error || mobility.error || device.error;

  return <View style={styles.page}>
    <View style={styles.header}>
      <View><Text style={styles.title}>个人时间线</Text><Text style={styles.subtitle}>任务、位置、设备与收支在本机按时间组合</Text></View>
    </View>
    <View style={styles.dateBar}>
      <Pressable accessibilityLabel="前一天" onPress={() => setDate((value) => addDays(value, -1))} style={styles.dateButton}><AppIcon name="chevron-back" color={colors.accent} size={20} /></Pressable>
      <Pressable onPress={() => setCollapsed((value) => !value)} style={styles.dateCopy}><Text style={styles.dateText}>{formatLongDate(date)}</Text><Text style={styles.eventCount}>{events.length} 个事件 · {collapsed ? "点击展开" : "点击收起"}</Text></Pressable>
      <Pressable accessibilityLabel="后一天" disabled={date >= today} onPress={() => setDate((value) => addDays(value, 1))} style={[styles.dateButton, date >= today && styles.disabled]}><AppIcon name="chevron-forward" color={colors.accent} size={20} /></Pressable>
    </View>
    <View style={styles.filters}>{FILTERS.map((filter) => {
      const active = enabled.includes(filter.id);
      return <Pressable key={filter.id} onPress={() => setEnabled((current) => active ? current.filter((id) => id !== filter.id) : [...current, filter.id])} style={[styles.filter, active && styles.filterActive]}><Text style={[styles.filterText, active && styles.filterTextActive]}>{filter.label}</Text></Pressable>;
    })}</View>
    <View style={styles.privacy}><AppIcon name="lock-closed-outline" color={colors.accent} size={17} /><Text style={styles.privacyText}>收支仅在本机组合；带云朵标记的数据已同步服务器。</Text></View>
    {pending ? <LoadingState /> : error ? <ErrorState message={error.message} onRetry={() => { void tasks.refetch(); void mobility.refetch(); void device.refetch(); }} /> : collapsed ? null : (
      <ScrollView contentContainerStyle={styles.events} showsVerticalScrollIndicator={false}>
        {events.length ? events.map((event, index) => <View key={event.id} style={styles.event}>
          <View style={styles.rail}><View style={styles.dot} />{index < events.length - 1 ? <View style={styles.line} /> : null}</View>
          <View style={styles.eventCard}>
            <View style={styles.eventHeader}><AppIcon name={sourceIcon(event.source)} color={colors.accent} size={18} /><Text style={styles.eventTitle}>{event.title}</Text><Text style={styles.time}>{formatTime(event.timestamp)}</Text></View>
            <Text style={styles.detail}>{event.detail}</Text>
            <View style={styles.sync}><AppIcon name={event.synced ? "cloud-done-outline" : "phone-portrait-outline"} color={colors.textMuted} size={14} /><Text style={styles.syncText}>{event.synced ? "已同步" : "仅本机"}</Text></View>
          </View>
        </View>) : <View style={styles.empty}><AppIcon name="time-outline" color={colors.textMuted} size={30} /><Text style={styles.emptyText}>当前筛选条件下没有事件</Text></View>}
      </ScrollView>
    )}
  </View>;
}

function sourceIcon(source: PersonalTimelineSource): React.ComponentProps<typeof AppIcon>["name"] {
  return { task: "checkmark-circle-outline", location: "location-outline", device: "phone-portrait-outline", expense: "wallet-outline" }[source] as React.ComponentProps<typeof AppIcon>["name"];
}
function formatTime(value: string) { return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }); }

const styles = StyleSheet.create({
  page: { backgroundColor: colors.background, flex: 1, padding: spacing.md, gap: spacing.sm },
  header: { ...shadows.card, backgroundColor: colors.panel, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, padding: spacing.md },
  title: { ...typography.title, color: colors.text }, subtitle: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  dateBar: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, flexDirection: "row" },
  dateButton: { alignItems: "center", height: 52, justifyContent: "center", width: 48 }, disabled: { opacity: 0.3 }, dateCopy: { alignItems: "center", flex: 1, padding: spacing.xs }, dateText: { ...typography.label, color: colors.text }, eventCount: { ...typography.caption, color: colors.textMuted },
  filters: { flexDirection: "row", gap: spacing.xs }, filter: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.full, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }, filterActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent }, filterText: { ...typography.caption, color: colors.textMuted }, filterTextActive: { color: colors.accent, fontWeight: "800" },
  privacy: { alignItems: "center", flexDirection: "row", gap: spacing.xs, paddingHorizontal: spacing.xs }, privacyText: { ...typography.caption, color: colors.textMuted, flex: 1 },
  events: { paddingBottom: spacing.xxl }, event: { flexDirection: "row", minHeight: 82 }, rail: { alignItems: "center", width: 24 }, dot: { backgroundColor: colors.accent, borderRadius: radius.full, height: 10, marginTop: 18, width: 10 }, line: { backgroundColor: colors.borderStrong, flex: 1, width: 2 }, eventCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, flex: 1, gap: spacing.xs, marginBottom: spacing.sm, padding: spacing.md }, eventHeader: { alignItems: "center", flexDirection: "row", gap: spacing.xs }, eventTitle: { ...typography.label, color: colors.text, flex: 1 }, time: { ...typography.caption, color: colors.textMuted }, detail: { ...typography.body, color: colors.text }, sync: { alignItems: "center", flexDirection: "row", gap: 3 }, syncText: { ...typography.caption, color: colors.textMuted }, empty: { alignItems: "center", gap: spacing.sm, padding: spacing.xxl }, emptyText: { ...typography.body, color: colors.textMuted },
});
