import { clearTokens, getMemoryTokens, loadTokens, saveTokens } from "./auth-storage";
import type {
  AiChatResult,
  DayTodos,
  GoogleCalendarStatus,
  GoogleCalendarSyncResult,
  RangeTodos,
  TaskCreatePayload,
  TaskUpdatePayload,
  TodoOccurrence,
  TokenPair,
  User,
} from "@/types";

const DEFAULT_API_URL = "https://68.183.180.19.sslip.io/api";
const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_BASE_URL || DEFAULT_API_URL
).replace(/\/$/, "");

let refreshPromise: Promise<string> | null = null;

function formatErrorDetail(detail: unknown): string | null {
  if (typeof detail === "string") {
    return detail;
  }
  if (Array.isArray(detail)) {
    const messages = detail
      .map(formatErrorDetail)
      .filter((item): item is string => Boolean(item));
    return messages.length ? messages.join("\n") : null;
  }
  if (detail && typeof detail === "object") {
    const messages = Object.values(detail)
      .map(formatErrorDetail)
      .filter((item): item is string => Boolean(item));
    return messages.length ? messages.join("\n") : null;
  }
  return null;
}

async function readErrorMessage(response: Response) {
  const fallback = `请求失败（${response.status}）`;
  const text = await response.text();
  if (!text) {
    return fallback;
  }

  try {
    const body = JSON.parse(text) as {
      detail?: unknown;
      message?: unknown;
      error?: unknown;
    };
    return (
      formatErrorDetail(body.detail) ??
      formatErrorDetail(body.message) ??
      formatErrorDetail(body.error) ??
      fallback
    );
  } catch {
    return text;
  }
}

async function refreshAccessToken() {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const tokens = getMemoryTokens() ?? (await loadTokens());
    if (!tokens?.refreshToken) {
      throw new Error("登录已过期，请重新登录。");
    }

    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });
    if (!response.ok) {
      await clearTokens();
      throw new Error(await readErrorMessage(response));
    }

    const nextTokens = (await response.json()) as TokenPair;
    await saveTokens(nextTokens);
    return nextTokens.accessToken;
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  authenticated = true,
  canRetry = true,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (authenticated) {
    const tokens = getMemoryTokens() ?? (await loadTokens());
    if (!tokens) {
      throw new Error("请先登录。");
    }
    headers.set("Authorization", `Bearer ${tokens.accessToken}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401 && authenticated && canRetry) {
    const accessToken = await refreshAccessToken();
    headers.set("Authorization", `Bearer ${accessToken}`);
    return request<T>(path, { ...options, headers }, true, false);
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export function login(payload: { identifier: string; password: string }) {
  return request<TokenPair>(
    "/auth/login",
    { method: "POST", body: JSON.stringify(payload) },
    false,
  );
}

export function register(payload: {
  username: string;
  email: string;
  password: string;
}) {
  return request<TokenPair>(
    "/auth/register",
    { method: "POST", body: JSON.stringify(payload) },
    false,
  );
}

export function getMe() {
  return request<User>("/auth/me");
}

export function getDay(date: string) {
  return request<DayTodos>(`/days/${date}`);
}

export function getRange(start: string, end: string) {
  return request<RangeTodos>(`/range?start=${start}&end=${end}`);
}

export function createTask(date: string, payload: TaskCreatePayload) {
  return request<TodoOccurrence>(`/days/${date}/tasks`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateOccurrence(id: string, payload: TaskUpdatePayload) {
  return request<TodoOccurrence>(`/occurrences/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteOccurrence(id: string) {
  return request<void>(`/occurrences/${id}`, { method: "DELETE" });
}

export function chatWithAi(message: string, date?: string) {
  return request<AiChatResult>("/ai/chat", {
    method: "POST",
    body: JSON.stringify({ message, date }),
  });
}

export function getGoogleCalendarStatus() {
  return request<GoogleCalendarStatus>("/integrations/google-calendar/status");
}

export function syncGoogleCalendar(days = 45) {
  return request<GoogleCalendarSyncResult>(
    `/integrations/google-calendar/sync?days=${days}`,
    { method: "POST" },
  );
}
