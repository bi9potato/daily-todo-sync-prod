import { useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import { AppIcon } from "./AppIcon";
import { colors, radius, spacing } from "@/theme";

type ComposerProps = {
  isPending: boolean;
  onSubmit: (text: string) => Promise<void>;
};

export function Composer({ isPending, onSubmit }: ComposerProps) {
  const [text, setText] = useState("");

  async function submit() {
    const value = text.trim();
    if (!value || isPending) {
      return;
    }
    await onSubmit(value);
    setText("");
    Keyboard.dismiss();
  }

  return (
    <View style={styles.wrapper}>
      <View style={styles.container}>
        <AppIcon name="add-circle-outline" color={colors.accent} size={27} />
        <TextInput
          accessibilityLabel="添加任务"
          autoCapitalize="sentences"
          blurOnSubmit={false}
          editable={!isPending}
          onChangeText={setText}
          onSubmitEditing={submit}
          placeholder="添加任务…"
          placeholderTextColor={colors.textMuted}
          returnKeyType="done"
          style={styles.input}
          value={text}
        />
        <Pressable
          accessibilityLabel="保存任务"
          accessibilityRole="button"
          disabled={!text.trim() || isPending}
          onPress={submit}
          style={({ pressed }) => [
            styles.submit,
            (!text.trim() || isPending) && styles.submitDisabled,
            pressed && styles.submitPressed,
          ]}>
          {isPending ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <AppIcon name="arrow-up" color={colors.white} size={20} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: colors.background,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  container: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  input: {
    color: colors.text,
    flex: 1,
    fontSize: 16,
    paddingVertical: 10,
  },
  submit: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  submitDisabled: {
    opacity: 0.38,
  },
  submitPressed: {
    backgroundColor: colors.accentPressed,
  },
});
