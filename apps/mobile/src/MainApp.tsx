import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import { AppDrawer, type AppSection } from "@/components/AppDrawer";
import { AppIcon } from "@/components/AppIcon";
import { getMe } from "@/lib/api";
import { toDateKey } from "@/lib/date";
import { useMobilityRuntime } from "@/lib/useMobilityRuntime";
import { AiScreen } from "@/screens/AiScreen";
import { AnalyticsScreen } from "@/screens/AnalyticsScreen";
import {
  CalendarScreen,
  type CalendarViewMode,
} from "@/screens/CalendarScreen";
import { ProfileScreen } from "@/screens/ProfileScreen";
import { MobilityScreen } from "@/screens/MobilityScreen";
import { TodayScreen } from "@/screens/TodayScreen";
import { colors, radius, shadows, spacing, typography } from "@/theme";

export function MainApp() {
  const today = toDateKey(new Date());
  const [activeSection, setActiveSection] = useState<AppSection>("today");
  const mobilityRuntime = useMobilityRuntime(today);
  const [calendarView, setCalendarView] = useState<CalendarViewMode>("week");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(today);
  const meQuery = useQuery({ queryKey: ["me"], queryFn: getMe });
  const displayName =
    meQuery.data?.displayName || meQuery.data?.username || "Daily Todo";

  function openDate(date: string) {
    setSelectedDate(date);
    setActiveSection("today");
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
      <View style={styles.appBar}>
        <Pressable
          accessibilityLabel="打开侧边栏"
          onPress={() => setDrawerOpen(true)}
          style={({ pressed }) => [
            styles.menuButton,
            pressed && styles.pressed,
          ]}>
          <AppIcon color={colors.textMuted} name="menu" size={23} />
        </Pressable>
        <View style={styles.appBarCopy}>
          <Text numberOfLines={1} style={styles.appBarName}>
            {displayName}
          </Text>
          <Text style={styles.appBarProduct}>Daily Todo Sync</Text>
        </View>
      </View>
      <View style={styles.content}>
        {activeSection === "today" ? (
          <TodayScreen
            selectedDate={selectedDate}
          />
        ) : null}
        {activeSection === "long-term" ? (
          <TodayScreen selectedDate={today} viewMode="long-term" />
        ) : null}
        {activeSection === "low-priority" ? (
          <TodayScreen selectedDate={today} viewMode="low-priority" />
        ) : null}
        {activeSection === "analytics" ? (
          <AnalyticsScreen today={today} />
        ) : null}
        {activeSection === "calendar" ? (
          <CalendarScreen
            mode={calendarView}
            onOpenDate={openDate}
            onSelectDate={setSelectedDate}
            selectedDate={selectedDate}
            today={today}
          />
        ) : null}
        {activeSection === "mobility" ? (
          <MobilityScreen runtime={mobilityRuntime} today={today} />
        ) : null}
        {activeSection === "ai" ? <AiScreen selectedDate={selectedDate} /> : null}
        {activeSection === "profile" ? <ProfileScreen /> : null}
      </View>
      <AppDrawer
        activeSection={activeSection}
        calendarView={calendarView}
        currentDate={selectedDate}
        displayName={displayName}
        onChangeCalendarView={setCalendarView}
        onClose={() => setDrawerOpen(false)}
        onNavigate={setActiveSection}
        visible={drawerOpen}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  appBar: {
    ...shadows.panel,
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    minHeight: 58,
    paddingHorizontal: spacing.sm,
    zIndex: 2,
  },
  menuButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  appBarCopy: {
    flex: 1,
    gap: 1,
    minWidth: 0,
  },
  appBarName: {
    ...typography.label,
    color: colors.text,
    fontWeight: "800",
  },
  appBarProduct: {
    ...typography.caption,
    color: colors.textMuted,
  },
  content: {
    backgroundColor: colors.background,
    flex: 1,
  },
  pressed: {
    opacity: 0.62,
  },
});
