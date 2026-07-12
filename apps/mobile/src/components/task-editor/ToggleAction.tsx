import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon } from "@/components/AppIcon";
import { colors, radius, typography } from "@/theme";

export function ToggleAction({
  icon,
  label,
  onPress,
  selected,
}: {
  icon: React.ComponentProps<typeof AppIcon>["name"];
  label: string;
  onPress: () => void;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.toggleAction,
        pressed && styles.pressed,
      ]}>
      <View style={[styles.toggleIcon, selected && styles.toggleIconSelected]}>
        <AppIcon
          name={selected && icon === "bookmark-outline" ? "bookmark" : icon}
          color={selected ? colors.accent : colors.textMuted}
          size={21}
        />
      </View>
      <Text numberOfLines={1} style={[styles.toggleActionText, selected && styles.toggleActionTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toggleAction: {
    alignItems: "center",
    flex: 1,
    gap: 2,
    justifyContent: "center",
    minHeight: 52,
    minWidth: 0,
  },
  toggleIcon: {
    alignItems: "center",
    borderRadius: radius.md,
    height: 30,
    justifyContent: "center",
    width: 40,
  },
  toggleIconSelected: {
    backgroundColor: colors.accentSoft,
  },
  toggleActionText: {
    ...typography.caption,
    color: colors.textMuted,
    maxWidth: "100%",
  },
  toggleActionTextSelected: {
    color: colors.accent,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.64,
  },
});
