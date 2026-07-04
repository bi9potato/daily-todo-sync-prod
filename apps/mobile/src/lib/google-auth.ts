import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";

import {
  exchangeAndroidGoogleLogin,
  startAndroidGoogleLogin,
} from "./api";
import type { TokenPair } from "@/types";

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64Url(value: string) {
  return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function createPkcePair() {
  const verifier = toHex(await Crypto.getRandomBytesAsync(32));
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  return {
    challenge: toBase64Url(digest),
    verifier,
  };
}

// Google's consent screen (account picker, 2FA) can keep the browser open
// long enough for Android to reclaim the backgrounded app process under
// memory pressure - routine on aggressive-battery-management ROMs. When that
// happens, WebBrowser.openAuthSessionAsync's in-memory promise (and the PKCE
// verifier that only ever lived in this function's closure) both die with the
// process, and the redirect instead cold-launches the app via the
// daily-todo://auth/google deep link with no pending caller to resolve. The
// verifier is persisted here so src/app/auth/google.tsx can still complete
// the exchange after such a restart.
const PKCE_VERIFIER_KEY = "daily-todo-sync.google-pkce-verifier";

async function savePendingVerifier(verifier: string) {
  await SecureStore.setItemAsync(PKCE_VERIFIER_KEY, verifier);
}

async function takePendingVerifier(): Promise<string | null> {
  const verifier = await SecureStore.getItemAsync(PKCE_VERIFIER_KEY);
  if (verifier) {
    await SecureStore.deleteItemAsync(PKCE_VERIFIER_KEY).catch(() => undefined);
  }
  return verifier;
}

type GoogleCallbackParams = {
  googleAuth?: string | null;
  code?: string | null;
  message?: string | null;
};

// Shared by the normal in-process flow below and by the auth/google deep-link
// route (the process-restart fallback), so both paths consume the same
// persisted verifier the same way.
export async function completeGoogleCallback(
  params: GoogleCallbackParams,
): Promise<TokenPair | null> {
  const { googleAuth: status, code: exchangeCode, message } = params;
  if (status === "error") {
    await takePendingVerifier();
    throw new Error(message || "Google 登录失败，请重试。");
  }
  if (status !== "success" || !exchangeCode) {
    await takePendingVerifier();
    throw new Error("Google 登录回调无效，请重试。");
  }
  const verifier = await takePendingVerifier();
  if (!verifier) {
    throw new Error("Google 登录会话已过期，请重试。");
  }
  return exchangeAndroidGoogleLogin(exchangeCode, verifier);
}

export async function authenticateWithGoogle(): Promise<TokenPair | null> {
  const { challenge, verifier } = await createPkcePair();
  const auth = await startAndroidGoogleLogin(challenge);
  await savePendingVerifier(verifier);

  await WebBrowser.warmUpAsync();
  try {
    const result = await WebBrowser.openAuthSessionAsync(
      auth.authorizationUrl,
      auth.redirectUrl,
    );
    if (result.type !== "success") {
      await SecureStore.deleteItemAsync(PKCE_VERIFIER_KEY).catch(() => undefined);
      return null;
    }

    const callback = new URL(result.url);
    return completeGoogleCallback({
      googleAuth: callback.searchParams.get("googleAuth"),
      code: callback.searchParams.get("code"),
      message: callback.searchParams.get("message"),
    });
  } finally {
    await WebBrowser.coolDownAsync().catch(() => undefined);
  }
}
