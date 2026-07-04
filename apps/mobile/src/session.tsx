import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Platform } from "react-native";

import {
  login,
  register,
  registerAndroid,
  requestAndroidRegistrationCode,
} from "@/lib/api";
import {
  clearTokens,
  loadTokens,
  saveTokens,
  subscribeToTokenClear,
} from "@/lib/auth-storage";
import { flushClientLogs, recordClientLog } from "@/lib/client-logs";
import { authenticateWithGoogle, completeGoogleCallback } from "@/lib/google-auth";
import type { TokenPair } from "@/types";

type SessionStatus = "loading" | "authenticated" | "unauthenticated";

// Session restore normally resolves in a few milliseconds; this is only a
// safety net for the rare case where it hangs outright (e.g. a corrupted
// Android Keystore entry after an OS/app update) instead of rejecting. With
// no timeout, a hang leaves `status` stuck on "loading" forever, which keeps
// the native splash screen up indefinitely - the app never gets anywhere, not
// even the login screen (recoverable today only by clearing all app data).
const SESSION_RESTORE_TIMEOUT_MS = 6_000;

type SessionContextValue = {
  status: SessionStatus;
  signIn: (identifier: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<boolean>;
  completeGoogleSignIn: (params: {
    googleAuth?: string | null;
    code?: string | null;
    message?: string | null;
  }) => Promise<boolean>;
  requestRegistrationCode: (email: string) => Promise<number>;
  signUp: (
    username: string,
    email: string,
    password: string,
    verificationCode?: string,
  ) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;
    const timeout = setTimeout(() => {
      if (active) {
        recordClientLog("warn", "Session restore timed out, forcing login", {
          source: "session",
        });
        void flushClientLogs();
        setStatus("unauthenticated");
      }
    }, SESSION_RESTORE_TIMEOUT_MS);
    loadTokens()
      .then((tokens) => {
        if (active) {
          setStatus(tokens ? "authenticated" : "unauthenticated");
        }
      })
      .catch(() => {
        if (active) {
          setStatus("unauthenticated");
        }
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, []);

  useEffect(
    () =>
      subscribeToTokenClear(() => {
        queryClient.clear();
        setStatus("unauthenticated");
      }),
    [queryClient],
  );

  useEffect(() => {
    if (status === "authenticated") {
      void flushClientLogs();
    }
  }, [status]);

  const establishSession = useCallback(async (tokens: TokenPair, event: string) => {
    await saveTokens(tokens);
    setStatus("authenticated");
    recordClientLog("info", event, { source: "session" });
    void flushClientLogs();
  }, []);

  const signIn = useCallback(
    async (identifier: string, password: string) => {
      const tokens = await login({ identifier, password });
      await establishSession(tokens, "User signed in");
    },
    [establishSession],
  );

  const requestRegistrationCode = useCallback(async (email: string) => {
    if (Platform.OS !== "android") {
      throw new Error("邮箱验证码注册仅用于 Android。");
    }
    const result = await requestAndroidRegistrationCode(email);
    return result.retryAfterSeconds;
  }, []);

  const signUp = useCallback(
    async (
      username: string,
      email: string,
      password: string,
      verificationCode = "",
    ) => {
      const tokens =
        Platform.OS === "android"
          ? await registerAndroid({
              username,
              email,
              password,
              verificationCode,
            })
          : await register({ username, email, password });
      await establishSession(tokens, "User signed up");
    },
    [establishSession],
  );

  const signInWithGoogle = useCallback(async () => {
    if (Platform.OS !== "android") {
      throw new Error("Google 登录目前仅用于 Android。");
    }
    const tokens = await authenticateWithGoogle();
    if (!tokens) {
      return false;
    }
    await establishSession(tokens, "User signed in with Google");
    return true;
  }, [establishSession]);

  // Completes a Google sign-in that arrived via the auth/google deep-link
  // route rather than the in-process WebBrowser.openAuthSessionAsync promise
  // - i.e. the app was cold-launched by the OAuth redirect after Android
  // killed the process mid-flow.
  const completeGoogleSignIn = useCallback(
    async (params: {
      googleAuth?: string | null;
      code?: string | null;
      message?: string | null;
    }) => {
      const tokens = await completeGoogleCallback(params);
      if (!tokens) {
        return false;
      }
      await establishSession(
        tokens,
        "User signed in with Google (resumed after app restart)",
      );
      return true;
    },
    [establishSession],
  );

  const signOut = useCallback(async () => {
    recordClientLog("info", "User signed out", { source: "session" });
    await flushClientLogs();
    await clearTokens();
    queryClient.clear();
    setStatus("unauthenticated");
  }, [queryClient]);

  const value = useMemo(
    () => ({
      status,
      requestRegistrationCode,
      signIn,
      signInWithGoogle,
      completeGoogleSignIn,
      signOut,
      signUp,
    }),
    [
      completeGoogleSignIn,
      requestRegistrationCode,
      signIn,
      signInWithGoogle,
      signOut,
      signUp,
      status,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used inside SessionProvider");
  }
  return context;
}
