import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { BlurView } from "expo-blur";
import Animated, { SlideInLeft, SlideOutLeft } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon } from "./AppIcon";
import { enterEasing, exitEasing, motionDurations } from "@/lib/motion";
import type { CalendarViewMode } from "@/screens/CalendarScreen";
import { colors, radius, shadows, spacing, typography } from "@/theme";

// Timing on the emphasized curves instead of a spring: the panel glides in
// and settles without wobble, and leaves faster than it arrived.
const PANEL_ENTERING = SlideInLeft.duration(motionDurations.panelEnter).easing(
  enterEasing,
);
const PANEL_EXITING = SlideOutLeft.duration(motionDurations.panelExit).easing(
  exitEasing,
);

export type AppSection =
  | "today"
  | "long-term"
  | "low-priority"
  | "analytics"
  | "calendar"
  | "mobility"
  | "sleep"
  | "passwords"
  | "ai"
  | "profile";

type AppDrawerProps = {
  activeSection: AppSection;
  calendarView: CalendarViewMode;
  currentDate: string;
  displayName: string;
  onChangeCalendarView: (view: CalendarViewMode) => void;
  onClose: () => void;
  onNavigate: (section: AppSection) => void;
  visible: boolean;
};

const navItems = [
  {
    key: "today",
    label: "我的一天",
    meta: "今日任务",
    icon: "sunny-outline",
  },
  {
    key: "long-term",
    label: "长期任务",
    meta: "每天持续显示",
    icon: "pricetag-outline",
  },
  {
    key: "low-priority",
    label: "低优先级",
    meta: "稍后处理",
    icon: "leaf-outline",
  },
  {
    key: "analytics",
    label: "分析",
    meta: "今日复盘",
    icon: "analytics-outline",
  },
  {
    key: "calendar",
    label: "日历",
    meta: "选择日期",
    icon: "calendar-outline",
  },
  {
    key: "mobility",
    label: "足迹地图",
    meta: "轨迹、步数与地点",
    icon: "map-outline",
  },
  {
    key: "sleep",
    label: "睡眠",
    meta: "手环数据 · Health Connect",
    icon: "moon-outline",
  },
  {
    key: "passwords",
    label: "密码管理",
    meta: "本机加密保存",
    icon: "key-outline",
  },
  {
    key: "ai",
    label: "AI 助手",
    meta: "自然语言管理",
    icon: "sparkles-outline",
  },
] as const;

export function AppDrawer({
  activeSection,
  calendarView,
  currentDate,
  displayName,
  onChangeCalendarView,
  onClose,
  onNavigate,
  visible,
}: AppDrawerProps) {
  const initial = displayName.trim().slice(0, 1).toUpperCase() || "D";

  function navigate(section: AppSection) {
    onNavigate(section);
    onClose();
  }

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}>
      <View style={styles.overlay}>
        <BlurView intensity={28} style={styles.scrim} tint="dark">
          <Pressable
            accessibilityLabel="关闭侧边栏"
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          />
        </BlurView>
        <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
          <Animated.View
            entering={PANEL_ENTERING}
            exiting={PANEL_EXITING}
            style={styles.panel}>
            <View style={styles.accountRow}>
              <Pressable
                accessibilityLabel="打开我的账户"
                onPress={() => navigate("profile")}
                style={({ pressed }) => [
                  styles.accountButton,
                  activeSection === "profile" && styles.accountButtonActive,
                  pressed && styles.pressed,
                ]}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initial}</Text>
                </View>
                <View style={styles.accountCopy}>
                  <Text numberOfLines={1} style={styles.accountName}>
                    {displayName}
                  </Text>
                  <Text style={styles.accountMeta}>账户与同步设置</Text>
                </View>
                <AppIcon
                  color={colors.textMuted}
                  name="chevron-forward"
                  size={18}
                />
              </Pressable>
              <Pressable
                accessibilityLabel="关闭侧边栏"
                onPress={onClose}
                style={({ pressed }) => [
                  styles.closeButton,
                  pressed && styles.pressed,
                ]}>
                <AppIcon color={colors.textMuted} name="close" size={22} />
              </Pressable>
            </View>

            <View style={styles.navigation}>
              {navItems.map((item) => {
                const active = activeSection === item.key;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    key={item.key}
                    onPress={() => navigate(item.key)}
                    style={({ pressed }) => [
                      styles.navItem,
                      active && styles.navItemActive,
                      pressed && styles.pressed,
                    ]}>
                    <View style={styles.navIcon}>
                      <AppIcon
                        color={colors.accent}
                        name={item.icon}
                        size={21}
                      />
                    </View>
                    <View style={styles.navCopy}>
                      <Text style={styles.navLabel}>{item.label}</Text>
                      <Text style={styles.navMeta}>{item.meta}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.viewSection}>
              <Text style={styles.sectionLabel}>日历视图</Text>
              <View style={styles.segmented}>
                {(["day", "week", "month"] as const).map((view) => {
                  const active = calendarView === view;
                  const label = view === "day" ? "日" : view === "week" ? "周" : "月";
                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      key={view}
                      onPress={() => {
                        onChangeCalendarView(view);
                        onNavigate("calendar");
                        onClose();
                      }}
                      style={({ pressed }) => [
                        styles.segment,
                        active && styles.segmentActive,
                        pressed && styles.pressed,
                      ]}>
                      <Text
                        style={[
                          styles.segmentText,
                          active && styles.segmentTextActive,
                        ]}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.currentDate}>
              <Text style={styles.sectionLabel}>当前日期</Text>
              <Text style={styles.currentDateValue}>{currentDate}</Text>
              <Text style={styles.currentDateHint}>日期仅在日历中切换</Text>
            </View>
          </Animated.View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: "row",
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(22, 27, 24, 0.18)",
  },
  safeArea: {
    width: "86%",
    maxWidth: 332,
  },
  panel: {
    ...shadows.floating,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRightWidth: 1,
    flex: 1,
    gap: spacing.xl,
    padding: spacing.lg,
  },
  accountRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  accountButton: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 56,
    padding: spacing.xs,
  },
  accountButtonActive: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  avatarText: {
    color: colors.white,
    fontSize: 17,
    fontWeight: "900",
  },
  accountCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  accountName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  accountMeta: {
    ...typography.caption,
    color: colors.textMuted,
  },
  closeButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  navigation: {
    gap: spacing.xs,
  },
  navItem: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 62,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  navItemActive: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  navIcon: {
    alignItems: "center",
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  navCopy: {
    flex: 1,
    gap: 2,
  },
  navLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  navMeta: {
    ...typography.caption,
    color: colors.textMuted,
  },
  viewSection: {
    gap: spacing.sm,
  },
  sectionLabel: {
    ...typography.label,
    color: colors.textMuted,
  },
  segmented: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  segment: {
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    borderColor: "transparent",
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 42,
  },
  segmentActive: {
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
  },
  segmentText: {
    ...typography.label,
    color: colors.textMuted,
  },
  segmentTextActive: {
    color: colors.accent,
    fontWeight: "800",
  },
  currentDate: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.xs,
    marginTop: "auto",
    paddingTop: spacing.lg,
  },
  currentDateValue: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
  },
  currentDateHint: {
    ...typography.caption,
    color: colors.textMuted,
  },
  pressed: {
    opacity: 0.62,
  },
});
