import { useState } from "react";
import DateTimePicker from "@react-native-community/datetimepicker";
import dayjs from "dayjs";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppIcon } from "./AppIcon";
import { useKeyboardControllerShim } from "@/lib/useKeyboardControllerShim";
import { isVoiceCommandSessionActive } from "@/lib/voice-session";
import { colors, radius, spacing } from "@/theme";

type ComposerMode = "task" | "ai";

type ComposerProps = {
  autoFocus?: boolean;
  isPending: boolean;
  lastAiReply?: string;
  onAiSubmit?: (text: string) => Promise<void>;
  onSubmit: (text: string, reminderTime: string | null) => Promise<void>;
};

export function Composer({
  autoFocus = false,
  isPending,
  lastAiReply,
  onAiSubmit,
  onSubmit,
}: ComposerProps) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState("");
  const [mode, setMode] = useState<ComposerMode>("task");
  const [isListening, setIsListening] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  // Samsung Reminders' create toolkit: a reminder time can be staged before
  // the task exists, shown as a removable chip, applied on submit.
  const [stagedTime, setStagedTime] = useState<string | null>(null);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const { keyboardInset, keyboardVisible } = useKeyboardControllerShim(
    insets.bottom,
  );

  // Speech events are global to the app; sessions started by the
  // voice-command overlay must not leak transcripts into this input.
  useSpeechRecognitionEvent("start", () => {
    if (!isVoiceCommandSessionActive()) {
      setIsListening(true);
    }
  });
  useSpeechRecognitionEvent("end", () => setIsListening(false));
  useSpeechRecognitionEvent("result", (event) => {
    if (isVoiceCommandSessionActive()) {
      return;
    }
    const transcript = event.results[0]?.transcript?.trim();
    if (transcript) {
      setText(transcript);
    }
  });
  useSpeechRecognitionEvent("error", (event) => {
    setIsListening(false);
    if (isVoiceCommandSessionActive()) {
      return;
    }
    if (event.error !== "no-speech" && event.error !== "aborted") {
      Alert.alert("语音输入不可用", event.message || "请检查麦克风和语音识别权限。");
    }
  });

  async function toggleSpeechRecognition() {
    try {
      if (isListening) {
        await ExpoSpeechRecognitionModule.stop();
        setIsListening(false);
        return;
      }

      const permission =
        await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("需要权限", "请允许麦克风和语音识别权限后再使用语音输入。");
        return;
      }

      await ExpoSpeechRecognitionModule.start({
        continuous: false,
        interimResults: true,
        lang: "zh-CN",
      });
    } catch (error) {
      setIsListening(false);
      Alert.alert(
        "语音输入不可用",
        error instanceof Error
          ? error.message
          : "当前设备没有可用的语音识别服务。",
      );
    }
  }

  async function submit() {
    const value = text.trim();
    if (!value || isPending) {
      return;
    }
    if (mode === "ai") {
      await onAiSubmit?.(value);
    } else {
      await onSubmit(value, stagedTime);
    }
    setText("");
    setStagedTime(null);
    Keyboard.dismiss();
  }

  const wrapperStyle =
    Platform.OS === "android" && keyboardVisible
      ? { bottom: keyboardInset }
      : // Keyboard down: rest above the bottom safe area (gesture bar / home
        // indicator) instead of the flat 8pt, so the bar never sits under the
        // system navigation.
        { bottom: spacing.sm + insets.bottom };

  return (
    <View style={[styles.wrapper, wrapperStyle]}>
      {Platform.OS === "android" &&
      mode === "task" &&
      (isFocused || stagedTime) ? (
        // Samsung Reminders' create toolkit row: condition buttons floating
        // above the keyboard while composing; a staged time shows as a
        // removable chip and is applied when the task is saved.
        <View style={styles.toolkit}>
          {stagedTime ? (
            <View style={styles.toolkitChip}>
              <AppIcon name="alarm" color={colors.accent} size={15} />
              <Text style={styles.toolkitChipText}>{stagedTime}</Text>
              <Pressable
                accessibilityLabel="移除提醒时间"
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => setStagedTime(null)}>
                <AppIcon name="close-circle" color={colors.accent} size={16} />
              </Pressable>
            </View>
          ) : (
            <Pressable
              accessibilityLabel="为新任务设置提醒时间"
              accessibilityRole="button"
              onPress={() => setTimePickerOpen(true)}
              style={({ pressed }) => [
                styles.toolkitButton,
                pressed && styles.voicePressed,
              ]}>
              <AppIcon name="alarm-outline" color={colors.textMuted} size={19} />
              <Text style={styles.toolkitButtonText}>时间</Text>
            </Pressable>
          )}
        </View>
      ) : null}
      {timePickerOpen && Platform.OS === "android" ? (
        <DateTimePicker
          is24Hour
          mode="time"
          onChange={(event, date) => {
            setTimePickerOpen(false);
            if (event.type === "set" && date) {
              setStagedTime(dayjs(date).format("HH:mm"));
            }
          }}
          value={new Date()}
        />
      ) : null}
      <View style={[styles.container, mode === "ai" && styles.aiContainer]}>
        <Pressable
          accessibilityLabel={mode === "ai" ? "切回普通添加任务" : "切换到 AI 模式"}
          accessibilityRole="button"
          accessibilityState={{ selected: mode === "ai" }}
          onPress={() => setMode((current) => (current === "ai" ? "task" : "ai"))}
          style={[styles.addButton, mode === "ai" && styles.aiButton]}>
          <AppIcon
            name={mode === "ai" ? "sparkles" : "add"}
            color={mode === "ai" ? colors.white : colors.textMuted}
            size={22}
          />
        </Pressable>
        <TextInput
          accessibilityLabel="添加任务"
          autoCapitalize="sentences"
          autoFocus={autoFocus}
          blurOnSubmit={false}
          editable={!isPending}
          onBlur={() => setIsFocused(false)}
          onChangeText={setText}
          onFocus={() => setIsFocused(true)}
          onSubmitEditing={submit}
          placeholder={
            mode === "ai"
              ? "用 AI 管理任务，例如：整理今天"
              : "添加任务，按 Enter 保存"
          }
          placeholderTextColor={colors.textMuted}
          returnKeyType="done"
          style={styles.input}
          value={text}
        />
        {mode === "task" ? (
          <Pressable
            accessibilityLabel={isListening ? "停止语音输入" : "语音输入"}
            accessibilityRole="button"
            disabled={isPending}
            onPress={toggleSpeechRecognition}
            style={({ pressed }) => [
              styles.voice,
              isListening && styles.voiceListening,
              pressed && styles.voicePressed,
            ]}>
            <AppIcon
              name={isListening ? "stop" : "mic-outline"}
              color={isListening ? colors.white : colors.textMuted}
              size={18}
            />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityLabel={mode === "ai" ? "发送 AI 指令" : "保存任务"}
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
            <AppIcon name={mode === "ai" ? "send" : "arrow-up"} color={colors.white} size={20} />
          )}
        </Pressable>
      </View>
      {mode === "ai" && lastAiReply ? (
        <View style={styles.aiReply}>
          <AppIcon name="sparkles" color={colors.accent} size={14} />
          <Text style={styles.aiReplyText}>{lastAiReply}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toolkit: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  toolkitButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderRadius: radius.full,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  toolkitButtonText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  toolkitChip: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
    borderRadius: radius.full,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    minHeight: 36,
    paddingHorizontal: spacing.md,
  },
  toolkitChipText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: "700",
  },
  wrapper: {
    bottom: spacing.sm,
    elevation: 12,
    left: 0,
    marginHorizontal: spacing.md,
    pointerEvents: "box-none",
    position: "absolute",
    right: 0,
    zIndex: 12,
  },
  container: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderRadius: radius.full,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: 7,
  },
  aiContainer: {
    borderColor: colors.accent,
  },
  addButton: {
    alignItems: "center",
    borderRadius: radius.full,
    backgroundColor: colors.surfaceMuted,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  aiButton: {
    backgroundColor: colors.accent,
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
  voice: {
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.full,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  voiceListening: {
    backgroundColor: colors.accent,
  },
  voicePressed: {
    opacity: 0.72,
  },
  submitDisabled: {
    opacity: 0.38,
  },
  submitPressed: {
    backgroundColor: colors.accentPressed,
  },
  aiReply: {
    alignItems: "flex-start",
    alignSelf: "stretch",
    backgroundColor: colors.accentSoft,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.xs,
    padding: spacing.sm,
  },
  aiReplyText: {
    color: colors.text,
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
});
