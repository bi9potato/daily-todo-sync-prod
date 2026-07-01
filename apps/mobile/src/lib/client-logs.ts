import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import { AppState, Platform } from "react-native";

import { uploadClientLogs } from "./api";
import type {
  ClientLogEntryPayload,
  ClientLogLevel,
} from "@/types";

const MAX_QUEUE_SIZE = 250;
const MAX_UPLOAD_BATCH_SIZE = 100;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_STACK_LENGTH = 12000;
const LOG_DIRECTORY = `${FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? ""}client-logs/`;
const QUEUE_FILE = `${LOG_DIRECTORY}queue.json`;
const DEVICE_FILE = `${LOG_DIRECTORY}device-id.txt`;
const SESSION_FILE = `${LOG_DIRECTORY}session.json`;
const sessionId = createId("session");

type SessionMarker = {
  sessionId: string;
  state: "active" | "background";
  updatedAt: string;
};

let installed = false;
let initialized = false;
let initializing: Promise<void> | null = null;
let flushing: Promise<void> | null = null;
let queue: ClientLogEntryPayload[] = [];
let deviceId = "";
let persistPromise = Promise.resolve();
let originalConsoleWarn = console.warn;
let originalConsoleError = console.error;

type ErrorUtilsLike = {
  getGlobalHandler?: () => (error: Error, isFatal?: boolean) => void;
  setGlobalHandler?: (
    handler: (error: Error, isFatal?: boolean) => void,
  ) => void;
};

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function truncate(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

function serializeArg(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getErrorStack(value: unknown) {
  return value instanceof Error && value.stack
    ? truncate(value.stack, MAX_STACK_LENGTH)
    : "";
}

function appVersion() {
  return (
    Constants.expoConfig?.version ||
    Constants.nativeAppVersion ||
    "development"
  );
}

function buildSha() {
  const value = Constants.expoConfig?.extra?.buildSha;
  return typeof value === "string" ? value : "development";
}

function osVersion() {
  return Platform.Version ? String(Platform.Version) : "";
}

async function ensureDirectory() {
  if (!LOG_DIRECTORY) {
    return;
  }
  await FileSystem.makeDirectoryAsync(LOG_DIRECTORY, { intermediates: true });
}

async function readJsonFile<T>(uri: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await FileSystem.readAsStringAsync(uri)) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(uri: string, value: unknown) {
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(value));
}

async function readOrCreateDeviceId() {
  try {
    const existing = (await FileSystem.readAsStringAsync(DEVICE_FILE)).trim();
    if (existing) {
      return existing;
    }
  } catch {
    // Create a device id below.
  }
  const nextDeviceId = createId("device");
  await FileSystem.writeAsStringAsync(DEVICE_FILE, nextDeviceId);
  return nextDeviceId;
}

function schedulePersist() {
  if (!initialized || !LOG_DIRECTORY) {
    return;
  }
  const snapshot = queue.slice(-MAX_QUEUE_SIZE);
  persistPromise = persistPromise
    .catch(() => undefined)
    .then(() => writeJsonFile(QUEUE_FILE, snapshot))
    .catch((error) => originalConsoleWarn("Client log persist failed", error));
}

export function recordClientLog(
  level: ClientLogLevel,
  message: string,
  options: {
    source?: string;
    stack?: string;
    context?: Record<string, unknown>;
  } = {},
) {
  const entry: ClientLogEntryPayload = {
    clientId: createId("log"),
    occurredAt: new Date().toISOString(),
    level,
    source: options.source ?? "app",
    message: truncate(message, MAX_MESSAGE_LENGTH),
    stack: options.stack ? truncate(options.stack, MAX_STACK_LENGTH) : "",
    context: options.context ?? {},
  };
  queue = [...queue, entry].slice(-MAX_QUEUE_SIZE);
  schedulePersist();
}

async function writeSessionMarker(state: SessionMarker["state"]) {
  await writeJsonFile(SESSION_FILE, {
    sessionId,
    state,
    updatedAt: new Date().toISOString(),
  } satisfies SessionMarker);
}

async function initialize() {
  if (initialized) {
    return;
  }
  if (initializing) {
    return initializing;
  }
  initializing = (async () => {
    await ensureDirectory();
    queue = await readJsonFile<ClientLogEntryPayload[]>(QUEUE_FILE, []);
    deviceId = await readOrCreateDeviceId();
    const previous = await readJsonFile<SessionMarker | null>(SESSION_FILE, null);
    if (previous?.state === "active" && previous.sessionId !== sessionId) {
      recordClientLog("warn", "Previous app session ended while active", {
        source: "session-recovery",
        context: {
          previousSessionId: previous.sessionId,
          previousUpdatedAt: previous.updatedAt,
        },
      });
    }
    initialized = true;
    await writeSessionMarker("active");
    schedulePersist();
  })().finally(() => {
    initializing = null;
  });
  return initializing;
}

function installConsoleCapture() {
  console.warn = (...args: unknown[]) => {
    originalConsoleWarn(...args);
    recordClientLog("warn", args.map(serializeArg).join(" "), {
      source: "console.warn",
      stack: getErrorStack(args.find((item) => item instanceof Error)),
    });
  };
  console.error = (...args: unknown[]) => {
    originalConsoleError(...args);
    recordClientLog("error", args.map(serializeArg).join(" "), {
      source: "console.error",
      stack: getErrorStack(args.find((item) => item instanceof Error)),
    });
  };
}

function installGlobalErrorCapture() {
  const errorUtils = (globalThis as typeof globalThis & {
    ErrorUtils?: ErrorUtilsLike;
  }).ErrorUtils;
  const previousHandler = errorUtils?.getGlobalHandler?.();
  errorUtils?.setGlobalHandler?.((error, isFatal) => {
    recordClientLog(isFatal ? "fatal" : "error", error.message, {
      source: "global-error",
      stack: error.stack,
      context: { isFatal: Boolean(isFatal) },
    });
    previousHandler?.(error, isFatal);
  });
}

function installAppStateCapture() {
  AppState.addEventListener("change", (state) => {
    void initialize().then(() => {
      if (state === "active") {
        void writeSessionMarker("active");
      } else if (state === "background") {
        void writeSessionMarker("background");
        void flushClientLogs();
      }
    });
  });
}

export function installClientLogCapture() {
  if (installed) {
    return;
  }
  installed = true;
  installConsoleCapture();
  installGlobalErrorCapture();
  installAppStateCapture();
  void initialize().then(() =>
    recordClientLog("info", "Client log capture installed", {
      source: "startup",
    }),
  );
}

export async function flushClientLogs() {
  if (flushing) {
    return flushing;
  }
  flushing = (async () => {
    await initialize();
    await persistPromise.catch(() => undefined);
    if (!queue.length) {
      return;
    }
    const entries = queue.slice(0, MAX_UPLOAD_BATCH_SIZE);
    await uploadClientLogs({
      sessionId,
      deviceId,
      appVersion: appVersion(),
      buildSha: buildSha(),
      platform: Platform.OS,
      osVersion: osVersion(),
      entries,
    });
    const uploadedIds = new Set(entries.map((entry) => entry.clientId));
    queue = queue.filter((entry) => !uploadedIds.has(entry.clientId));
    schedulePersist();
  })().catch((error) => {
    originalConsoleWarn("Client log upload failed", error);
  }).finally(() => {
    flushing = null;
  });
  return flushing;
}
