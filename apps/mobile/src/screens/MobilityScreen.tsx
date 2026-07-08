import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  InteractionManager,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import Slider from "@react-native-community/slider";
import SegmentedControl from "@react-native-segmented-control/segmented-control";
import * as FileSystem from "expo-file-system/legacy";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import * as Sharing from "expo-sharing";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppIcon } from "@/components/AppIcon";
import {
  RouteMap,
  VISIT_MARKER_COLOR,
  type RouteMapHandle,
  type RouteMapVisit,
} from "@/components/RouteMap";
import { ScreenEnter } from "@/components/ScreenEnter";
import { flushClientLogs, recordClientLog } from "@/lib/client-logs";
import {
  clearMobilityHistory,
  exportMobilityHistory,
  getMobilityDay,
  startMobilityRecording,
  stopMobilityRecording,
} from "@/lib/api";
import { addDays, formatLongDate, toDateKey } from "@/lib/date";
import { beginMobilityActivation } from "@/lib/mobility-activation";
import {
  clearActiveMobilityRecordingId,
  DEFAULT_VISIT_DWELL_MINUTES,
  getAutoTrackingEnabled,
  getVisitDwellMinutes,
  hasAutoTrackingPreference,
  setActiveMobilityRecordingId,
  setAutoTrackingEnabled,
  setVisitDwellMinutes,
  VISIT_DWELL_MINUTE_OPTIONS,
} from "@/lib/mobility-storage";
import { flushMobilityPointQueue } from "@/lib/mobility-queue";
import { reverseGeocode } from "@/lib/reverse-geocode";
import {
  clearNativeMobilityQueue,
  flushNativeMobilityQueueNow,
  getLatestNativeMobilityPoint,
  isBatteryOptimizationDisabled,
  openBatteryOptimizationSettings,
} from "@/lib/mobility-native-service";
import {
  startMobilityLocationTracking,
  stopMobilityLocationTracking,
  supportsBackgroundLocationTracking,
} from "@/lib/mobility-tracking";
import { useLiveLocation } from "@/lib/useLiveLocation";
import type { MobilityRuntimeState } from "@/lib/useMobilityRuntime";
import { colors, radius, shadows, spacing, typography } from "@/theme";
import type {
  MobilityDay,
  MobilityPoint,
  MobilityRecording,
  MobilitySegment,
} from "@/types";

const PLAYBACK_SPEED_OPTIONS = [1, 2, 5, 10] as const;
const EMPTY_MOBILITY_POINTS: MobilityPoint[] = [];
const EMPTY_MOBILITY_SEGMENTS: MobilitySegment[] = [];

