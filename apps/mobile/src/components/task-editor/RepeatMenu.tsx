import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { AppIcon } from "@/components/AppIcon";
import { ScreenEnter } from "@/components/ScreenEnter";
import { useBackPressKeyboardGuard } from "@/lib/keyboard";
import { repeatOptions, repeatUnitOptions } from "@/lib/task-repeat";
import { colors, radius, spacing, typography } from "@/theme";
import type { RepeatKind } from "@/types";

export function RepeatMenu({
  interval,
  isLongTerm,
  onChangeInterval,
  onClose,
  onSelect,
  repeatKind,
  visible,
}: {
  interval: string;
  isLongTerm: boolean;
  onChangeInterval: (value: string) => void;
  onClose: () => void;
  onSelect: (kind: RepeatKind) => void;
  repeatKind: RepeatKind;
  visible: boolean;
}) {
  const handleKeyboardGuard = useBackPressKeyboardGuard(onClose);
  return (
    <Modal
      animationType="fade"
      onRequestClose={handleKeyboardGuard}
      transparent
      visible={visible}>
      <View style={styles.menuBackdrop}>
        <Pressable
          accessibilityLabel="关闭重复设置"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <ScreenEnter style={styles.repeatMenu}>
          <View style={styles.sheetHandle} />
          <View style={styles.menuHeader}>
            <AppIcon name="repeat-outline" color={colors.accent} size={22} />
            <Text style={styles.menuTitle}>重复</Text>
          </View>
          <View style={styles.repeatList}>
            {repeatOptions.map((option) => {
              const selected = repeatKind === option.value;
              return (
                <Pressable
                  disabled={isLongTerm && option.value !== "daily"}
                  key={option.value}
                  onPress={() => {
                    onChangeInterval("1");
                    onSelect(option.value);
                  }}
                  accessibilityRole="button"
                  style={[
                    styles.repeatOption,
                    selected && styles.repeatOptionSelected,
                    isLongTerm && option.value !== "daily" && styles.optionDisabled,
                  ]}>
                  <Text style={[styles.repeatOptionText, selected && styles.optionTextSelected]}>
                    {option.label}
                  </Text>
                  <AppIcon
                    name={selected ? "checkmark-circle" : "ellipse-outline"}
                    color={selected ? colors.accent : colors.borderStrong}
                    size={20}
                  />
                </Pressable>
              );
            })}
          </View>
          <View style={styles.customRepeat}>
            <View style={styles.customRepeatHeader}>
              <AppIcon name="options-outline" color={colors.textMuted} size={19} />
              <Text style={styles.customRepeatTitle}>自定义</Text>
            </View>
            <View style={styles.customRepeatControls}>
              <Text style={styles.customRepeatText}>每</Text>
              <TextInput
                accessibilityLabel="重复间隔"
                editable={!isLongTerm}
                keyboardType="number-pad"
                maxLength={2}
                onChangeText={(value) => onChangeInterval(value.replace(/[^0-9]/g, ""))}
                selectTextOnFocus
                style={styles.intervalInput}
                value={interval}
              />
              <View style={styles.unitSelector}>
                {repeatUnitOptions.map((unit) => {
                  const selected = repeatKind === unit.value;
                  return (
                    <Pressable
                      accessibilityLabel={`每${unit.label}重复`}
                      accessibilityRole="button"
                      disabled={isLongTerm}
                      key={unit.value}
                      onPress={() => onSelect(unit.value)}
                      style={[styles.unitOption, selected && styles.unitOptionSelected]}>
                      <Text style={[styles.unitText, selected && styles.unitTextSelected]}>
                        {unit.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={styles.menuDoneButton}>
            <Text style={styles.menuDoneText}>完成</Text>
          </Pressable>
        </ScreenEnter>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  menuBackdrop: {
    backgroundColor: "rgba(22, 27, 24, 0.48)",
    flex: 1,
    justifyContent: "flex-end",
  },
  repeatMenu: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  sheetHandle: {
    alignSelf: "center",
    backgroundColor: colors.borderStrong,
    borderRadius: radius.full,
    height: 4,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
    width: 38,
  },
  menuHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 44,
  },
  menuTitle: {
    ...typography.section,
    color: colors.text,
    fontSize: 19,
  },
  repeatList: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  repeatOption: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 44,
    paddingHorizontal: spacing.xs,
  },
  repeatOptionSelected: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.sm,
  },
  repeatOptionText: {
    ...typography.body,
    color: colors.text,
  },
  optionDisabled: {
    opacity: 0.58,
  },
  optionTextSelected: {
    color: colors.accent,
  },
  customRepeat: {
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  customRepeatHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  customRepeatTitle: {
    ...typography.label,
    color: colors.text,
  },
  customRepeatControls: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  customRepeatText: {
    ...typography.body,
    color: colors.textMuted,
  },
  intervalInput: {
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    height: 42,
    paddingHorizontal: spacing.sm,
    textAlign: "center",
    width: 52,
  },
  unitSelector: {
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    overflow: "hidden",
  },
  unitOption: {
    alignItems: "center",
    flex: 1,
    height: 42,
    justifyContent: "center",
  },
  unitOptionSelected: {
    backgroundColor: colors.accentSoft,
  },
  unitText: {
    ...typography.label,
    color: colors.textMuted,
  },
  unitTextSelected: {
    color: colors.accent,
  },
  menuDoneButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    justifyContent: "center",
    minHeight: 46,
  },
  menuDoneText: {
    ...typography.label,
    color: colors.white,
    fontSize: 15,
  },
});
