import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { getMobilityDay } from "./api";
import {
  clearMobilityDiagnostics,
  type MobilityDiagnosticState,
} from "./mobility-diagnostics";
import {
  flushMobilityPointQueue,
  getQueuedMobilityPointCount,
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
  stopFallbackStepTracking,
  type MobilityStepSource,
} from "./mobility-steps";

export type MobilityRuntimeState = MobilityDiagnosticState & {
  backgroundPermission: boolean;
  foregroundPermission: boolean;
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
  nativeTaskActive: false,
  queuedPointCount: 0,
  recoveredAt: null,
  stepSource: "unavailable",
};

export function useMobilityRuntime(today: string) {
  const queryClient = useQueryClient();
  const [runtime, setRuntime] = useState(INITIAL_STATE);
  const reconcilingRef = useRef(false);
  const dayQuery = useQuery({
    queryKey: ["mobility-day", today],
    queryFn: () => getMobilityDay(today),
    refetchInterval: (query) =>
      query.state.data?.activeRecording ? 15_000 : false,
  });
  const activeRecording = dayQuery.data?.activeRecording ?? null;
  const refetchDay = dayQuery.refetch;

  const reconcile = useCallback(
    async (
      recording = activeRecording,
      dayLoaded = Boolean(dayQuery.data),
    ) => {
      if (Platform.OS === "web" || reconcilingRef.current) {
        return;
      }
      reconcilingRef.current = true;
      try {
        if (!recording) {
          if (dayLoaded && (await isMobilityLocationTrackingActive())) {
            await stopMobilityLocationTracking();
            await clearActiveMobilityRecordingId();
            await clearMobilityDiagnostics();
          }
          await stopFallbackStepTracking();
          const diagnostics = await getMobilityTrackingDiagnostics();
          setRuntime({
            ...diagnostics,
            queuedPointCount: await getQueuedMobilityPointCount(),
            stepSource: "unavailable",
          });
          return;
        }

        await setActiveMobilityRecordingId(recording.id);
        const [diagnostics, stepResult] = await Promise.all([
          recoverMobilityLocationTracking(recording.id),
          reconcileMobilitySteps(recording),
          flushMobilityPointQueue(),
        ]);
        if (stepResult.recording) {
          await queryClient.invalidateQueries({
            queryKey: ["mobility-day", today],
          });
        }
        setRuntime({
          ...diagnostics,
          queuedPointCount: await getQueuedMobilityPointCount(),
          stepSource: stepResult.source,
        });
      } catch (error) {
        const diagnostics = await getMobilityTrackingDiagnostics();
        setRuntime({
          ...diagnostics,
          lastError:
            error instanceof Error ? error.message : "足迹后台服务恢复失败",
          queuedPointCount: await getQueuedMobilityPointCount(),
          stepSource: "unavailable",
        });
      } finally {
        reconcilingRef.current = false;
      }
    },
    [activeRecording, dayQuery.data, queryClient, today],
  );

  useEffect(() => {
    const startupTimer = setTimeout(() => {
      void reconcile();
    }, 0);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refetchDay().then(({ data }) =>
          reconcile(data?.activeRecording ?? null, Boolean(data)),
        );
      }
    });
    return () => {
      clearTimeout(startupTimer);
      subscription.remove();
    };
  }, [reconcile, refetchDay]);

  useEffect(() => {
    if (!activeRecording) {
      return;
    }
    const timer = setInterval(() => {
      void reconcile();
    }, 30_000);
    return () => clearInterval(timer);
  }, [activeRecording, reconcile]);

  return runtime;
}
