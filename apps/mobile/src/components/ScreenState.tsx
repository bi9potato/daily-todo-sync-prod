import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon } from "./AppIcon";
import { colors, radius, spacing, typography } from "@/theme";

export function LoadingState({ label = "正在同步…" }: { label?: string }) {
  return (
    <View style={styles.container}>
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.message}>{label}</Text>
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <View style={styles.container}>
      <AppIcon name="cloud-offline-outline" color={colors.textMuted} size={30} />
      <Text style={styles.message}>{message}</Text>
      <Pressable onPress={onRetry} style={styles.retryButton}>
        <Text style={styles.retryText}>重试</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    flex: 1,
    gap: spacing.md,
    justifyContent: "center",
    padding: spacing.xl,
  },
  message: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: "center",
  },
  retryButton: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  retryText: {
    ...typography.label,
    color: colors.accent,
  },
});
