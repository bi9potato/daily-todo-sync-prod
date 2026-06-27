import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSession } from "@/session";
import { colors, radius, spacing, typography } from "@/theme";

type AuthMode = "login" | "register";

export function AuthScreen() {
  const insets = useSafeAreaInsets();
  const { signIn, signUp } = useSession();
  const [mode, setMode] = useState<AuthMode>("login");
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);

  const canSubmit =
    password.length >= 6 &&
    (mode === "login" ? identifier.trim() : username.trim() && email.trim());

  async function submit() {
    if (!canSubmit || isPending) {
      return;
    }
    setError("");
    setIsPending(true);
    try {
      if (mode === "login") {
        await signIn(identifier.trim(), password);
      } else {
        await signUp(username.trim(), email.trim(), password);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "认证失败，请稍后重试。");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.page}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <Image
            accessibilityIgnoresInvertColors
            source={require("../../assets/images/app-icon.png")}
            style={styles.logo}
          />
          <Text style={styles.title}>Daily Todo</Text>
          <Text style={styles.subtitle}>把今天安排得更简单</Text>
        </View>

        <View style={styles.segmented}>
          {(["login", "register"] as const).map((item) => (
            <Pressable
              key={item}
              onPress={() => {
                setMode(item);
                setError("");
              }}
              style={[styles.segment, mode === item && styles.activeSegment]}>
              <Text
                style={[
                  styles.segmentText,
                  mode === item && styles.activeSegmentText,
                ]}>
                {item === "login" ? "登录" : "注册"}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.form}>
          {mode === "login" ? (
            <Input
              autoCapitalize="none"
              label="用户名或邮箱"
              onChangeText={setIdentifier}
              returnKeyType="next"
              value={identifier}
            />
          ) : (
            <>
              <Input
                autoCapitalize="none"
                label="用户名"
                onChangeText={setUsername}
                returnKeyType="next"
                value={username}
              />
              <Input
                autoCapitalize="none"
                keyboardType="email-address"
                label="邮箱"
                onChangeText={setEmail}
                returnKeyType="next"
                value={email}
              />
            </>
          )}
          <Input
            label="密码"
            onChangeText={setPassword}
            onSubmitEditing={submit}
            returnKeyType="done"
            secureTextEntry
            value={password}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            accessibilityRole="button"
            disabled={!canSubmit || isPending}
            onPress={submit}
            style={({ pressed }) => [
              styles.primaryButton,
              (!canSubmit || isPending) && styles.primaryButtonDisabled,
              pressed && styles.pressed,
            ]}>
            {isPending ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.primaryButtonText}>
                {mode === "login" ? "登录" : "创建账号"}
              </Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Input({
  label,
  ...props
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        placeholder={label}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.accent}
        style={styles.input}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  brand: {
    alignItems: "center",
    marginBottom: spacing.xxl,
  },
  logo: {
    borderRadius: 24,
    height: 88,
    marginBottom: spacing.lg,
    width: 88,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  segmented: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    flexDirection: "row",
    marginBottom: spacing.xl,
    padding: 4,
  },
  segment: {
    alignItems: "center",
    borderRadius: radius.sm,
    flex: 1,
    minHeight: 42,
    justifyContent: "center",
  },
  activeSegment: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segmentText: {
    ...typography.label,
    color: colors.textMuted,
  },
  activeSegmentText: {
    color: colors.accent,
  },
  form: {
    gap: spacing.lg,
  },
  inputGroup: {
    gap: spacing.sm,
  },
  inputLabel: {
    ...typography.label,
    color: colors.text,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  error: {
    ...typography.label,
    color: colors.danger,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    justifyContent: "center",
    minHeight: 52,
  },
  primaryButtonDisabled: {
    opacity: 0.4,
  },
  primaryButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.72,
  },
});
