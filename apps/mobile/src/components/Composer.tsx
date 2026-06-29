import { useEffect, useState } from "react";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardEvent,
} from "react-native";

import { AppIcon } from "./AppIcon";
import { colors, radius, spacing } from "@/theme";

type ComposerMode = "task" | "ai";

type ComposerProps = {
  isPending: boolean;
  lastAiReply?: string;
  onAiSubmit?: (text: string) => Promise<void>;
  onSubmit: (text: string) => Promise<void>;
};

export function Composer({
  isPending,
  lastAiReply,
  onAiSubmit,
  onSubmit,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<ComposerMode>("task");
  const [isListening, setIsListening] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "android") {
      setKeyboardInset(0);
      setKeyboardVisible(false);
      return;
    }

    function alignToKeyboard(event: KeyboardEvent) {
      const windowHeight = Dimensions.get("window").height;
      const keyboardTop = event.endCoordinates.screenY;
      const overlap = Math.max(0, windowHeight - keyboardTop);
      setKeyboardVisible(true);
      setKeyboardInset(overlap);
    }

    const showSubscription = Keyboard.addListener(
      "keyboardDidShow",
      alignToKeyboard,
    );
    const frameSubscription = Keyboard.addListener(
      "keyboardDidChangeFrame",
      alignToKeyboard,
    );
    const hideSubscription = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardVisible(false);
      setKeyboardInset(0);
    });

    return () => {
      showSubscription.remove();
      frameSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useSpeechRecognitionEvent("start", () => setIsListening(true));
  useSpeechRecognitionEvent("end", () => setIsListening(false));
  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript?.trim();
    if (transcript) {
      setText(transcript);
    }
  });
  useSpeechRecognitionEvent("error", (event) => {
    setIsListening(false);
    if (event.error !== "no-speech" && event.error !== "aborted") {
      Alert.alert("语音输入不可用", event.message || "请检查麦克风和语音识别权限。");
    }
  });

  async function toggleSpeechRecognition() {
    if (isListening) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }

    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("需要权限", "请允许麦克风和语音识别权限后再使用语音输入。");
      return;
    }

    ExpoSpeechRecognitionModule.start({
      continuous: false,
      interimResults: true,
      lang: "zh-CN",
    });
  }

  async function submit() {
    const value = text.trim();
    if (!value || isPending) {
      return;
    }
    if (mode === "ai") {
      await onAiSubmit?.(value);
    } else {
      await onSubmit(value);
    }
    setText("");
    Keyboard.dismiss();
  }

  return (
    <View
      style={[
        styles.wrapper,
        { bottom: keyboardVisible ? keyboardInset : spacing.sm },
      ]}>
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
          blurOnSubmit={false}
          editable={!isPending}
          onChangeText={setText}
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
  wrapper: {
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
