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

import { login, register } from "@/lib/api";
import {
  clearTokens,
  loadTokens,
  saveTokens,
  subscribeToTokenClear,
} from "@/lib/auth-storage";
import { flushClientLogs, recordClientLog } from "@/lib/client-logs";

type SessionStatus = "loading" | "authenticated" | "unauthenticated";

type SessionContextValue = {
  status: SessionStatus;
  signIn: (identifier: string, password: string) => Promise<void>;
  signUp: (username: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;
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
      });
    return () => {
      active = false;
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

  const signIn = useCallback(async (identifier: string, password: string) => {
    const tokens = await login({ identifier, password });
    await saveTokens(tokens);
    setStatus("authenticated");
    recordClientLog("info", "User signed in", { source: "session" });
    void flushClientLogs();
  }, []);

  const signUp = useCallback(
    async (username: string, email: string, password: string) => {
      const tokens = await register({ username, email, password });
      await saveTokens(tokens);
      setStatus("authenticated");
      recordClientLog("info", "User signed up", { source: "session" });
      void flushClientLogs();
    },
    [],
  );

  const signOut = useCallback(async () => {
    recordClientLog("info", "User signed out", { source: "session" });
    await flushClientLogs();
    await clearTokens();
    queryClient.clear();
    setStatus("unauthenticated");
  }, [queryClient]);

  const value = useMemo(
    () => ({ status, signIn, signUp, signOut }),
    [signIn, signOut, signUp, status],
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
