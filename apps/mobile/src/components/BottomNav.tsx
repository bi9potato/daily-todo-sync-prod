import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon } from "./AppIcon";
import { colors, typography } from "@/theme";

export type MainTab = "today" | "calendar" | "ai" | "profile";

const tabs = [
  { key: "today", label: "今天", icon: "checkmark-circle-outline" },
  { key: "calendar", label: "日历", icon: "calendar-outline" },
  { key: "ai", label: "AI", icon: "sparkles-outline" },
  { key: "profile", label: "我的", icon: "person-outline" },
] as const;

type BottomNavProps = {
  activeTab: MainTab;
  onChange: (tab: MainTab) => void;
};

export function BottomNav({ activeTab, onChange }: BottomNavProps) {
  return (
    <View style={styles.container}>
      {tabs.map((tab) => {
        const active = activeTab === tab.key;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
            <AppIcon
              name={tab.icon}
              color={active ? colors.accent : colors.textMuted}
              size={24}
            />
            <Text style={[styles.label, active && styles.activeLabel]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 64,
  },
  tab: {
    alignItems: "center",
    flex: 1,
    gap: 2,
    justifyContent: "center",
    minHeight: 56,
  },
  pressed: {
    opacity: 0.58,
  },
  label: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: "500",
  },
  activeLabel: {
    color: colors.accent,
    fontWeight: "700",
  },
});
