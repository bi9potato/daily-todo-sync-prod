import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Drawer } from "expo-router/drawer";
import type { DrawerHeaderProps } from "expo-router/drawer";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppDrawerContent } from "@/components/AppDrawerContent";
import { AppIcon } from "@/components/AppIcon";
import { AppShellProvider, useAppShell } from "@/lib/app-shell";
import { colors, radius, shadows, spacing, typography } from "@/theme";

// Without this, expo-router falls back to the first route alphabetically --
// which is `ai` -- whenever the (app) group mounts without an explicit path
// (process restore, notification taps, back navigation collapsing the
// stack). "My day" is the app's home.
export const unstable_settings = {
  initialRouteName: "today",
};

export default function AppGroupLayout() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // A numeric width (not a "84%" string) so the underlying drawer-layout can
  // compute the open/close translation; capped so it never gets absurdly wide
  // on tablets.
  const drawerWidth = Math.min(320, Math.round(width * 0.84));

  return (
    <AppShellProvider>
      <Drawer
        drawerContent={(props) => <AppDrawerContent {...props} />}
        initialRouteName="today"
        backBehavior="initialRoute"
        screenOptions={{
          drawerStyle: {
            backgroundColor: colors.surface,
            borderRightColor: colors.border,
            borderRightWidth: StyleSheet.hairlineWidth,
            width: drawerWidth,
          },
          // `front` on every platform matches the old Modal drawer that
          // overlaid the whole screen (iOS would otherwise default to `slide`).
          drawerType: "front",
          header: (props) => <AppBar {...props} />,
          headerShown: true,
          overlayColor: "rgba(22, 27, 24, 0.4)",
          // Reproduce the bottom safe-area padding the old shared SafeAreaView
          // gave every screen, so nothing sits under the gesture/nav bar.
          sceneStyle: {
            backgroundColor: colors.background,
            paddingBottom: insets.bottom,
          },
        }}
      />
    </AppShellProvider>
  );
}

function AppBar({ navigation }: DrawerHeaderProps) {
  const insets = useSafeAreaInsets();
  const { displayName } = useAppShell();

  return (
    <View style={[styles.headerSafeArea, { paddingTop: insets.top }]}>
      <View style={styles.appBar}>
        <Pressable
          accessibilityLabel="打开侧边栏"
          onPress={() => navigation.openDrawer()}
          style={({ pressed }) => [styles.menuButton, pressed && styles.pressed]}>
          <AppIcon color={colors.textMuted} name="menu" size={23} />
        </Pressable>
        <View style={styles.appBarCopy}>
          <Text numberOfLines={1} style={styles.appBarName}>
            {displayName}
          </Text>
          <Text style={styles.appBarProduct}>Daily Todo Sync</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerSafeArea: {
    backgroundColor: colors.background,
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
  pressed: {
    opacity: 0.62,
  },
});
