import * as Crypto from "expo-crypto";
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

export async function authenticateWithGoogle(): Promise<TokenPair | null> {
  const { challenge, verifier } = await createPkcePair();
  const auth = await startAndroidGoogleLogin(challenge);

  await WebBrowser.warmUpAsync();
  try {
    const result = await WebBrowser.openAuthSessionAsync(
      auth.authorizationUrl,
      auth.redirectUrl,
    );
    if (result.type !== "success") {
      return null;
    }

    const callback = new URL(result.url);
    const status = callback.searchParams.get("googleAuth");
    const message = callback.searchParams.get("message");
    const exchangeCode = callback.searchParams.get("code");
    if (status === "error") {
      throw new Error(message || "Google 登录失败，请重试。");
    }
    if (status !== "success" || !exchangeCode) {
      throw new Error("Google 登录回调无效，请重试。");
    }
    return exchangeAndroidGoogleLogin(exchangeCode, verifier);
  } finally {
    await WebBrowser.coolDownAsync().catch(() => undefined);
  }
}
