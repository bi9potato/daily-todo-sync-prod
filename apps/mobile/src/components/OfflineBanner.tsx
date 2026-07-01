import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppIcon } from "./AppIcon";
import { useIsOnline } from "@/lib/network";
import { useQueuedTodoMutationCount } from "@/lib/todo-mutation-queue";
import { colors, radius, spacing, typography } from "@/theme";

export function OfflineBanner() {
  const isOnline = useIsOnline();
  const queuedCount = useQueuedTodoMutationCount();
  const insets = useSafeAreaInsets();

  if (isOnline) {
    return null;
  }

  return (
    <View
      pointerEvents="none"
      // Anchored near the top (below the status bar/notch) rather than the
      // bottom, since several screens (AI chat, the task composer) already
      // anchor their own input bars to the bottom of the screen.
      style={[styles.container, { top: insets.top + spacing.sm }]}>
      <AppIcon name="cloud-offline-outline" color={colors.white} size={14} />
      <Text style={styles.text}>
        {queuedCount > 0
          ? `离线模式 · 待同步 ${queuedCount} 项`
          : "离线模式 · 更改会在联网后自动同步"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    backgroundColor: colors.textMuted,
    borderRadius: radius.full,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    left: spacing.lg,
    paddingHorizontal: 12,
    paddingVertical: 7,
    position: "absolute",
    right: spacing.lg,
  },
  text: {
    ...typography.caption,
    color: colors.white,
  },
});
