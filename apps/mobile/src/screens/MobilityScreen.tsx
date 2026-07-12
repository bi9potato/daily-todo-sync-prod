import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { scheduleIdleTask } from "@/lib/schedule-idle-task";
import * as FileSystem from "expo-file-system/legacy";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import * as Sharing from "expo-sharing";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppIcon } from "@/components/AppIcon";
import {
  RouteMap,
  type RouteMapHandle,
  type RouteMapVisit,
} from "@/components/RouteMap";
import { ScreenEnter } from "@/components/ScreenEnter";
import {
  MobilityDetails,
  formatRuntimeTime,
} from "@/components/mobility/MobilityDetails";
import { MobilityPlaybackBar } from "@/components/mobility/MobilityPlaybackBar";
import { MobilityTimeline } from "@/components/mobility/MobilityTimeline";
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
} from "@/lib/mobility-storage";
import {
  promptForBatteryOptimization,
  requestTrackingPermissions,
} from "@/lib/mobility-permissions";
import { flushMobilityPointQueue } from "@/lib/mobility-queue";
import {
  mergeMobilityPoints,
  mobilitySegmentKey,
} from "@/lib/mobility-view-model";
import {
  clearNativeMobilityQueue,
  flushNativeMobilityQueueNow,
  getLatestNativeMobilityPoint,
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
  MobilityPoint,
  MobilityRecording,
  MobilitySegment,
} from "@/types";

const EMPTY_MOBILITY_POINTS: MobilityPoint[] = [];
const EMPTY_MOBILITY_SEGMENTS: MobilitySegment[] = [];

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
  // Drawer screens stay mounted after their first visit, so anything
  // periodic in here would otherwise keep running forever from every other
  // screen. Gate all polling on actual focus.
  const [isFocused, setIsFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, []),
  );

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
      isFocused && query.state.data?.activeRecording ? 5_000 : false,
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
    if (!isFocused || !recordingEnabled || !recordingId) {
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
  }, [activeRecording?.id, isFocused, recordingEnabled, today]);

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
          id: mobilitySegmentKey(segment),
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
      const key = mobilitySegmentKey(segment);

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
          candidate.type === "visit" && mobilitySegmentKey(candidate) === id,
      );
      if (segment) {
        focusSegment(segment);
      }
    },
    [timelineSegments, focusSegment],
  );

  const registerRowRef = useCallback((key: string, node: View | null) => {
    rowRefs.current[key] = node;
  }, []);

  // Live "you are here" puck + heading. It only makes sense for today (a past
  // day has no "now"), and only runs once we hold foreground location
  // permission - always true while recording, otherwise requested on demand
  // when the user taps the locate button. This is intentionally separate from
  // the background footprint recording, which stays coarse for battery/history.
  const [userEnabledLive, setUserEnabledLive] = useState(false);
  const [followLive, setFollowLive] = useState(false);
  const liveEnabled = isToday && (recordingEnabled || userEnabledLive);
  const liveLocation = useLiveLocation(liveEnabled);

  // Mounting MapLibre is non-urgent (GL surface + style setup), so let the
  // initial screen render finish first. A timeout guarantees the map appears
  // even on a continuously busy JS thread.
  const [mapMountReady, setMapMountReady] = useState(false);
  useEffect(() => {
    return scheduleIdleTask(() => {
      setMapMountReady(true);
    });
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
        <MobilityPlaybackBar
          isPlaying={isPlaying}
          onChooseSpeed={choosePlaybackSpeed}
          onSeek={seekPlayback}
          onTogglePlayback={togglePlayback}
          playbackRatio={playbackRatio}
          playbackSpeed={playbackSpeed}
        />
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

      <MobilityTimeline
        highlightedSegmentKey={highlightedSegmentKey}
        onChooseVisitDwellMinutes={chooseVisitDwellMinutes}
        onPressVisit={focusSegment}
        registerRowRef={registerRowRef}
        segments={timelineSegments}
        visitDwellMinutes={visitDwellMinutes}
      />

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
