import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { getMobilityDay } from "./api";
import { isMobilityActivationInProgress } from "./mobility-activation";
import {
  clearMobilityDiagnostics,
  type MobilityDiagnosticState,
} from "./mobility-diagnostics";
import {
  flushMobilityPointQueue,
  getQueuedMobilityPointCount,
  importNativeMobilityPointQueue,
} from "./mobility-queue";
import {
  clearActiveMobilityRecordingId,
  setActiveMobilityRecordingId,
} from "./mobility-storage";
import {
  getMobilityTrackingDiagnostics,
  isMobilityLocationTrackingActive,
  recoverMobilityLocationTracking,
  stopMobilityLocationTracking,
} from "./mobility-tracking";
import {
  reconcileMobilitySteps,
  type MobilityStepSource,
} from "./mobility-steps";
import type { MobilityRecording } from "@/types";

export type MobilityRuntimeState = MobilityDiagnosticState & {
  backgroundPermission: boolean;
  foregroundPermission: boolean;
  nativeBackgroundAvailable: boolean;
  nativeQueuedPointCount?: number;
  nativeTaskActive: boolean;
  queuedPointCount: number;
  stepSource: MobilityStepSource;
};

const INITIAL_STATE: MobilityRuntimeState = {
  backgroundPermission: false,
  foregroundPermission: false,
  lastError: "",
  lastLocationAt: null,
  lastSyncAt: null,
  nativeBackgroundAvailable: false,
  nativeQueuedPointCount: 0,
  nativeTaskActive: false,
  queuedPointCount: 0,
  recoveredAt: null,
  stepSource: "unavailable",
};

async function getSafeMobilityDiagnostics() {
  try {
    return await getMobilityTrackingDiagnostics();
  } catch (error) {
    console.warn("Mobility diagnostics unavailable", error);
    return {
      backgroundPermission: false,
      foregroundPermission: false,
      lastError:
        error instanceof Error ? error.message : "Mobility diagnostics unavailable",
      lastLocationAt: null,
      lastSyncAt: null,
      nativeBackgroundAvailable: false,
      nativeQueuedPointCount: 0,
      nativeTaskActive: false,
      recoveredAt: null,
    };
  }
}

function totalQueuedPointCount(
  localQueuedPointCount: number,
  diagnostics: Awaited<ReturnType<typeof getSafeMobilityDiagnostics>>,
) {
  return localQueuedPointCount + (diagnostics.nativeQueuedPointCount ?? 0);
}

export function useMobilityRuntime(today: string, enabled = true) {
  const queryClient = useQueryClient();
  const [runtime, setRuntime] = useState(INITIAL_STATE);
  const reconcilingRef = useRef(false);
  const activeRecordingRef = useRef<MobilityRecording | null>(null);
  const dayQuery = useQuery({
    queryKey: ["mobility-day", today],
    queryFn: () => getMobilityDay(today),
    enabled,
    refetchInterval: (query) =>
      enabled && query.state.data?.activeRecording ? 15_000 : false,
  });
  const activeRecording = dayQuery.data?.activeRecording ?? null;
  const activeRecordingId = activeRecording?.id ?? null;
  const dayLoaded = Boolean(dayQuery.data);
  const refetchDay = dayQuery.refetch;

  useEffect(() => {
    activeRecordingRef.current = activeRecording;
  }, [activeRecording]);

  const reconcile = useCallback(
    async (recording: MobilityRecording | null, dayLoaded: boolean) => {
      if (!enabled || Platform.OS === "web" || reconcilingRef.current) {
        return;
      }
      reconcilingRef.current = true;
      try {
        if (!recording) {
          if (
            dayLoaded &&
            (await isMobilityLocationTrackingActive())
          ) {
            await stopMobilityLocationTracking();
            await clearActiveMobilityRecordingId();
            await clearMobilityDiagnostics();
          }
          const diagnostics = await getSafeMobilityDiagnostics();
          const queuedPointCount = totalQueuedPointCount(
            await getQueuedMobilityPointCount(),
            diagnostics,
          );
          setRuntime({
            ...diagnostics,
            queuedPointCount,
            stepSource: "unavailable",
          });
          return;
        }

        await setActiveMobilityRecordingId(recording.id);
        await importNativeMobilityPointQueue();
        const [diagnostics, stepResult] = await Promise.all([
          recoverMobilityLocationTracking(recording.id),
          reconcileMobilitySteps(recording),
          flushMobilityPointQueue(),
        ]);
        if (
          stepResult.recording &&
          stepResult.recording.stepCount !== recording.stepCount
        ) {
          await queryClient.invalidateQueries({
            queryKey: ["mobility-day", today],
          });
        }
        const queuedPointCount = totalQueuedPointCount(
          await getQueuedMobilityPointCount(),
          diagnostics,
        );
        setRuntime({
          ...diagnostics,
          queuedPointCount,
          stepSource: stepResult.source,
        });
      } catch (error) {
        const diagnostics = await getSafeMobilityDiagnostics();
        const queuedPointCount = totalQueuedPointCount(
          await getQueuedMobilityPointCount(),
          diagnostics,
        );
        setRuntime({
          ...diagnostics,
          lastError:
            error instanceof Error ? error.message : "足迹后台服务恢复失败",
          queuedPointCount,
          stepSource: "unavailable",
        });
      } finally {
        reconcilingRef.current = false;
      }
    },
    [enabled, queryClient, today],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        if (isMobilityActivationInProgress()) {
          return;
        }
        void refetchDay().then(({ data }) =>
          reconcile(data?.activeRecording ?? null, Boolean(data)),
        );
      }
    });
    return () => subscription.remove();
  }, [enabled, reconcile, refetchDay]);

  useEffect(() => {
    if (!enabled || !dayLoaded) {
      return;
    }
    void reconcile(activeRecordingRef.current, true);
  }, [activeRecordingId, dayLoaded, enabled, reconcile]);

  useEffect(() => {
    if (!enabled || !activeRecordingId) {
      return;
    }
    const timer = setInterval(() => {
      void reconcile(activeRecordingRef.current, true);
    }, 30_000);
    return () => clearInterval(timer);
  }, [activeRecordingId, enabled, reconcile]);

  return runtime;
}