function explainBackgroundPermission() {
  if (Platform.OS !== "android") {
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      "允许后台记录",
      "授权打开后，Daily Todo 会通过常驻通知持续记录行走路线；关闭授权开关才会停止。",
      [
        { text: "暂不", style: "cancel", onPress: () => resolve(false) },
        { text: "继续", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

async function requestAndroidNotificationPermission() {
  const version =
    typeof Platform.Version === "string"
      ? Number.parseInt(Platform.Version, 10)
      : Platform.Version;
  if (
    Platform.OS !== "android" ||
    !Number.isFinite(version) ||
    version < 33
  ) {
    return;
  }
  try {
    await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
  } catch (error) {
    console.warn("Notification permission request failed", error);
  }
}

async function requestAndroidActivityRecognitionPermission() {
  const version =
    typeof Platform.Version === "string"
      ? Number.parseInt(Platform.Version, 10)
      : Platform.Version;
  if (
    Platform.OS !== "android" ||
    !Number.isFinite(version) ||
    version < 29
  ) {
    return true;
  }
  try {
    return (
      (await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
      )) === PermissionsAndroid.RESULTS.GRANTED
    );
  } catch (error) {
    console.warn("Activity recognition permission request failed", error);
    return false;
  }
}

async function waitForAndroidActivityToResume() {
  if (Platform.OS !== "android") {
    return;
  }
  if (AppState.currentState !== "active") {
    await withTimeout(
      new Promise<void>((resolve) => {
        const subscription = AppState.addEventListener("change", (state) => {
          if (state === "active") {
            subscription.remove();
            resolve();
          }
        });
      }),
      10_000,
      "应用未能从系统授权页面恢复，请返回应用后重试。",
    );
  }
  // Android can publish AppState.active slightly before the Activity window
  // regains focus. Starting a location FGS in that gap crashes API 34+.
  await new Promise<void>((resolve) => setTimeout(resolve, 600));
}

async function requestTrackingPermissions({
  requireBackground,
}: {
  requireBackground: boolean;
}) {
  if (Platform.OS === "web") {
    throw new Error("网页端不能持续记录轨迹，请在 Android APK 中使用。");
  }
  recordClientLog("info", "Requesting foreground location permission", {
    source: "mobility",
  });
  await flushClientLogs();
  if (!(await Location.hasServicesEnabledAsync())) {
    throw new Error("请先打开系统定位服务。");
  }
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) {
    throw new Error("需要“精确位置”权限才能记录路线。");
  }
  if (!requireBackground) {
    return;
  }
  await requestAndroidActivityRecognitionPermission();
  await requestAndroidNotificationPermission();
  if (!(await explainBackgroundPermission())) {
    throw new Error("未开启后台位置权限。");
  }
  recordClientLog("info", "Requesting background location permission", {
    source: "mobility",
  });
  await flushClientLogs();
  const background = await Location.requestBackgroundPermissionsAsync();
  if (!background.granted) {
    throw new Error("需要选择“始终允许”才能在锁屏后继续记录。");
  }
  await waitForAndroidActivityToResume();
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

async function promptForBatteryOptimization() {
  if (Platform.OS !== "android") {
    return;
  }
  if (await isBatteryOptimizationDisabled().catch(() => true)) {
    return;
  }
  Alert.alert(
    "允许持续后台记录",
    "为减少系统省电策略中断足迹，请在电池优化设置中将 Daily Todo 设为“不优化”。该设置必须由你在系统页面确认。",
    [
      { text: "稍后", style: "cancel" },
      {
        text: "去设置",
        onPress: () => {
          void openBatteryOptimizationSettings().catch((error) => {
            console.warn("Battery optimization settings unavailable", error);
          });
        },
      },
    ],
  );
}

export function MobilityScreen({
  runtime,
  today,
}: {
  runtime: MobilityRuntimeState;
  today: string;
}) {
  const queryClient = useQueryClient();
  const [selectedDateOverride, setSelectedDateOverride] = useState<string | null>(
    null,
  );
  const selectedDate = selectedDateOverride ?? today;
  const [actionError, setActionError] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [liveTrack, setLiveTrack] = useState<{
    date: string;
    points: MobilityPoint[];
    recordingId: string | null;
  }>({
    date: today,
    points: [],
    recordingId: null,
  });
  const [visitDwellMinutes, setVisitDwellMinutesState] = useState(
    DEFAULT_VISIT_DWELL_MINUTES,
  );
  const latestLivePointRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    void getVisitDwellMinutes().then((minutes) => {
      if (!cancelled) {
        setVisitDwellMinutesState(minutes);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const chooseVisitDwellMinutes = useCallback((minutes: number) => {
    setVisitDwellMinutesState(minutes);
    void setVisitDwellMinutes(minutes);
    recordClientLog("info", "Mobility visit dwell threshold changed", {
      source: "mobility",
      context: { minutes },
    });
  }, []);

  const dayQuery = useQuery({
    queryKey: ["mobility-day", selectedDate, visitDwellMinutes],
    queryFn: () => getMobilityDay(selectedDate, visitDwellMinutes),
  });
  const todayQuery = useQuery({
    queryKey: ["mobility-day", today, visitDwellMinutes],
    queryFn: () => getMobilityDay(today, visitDwellMinutes),
    refetchInterval: (query) =>
      query.state.data?.activeRecording ? 5_000 : false,
  });
  const activeRecording = todayQuery.data?.activeRecording ?? null;
  const isToday = selectedDate === today;
  const recordingEnabled = Boolean(activeRecording);

  // Continuous tracking has no per-day start/stop button anymore, so the
  // first time this runs after upgrading from the old manual toggle, adopt
  // whatever is already running instead of leaving the preference unset.
  useEffect(() => {
    if (!activeRecording) {
      return;
    }
    let cancelled = false;
    void hasAutoTrackingPreference().then((hasPreference) => {
      if (!cancelled && !hasPreference) {
        void setAutoTrackingEnabled(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeRecording]);

  const startMutation = useMutation({
    mutationFn: async () => {
      const finishActivation = beginMobilityActivation();
      setActionError("");
      setLiveTrack({ date: today, points: [], recordingId: null });
      latestLivePointRef.current = "";
      try {
        const nativeBackgroundAvailable =
          supportsBackgroundLocationTracking();
        recordClientLog("info", "Mobility recording start requested", {
          source: "mobility",
          context: { nativeBackgroundAvailable },
        });
        await flushClientLogs();
        await requestTrackingPermissions({
          requireBackground: nativeBackgroundAvailable,
        });
        const recording = await startMobilityRecording();
        await setActiveMobilityRecordingId(recording.id);
        try {
          recordClientLog("info", "Starting mobility location tracking", {
            source: "mobility",
            context: { nativeBackgroundAvailable },
          });
          await flushClientLogs();
          await startMobilityLocationTracking({
            background: nativeBackgroundAvailable,
            manual: true,
            recordingId: recording.id,
          });
          recordClientLog("info", "Mobility location tracking started", {
            source: "mobility",
            context: { nativeBackgroundAvailable },
          });
          await flushClientLogs();
          await promptForBatteryOptimization();
        } catch (error) {
          await stopMobilityLocationTracking().catch((cleanupError) => {
            console.warn(
              "Mobility tracking cleanup after start failure failed",
              cleanupError,
            );
          });
          await stopMobilityRecording(recording.id).catch((cleanupError) => {
            console.warn(
              "Mobility recording cleanup after start failure failed",
              cleanupError,
            );
          });
          await clearActiveMobilityRecordingId().catch((cleanupError) => {
            console.warn(
              "Mobility active recording cleanup failed",
              cleanupError,
            );
          });
          throw error;
        }
        await setAutoTrackingEnabled(true);
        return recording;
      } finally {
        finishActivation();
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["mobility-day"],
      });
    },
    onError: (error) => {
      setActionError(error.message || "无法开启自动记录");
    },
  });

  const stopMutation = useMutation({
    mutationFn: async (recording: MobilityRecording) => {
      setActionError("");
      recordClientLog("info", "Mobility recording stop requested", {
        source: "mobility",
      });
      await flushClientLogs();
      await stopMobilityLocationTracking();
      try {
        return await stopMobilityRecording(recording.id);
      } finally {
        await clearActiveMobilityRecordingId().catch((error) => {
          console.warn("Mobility active recording cleanup failed", error);
        });
        await setAutoTrackingEnabled(false);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["mobility-day"],
      });
    },
    onError: (error) => {
      setActionError(error.message || "无法关闭自动记录");
    },
  });

  const clearHistoryMutation = useMutation({
    mutationFn: async () => {
      setActionError("");
      recordClientLog("info", "Mobility clear history requested", {
        source: "mobility",
      });
      await flushClientLogs();
      await clearMobilityHistory();
      await clearNativeMobilityQueue().catch((error) => {
        console.warn("Mobility native queue clear failed", error);
      });
      setLiveTrack({ date: today, points: [], recordingId: null });
      latestLivePointRef.current = "";
      const shouldResume = recordingEnabled && (await getAutoTrackingEnabled());
      if (shouldResume) {
        const recording = await startMobilityRecording();
        await setActiveMobilityRecordingId(recording.id);
        await startMobilityLocationTracking({
          background: supportsBackgroundLocationTracking(),
          manual: true,
          recordingId: recording.id,
        }).catch((error) => {
          console.warn("Mobility restart after clearing history failed", error);
        });
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["mobility-day"] });
    },
    onError: (error) => {
      setActionError(error.message || "无法清除足迹历史");
    },
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      setActionError("");
      recordClientLog("info", "Mobility export requested", {
        source: "mobility",
        context: { date: selectedDate },
      });
      await flushClientLogs();
      const payload = await exportMobilityHistory(selectedDate, selectedDate);
      const fileUri = `${FileSystem.cacheDirectory}mobility-timeline-${selectedDate}.json`;
      await FileSystem.writeAsStringAsync(
        fileUri,
        JSON.stringify(payload, null, 2),
      );
      if (!(await Sharing.isAvailableAsync())) {
        throw new Error("当前设备不支持分享文件。");
      }
      await Sharing.shareAsync(fileUri, {
        dialogTitle: "导出足迹数据",
        mimeType: "application/json",
      });
    },
    onError: (error) => {
      setActionError(error.message || "导出失败");
    },
  });

  const confirmClearHistory = useCallback(() => {
    Alert.alert(
      "清除足迹历史记录",
      "此操作将永久删除你的全部足迹记录（本地与服务器），且无法恢复。是否继续？",
      [
        { text: "取消", style: "cancel" },
        {
          text: "删除",
          style: "destructive",
          onPress: () => clearHistoryMutation.mutate(),
        },
      ],
      { cancelable: true },
    );
  }, [clearHistoryMutation]);

  useEffect(() => {
    if (activeRecording?.id) {
      void setActiveMobilityRecordingId(activeRecording.id);
      void flushMobilityPointQueue();
      // Background sync is deliberately lazy (30-minute batches); the user
      // looking at the map is the "must be current now" moment, so also ask
      // the native service to flush, then refresh today's track once the
      // upload has had a moment to land.
      void flushNativeMobilityQueueNow().then((flushed) => {
        if (flushed) {
          setTimeout(() => {
            void queryClient.invalidateQueries({
              queryKey: ["mobility-day", today],
            });
          }, 4_000);
        }
      });
    }
  }, [activeRecording?.id, queryClient, today]);

  useEffect(() => {
    const recordingId = activeRecording?.id;
    if (!recordingEnabled || !recordingId) {
      latestLivePointRef.current = "";
      return;
    }
    latestLivePointRef.current = "";
    let cancelled = false;
    const pollLatestPoint = async () => {
      const point = await getLatestNativeMobilityPoint().catch(() => null);
      if (
        cancelled ||
        !point ||
        toDateKey(new Date(point.recordedAt)) !== today ||
        point.recordedAt === latestLivePointRef.current
      ) {
        return;
      }
      latestLivePointRef.current = point.recordedAt;
      // Points arrive one at a time and `latestLivePointRef` above already
      // guarantees we never re-process the same recorded point twice, so
      // there is no need to re-scan (and dedupe) the whole array on every
      // tick — doing that with `findIndex` inside `filter` was O(n^2) and,
      // once a recording ran long enough to approach the 5,000 point cap,
      // was slow enough to visibly freeze the app on every poll.
      setLiveTrack((current) => {
        const currentPoints =
          current.date === today && current.recordingId === recordingId
            ? current.points
            : [];
        return {
          date: today,
          recordingId,
          points:
            currentPoints.length >= 5_000
              ? [...currentPoints.slice(1), point]
              : [...currentPoints, point],
        };
      });
    };
    void pollLatestPoint();
    const timer = setInterval(() => {
      void pollLatestPoint();
    }, 500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeRecording?.id, recordingEnabled, today]);

  const livePoints =
    liveTrack.date === today &&
    liveTrack.recordingId === activeRecording?.id
      ? liveTrack.points
      : EMPTY_MOBILITY_POINTS;
  const routePoints = useMemo(
    () =>
      mergeMobilityPoints(
        dayQuery.data?.points ?? [],
        isToday && recordingEnabled ? livePoints : [],
      ),
    [dayQuery.data?.points, isToday, livePoints, recordingEnabled],
  );
  const timelineSegments = useMemo(
    () => dayQuery.data?.segments ?? EMPTY_MOBILITY_SEGMENTS,
    [dayQuery.data?.segments],
  );
  const segmentPlaceNames = useSegmentPlaceNames(timelineSegments);
  const latestLivePoint = recordingEnabled ? (livePoints.at(-1) ?? null) : null;

  // Visit stops marked on the map, keyed the same way as the timeline rows so
  // a tap on either side can find its counterpart.
  const visitMarkers = useMemo<RouteMapVisit[]>(
    () =>
      timelineSegments
        .filter(
          (segment) =>
            segment.type === "visit" &&
            segment.latitude != null &&
            segment.longitude != null,
        )
        .map((segment) => ({
          id: segmentKey(segment),
          longitude: segment.longitude as number,
          latitude: segment.latitude as number,
        })),
    [timelineSegments],
  );

  const routeMapRef = useRef<RouteMapHandle>(null);
  const [mapAvailable, setMapAvailable] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRatio, setPlaybackRatio] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  // Scroll-to-and-highlight bookkeeping for jumping between a map visit
  // marker and its timeline row (and back).
  const scrollViewRef = useRef<ScrollView>(null);
  const scrollOffsetRef = useRef(0);
  const rowRefs = useRef<Record<string, View | null>>({});
  const [highlightedSegmentKey, setHighlightedSegmentKey] = useState<
    string | null
  >(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(
    () => () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    },
    [],
  );

  const focusSegment = useCallback(
    (segment: MobilitySegment) => {
      const key = segmentKey(segment);

      setHighlightedSegmentKey(key);
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
      highlightTimeoutRef.current = setTimeout(
        () => setHighlightedSegmentKey(null),
        2400,
      );

      const rowNode = rowRefs.current[key];
      const scrollNode = scrollViewRef.current;
      if (rowNode && scrollNode) {
        // ScrollView's TS type omits the NativeMethods measure* methods, but
        // at runtime the ref IS the native host view with those methods
        // attached (react-native's ScrollView.js Object.assign()s
        // getScrollableNode/scrollTo/etc onto the native instance), so it can
        // be measured directly. getScrollableNode() looked like the
        // sanctioned way to reach a measurable handle, but it actually
        // returns a plain numeric node handle with no measureInWindow method
        // at all - calling it here previously threw an uncaught TypeError
        // from this native callback and crashed the app on every visit-point
        // tap.
        const measurableScrollNode = scrollNode as unknown as {
          measureInWindow: typeof rowNode.measureInWindow;
        };
        rowNode.measureInWindow((_rowX: number, rowY: number) => {
          measurableScrollNode.measureInWindow((_scrollX: number, scrollY: number) => {
            const targetY = scrollOffsetRef.current + (rowY - scrollY) - 96;
            scrollNode.scrollTo({ y: Math.max(0, targetY), animated: true });
          });
        });
      }

      if (routePoints.length > 1) {
        const t0 = new Date(routePoints[0].recordedAt).getTime();
        const tN = new Date(
          routePoints[routePoints.length - 1].recordedAt,
        ).getTime();
        const segmentTime = new Date(segment.startTime).getTime();
        const ratio =
          tN > t0
            ? Math.max(0, Math.min(1, (segmentTime - t0) / (tN - t0)))
            : 0;
        setIsPlaying(false);
        setPlaybackRatio(ratio);
        routeMapRef.current?.seek(ratio);
      }

      if (segment.latitude != null && segment.longitude != null) {
        routeMapRef.current?.focusOn(segment.longitude, segment.latitude);
      }
    },
    [routePoints],
  );

  const handleVisitMarkerPress = useCallback(
    (id: string) => {
      const segment = timelineSegments.find(
        (candidate) =>
          candidate.type === "visit" && segmentKey(candidate) === id,
      );
      if (segment) {
        focusSegment(segment);
      }
    },
    [timelineSegments, focusSegment],
  );

  // Live "you are here" puck + heading. It only makes sense for today (a past
  // day has no "now"), and only runs once we hold foreground location
  // permission - always true while recording, otherwise requested on demand
  // when the user taps the locate button. This is intentionally separate from
  // the background footprint recording, which stays coarse for battery/history.
  const [userEnabledLive, setUserEnabledLive] = useState(false);
  const [followLive, setFollowLive] = useState(false);
  const liveEnabled = isToday && (recordingEnabled || userEnabledLive);
  const liveLocation = useLiveLocation(liveEnabled);

  // Mounting the native MapLibre view is heavy (GL surface + style setup) and
  // contends with ScreenEnter's entrance animation for frame budget, which is
  // exactly what read as "laggy" opening this screen. Deferring construction
  // until the transition (and any other queued interaction) finishes keeps
  // the fade-in smooth; the loading spinner already shown for a pending
  // dayQuery covers this brief extra window too.
  const [mapMountReady, setMapMountReady] = useState(false);
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      setMapMountReady(true);
    });
    return () => handle.cancel();
  }, []);

  const handleUserPan = useCallback(() => {
    setFollowLive(false);
  }, []);

  const handleLocatePress = useCallback(async () => {
    if (Platform.OS === "web") {
      setActionError("网页端不支持实时定位，请在 Android 上使用。");
      return;
    }
    // A second tap while following simply releases follow mode; the puck stays.
    if (followLive) {
      setFollowLive(false);
      return;
    }
    try {
      const { granted } = await Location.getForegroundPermissionsAsync();
      if (!granted) {
        if (!(await Location.hasServicesEnabledAsync())) {
          setActionError("请先打开系统定位服务。");
          return;
        }
        const requested = await Location.requestForegroundPermissionsAsync();
        if (!requested.granted) {
          setActionError("需要位置权限才能显示当前位置。");
          return;
        }
      }
      setActionError("");
      setUserEnabledLive(true);
      setFollowLive(true);
      // Snaps to the puck immediately if a fix already exists; otherwise the
      // follow effect centers on the first fix within ~1s.
      routeMapRef.current?.centerOnLive();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "定位失败");
    }
  }, [followLive]);

  const changeSelectedDate = useCallback(
    (updater: (date: string) => string) => {
      setSelectedDateOverride((current) => {
        const next = updater(current ?? today);
        return next === today ? null : next;
      });
      setIsPlaying(false);
      setPlaybackRatio(0);
      setFollowLive(false);
    },
    [today],
  );

  const handleMapFallback = useCallback((fallback: boolean) => {
    setMapAvailable(!fallback);
  }, []);

  const handlePlaybackProgress = useCallback((ratio: number) => {
    setPlaybackRatio(ratio);
  }, []);

  const handlePlaybackEnded = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      routeMapRef.current?.pause();
      setIsPlaying(false);
    } else {
      routeMapRef.current?.play(playbackSpeed);
      setIsPlaying(true);
    }
  }, [isPlaying, playbackSpeed]);

  const seekPlayback = useCallback((ratio: number) => {
    setPlaybackRatio(ratio);
    setIsPlaying(false);
    routeMapRef.current?.seek(ratio);
  }, []);

  const choosePlaybackSpeed = useCallback(
    (speed: number) => {
      setPlaybackSpeed(speed);
      if (isPlaying) {
        routeMapRef.current?.play(speed);
      }
    },
    [isPlaying],
  );
  const busy = startMutation.isPending || stopMutation.isPending;
  const totalSteps = dayQuery.data?.stepCount ?? 0;
  const backgroundTrackingHealthy =
    runtime.nativeBackgroundAvailable &&
    runtime.backgroundPermission &&
    runtime.nativeTaskActive;
  const trackingHealthy = backgroundTrackingHealthy;

  if (showDetails) {
    return (
      <ScreenEnter style={{ flex: 1 }}>
        <MobilityDetails
          day={dayQuery.data}
          onBack={() => setShowDetails(false)}
          runtime={runtime}
          selectedDate={selectedDate}
          totalSteps={totalSteps}
        />
      </ScreenEnter>
    );
  }

  return (
    <ScreenEnter style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.content}
        onScroll={(event) => {
          scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
        }}
        ref={scrollViewRef}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}>
      <View style={styles.heading}>
        <View>
          <Text style={styles.title}>足迹地图</Text>
          <Text style={styles.subtitle}>开启后持续自动记录，无需每天手动开关</Text>
        </View>
        {recordingEnabled ? (
          <LinearGradient
            colors={[colors.accentSoft, colors.surface]}
            end={{ x: 1, y: 0.5 }}
            start={{ x: 0, y: 0.5 }}
            style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>持续记录</Text>
          </LinearGradient>
        ) : null}
      </View>

      <View style={styles.authorizationCard}>
        <View style={styles.authorizationCopy}>
          <Text style={styles.authorizationTitle}>自动记录足迹</Text>
          <Text style={styles.authorizationDescription}>
            {recordingEnabled
              ? backgroundTrackingHealthy
                ? "正在持续记录；应用关闭后后台服务也会继续写入路线"
                : "已开启记录，正在等待原生定位服务恢复"
              : "未开启，不会获取位置和活动数据"}
          </Text>
        </View>
        {busy || todayQuery.isPending ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <Switch
            accessibilityLabel="足迹记录"
            onValueChange={(enabled) => {
              if (enabled) {
                startMutation.mutate();
              } else if (activeRecording) {
                stopMutation.mutate(activeRecording);
              }
            }}
            thumbColor={colors.white}
            trackColor={{
              false: colors.borderStrong,
              true: colors.accent,
            }}
            value={recordingEnabled}
          />
        )}
      </View>

      <View style={styles.datePicker}>
        <Pressable
          accessibilityLabel="前一天"
          onPress={() => changeSelectedDate((date) => addDays(date, -1))}
          style={styles.dateButton}>
          <AppIcon name="chevron-back" color={colors.text} size={20} />
        </Pressable>
        <View style={styles.dateCopy}>
          <Text style={styles.dateLabel}>{isToday ? "今天" : formatLongDate(selectedDate)}</Text>
          {!isToday ? <Text style={styles.dateMeta}>{selectedDate}</Text> : null}
        </View>
        <Pressable
          accessibilityLabel="后一天"
          disabled={isToday}
          onPress={() => changeSelectedDate((date) => addDays(date, 1))}
          style={[styles.dateButton, isToday && styles.dateButtonDisabled]}>
          <AppIcon name="chevron-forward" color={colors.text} size={20} />
        </Pressable>
      </View>

      <View style={styles.mapFrame}>
        {dayQuery.isPending || !mapMountReady ? (
          <View style={styles.mapLoading}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <RouteMap
            key={selectedDate}
            followLive={followLive}
            liveLocation={isToday ? liveLocation : null}
            onFallback={handleMapFallback}
            onPlaybackEnded={handlePlaybackEnded}
            onPlaybackProgress={handlePlaybackProgress}
            onUserPan={handleUserPan}
            onVisitPress={handleVisitMarkerPress}
            points={routePoints}
            ref={routeMapRef}
            visits={visitMarkers}
          />
        )}
        {isToday && Platform.OS !== "web" && !dayQuery.isPending ? (
          <Pressable
            accessibilityLabel={followLive ? "停止跟随当前位置" : "定位到当前位置"}
            accessibilityRole="button"
            onPress={handleLocatePress}
            style={({ pressed }) => [
              styles.locateButton,
              followLive && styles.locateButtonActive,
              pressed && styles.pressed,
            ]}>
            <AppIcon
              name={followLive ? "navigate" : "locate"}
              color={followLive ? colors.white : colors.accent}
              size={20}
            />
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.mapHint}>
        {isToday
          ? "双指缩放 · 拖动查看路线 · 点定位按钮跟随当前位置和朝向"
          : "双指缩放 · 拖动查看路线"}
      </Text>

      {mapAvailable && routePoints.length > 1 ? (
        <View style={styles.playbackBar}>
          <Pressable
            accessibilityLabel={isPlaying ? "暂停回放" : "回放轨迹"}
            accessibilityRole="button"
            onPress={togglePlayback}
            style={({ pressed }) => [
              styles.playbackButton,
              pressed && styles.pressed,
            ]}>
            <AppIcon
              color={colors.white}
              name={isPlaying ? "pause" : "play"}
              size={17}
            />
          </Pressable>
          <Slider
            accessibilityLabel="回放进度"
            maximumTrackTintColor={colors.surfaceMuted}
            maximumValue={1}
            minimumTrackTintColor={colors.accent}
            minimumValue={0}
            onValueChange={seekPlayback}
            style={styles.scrubber}
            thumbTintColor={colors.accent}
            value={playbackRatio}
          />
          <View style={styles.speedOptions}>
            {PLAYBACK_SPEED_OPTIONS.map((speed) => {
              const active = speed === playbackSpeed;
              return (
                <Pressable
                  accessibilityLabel={`${speed} 倍速回放`}
                  accessibilityRole="button"
                  key={speed}
                  onPress={() => choosePlaybackSpeed(speed)}
                  style={({ pressed }) => [
                    styles.speedChip,
                    active && styles.speedChipActive,
                    pressed && styles.pressed,
                  ]}>
                  <Text
                    style={[
                      styles.speedChipText,
                      active && styles.speedChipTextActive,
                    ]}>
                    {speed}x
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={styles.distanceSummary}>
        <View style={styles.distanceCopy}>
          <AppIcon name="navigate-outline" color={colors.accent} size={20} />
          <View>
            <Text style={styles.distanceValue}>
              {((dayQuery.data?.distanceMeters ?? 0) / 1000).toFixed(2)} 公里
            </Text>
            <Text style={styles.distanceLabel}>
              {isToday ? "今日记录距离" : "当日记录距离"}
            </Text>
          </View>
        </View>
        <View style={styles.summaryActions}>
          <Pressable
            accessibilityLabel="导出本日足迹数据"
            accessibilityRole="button"
            disabled={exportMutation.isPending || !routePoints.length}
            onPress={() => exportMutation.mutate()}
            style={({ pressed }) => [
              styles.iconButton,
              pressed && styles.pressed,
            ]}>
            {exportMutation.isPending ? (
              <ActivityIndicator color={colors.accent} size="small" />
            ) : (
              <AppIcon name="share-outline" color={colors.accent} size={19} />
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowDetails(true)}
            style={({ pressed }) => [
              styles.detailsButton,
              pressed && styles.pressed,
            ]}>
            <Text style={styles.detailsButtonText}>查看详情</Text>
            <AppIcon name="chevron-forward" color={colors.accent} size={18} />
          </Pressable>
        </View>
      </View>

      {actionError ? (
        <View style={styles.error}>
          <AppIcon name="alert-circle-outline" color={colors.danger} size={18} />
          <Text style={styles.errorText}>{actionError}</Text>
        </View>
      ) : null}
      {dayQuery.isError ? (
        <View style={styles.error}>
          <Text style={styles.errorText}>{dayQuery.error.message}</Text>
        </View>
      ) : null}

      <View style={styles.privacy}>
        <AppIcon name="lock-closed-outline" color={colors.textMuted} size={15} />
        <Text style={styles.privacyText}>
          {recordingEnabled
            ? backgroundTrackingHealthy
              ? "仅你可见 · 后台服务运行中"
              : "原生定位服务等待恢复 · 请检查下方状态"
            : "记录已关闭 · 不会获取位置"}
        </Text>
      </View>

      {recordingEnabled ? (
        <View
          style={[
            styles.runtimePanel,
            !trackingHealthy && styles.runtimePanelWarning,
          ]}>
          <View style={styles.runtimeHeading}>
            <AppIcon
              name={trackingHealthy ? "shield-checkmark-outline" : "warning-outline"}
              color={trackingHealthy ? colors.accent : colors.danger}
              size={21}
            />
            <View style={styles.runtimeHeadingCopy}>
              <Text style={styles.runtimeTitle}>
                {backgroundTrackingHealthy
                  ? "后台轨迹服务正常"
                  : "原生定位服务未运行"}
              </Text>
              <Text style={styles.runtimeMeta}>
                {latestLivePoint?.recordedAt || runtime.lastLocationAt
                  ? `最近定位 ${formatRuntimeTime(
                      latestLivePoint?.recordedAt ?? runtime.lastLocationAt!,
                    )}`
                  : "正在等待第一条定位"}
                {runtime.queuedPointCount
                  ? ` · ${runtime.queuedPointCount} 个定位点待同步`
                  : ""}
              </Text>
            </View>
          </View>
          {runtime.lastError ? (
            <Text style={styles.runtimeError}>{runtime.lastError}</Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.placesSection}>
        <View style={styles.placesHeading}>
          <Text style={styles.sectionTitle}>足迹时间轴</Text>
        </View>
        <View style={styles.dwellSettingRow}>
          <Text style={styles.dwellSettingLabel}>停留多久算到访（分钟）</Text>
          <SegmentedControl
            accessibilityLabel="停留多久算到访"
            activeFontStyle={styles.dwellSegmentActiveFont}
            backgroundColor={colors.surfaceMuted}
            fontStyle={styles.dwellSegmentFont}
            onChange={(event) => {
              const minutes =
                VISIT_DWELL_MINUTE_OPTIONS[
                  event.nativeEvent.selectedSegmentIndex
                ];
              if (minutes != null) {
                chooseVisitDwellMinutes(minutes);
              }
            }}
            selectedIndex={(VISIT_DWELL_MINUTE_OPTIONS as readonly number[]).indexOf(
              visitDwellMinutes,
            )}
            tintColor={colors.accent}
            values={VISIT_DWELL_MINUTE_OPTIONS.map(String)}
          />
        </View>
        {timelineSegments.length ? (
          timelineSegments.map((segment, index) => {
            const isLast = index === timelineSegments.length - 1;
            if (segment.type === "visit") {
              const key = segmentKey(segment);
              const label = segmentPlaceNames[key] || `停留地点 ${index + 1}`;
              const highlighted = highlightedSegmentKey === key;
              return (
                <Pressable
                  accessibilityLabel={`查看到访地点 ${label}`}
                  accessibilityRole="button"
                  key={`${segment.startTime}-${index}`}
                  onPress={() => focusSegment(segment)}
                  ref={(node) => {
                    rowRefs.current[key] = node;
                  }}
                  style={({ pressed }) => [
                    styles.placeRow,
                    highlighted && styles.placeRowHighlighted,
                    pressed && styles.pressed,
                  ]}>
                  <View style={styles.timeline}>
                    <View
                      style={[
                        styles.placeDot,
                        highlighted && styles.placeDotHighlighted,
                      ]}
                    />
                    {!isLast ? <View style={styles.placeLine} /> : null}
                  </View>
                  <View style={styles.placeCopy}>
                    <Text style={styles.placeName}>{label}</Text>
                    <Text style={styles.placeTime}>
                      {formatSegmentTimeRange(segment)} · 停留{" "}
                      {segment.durationMinutes} 分钟
                    </Text>
                  </View>
                </Pressable>
              );
            }
            const modeLabel = segment.mode ? TRIP_MODE_LABEL[segment.mode] : null;
            const modeIcon = segment.mode ? TRIP_MODE_ICON[segment.mode] : null;
            return (
              <View key={`${segment.startTime}-${index}`} style={styles.placeRow}>
                <View style={styles.timeline}>
                  <View style={styles.tripDot} />
                  {!isLast ? <View style={styles.placeLine} /> : null}
                </View>
                <View style={styles.placeCopy}>
                  <View style={styles.tripHeading}>
                    <AppIcon
                      color={colors.textMuted}
                      name={modeIcon ?? "walk-outline"}
                      size={15}
                    />
                    <Text style={styles.placeName}>
                      {modeLabel ?? "移动"}
                      {segment.distanceMeters != null
                        ? ` · ${(segment.distanceMeters / 1000).toFixed(2)} 公里`
                        : ""}
                    </Text>
                  </View>
                  <Text style={styles.placeTime}>
                    {formatSegmentTimeRange(segment)} · {segment.durationMinutes}{" "}
                    分钟
                  </Text>
                </View>
              </View>
            );
          })
        ) : (
          <Text style={styles.emptyPlaces}>
            在约 80 米范围停留满 {visitDwellMinutes} 分钟后自动显示到访地点，途中的移动会显示为行程
          </Text>
        )}
      </View>

      <Pressable
        accessibilityLabel="清除足迹历史记录"
        accessibilityRole="button"
        disabled={clearHistoryMutation.isPending}
        onPress={confirmClearHistory}
        style={({ pressed }) => [
          styles.dangerRow,
          pressed && styles.pressed,
        ]}>
        {clearHistoryMutation.isPending ? (
          <ActivityIndicator color={colors.danger} size="small" />
        ) : (
          <AppIcon name="trash-outline" color={colors.danger} size={18} />
        )}
        <Text style={styles.dangerRowText}>清除足迹历史记录</Text>
      </Pressable>
      </ScrollView>
    </ScreenEnter>
  );
}

function MobilityDetails({
  day,
  onBack,
  runtime,
  selectedDate,
  totalSteps,
}: {
  day: MobilityDay | undefined;
  onBack: () => void;
  runtime: MobilityRuntimeState;
  selectedDate: string;
  totalSteps: number;
}) {
  const stepSource =
    runtime.stepSource === "device"
      ? "原生设备计步传感器"
      : "暂无可用来源";

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      <View style={styles.detailsHeader}>
        <Pressable
          accessibilityLabel="返回足迹地图"
          onPress={onBack}
          style={({ pressed }) => [
            styles.detailsBackButton,
            pressed && styles.pressed,
          ]}>
          <AppIcon name="chevron-back" color={colors.text} size={21} />
        </Pressable>
        <View style={styles.detailsHeadingCopy}>
          <Text style={styles.title}>足迹详情</Text>
          <Text style={styles.subtitle}>{formatLongDate(selectedDate)}</Text>
        </View>
      </View>

      <View style={styles.metrics}>
        <Metric
          icon="footsteps-outline"
          label="步数"
          value={totalSteps.toLocaleString()}
        />
        <Metric
          icon="navigate-outline"
          label="公里"
          value={((day?.distanceMeters ?? 0) / 1000).toFixed(2)}
        />
        <Metric
          icon="time-outline"
          label="记录分钟"
          value={String(day?.durationMinutes ?? 0)}
        />
      </View>

      <View style={styles.detailsPanel}>
        <DetailRow
          icon="location-outline"
          label="定位点"
          value={`${day?.points.length ?? 0} 个`}
        />
        <DetailRow
          icon="footsteps-outline"
          label="步数来源"
          value={stepSource}
        />
        <DetailRow
          icon="cloud-upload-outline"
          label="等待同步"
          value={`${runtime.queuedPointCount} 个定位点`}
        />
        <DetailRow
          icon="time-outline"
          label="最近定位"
          value={
            runtime.lastLocationAt
              ? formatRuntimeTime(runtime.lastLocationAt)
              : "暂无"
          }
        />
      </View>

      <Text style={styles.stepNote}>
        Android 会在你开启足迹记录后使用设备传感器统计本次步数。
      </Text>
    </ScrollView>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof AppIcon>["name"];
  label: string;
  value: string;
}) {
  return (
    <View style={styles.detailRow}>
      <AppIcon name={icon} color={colors.accent} size={19} />
      <Text style={styles.detailLabel}>{label}</Text>
      <Text numberOfLines={2} style={styles.detailValue}>
        {value}
      </Text>
    </View>
  );
}

function formatRuntimeTime(value: string) {
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function mergeMobilityPoints(
  persisted: MobilityPoint[],
  live: MobilityPoint[],
) {
  // The server de-spikes, thins, and visit-anchors everything it has already
  // stored, and today's query refetches every few seconds while recording.
  // Live points therefore only bridge the gap after the newest persisted
  // point: keeping older live samples in the union would permanently re-add
  // the raw jitter and drift spikes the server just filtered out.
  const lastPersistedAt = persisted.length
    ? new Date(persisted[persisted.length - 1].recordedAt).getTime()
    : Number.NEGATIVE_INFINITY;
  const liveTail = live.filter(
    (point) => new Date(point.recordedAt).getTime() > lastPersistedAt,
  );
  const unique = new Map<string, MobilityPoint>();
  [...persisted, ...liveTail].forEach((point) => {
    unique.set(
      `${point.recordedAt}:${point.latitude.toFixed(6)}:${point.longitude.toFixed(6)}`,
      point,
    );
  });
  const sorted = [...unique.values()].sort(
    (first, second) =>
      new Date(first.recordedAt).getTime() -
      new Date(second.recordedAt).getTime(),
  );
  if (sorted.length <= 6_000) {
    return sorted;
  }
  const stride = Math.ceil(sorted.length / 5_999);
  return [
    sorted[0],
    ...sorted.slice(1, -1).filter((_, index) => index % stride === 0),
    sorted.at(-1)!,
  ];
}

// Visit/Trip segmentation now happens server-side (mobility/segmentation.py)
// so the Timeline UI, the map, and the Google Takeout export all agree on
// the same boundaries. The client's only remaining job is turning a visit's
// coordinate into a place name, the same on-device reverse geocode it did
// before this moved server-side.
function segmentKey(segment: MobilitySegment) {
  return `${segment.startTime}:${segment.latitude?.toFixed(5)}:${segment.longitude?.toFixed(5)}`;
}

function formatSegmentTimeRange(segment: MobilitySegment) {
  const format = (value: string) =>
    new Date(value).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  return `${format(segment.startTime)} - ${format(segment.endTime)}`;
}

const TRIP_MODE_ICON: Record<string, React.ComponentProps<typeof AppIcon>["name"]> = {
  WALKING: "walk-outline",
  CYCLING: "bicycle-outline",
  IN_VEHICLE: "car-outline",
  SUBWAY: "subway-outline",
  TRAIN: "train-outline",
  HIGH_SPEED_RAIL: "train-outline",
  FLIGHT: "airplane-outline",
};

const TRIP_MODE_LABEL: Record<string, string> = {
  WALKING: "步行",
  CYCLING: "骑行",
  // Driver vs passenger can't be told apart from GPS, so road vehicles stay
  // one bucket; rail and air split out by their distinctive speed profiles.
  IN_VEHICLE: "乘车",
  SUBWAY: "地铁",
  TRAIN: "火车",
  HIGH_SPEED_RAIL: "高铁",
  FLIGHT: "飞行",
};

function useSegmentPlaceNames(segments: MobilitySegment[]) {
  const visits = useMemo(
    () => segments.filter((segment) => segment.type === "visit"),
    [segments],
  );
  const [resolvedNames, setResolvedNames] = useState<Record<string, string>>(
    {},
  );
  const unresolvedKeys = visits
    .filter((segment) => !resolvedNames[segmentKey(segment)])
    .map(segmentKey)
    .join("|");

  useEffect(() => {
    const unresolved = visits.filter(
      (segment) => !resolvedNames[segmentKey(segment)],
    );
    if (!unresolved.length) {
      return;
    }
    let cancelled = false;
    void Promise.all(
      unresolved.map(async (segment, index) => {
        if (segment.latitude == null || segment.longitude == null) {
          return [segmentKey(segment), `停留地点 ${index + 1}`] as const;
        }
        const label = await reverseGeocode(segment.latitude, segment.longitude);
        return [segmentKey(segment), label || `停留地点 ${index + 1}`] as const;
      }),
    ).then((entries) => {
      if (!cancelled) {
        setResolvedNames((current) => ({
          ...current,
          ...Object.fromEntries(entries),
        }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [visits, resolvedNames, unresolvedKeys]);

  return resolvedNames;
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof AppIcon>["name"];
  label: string;
  value: string;
}) {
  return (
    <View style={styles.metric}>
      <AppIcon name={icon} color={colors.accent} size={18} />
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.md,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  heading: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 3,
  },
  liveBadge: {
    alignItems: "center",
    borderRadius: radius.full,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  liveDot: {
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    height: 7,
    width: 7,
  },
  liveText: {
    ...typography.label,
    color: colors.accent,
  },
  authorizationCard: {
    ...shadows.floating,
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
  },
  authorizationCopy: {
    flex: 1,
    gap: 3,
  },
  authorizationTitle: {
    ...typography.section,
    color: colors.text,
  },
  authorizationDescription: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 18,
  },
  datePicker: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  dateButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  dateButtonDisabled: {
    opacity: 0.3,
  },
  dateCopy: {
    alignItems: "center",
    gap: 1,
  },
  dateLabel: {
    ...typography.section,
    color: colors.text,
  },
  dateMeta: {
    ...typography.caption,
    color: colors.textMuted,
  },
  mapFrame: {
    ...shadows.floating,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    height: 310,
    overflow: "hidden",
  },
  mapLoading: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  locateButton: {
    ...shadows.card,
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    bottom: spacing.md,
    height: 44,
    justifyContent: "center",
    position: "absolute",
    right: spacing.md,
    width: 44,
  },
  locateButtonActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  mapHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: -spacing.sm,
    textAlign: "center",
  },
  playbackBar: {
    ...shadows.card,
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.sm,
  },
  playbackButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  scrubber: {
    flex: 1,
  },
  speedOptions: {
    flexDirection: "row",
    gap: 4,
  },
  speedChip: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  speedChipActive: {
    backgroundColor: colors.accent,
  },
  speedChipText: {
    ...typography.label,
    color: colors.textMuted,
    fontSize: 11,
  },
  speedChipTextActive: {
    color: colors.white,
  },
  metrics: {
    ...shadows.card,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    paddingVertical: spacing.md,
  },
  metric: {
    alignItems: "center",
    borderRightColor: colors.border,
    borderRightWidth: StyleSheet.hairlineWidth,
    flex: 1,
    gap: 2,
  },
  metricValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
  },
  metricLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  distanceSummary: {
    ...shadows.card,
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: spacing.md,
  },
  distanceCopy: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  distanceValue: {
    ...typography.section,
    color: colors.text,
  },
  distanceLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 1,
  },
  summaryActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderRadius: radius.sm,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  detailsButton: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: 2,
    minHeight: 40,
    paddingHorizontal: spacing.sm,
  },
  detailsButtonText: {
    ...typography.label,
    color: colors.accent,
  },
  pressed: {
    opacity: 0.68,
  },
  error: {
    alignItems: "center",
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
  },
  errorText: {
    ...typography.caption,
    color: colors.danger,
    flex: 1,
  },
  privacy: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
  },
  privacyText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  runtimePanel: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  runtimePanelWarning: {
    backgroundColor: colors.dangerSoft,
    borderColor: "#EDB9B4",
  },
  runtimeHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  runtimeHeadingCopy: {
    flex: 1,
    gap: 2,
  },
  runtimeTitle: {
    ...typography.label,
    color: colors.text,
    fontSize: 14,
  },
  runtimeMeta: {
    ...typography.caption,
    color: colors.textMuted,
  },
  runtimeError: {
    ...typography.caption,
    color: colors.danger,
  },
  detailsHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  detailsBackButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  detailsHeadingCopy: {
    flex: 1,
  },
  detailsPanel: {
    ...shadows.card,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
  },
  detailRow: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 54,
    paddingVertical: spacing.sm,
  },
  detailLabel: {
    ...typography.body,
    color: colors.textMuted,
    flex: 1,
  },
  detailValue: {
    ...typography.label,
    color: colors.text,
    flex: 1.4,
    textAlign: "right",
  },
  placesSection: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
  },
  sectionTitle: {
    ...typography.section,
    color: colors.text,
  },
  placesHeading: {
    marginBottom: spacing.sm,
  },
  dwellSettingRow: {
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  dwellSettingLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  dwellSegmentFont: {
    ...typography.label,
    color: colors.text,
  },
  dwellSegmentActiveFont: {
    ...typography.label,
    color: colors.white,
  },
  placeRow: {
    borderRadius: radius.md,
    flexDirection: "row",
    minHeight: 58,
  },
  placeRowHighlighted: {
    backgroundColor: colors.accentSoft,
  },
  timeline: {
    alignItems: "center",
    width: 24,
  },
  placeDot: {
    // Matches VISIT_MARKER_COLOR in RouteMap.tsx so a stop's map pin and its
    // timeline row read as the same thing.
    backgroundColor: VISIT_MARKER_COLOR,
    borderColor: colors.white,
    borderRadius: radius.full,
    borderWidth: 2,
    height: 13,
    marginTop: 3,
    width: 13,
  },
  placeDotHighlighted: {
    height: 16,
    marginTop: 1,
    width: 16,
  },
  placeLine: {
    backgroundColor: colors.borderStrong,
    flex: 1,
    marginVertical: 3,
    width: 1,
  },
  tripDot: {
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderRadius: radius.full,
    borderWidth: 2,
    height: 13,
    marginTop: 3,
    width: 13,
  },
  tripHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
  },
  placeCopy: {
    flex: 1,
    gap: 2,
    paddingBottom: spacing.md,
    paddingLeft: spacing.sm,
  },
  placeName: {
    ...typography.body,
    color: colors.text,
    fontWeight: "600",
  },
  placeTime: {
    ...typography.caption,
    color: colors.textMuted,
  },
  emptyPlaces: {
    ...typography.body,
    color: colors.textMuted,
    paddingBottom: spacing.sm,
  },
  stepNote: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 18,
    textAlign: "center",
  },
  dangerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    paddingVertical: spacing.sm,
  },
  dangerRowText: {
    ...typography.label,
    color: colors.danger,
  },
});
