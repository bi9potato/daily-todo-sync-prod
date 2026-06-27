import { useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { AppIcon } from "@/components/AppIcon";
import { chatWithAi } from "@/lib/api";
import { colors, radius, spacing, typography } from "@/theme";

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
};

const initialMessages: ChatMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    text: "告诉我你想安排什么。我可以添加、整理或分析任务。",
  },
];

export function AiScreen({ selectedDate }: { selectedDate: string }) {
  const queryClient = useQueryClient();
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const [text, setText] = useState("");
  const [messages, setMessages] = useState(initialMessages);

  const mutation = useMutation({
    mutationFn: (message: string) => chatWithAi(message, selectedDate),
    onSuccess: (result) => {
      setMessages((current) => [
        ...current,
        { id: `assistant-${Date.now()}`, role: "assistant", text: result.reply },
      ]);
      if (result.actions.length) {
        void queryClient.invalidateQueries({ queryKey: ["day"] });
        void queryClient.invalidateQueries({ queryKey: ["range"] });
      }
    },
    onError: (error) => {
      setMessages((current) => [
        ...current,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          text: error.message || "暂时无法连接 AI，请稍后再试。",
        },
      ]);
    },
  });

  function submit() {
    const value = text.trim();
    if (!value || mutation.isPending) {
      return;
    }
    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: "user", text: value },
    ]);
    setText("");
    mutation.mutate(value);
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={8}
      style={styles.page}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>AI 助手</Text>
          <Text style={styles.subtitle}>用自然语言管理任务</Text>
        </View>
        <View style={styles.aiIcon}>
          <AppIcon name="sparkles" color={colors.accent} size={22} />
        </View>
      </View>

      <FlatList
        contentContainerStyle={styles.messages}
        data={messages}
        keyExtractor={(item) => item.id}
        ListFooterComponent={
          mutation.isPending ? (
            <View style={[styles.bubble, styles.assistantBubble, styles.thinking]}>
              <ActivityIndicator color={colors.accent} size="small" />
              <Text style={styles.thinkingText}>正在处理…</Text>
            </View>
          ) : null
        }
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ref={listRef}
        renderItem={({ item }) => (
          <View
            style={[
              styles.bubble,
              item.role === "user" ? styles.userBubble : styles.assistantBubble,
            ]}>
            <Text
              style={[
                styles.bubbleText,
                item.role === "user" && styles.userBubbleText,
              ]}>
              {item.text}
            </Text>
          </View>
        )}
        showsVerticalScrollIndicator={false}
      />

      <View style={styles.suggestions}>
        {["分析今天", "整理待处理", "添加明天提醒"].map((suggestion) => (
          <Pressable
            key={suggestion}
            onPress={() => setText(suggestion)}
            style={styles.suggestion}>
            <Text style={styles.suggestionText}>{suggestion}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.composer}>
        <TextInput
          editable={!mutation.isPending}
          multiline
          onChangeText={setText}
          onSubmitEditing={submit}
          placeholder="例如：明天下午 3 点提醒我开会"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          value={text}
        />
        <Pressable
          accessibilityLabel="发送"
          disabled={!text.trim() || mutation.isPending}
          onPress={submit}
          style={[
            styles.sendButton,
            (!text.trim() || mutation.isPending) && styles.sendButtonDisabled,
          ]}>
          <AppIcon name="arrow-up" color={colors.white} size={20} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.background,
    flex: 1,
  },
  header: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: spacing.lg,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  aiIcon: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  messages: {
    flexGrow: 1,
    gap: spacing.md,
    justifyContent: "flex-end",
    padding: spacing.lg,
  },
  bubble: {
    borderRadius: radius.lg,
    maxWidth: "84%",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  assistantBubble: {
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceMuted,
    borderBottomLeftRadius: radius.sm,
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: colors.accent,
    borderBottomRightRadius: radius.sm,
  },
  bubbleText: {
    ...typography.body,
    color: colors.text,
  },
  userBubbleText: {
    color: colors.white,
  },
  thinking: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  thinkingText: {
    ...typography.label,
    color: colors.textMuted,
  },
  suggestions: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  suggestion: {
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  suggestionText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  composer: {
    alignItems: "flex-end",
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    flex: 1,
    fontSize: 15,
    maxHeight: 110,
    minHeight: 46,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  sendButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  sendButtonDisabled: {
    opacity: 0.38,
  },
});
