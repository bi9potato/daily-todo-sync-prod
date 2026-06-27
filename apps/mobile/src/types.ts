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
  repeat: RepeatRule;
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
