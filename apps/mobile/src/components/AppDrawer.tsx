import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { SlideInLeft, SlideOutLeft } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
  { key: "today", label: "我的一天", icon: "sunny-outline" },
  { key: "long-term", label: "长期任务", icon: "pricetag-outline" },
  { key: "low-priority", label: "低优先级", icon: "leaf-outline" },
  { key: "analytics", label: "分析", icon: "analytics-outline" },
  { key: "calendar", label: "日历", icon: "calendar-outline" },
  { key: "mobility", label: "足迹地图", icon: "map-outline" },
  { key: "sleep", label: "睡眠", icon: "moon-outline" },
  { key: "passwords", label: "密码管理", icon: "key-outline" },
  { key: "ai", label: "AI 助手", icon: "sparkles-outline" },
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
  const insets = useSafeAreaInsets();
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
        <BlurView intensity={26} style={styles.scrim} tint="dark">
          <Pressable
            accessibilityLabel="关闭侧边栏"
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          />
        </BlurView>
        {/* insets applied on the panel itself (rather than a SafeAreaView,
            which under-reports inside a translucent Modal on Android) so the
            content clears the status bar and gesture bar. */}
        <Animated.View
          entering={PANEL_ENTERING}
          exiting={PANEL_EXITING}
          style={[
            styles.panel,
            {
              paddingTop: insets.top + spacing.lg,
              paddingBottom: insets.bottom + spacing.md,
            },
          ]}>
          <Pressable
            accessibilityLabel="打开我的账户"
            onPress={() => navigate("profile")}
            style={({ pressed }) => [
              styles.account,
              activeSection === "profile" && styles.accountActive,
              pressed && styles.pressed,
            ]}>
            <LinearGradient
              colors={[colors.accent, colors.accentPressed]}
              end={{ x: 1, y: 1 }}
              start={{ x: 0, y: 0 }}
              style={styles.avatar}>
              <Text style={styles.avatarText}>{initial}</Text>
            </LinearGradient>
            <View style={styles.accountCopy}>
              <Text numberOfLines={1} style={styles.accountName}>
                {displayName}
              </Text>
              <Text style={styles.accountMeta}>账户与同步设置</Text>
            </View>
            <AppIcon color={colors.textMuted} name="chevron-forward" size={18} />
          </Pressable>

          <View style={styles.divider} />

          <ScrollView
            contentContainerStyle={styles.scrollBody}
            showsVerticalScrollIndicator={false}
            style={styles.scroll}>
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
                    <AppIcon
                      color={active ? colors.accent : colors.textMuted}
                      name={item.icon}
                      size={21}
                    />
                    <Text
                      numberOfLines={1}
                      style={[styles.navLabel, active && styles.navLabelActive]}>
                      {item.label}
                    </Text>
                    {active ? <View style={styles.activeDot} /> : null}
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.viewSection}>
              <Text style={styles.sectionLabel}>日历视图</Text>
              <View style={styles.segmented}>
                {(["day", "week", "month"] as const).map((view) => {
                  const active = calendarView === view;
                  const label =
                    view === "day" ? "日" : view === "week" ? "周" : "月";
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
          </ScrollView>

          <View style={styles.footer}>
            <Text style={styles.sectionLabel}>当前日期</Text>
            <Text style={styles.footerDate}>{currentDate}</Text>
          </View>
        </Animated.View>
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
    backgroundColor: "rgba(22, 27, 24, 0.22)",
  },
  panel: {
    // No flex here: in the row-direction overlay, flex:1 would stretch the
    // panel to full width and swallow the tap-to-close scrim. Width sets the
    // horizontal size; the default cross-axis stretch gives it full height.
    ...shadows.floating,
    backgroundColor: colors.surface,
    borderRightColor: colors.border,
    borderRightWidth: StyleSheet.hairlineWidth,
    maxWidth: 320,
    paddingHorizontal: spacing.md,
    width: "84%",
  },
  account: {
    alignItems: "center",
    borderRadius: radius.lg,
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.sm,
  },
  accountActive: {
    backgroundColor: colors.surfaceMuted,
  },
  avatar: {
    alignItems: "center",
    borderRadius: radius.full,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  avatarText: {
    color: colors.white,
    fontSize: 18,
    fontWeight: "800",
  },
  accountCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  accountName: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  accountMeta: {
    ...typography.caption,
    color: colors.textMuted,
  },
  divider: {
    backgroundColor: colors.border,
    height: StyleSheet.hairlineWidth,
    marginBottom: spacing.sm,
  },
  scroll: {
    flex: 1,
  },
  scrollBody: {
    gap: spacing.xl,
    paddingVertical: spacing.sm,
  },
  navigation: {
    gap: 2,
  },
  navItem: {
    alignItems: "center",
    borderRadius: radius.md,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 50,
    paddingHorizontal: spacing.md,
  },
  navItemActive: {
    backgroundColor: colors.accentSoft,
  },
  navLabel: {
    color: colors.text,
    flex: 1,
    fontSize: 15.5,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  navLabelActive: {
    color: colors.accent,
    fontWeight: "800",
  },
  activeDot: {
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    height: 7,
    width: 7,
  },
  viewSection: {
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  sectionLabel: {
    ...typography.label,
    color: colors.textMuted,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  segmented: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    flexDirection: "row",
    gap: spacing.xs,
    padding: spacing.xs,
  },
  segment: {
    alignItems: "center",
    borderRadius: radius.sm,
    flex: 1,
    justifyContent: "center",
    minHeight: 40,
  },
  segmentActive: {
    ...shadows.card,
    backgroundColor: colors.surface,
  },
  segmentText: {
    ...typography.label,
    color: colors.textMuted,
  },
  segmentTextActive: {
    color: colors.accent,
    fontWeight: "800",
  },
  footer: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.md,
  },
  footerDate: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.6,
  },
});
