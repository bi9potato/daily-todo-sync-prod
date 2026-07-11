import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { usePathname } from "expo-router";
import {
  DrawerContentScrollView,
  type DrawerContentComponentProps,
} from "expo-router/drawer";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppIcon } from "./AppIcon";
import { sectionForPath, type AppSection } from "@/lib/app-routes";
import { useAppShell } from "@/lib/app-shell";
import { colors, radius, shadows, spacing, typography } from "@/theme";

const navItems = [
  { key: "today", label: "我的一天", icon: "sunny-outline", group: "任务" },
  { key: "long-term", label: "长期任务", icon: "pricetag-outline", group: "任务" },
  { key: "low-priority", label: "低优先级", icon: "leaf-outline", group: "任务" },
  { key: "analytics", label: "分析", icon: "analytics-outline" },
  { key: "calendar", label: "日历", icon: "calendar-outline" },
  { key: "mobility", label: "足迹地图", icon: "map-outline", group: "生活记录" },
  { key: "device-timeline", label: "设备时间线", icon: "time-outline", group: "生活记录" },
  { key: "expenses", label: "每日收支", icon: "wallet-outline", group: "生活记录" },
  { key: "services", label: "权限与后台服务", icon: "shield-checkmark-outline", group: "系统" },
  { key: "sleep", label: "睡眠", icon: "moon-outline" },
  { key: "passwords", label: "密码管理", icon: "key-outline" },
  { key: "ai", label: "AI 助手", icon: "sparkles-outline" },
] as const;

type NavItemKey = (typeof navItems)[number]["key"];

const androidHiddenNavItems: ReadonlySet<NavItemKey> = new Set([
  "analytics",
  "calendar",
  "sleep",
  "passwords",
  "ai",
]);

// The reverse of the set above: features with no non-Android implementation
// at all (device-timeline has no iOS/web native service, unlike mobility
// which supports iOS through expo-task-manager).
const androidOnlyNavItems: ReadonlySet<NavItemKey> = new Set([
  "device-timeline",
  "expenses",
  "services",
]);

const platformNavItems = navItems.filter((item) =>
  Platform.OS === "android"
    ? !androidHiddenNavItems.has(item.key)
    : !androidOnlyNavItems.has(item.key),
);

const androidNavGroups = (["任务", "生活记录", "系统"] as const).map(
  (label) => ({
    label,
    items: platformNavItems.filter(
      (item) => "group" in item && item.group === label,
    ),
  }),
);

// Content of the app's navigation drawer. Rendered by expo-router's <Drawer>
// (via its `drawerContent` prop), which owns the panel chrome, safe areas,
// full-screen height, and swipe-to-open gesture. Wrapping the body in
// DrawerContentScrollView is what makes the nav list scroll when it can't fit
// - the hand-rolled Modal it replaced sized its inner ScrollView from an
// unbounded parent and stopped scrolling on short screens.
export function AppDrawerContent({ navigation }: DrawerContentComponentProps) {
  const insets = useSafeAreaInsets();
  const { calendarView, setCalendarView, displayName, selectedDate, navigateToSection } =
    useAppShell();
  const pathname = usePathname();
  const activeSection = sectionForPath(pathname);
  const initial = displayName.trim().slice(0, 1).toUpperCase() || "D";
  const drawerNavigation = navigation as typeof navigation & {
    addListener: (event: "drawerClose", listener: () => void) => () => void;
  };

  // Close first, navigate after: router.replace() swaps the active drawer
  // screen, which is heavy enough (a re-render of the whole (app) group)
  // that firing it in the same tick as closeDrawer() could occasionally
  // interrupt the drawer's own close animation/gesture settle before it
  // finished - the screen changed but the panel visually stayed open.
  // The drawerClose lifecycle event guarantees its animation has finished.
  function go(section: AppSection) {
    const unsubscribe = drawerNavigation.addListener("drawerClose", () => {
      unsubscribe();
      navigateToSection(section);
    });
    navigation.closeDrawer();
  }

  function renderNavItem(item: (typeof navItems)[number]) {
    const active = activeSection === item.key;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        key={item.key}
        onPress={() => go(item.key)}
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
  }

  return (
    <View style={styles.container}>
      <DrawerContentScrollView
        contentContainerStyle={styles.scrollBody}
        showsVerticalScrollIndicator={false}>
        <Pressable
          accessibilityLabel="打开我的账户"
          onPress={() => go("profile")}
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

        <View style={styles.navigation}>
          {Platform.OS === "android"
            ? androidNavGroups.map((group) => (
                <View key={group.label} style={styles.navGroup}>
                  <Text style={styles.navGroupLabel}>{group.label}</Text>
                  {group.items.map(renderNavItem)}
                </View>
              ))
            : platformNavItems.map(renderNavItem)}
        </View>

        {Platform.OS !== "android" ? <View style={styles.viewSection}>
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
                    setCalendarView(view);
                    go("calendar");
                  }}
                  style={({ pressed }) => [
                    styles.segment,
                    active && styles.segmentActive,
                    pressed && styles.pressed,
                  ]}>
                  <Text
                    style={[styles.segmentText, active && styles.segmentTextActive]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View> : null}
      </DrawerContentScrollView>

      {/* Pinned outside the scroll so the current date stays visible; it owns
          the bottom safe-area inset since it sits below the scroll view. */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Text style={styles.sectionLabel}>当前日期</Text>
        <Text style={styles.footerDate}>{selectedDate}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollBody: {
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.md,
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
  navigation: {
    gap: 2,
  },
  navGroup: {
    gap: 2,
    marginBottom: spacing.sm,
  },
  navGroupLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: "800",
    letterSpacing: 0.8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
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
    marginTop: spacing.xl,
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
    paddingHorizontal: spacing.md + spacing.xs,
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
