import { useEffect, useState } from "react";
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

import { AppIcon } from "@/components/AppIcon";
import { useSession } from "@/session";
import { colors, radius, spacing, typography } from "@/theme";

type AuthMode = "login" | "register";

export function AuthScreen() {
  const insets = useSafeAreaInsets();
  const {
    requestRegistrationCode,
    signIn,
    signInWithGoogle,
    signUp,
  } = useSession();
  const isAndroid = Platform.OS === "android";
  const [mode, setMode] = useState<AuthMode>("login");
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [isCodePending, setIsCodePending] = useState(false);
  const [isGooglePending, setIsGooglePending] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);

  useEffect(() => {
    if (codeCooldown <= 0) {
      return;
    }
    const timer = setTimeout(
      () => setCodeCooldown((seconds) => Math.max(0, seconds - 1)),
      1_000,
    );
    return () => clearTimeout(timer);
  }, [codeCooldown]);

  const registrationFieldsReady = Boolean(
    username.trim() &&
      email.trim() &&
      (!isAndroid || /^\d{6}$/.test(verificationCode.trim())),
  );
  const canSubmit = Boolean(
    password.length >= 6 &&
      (mode === "login" ? identifier.trim() : registrationFieldsReady),
  );
  const canRequestCode = Boolean(
    isAndroid &&
      mode === "register" &&
      email.trim().includes("@") &&
      codeCooldown === 0 &&
      !isCodePending,
  );

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
        await signUp(
          username.trim(),
          email.trim(),
          password,
          verificationCode.trim(),
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "认证失败，请稍后重试。");
    } finally {
      setIsPending(false);
    }
  }

  async function sendVerificationCode() {
    if (!canRequestCode) {
      return;
    }
    setError("");
    setIsCodePending(true);
    try {
      const retryAfterSeconds = await requestRegistrationCode(email.trim());
      setCodeCooldown(retryAfterSeconds);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "验证码发送失败，请稍后重试。");
    } finally {
      setIsCodePending(false);
    }
  }

  async function continueWithGoogle() {
    if (isGooglePending) {
      return;
    }
    setError("");
    setIsGooglePending(true);
    try {
      await signInWithGoogle();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Google 登录失败，请稍后重试。");
    } finally {
      setIsGooglePending(false);
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
                onChangeText={(value) => {
                  setEmail(value);
                  setVerificationCode("");
                  setCodeCooldown(0);
                }}
                returnKeyType="next"
                value={email}
              />
              {isAndroid ? (
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>邮箱验证码</Text>
                  <View style={styles.codeRow}>
                    <TextInput
                      autoCapitalize="none"
                      keyboardType="number-pad"
                      maxLength={6}
                      onChangeText={(value) =>
                        setVerificationCode(value.replace(/\D/g, ""))
                      }
                      placeholder="6 位验证码"
                      placeholderTextColor={colors.textMuted}
                      selectionColor={colors.accent}
                      style={[styles.input, styles.codeInput]}
                      value={verificationCode}
                    />
                    <Pressable
                      accessibilityRole="button"
                      disabled={!canRequestCode}
                      onPress={sendVerificationCode}
                      style={({ pressed }) => [
                        styles.codeButton,
                        !canRequestCode && styles.secondaryButtonDisabled,
                        pressed && styles.pressed,
                      ]}>
                      {isCodePending ? (
                        <ActivityIndicator color={colors.accent} size="small" />
                      ) : (
                        <Text style={styles.codeButtonText}>
                          {codeCooldown > 0
                            ? `${codeCooldown} 秒`
                            : "发送验证码"}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                  {codeCooldown > 0 ? (
                    <Text style={styles.codeHint}>验证码已发送，请检查收件箱和垃圾邮件。</Text>
                  ) : null}
                </View>
              ) : null}
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

          {isAndroid ? (
            <>
              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>或</Text>
                <View style={styles.dividerLine} />
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={isGooglePending || isPending}
                onPress={continueWithGoogle}
                style={({ pressed }) => [
                  styles.googleButton,
                  (isGooglePending || isPending) && styles.secondaryButtonDisabled,
                  pressed && styles.pressed,
                ]}>
                {isGooglePending ? (
                  <ActivityIndicator color={colors.text} />
                ) : (
                  <>
                    <AppIcon color="#4285F4" name="logo-google" size={21} />
                    <Text style={styles.googleButtonText}>使用 Google 登录</Text>
                  </>
                )}
              </Pressable>
            </>
          ) : null}
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
  codeRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  codeInput: {
    flex: 1,
  },
  codeButton: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: "center",
    minWidth: 112,
    paddingHorizontal: spacing.md,
  },
  codeButtonText: {
    ...typography.label,
    color: colors.accent,
  },
  codeHint: {
    ...typography.caption,
    color: colors.textMuted,
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
  secondaryButtonDisabled: {
    opacity: 0.45,
  },
  dividerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  dividerLine: {
    backgroundColor: colors.border,
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  dividerText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  googleButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: 52,
  },
  googleButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.72,
  },
});
