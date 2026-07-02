import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, usePathname } from "expo-router";

import { AppDrawer } from "@/components/AppDrawer";
import { AppIcon } from "@/components/AppIcon";
import { AppShellProvider, useAppShell } from "@/lib/app-shell";
import { sectionForPath } from "@/lib/app-routes";
import { colors, radius, shadows, spacing, typography } from "@/theme";

export default function AppGroupLayout() {
  return (
    <AppShellProvider>
      <AppShell />
    </AppShellProvider>
  );
}

function AppShell() {
  const {
    calendarView,
    closeDrawer,
    displayName,
    drawerOpen,
    navigateToSection,
    openDrawer,
    selectedDate,
    setCalendarView,
  } = useAppShell();
  const pathname = usePathname();
  const activeSection = sectionForPath(pathname);

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
      <View style={styles.appBar}>
        <Pressable
          accessibilityLabel="打开侧边栏"
          onPress={openDrawer}
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
        <Stack screenOptions={{ animation: "fade", headerShown: false }} />
      </View>
      <AppDrawer
        activeSection={activeSection}
        calendarView={calendarView}
        currentDate={selectedDate}
        displayName={displayName}
        onChangeCalendarView={setCalendarView}
        onClose={closeDrawer}
        onNavigate={navigateToSection}
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
