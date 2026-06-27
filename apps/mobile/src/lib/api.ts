import { clearTokens, getMemoryTokens, loadTokens, saveTokens } from "./auth-storage";
import type {
  AiChatResult,
  DayTodos,
  DeletedTodoOccurrence,
  GoogleCalendarAuthUrl,
  GoogleCalendarStatus,
  GoogleCalendarSyncResult,
  LocalAttachmentFile,
  MobileRelease,
  RangeTodos,
  TaskAttachment,
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

export function updateMe(payload: { displayName: string }) {
  return request<User>("/auth/me", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function getLatestMobileRelease() {
  return request<MobileRelease>("/mobile/releases/latest", {}, false);
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

export function copyLongTermOccurrenceAsRegular(id: string) {
  return request<TodoOccurrence>(`/occurrences/${id}/copy-regular`, {
    method: "POST",
  });
}

export function reorderDay(date: string, orderedIds: string[]) {
  return request<void>(`/days/${date}/reorder`, {
    method: "PATCH",
    body: JSON.stringify({ orderedIds }),
  });
}

export function deleteOccurrence(id: string) {
  return request<void>(`/occurrences/${id}`, { method: "DELETE" });
}

export function getTrash() {
  return request<DeletedTodoOccurrence[]>("/trash");
}

export function clearTrash() {
  return request<void>("/trash", { method: "DELETE" });
}

export function restoreOccurrence(id: string) {
  return request<TodoOccurrence>(`/occurrences/${id}/restore`, {
    method: "POST",
  });
}

export function uploadTaskAttachment(
  occurrenceId: string,
  file: LocalAttachmentFile,
) {
  const formData = new FormData();
  formData.append("file", file as unknown as Blob);
  return request<TaskAttachment>(
    `/occurrences/${occurrenceId}/attachments`,
    { method: "POST", body: formData },
  );
}

export function deleteTaskAttachment(
  attachmentId: string,
  occurrenceId?: string,
) {
  const query = occurrenceId
    ? `?occurrenceId=${encodeURIComponent(occurrenceId)}`
    : "";
  return request<void>(`/attachments/${attachmentId}${query}`, {
    method: "DELETE",
  });
}

export function reorderTaskAttachments(
  occurrenceId: string,
  orderedIds: string[],
) {
  return request<void>(`/occurrences/${occurrenceId}/attachments/reorder`, {
    method: "PATCH",
    body: JSON.stringify({ orderedIds }),
  });
}

export async function getAuthenticatedMediaSource(contentUrl: string) {
  const tokens = getMemoryTokens() ?? (await loadTokens());
  if (!tokens) {
    throw new Error("请先登录。");
  }
  const origin = API_BASE_URL.replace(/\/api\/?$/, "");
  const uri = /^https?:\/\//i.test(contentUrl)
    ? contentUrl
    : contentUrl.startsWith("/api/")
      ? `${origin}${contentUrl}`
      : `${API_BASE_URL}/${contentUrl.replace(/^\//, "")}`;
  return {
    uri,
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  };
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

export function bindGoogleAccount() {
  return request<GoogleCalendarAuthUrl>("/integrations/google-account/bind", {
    method: "POST",
  });
}

export function disconnectGoogleAccount(connectionId?: string) {
  return request<void>("/integrations/google-account/disconnect", {
    method: "POST",
    body: JSON.stringify({ connectionId: connectionId ?? null }),
  });
}

export function authorizeGoogleCalendar(connectionId?: string) {
  return request<GoogleCalendarAuthUrl>(
    "/integrations/google-calendar/authorize",
    {
      method: "POST",
      body: JSON.stringify({ connectionId: connectionId ?? null }),
    },
  );
}

export function setGoogleCalendarSyncEnabled(
  enabled: boolean,
  connectionId?: string,
) {
  return request<GoogleCalendarStatus>(
    "/integrations/google-calendar/sync-enabled",
    {
      method: "PATCH",
      body: JSON.stringify({ enabled, connectionId: connectionId ?? null }),
    },
  );
}

export function syncGoogleCalendar(days = 45) {
  return request<GoogleCalendarSyncResult>(
    `/integrations/google-calendar/sync?days=${days}`,
    { method: "POST" },
  );
}
