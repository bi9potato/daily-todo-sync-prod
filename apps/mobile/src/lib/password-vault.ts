import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// Device-local credential vault. Entries live in the platform secure store
// (Android Keystore-backed encryption) and are deliberately never synced to
// the API or written into the persisted React Query cache - that cache is
// plaintext AsyncStorage. One key per entry plus an id index keeps each
// value far below SecureStore's ~2KB per-value comfort zone.

export type PasswordField = {
  id: string;
  label: string;
  value: string;
};

export type PasswordEntry = {
  id: string;
  name: string;
  note: string;
  fields: PasswordField[];
  createdAt: string;
  updatedAt: string;
};

export type PasswordEntryDraft = {
  id?: string;
  name: string;
  note: string;
  fields: { id?: string; label: string; value: string }[];
  createdAt?: string;
};

const INDEX_KEY = "pwvault.v1.index";
const ENTRY_KEY_PREFIX = "pwvault.v1.entry.";

// SecureStore keys only accept [A-Za-z0-9._-], so ids are generated to fit.
function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export function isPasswordVaultAvailable() {
  return Platform.OS !== "web";
}

async function readIndex(): Promise<string[]> {
  const raw = await SecureStore.getItemAsync(INDEX_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

async function writeIndex(ids: string[]) {
  await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify(ids));
}

function parseEntry(raw: string | null): PasswordEntry | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PasswordEntry>;
    if (typeof parsed?.id !== "string" || typeof parsed?.name !== "string") {
      return null;
    }
    return {
      id: parsed.id,
      name: parsed.name,
      note: typeof parsed.note === "string" ? parsed.note : "",
      fields: Array.isArray(parsed.fields)
        ? parsed.fields.filter(
            (field): field is PasswordField =>
              typeof field?.id === "string" &&
              typeof field?.label === "string" &&
              typeof field?.value === "string",
          )
        : [],
      createdAt: parsed.createdAt ?? new Date().toISOString(),
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function listPasswordEntries(): Promise<PasswordEntry[]> {
  const ids = await readIndex();
  const raws = await Promise.all(
    ids.map((id) => SecureStore.getItemAsync(ENTRY_KEY_PREFIX + id)),
  );
  return raws
    .map(parseEntry)
    .filter((entry): entry is PasswordEntry => entry !== null);
}

export async function savePasswordEntry(
  draft: PasswordEntryDraft,
): Promise<PasswordEntry> {
  const now = new Date().toISOString();
  const entry: PasswordEntry = {
    id: draft.id ?? createId("entry"),
    name: draft.name.trim(),
    note: draft.note.trim(),
    fields: draft.fields
      .map((field) => ({
        id: field.id ?? createId("field"),
        label: field.label.trim(),
        value: field.value,
      }))
      .filter((field) => field.label || field.value),
    createdAt: draft.createdAt ?? now,
    updatedAt: now,
  };
  await SecureStore.setItemAsync(
    ENTRY_KEY_PREFIX + entry.id,
    JSON.stringify(entry),
  );
  const ids = await readIndex();
  if (!ids.includes(entry.id)) {
    await writeIndex([...ids, entry.id]);
  }
  return entry;
}

export async function deletePasswordEntry(id: string) {
  await SecureStore.deleteItemAsync(ENTRY_KEY_PREFIX + id);
  const ids = await readIndex();
  if (ids.includes(id)) {
    await writeIndex(ids.filter((item) => item !== id));
  }
}
