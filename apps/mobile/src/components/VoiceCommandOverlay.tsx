import { useCallback, useEffect, useRef, useState } from "react";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";

import { AppIcon } from "./AppIcon";
import { ScreenEnter } from "./ScreenEnter";
import {
  parseVoiceCommand,
  type VoiceCommand,
  type VoiceTaskRef,
} from "@/lib/voice-commands";
import { isVoiceLlmConfigured, parseVoiceCommandWithLlm } from "@/lib/voice-llm";
import { setVoiceCommandSessionActive } from "@/lib/voice-session";
import { colors, radius, spacing, typography } from "@/theme";

type Phase = "listening" | "thinking" | "result";

type VoiceCommandOverlayProps = {
  onAdd: (text: string, reminderTime: string | null) => Promise<void>;
  onComplete: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onClose: () => void;
  open: boolean;
  tasks: { pending: VoiceTaskRef[]; done: VoiceTaskRef[] };
};

// Full-voice control: speak "添加任务买牛奶" / "完成买牛奶" / "删除跑步"
// and it executes immediately. Rules parse the common phrasings offline;
// anything else goes to the configured LLM (我的账户 → 语音助手 AI 解析).
export function VoiceCommandOverlay({
  onAdd,
  onComplete,
  onDelete,
  onClose,
  open,
  tasks,
}: VoiceCommandOverlayProps) {
  const [phase, setPhase] = useState<Phase>("listening");
  const [transcript, setTranscript] = useState("");
  const [resultText, setResultText] = useState("");
  const [resultOk, setResultOk] = useState(true);
  // The latest transcript must be visible to the `end` listener without
  // re-registering handlers mid-session.
  const transcriptRef = useRef("");
  const processingRef = useRef(false);
  const sessionRef = useRef(false);

  const executeCommand = useCallback(
    async (command: VoiceCommand | null, spoken: string) => {
      if (!command || command.kind === "none") {
        const llmConfigured = await isVoiceLlmConfigured();
        setResultOk(false);
        setResultText(
          `没听懂「${spoken}」。试试：添加任务…、完成…、删除…${
            llmConfigured ? "" : "\n在“我的账户 → 语音助手 AI 解析”配置后可用更自然的说法。"
          }`,
        );
        return;
      }
      switch (command.kind) {
        case "add":
          await onAdd(command.text, command.reminderTime);
          setResultOk(true);
          setResultText(
            command.reminderTime
              ? `已添加「${command.text}」，${command.reminderTime} 提醒`
              : `已添加「${command.text}」`,
          );
          break;
        case "complete":
          onComplete(command.taskId);
          setResultOk(true);
          setResultText(`已完成「${command.taskText}」`);
          break;
        case "delete":
          onDelete(command.taskId);
          setResultOk(true);
          setResultText(`已删除「${command.taskText}」`);
          break;
        case "unmatched":
          setResultOk(false);
          setResultText(
            `今天没有找到叫「${command.query}」的任务，请再说一次任务名。`,
          );
          break;
      }
      if (command.kind !== "unmatched") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    },
    [onAdd, onComplete, onDelete],
  );

  const processTranscript = useCallback(
    async (spoken: string) => {
      if (processingRef.current) {
        return;
      }
      processingRef.current = true;
      setPhase("thinking");
      try {
        let command: VoiceCommand | null = parseVoiceCommand(spoken, tasks);
        if (command.kind === "none" || command.kind === "unmatched") {
          const llmCommand = await parseVoiceCommandWithLlm(spoken, tasks);
          if (
            llmCommand &&
            llmCommand.kind !== "none" &&
            !(llmCommand.kind === "unmatched" && command.kind !== "none")
          ) {
            command = llmCommand;
          }
        }
        await executeCommand(command, spoken);
      } catch (error) {
        setResultOk(false);
        setResultText(
          error instanceof Error ? error.message : "执行失败，请重试。",
        );
      } finally {
        processingRef.current = false;
        setPhase("result");
      }
    },
    [executeCommand, tasks],
  );

  const startListening = useCallback(async () => {
    setTranscript("");
    transcriptRef.current = "";
    setResultText("");
    setPhase("listening");
    try {
      const permission =
        await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setResultOk(false);
        setResultText("请允许麦克风和语音识别权限后再使用语音操作。");
        setPhase("result");
        return;
      }
      sessionRef.current = true;
      setVoiceCommandSessionActive(true);
      await ExpoSpeechRecognitionModule.start({
        continuous: false,
        interimResults: true,
        lang: "zh-CN",
      });
    } catch (error) {
      sessionRef.current = false;
      setVoiceCommandSessionActive(false);
      setResultOk(false);
      setResultText(
        error instanceof Error
          ? error.message
          : "当前设备没有可用的语音识别服务。",
      );
      setPhase("result");
    }
  }, []);

  // Session start happens in the Modal's onShow (below); this only makes
  // sure an in-flight session dies with the component.
  useEffect(
    () => () => {
      if (sessionRef.current) {
        sessionRef.current = false;
        setVoiceCommandSessionActive(false);
        void ExpoSpeechRecognitionModule.stop();
      }
    },
    [],
  );

  useSpeechRecognitionEvent("result", (event) => {
    if (!sessionRef.current) {
      return;
    }
    const spoken = event.results[0]?.transcript?.trim();
    if (spoken) {
      transcriptRef.current = spoken;
      setTranscript(spoken);
    }
  });

  useSpeechRecognitionEvent("end", () => {
    if (!sessionRef.current) {
      return;
    }
    sessionRef.current = false;
    setVoiceCommandSessionActive(false);
    const spoken = transcriptRef.current;
    if (spoken) {
      void processTranscript(spoken);
    } else {
      setResultOk(false);
      setResultText("没有听到内容，请再试一次。");
      setPhase("result");
    }
  });

  useSpeechRecognitionEvent("error", (event) => {
    if (!sessionRef.current) {
      return;
    }
    if (event.error === "no-speech" || event.error === "aborted") {
      return;
    }
    sessionRef.current = false;
    setVoiceCommandSessionActive(false);
    setResultOk(false);
    setResultText(event.message || "语音识别出错，请重试。");
    setPhase("result");
  });

  function close() {
    if (sessionRef.current) {
      sessionRef.current = false;
      setVoiceCommandSessionActive(false);
      void ExpoSpeechRecognitionModule.stop();
    }
    onClose();
  }

  return (
    <Modal
      animationType="fade"
      onRequestClose={close}
      onShow={() => void startListening()}
      transparent
      visible={open}>
      <View style={styles.backdrop}>
        <Pressable onPress={close} style={StyleSheet.absoluteFill} />
        <ScreenEnter style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <AppIcon name="mic" color={colors.accent} size={20} />
            <Text style={styles.title}>语音操作</Text>
          </View>

          {phase === "listening" ? (
            <View style={styles.body}>
              <View style={styles.pulse}>
                <AppIcon name="mic" color={colors.white} size={30} />
              </View>
              <Text style={styles.listeningHint}>
                {transcript || "请说：添加任务… / 完成… / 删除…"}
              </Text>
              <Pressable
                accessibilityLabel="停止聆听"
                onPress={() => void ExpoSpeechRecognitionModule.stop()}
                style={({ pressed }) => [styles.stopButton, pressed && styles.pressed]}>
                <Text style={styles.stopButtonText}>说完了</Text>
              </Pressable>
            </View>
          ) : null}

          {phase === "thinking" ? (
            <View style={styles.body}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.listeningHint}>
                {transcript ? `“${transcript}”` : ""}
              </Text>
              <Text style={styles.thinkingHint}>正在理解并执行…</Text>
            </View>
          ) : null}

          {phase === "result" ? (
            <View style={styles.body}>
              <AppIcon
                name={resultOk ? "checkmark-circle" : "alert-circle-outline"}
                color={resultOk ? colors.accent : colors.danger}
                size={34}
              />
              <Text style={[styles.resultText, !resultOk && styles.resultTextError]}>
                {resultText}
              </Text>
              <View style={styles.resultActions}>
                <Pressable
                  accessibilityLabel="继续说下一句"
                  onPress={() => void startListening()}
                  style={({ pressed }) => [styles.againButton, pressed && styles.pressed]}>
                  <AppIcon name="mic" color={colors.white} size={17} />
                  <Text style={styles.againButtonText}>再说一句</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="关闭语音操作"
                  onPress={close}
                  style={({ pressed }) => [styles.doneButton, pressed && styles.pressed]}>
                  <Text style={styles.doneButtonText}>完成</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </ScreenEnter>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "rgba(22, 27, 24, 0.45)",
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  handle: {
    alignSelf: "center",
    backgroundColor: colors.borderStrong,
    borderRadius: radius.full,
    height: 4,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
    width: 38,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 40,
  },
  title: {
    ...typography.section,
    color: colors.text,
  },
  body: {
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  pulse: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    height: 72,
    justifyContent: "center",
    width: 72,
  },
  listeningHint: {
    ...typography.body,
    color: colors.text,
    minHeight: 22,
    textAlign: "center",
  },
  thinkingHint: {
    ...typography.caption,
    color: colors.textMuted,
  },
  stopButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.full,
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  stopButtonText: {
    ...typography.label,
    color: colors.text,
  },
  resultText: {
    ...typography.body,
    color: colors.text,
    lineHeight: 22,
    textAlign: "center",
  },
  resultTextError: {
    color: colors.danger,
  },
  resultActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  againButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  againButtonText: {
    ...typography.label,
    color: colors.white,
    fontWeight: "700",
  },
  doneButton: {
    alignItems: "center",
    borderColor: colors.borderStrong,
    borderRadius: radius.full,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  doneButtonText: {
    ...typography.label,
    color: colors.text,
  },
  pressed: {
    opacity: 0.7,
  },
});
