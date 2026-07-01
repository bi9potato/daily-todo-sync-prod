import { File as ExpoFile, UploadType } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";

import { clearTokens, getMemoryTokens, loadTokens, saveTokens } from "./auth-storage";
import type {
  AiChatResult,
  ClientLogBatchPayload,
  DayTodos,
  DeletedTodoOccurrence,
  GoogleCalendarAuthUrl,
  GoogleCalendarStatus,
  GoogleCalendarSyncResult,
  LocalAttachmentFile,
  MobileRelease,
  MobilityDay,
  MobilityPointInput,
  MobilityRecording,
  MobilityTimelineExport,
  RangeTodos,
  TaskAttachment,
  TaskCreatePayload,
  TaskUpdatePayload,
  TodoOccurrence,
  TokenPair,
  User,
} from "@/types";

const DEFAULT_API_URL = "https://68.183.180.19.sslip.io/api";
export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_BASE_URL || DEFAULT_API_URL
).replace(/\/$/, "");

// Requests used to have no timeout at all, so a slow or hung backend call
// (e.g. a lock-contended request) left the UI stuck on a spinner
// indefinitely with nothing the user could do — which reads as "the app is
// frozen." Aborting after a generous timeout at least turns that into a
// recoverable error.
const REQUEST_TIMEOUT_MS = 20_000;

let refreshPromise: Promise<string> | null = null;

async function fetchWithTimeout(url: string, options: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("请求超时，请检查网络后重试。");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

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

function readUploadResultErrorMessage(status: number, body: string) {
  const fallback = `请求失败（${status}）`;
  if (!body) {
    return fallback;
  }

  try {
    const payload = JSON.parse(body) as {
      detail?: unknown;
      message?: unknown;
      error?: unknown;
    };
    return (
      formatErrorDetail(payload.detail) ??
      formatErrorDetail(payload.message) ??
      formatErrorDetail(payload.error) ??
      fallback
    );
  } catch {
    return body;
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

    const response = await fetchWithTimeout(`${API_BASE_URL}/auth/refresh`, {
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

  const response = await fetchWithTimeout(`${API_BASE_URL}${path}`, {
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

function safeUploadFilename(name: string) {
  return name.trim().replace(/[^A-Za-z0-9._-]/g, "_") || `attachment-${Date.now()}`;
}

async function prepareUploadUri(file: LocalAttachmentFile) {
  if (!FileSystem.cacheDirectory) {
    return { cleanupUri: null, uri: file.uri };
  }

  const uploadDirectory = `${FileSystem.cacheDirectory}upload-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}/`;
  const uploadUri = `${uploadDirectory}${safeUploadFilename(file.name)}`;

  try {
    await FileSystem.makeDirectoryAsync(uploadDirectory, { intermediates: true });
    await FileSystem.copyAsync({ from: file.uri, to: uploadUri });
    return { cleanupUri: uploadDirectory, uri: uploadUri };
  } catch {
    return { cleanupUri: null, uri: file.uri };
  }
}

async function removeTemporaryUploadFile(cleanupUri: string | null) {
  if (!cleanupUri) {
    return;
  }

  try {
    await FileSystem.deleteAsync(cleanupUri, { idempotent: true });
  } catch {
    // Ignore cleanup failures; the upload result is more important.
  }
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

export function uploadClientLogs(payload: ClientLogBatchPayload) {
  return request<{ accepted: number }>("/diagnostics/client-logs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getDay(date: string) {
  return request<DayTodos>(`/days/${date}`);
}

export function getRange(start: string, end: string) {
  return request<RangeTodos>(`/range?start=${start}&end=${end}`);
}

export function getMobilityDay(date: string, dwellMinutes?: number) {
  const query = dwellMinutes ? `?dwellMinutes=${dwellMinutes}` : "";
  return request<MobilityDay>(`/mobility/days/${date}${query}`);
}

export function startMobilityRecording() {
  return request<MobilityRecording>("/mobility/recordings/start", {
    method: "POST",
  });
}

export function stopMobilityRecording(id: string) {
  return request<MobilityRecording>(`/mobility/recordings/${id}/stop`, {
    method: "POST",
  });
}

export function clearMobilityHistory() {
  return request<void>("/mobility/history", { method: "DELETE" });
}

export function exportMobilityHistory(start: string, end: string) {
  return request<MobilityTimelineExport>(
    `/mobility/export?start=${start}&end=${end}`,
  );
}

export function addMobilityPoints(id: string, points: MobilityPointInput[]) {
  return request<MobilityRecording>(`/mobility/recordings/${id}/points`, {
    method: "POST",
    body: JSON.stringify({ points }),
  });
}

export function setMobilityStepSample(
  id: string,
  payload: { sourceId: string; stepCount: number; recordedAt: string },
) {
  return request<MobilityRecording>(`/mobility/recordings/${id}/steps`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
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

export async function uploadTaskAttachment(
  occurrenceId: string,
  file: LocalAttachmentFile,
  canRetry = true,
): Promise<TaskAttachment> {
  const tokens = getMemoryTokens() ?? (await loadTokens());
  if (!tokens) {
    throw new Error("请先登录。");
  }

  const upload = await prepareUploadUri(file);
  try {
    const result = await new ExpoFile(upload.uri).upload(
      `${API_BASE_URL}/occurrences/${occurrenceId}/attachments`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        fieldName: "file",
        httpMethod: "POST",
        mimeType: file.type,
        uploadType: UploadType.MULTIPART,
      },
    );

    if (result.status === 401 && canRetry) {
      await refreshAccessToken();
      return uploadTaskAttachment(occurrenceId, file, false);
    }

    if (result.status < 200 || result.status >= 300) {
      throw new Error(readUploadResultErrorMessage(result.status, result.body));
    }

    return JSON.parse(result.body) as TaskAttachment;
  } finally {
    await removeTemporaryUploadFile(upload.cleanupUri);
  }
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

export function resolveMediaUrl(contentUrl: string) {
  const origin = API_BASE_URL.replace(/\/api\/?$/, "");
  return /^https?:\/\//i.test(contentUrl)
    ? contentUrl
    : contentUrl.startsWith("/api/")
      ? `${origin}${contentUrl}`
      : `${API_BASE_URL}/${contentUrl.replace(/^\//, "")}`;
}

export async function getAuthenticatedMediaSource(contentUrl: string) {
  const tokens = getMemoryTokens() ?? (await loadTokens());
  if (!tokens) {
    throw new Error("请先登录。");
  }
  return {
    uri: resolveMediaUrl(contentUrl),
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  };
}

export async function getAuthenticatedMediaBlob(
  contentUrl: string,
  canRetry = true,
) {
  const tokens = getMemoryTokens() ?? (await loadTokens());
  if (!tokens) {
    throw new Error("请先登录。");
  }
  const response = await fetchWithTimeout(resolveMediaUrl(contentUrl), {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  if (response.status === 401 && canRetry) {
    await refreshAccessToken();
    return getAuthenticatedMediaBlob(contentUrl, false);
  }
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return response.blob();
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
