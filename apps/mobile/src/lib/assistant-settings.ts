import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

// Settings for the voice assistant's optional LLM intent parser. The key
// lives in SecureStore (encrypted at rest); base URL and model are plain
// preferences. Any OpenAI-compatible /chat/completions provider works -
// DeepSeek is the default because it is cheap and reachable from mainland
// China without a proxy.
const BASE_URL_KEY = "assistant-llm-base-url";
const MODEL_KEY = "assistant-llm-model";
const API_KEY_KEY = "assistant-llm-api-key";

export const DEFAULT_LLM_BASE_URL = "https://api.deepseek.com/v1";
export const DEFAULT_LLM_MODEL = "deepseek-chat";

export type AssistantLlmSettings = {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
};

export async function getAssistantLlmSettings(): Promise<AssistantLlmSettings> {
  const [baseUrl, model, apiKey] = await Promise.all([
    AsyncStorage.getItem(BASE_URL_KEY),
    AsyncStorage.getItem(MODEL_KEY),
    SecureStore.getItemAsync(API_KEY_KEY).catch(() => null),
  ]);
  return {
    baseUrl: baseUrl?.trim() || DEFAULT_LLM_BASE_URL,
    model: model?.trim() || DEFAULT_LLM_MODEL,
    hasApiKey: Boolean(apiKey),
  };
}

export async function getAssistantApiKey(): Promise<string | null> {
  return SecureStore.getItemAsync(API_KEY_KEY).catch(() => null);
}

export async function saveAssistantLlmSettings(settings: {
  baseUrl: string;
  model: string;
  apiKey: string;
}) {
  await Promise.all([
    AsyncStorage.setItem(BASE_URL_KEY, settings.baseUrl.trim()),
    AsyncStorage.setItem(MODEL_KEY, settings.model.trim()),
  ]);
  const key = settings.apiKey.trim();
  if (key) {
    await SecureStore.setItemAsync(API_KEY_KEY, key);
  }
}

export async function clearAssistantApiKey() {
  await SecureStore.deleteItemAsync(API_KEY_KEY).catch(() => {});
}
