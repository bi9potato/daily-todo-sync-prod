import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Redirect, useLocalSearchParams } from "expo-router";

import { recordClientLog } from "@/lib/client-logs";
import { useSession } from "@/session";
import { colors, spacing, typography } from "@/theme";

// Reached only when Android cold-launches the app straight from the Google
// OAuth redirect (daily-todo://auth/google?...) instead of the browser
// session resolving in-process - i.e. the process that started the login was
// killed while the consent screen was open. See the PKCE-persistence comment
// in google-auth.ts for why the exchange can still complete from here.
export default function GoogleAuthCallbackScreen() {
  const params = useLocalSearchParams<{
    googleAuth?: string;
    code?: string;
    message?: string;
  }>();
  const { status, completeGoogleSignIn } = useSession();
  const handledRef = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (handledRef.current) {
      return;
    }
    handledRef.current = true;
    void (async () => {
      try {
        const ok = await completeGoogleSignIn({
          googleAuth: params.googleAuth ?? null,
          code: params.code ?? null,
          message: params.message ?? null,
        });
        if (!ok) {
          setFailed(true);
        }
      } catch (error) {
        recordClientLog("warn", "Resumed Google sign-in failed", {
          source: "auth",
          context: {
            message: error instanceof Error ? error.message : String(error),
          },
        });
        setFailed(true);
      }
    })();
  }, [completeGoogleSignIn, params.code, params.googleAuth, params.message]);

  if (status === "authenticated") {
    return <Redirect href="/today" />;
  }
  if (failed) {
    return <Redirect href="/" />;
  }
  return (
    <View style={styles.page}>
      <ActivityIndicator color={colors.accent} size="large" />
      <Text style={styles.text}>正在完成 Google 登录…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    alignItems: "center",
    backgroundColor: colors.background,
    flex: 1,
    gap: spacing.md,
    justifyContent: "center",
  },
  text: {
    ...typography.body,
    color: colors.textMuted,
  },
});
