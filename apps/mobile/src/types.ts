export type User = {
  id: string;
  username: string;
  email: string;
  displayName: string;
};

export type DeletedTodoOccurrence = TodoOccurrence & {
  deletedAt: string | null;
};

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  tokenType: "bearer";
};

export type RepeatKind =
  | "none"
  | "daily"
  | "weekdays"
  | "weekly"
  | "monthly"
  | "yearly";

export type RepeatRule = {
  kind: RepeatKind;
  interval: number;
  daysOfWeek: number[];
  until: string | null;
};

export type TaskAttachment = {
  id: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  contentUrl: string;
};

export type TaskLocation = {
  name: string;
  latitude: number;
  longitude: number;
  recordedAt: string;
};

export type TodoOccurrence = {
  id: string;
  taskId: string;
  rootId: string;
  taskDate: string;
  text: string;
  note: string;
  status: "pending" | "done";
  source: "manual" | "carryover" | "recurring";
  sortOrder: number;
  isPinned: boolean;
  isLowPriority: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  carryoverFromOccurrenceId: string | null;
  firstCreatedAt: string;
  reminderTime: string | null;
  reminderAt: string | null;
  isRecurring: boolean;
  isLongTerm: boolean;
  isArchived: boolean;
  archivedAt: string | null;
  repeat: RepeatRule;
  location: TaskLocation | null;
  attachments: TaskAttachment[];
};

export type DayTodos = {
  date: string;
  pending: TodoOccurrence[];
  done: TodoOccurrence[];
};

export type RangeTodos = {
  start: string;
  end: string;
  days: DayTodos[];
};

export type TaskCreatePayload = {
  text: string;
  note?: string;
  isLongTerm?: boolean;
  isLowPriority?: boolean;
  reminderTime?: string | null;
  repeat?: RepeatRule;
  // Lets the backend use this as the occurrence's final ID (see
  // create_task_for_day), so an offline-created todo never needs a
  // temporary-ID-to-real-ID swap once it syncs.
  clientId?: string;
};

export type TaskUpdatePayload = {
  done?: boolean;
  text?: string;
  note?: string;
  pinned?: boolean;
  isLongTerm?: boolean;
  isLowPriority?: boolean;
  reminderTime?: string | null;
  repeat?: RepeatRule;
  location?: TaskLocation | null;
};

export type MobilityPoint = {
  recordedAt: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  placeName: string;
};

export type MobilityRecording = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  isActive: boolean;
  stepCount: number;
  distanceMeters: number;
  durationMinutes: number;
};

export type MobilitySegment = {
  type: "visit" | "trip";
  startTime: string;
  endTime: string;
  durationMinutes: number;
  latitude: number | null;
  longitude: number | null;
  endLatitude: number | null;
  endLongitude: number | null;
  distanceMeters: number | null;
  mode:
    | "WALKING"
    | "CYCLING"
    | "IN_VEHICLE"
    | "SUBWAY"
    | "TRAIN"
    | "HIGH_SPEED_RAIL"
    | "FLIGHT"
    | null;
};

export type MobilityDay = {
  date: string;
  stepCount: number;
  distanceMeters: number;
  durationMinutes: number;
  activeRecording: MobilityRecording | null;
  recordings: MobilityRecording[];
  points: MobilityPoint[];
  segments: MobilitySegment[];
};

export type MobilityTimelineExport = {
  timelineObjects: unknown[];
};

export type DeviceTimelineItem = {
  type: "app" | "screen_on" | "screen_off" | "unlock" | "shutdown" | "boot";
  time: string | null;
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number | null;
  packageName: string | null;
  appLabel: string | null;
};

export type DeviceTimelineDay = {
  date: string;
  timeline: DeviceTimelineItem[];
};

export type MobilityPointInput = {
  clientId: string;
  recordedAt: string;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  altitude?: number | null;
  speed?: number | null;
  heading?: number | null;
  placeName?: string;
};

export type AiChatResult = {
  reply: string;
  actions: {
    type: string;
    label: string;
    taskId: string | null;
  }[];
};

export type GoogleCalendarStatus = {
  configured: boolean;
  connected: boolean;
  googleBound: boolean;
  googleEmail: string;
  googleName: string;
  calendarAuthorized: boolean;
  canUseCalendarSync: boolean;
  syncEnabled: boolean;
  calendarId: string;
  calendarName: string;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastError: string;
  syncedCount: number;
  failedCount: number;
  accounts: GoogleCalendarAccount[];
};

export type GoogleCalendarAccount = {
  id: string;
  googleEmail: string;
  googleName: string;
  calendarAuthorized: boolean;
  syncEnabled: boolean;
  calendarId: string;
  calendarName: string;
  connectedAt: string;
  lastSyncAt: string | null;
  lastError: string;
  isPrimary: boolean;
};

export type GoogleCalendarAuthUrl = {
  authorizationUrl: string;
};

export type LocalAttachmentFile = {
  uri: string;
  name: string;
  type: string;
};

export type GoogleCalendarSyncResult = {
  start: string;
  end: string;
  synced: number;
};

export type MobileRelease = {
  versionName: string;
  versionCode: number;
  buildSha: string;
  architecture: "arm64-v8a";
  apkUrl: string;
  releaseUrl: string;
  publishedAt: string;
};

export type ClientLogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export type ClientLogEntryPayload = {
  clientId: string;
  occurredAt: string;
  level: ClientLogLevel;
  source: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
};

export type ClientLogBatchPayload = {
  sessionId: string;
  deviceId: string;
  appVersion: string;
  buildSha: string;
  platform: string;
  osVersion: string;
  entries: ClientLogEntryPayload[];
};
