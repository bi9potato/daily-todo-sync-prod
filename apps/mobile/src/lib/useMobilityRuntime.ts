import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, InteractionManager, Platform } from "react-native";
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
import type { MobilityDay, MobilityRecording } from "@/types";

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

// Resuming from another app or the lock screen replays the window
// transition; kicking the reconcile pipeline at that exact moment makes the
// first frames stutter. Android's own transition finishes well inside this.
const RESUME_RECONCILE_DELAY_MS = 600;

function sameRuntimeState(a: MobilityRuntimeState, b: MobilityRuntimeState) {
  const keys = new Set([
    ...Object.keys(a),
    ...Object.keys(b),
  ]) as Set<keyof MobilityRuntimeState>;
  return [...keys].every((key) => a[key] === b[key]);
}

export function useMobilityRuntime(today: string, enabled = true) {
  const queryClient = useQueryClient();
  const [runtime, setRuntimeState] = useState(INITIAL_STATE);
  const runtimeRef = useRef(runtime);
  const reconcilingRef = useRef(false);
  const hasReconciledRef = useRef(false);
  const activeRecordingRef = useRef<MobilityRecording | null>(null);

  // Every reconcile builds a fresh state object even when nothing changed,
  // and this state is folded into the app-shell context value - so an
  // identical-but-new object would re-render every screen in the shell.
  const setRuntime = useCallback((next: MobilityRuntimeState) => {
    runtimeRef.current = next;
    setRuntimeState((current) => (sameRuntimeState(current, next) ? current : next));
  }, []);
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
        hasReconciledRef.current = true;
      }
    },
    [enabled, queryClient, setRuntime, today],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    const subscription = AppState.addEventListener("change", (state) => {
      if (resumeTimer) {
        clearTimeout(resumeTimer);
        resumeTimer = null;
      }
      if (state !== "active") {
        return;
      }
      resumeTimer = setTimeout(() => {
        resumeTimer = null;
        if (isMobilityActivationInProgress()) {
          return;
        }
        // Nothing to recover, upload, or shut down: skip the refetch and
        // the native probes entirely instead of paying for them (and the
        // re-renders they cause) on every unlock.
        const cachedDay = queryClient.getQueryData<MobilityDay>([
          "mobility-day",
          today,
        ]);
        const known = runtimeRef.current;
        if (
          hasReconciledRef.current &&
          !cachedDay?.activeRecording &&
          !known.nativeTaskActive &&
          known.queuedPointCount === 0 &&
          (known.nativeQueuedPointCount ?? 0) === 0
        ) {
          return;
        }
        // The fixed delay above covers Android's own native window-resume
        // transition (invisible to JS); this additionally waits out any
        // in-flight JS-thread interaction (e.g. a screen transition still
        // animating) using the standard React Native primitive for it,
        // rather than a second guessed delay.
        InteractionManager.runAfterInteractions(() => {
          void refetchDay().then(({ data }) =>
            reconcile(data?.activeRecording ?? null, Boolean(data)),
          );
        });
      }, RESUME_RECONCILE_DELAY_MS);
    });
    return () => {
      if (resumeTimer) {
        clearTimeout(resumeTimer);
      }
      subscription.remove();
    };
  }, [enabled, queryClient, reconcile, refetchDay, today]);

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
      // The mobility foreground service keeps this JS process alive around
      // the clock, so without this gate the periodic native probes would
      // run all night with the app backgrounded.
      if (AppState.currentState !== "active") {
        return;
      }
      void reconcile(activeRecordingRef.current, true);
    }, 30_000);
    return () => clearInterval(timer);
  }, [activeRecordingId, enabled, reconcile]);

  return runtime;
}
