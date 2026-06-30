import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

export type MobilityDiagnosticState = {
  lastError: string;
  lastLocationAt: string | null;
  lastSyncAt: string | null;
  recoveredAt: string | null;
};

const EMPTY_STATE: MobilityDiagnosticState = {
  lastError: "",
  lastLocationAt: null,
  lastSyncAt: null,
  recoveredAt: null,
};
const DIAGNOSTICS_FILE = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}mobility-diagnostics.json`
  : null;

export async function readMobilityDiagnostics(): Promise<MobilityDiagnosticState> {
  if (Platform.OS === "web" || !DIAGNOSTICS_FILE) {
    return EMPTY_STATE;
  }
  try {
    const content = await FileSystem.readAsStringAsync(DIAGNOSTICS_FILE);
    return { ...EMPTY_STATE, ...JSON.parse(content) };
  } catch {
    return EMPTY_STATE;
  }
}

export async function updateMobilityDiagnostics(
  patch: Partial<MobilityDiagnosticState>,
) {
  if (Platform.OS === "web" || !DIAGNOSTICS_FILE) {
    return;
  }
  const current = await readMobilityDiagnostics();
  await FileSystem.writeAsStringAsync(
    DIAGNOSTICS_FILE,
    JSON.stringify({ ...current, ...patch }),
  );
}

export async function clearMobilityDiagnostics() {
  if (Platform.OS === "web" || !DIAGNOSTICS_FILE) {
    return;
  }
  await FileSystem.deleteAsync(DIAGNOSTICS_FILE, { idempotent: true });
}
