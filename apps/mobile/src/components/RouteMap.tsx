import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
} from "react";
import {
  Animated as RNAnimated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Circle, Line, Polyline } from "react-native-svg";
import {
  Animated as MapLibreAnimated,
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  type CameraRef,
} from "@maplibre/maplibre-react-native";

import { AppIcon } from "./AppIcon";
import { colors, radius, typography } from "@/theme";
import type { MobilityPoint } from "@/types";

export type RouteMapHandle = {
  play: (speed: number) => void;
  pause: () => void;
  seek: (ratio: number) => void;
  stop: () => void;
};

type RouteMapProps = {
  points: MobilityPoint[];
  onFallback?: (fallback: boolean) => void;
  onPlaybackEnded?: () => void;
  onPlaybackProgress?: (ratio: number, timestampMs: number) => void;
};

const EMPTY_POINTS: MobilityPoint[] = [];

// OpenFreeMap: open-source, no API key, no registration. Positron is a clean
// light basemap that lets the green route stand out. WGS84 (OSM-derived) so it
// aligns with the raw GPS points - no GCJ-02 offset. Swap the last path segment
// (e.g. "liberty") for a more detailed style.
const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

const ROUTE_COLOR = "#2C5745";
const PLAYBACK_COLOR = "#E8853A";
// Throttle for the scrubber progress ping back to the consumer, matching the
// old WebView cadence so the slider stays smooth without a 60fps flood.
const PROGRESS_PING_MS = 120;

// A route point flattened to what the map + playback math need.
type RoutePoint = { lon: number; lat: number; t: number };

function toRoutePoints(points: MobilityPoint[]): RoutePoint[] {
  return points.map((point) => ({
    lon: point.longitude,
    lat: point.latitude,
    t: new Date(point.recordedAt).getTime(),
  }));
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

// Linearly interpolate the position along the route at a virtual time (ms),
// mirroring the old in-WebView pointAtVirtualTime so playback keeps the same
// GPS-timestamp-driven variable speed.
function positionAtVirtualTime(pts: RoutePoint[], vt: number): [number, number] {
  if (!pts.length) {
    return [0, 0];
  }
  if (vt <= pts[0].t) {
    return [pts[0].lon, pts[0].lat];
  }
  const last = pts.length - 1;
  if (vt >= pts[last].t) {
    return [pts[last].lon, pts[last].lat];
  }
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].t <= vt) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const a = pts[lo];
  const b = pts[hi];
  const span = b.t - a.t;
  const ratio = span > 0 ? (vt - a.t) / span : 0;
  return [a.lon + (b.lon - a.lon) * ratio, a.lat + (b.lat - a.lat) * ratio];
}

// Index i such that pts[i].t <= vt <= pts[i+1].t (the leg starting at vt).
function legIndexForVirtualTime(pts: RoutePoint[], vt: number): number {
  const last = pts.length - 1;
  if (vt <= pts[0].t) {
    return 0;
  }
  if (vt >= pts[last].t) {
    return last;
  }
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].t <= vt) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function pointGeometry(coordinates: [number, number]): GeoJSON.Point {
  return { type: "Point", coordinates };
}

function RouteMapComponent(
  { points = EMPTY_POINTS, onFallback, onPlaybackEnded, onPlaybackProgress }: RouteMapProps,
  ref: ForwardedRef<RouteMapHandle>,
) {
  const cameraRef = useRef<CameraRef>(null);
  const hasFitRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [playbackVisible, setPlaybackVisible] = useState(false);
  // The playback marker is kept in state (not just a ref) because it is passed
  // as the `data` prop of the animated source, i.e. it is needed for rendering.
  const [playbackPoint, setPlaybackPoint] = useState<InstanceType<
    typeof MapLibreAnimated.Point
  > | null>(null);

  // Route data as memoized GeoJSON. Native GeoJSONSource diffs updates
  // efficiently, so unlike the old WebView (which re-serialized the whole
  // route across the bridge on every live point) no throttle is needed here.
  const routeLine = useMemo<GeoJSON.Feature<GeoJSON.LineString>>(
    () => ({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: points.map((point) => [point.longitude, point.latitude]),
      },
    }),
    [points],
  );

  const endpoints = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => {
    if (!points.length) {
      return { type: "FeatureCollection", features: [] };
    }
    const first = points[0];
    const last = points[points.length - 1];
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { role: "start" },
          geometry: { type: "Point", coordinates: [first.longitude, first.latitude] },
        },
        {
          type: "Feature",
          properties: { role: "end" },
          geometry: { type: "Point", coordinates: [last.longitude, last.latitude] },
        },
      ],
    };
  }, [points]);

  // Playback state kept in refs so the animation callbacks never read stale
  // values. The marker itself is an AnimatedPoint animated natively; the refs
  // only drive leg chaining, the progress ticker, and pause/seek bookkeeping.
  const routePointsRef = useRef<RoutePoint[]>([]);
  const playbackPointRef = useRef<InstanceType<typeof MapLibreAnimated.Point> | null>(
    null,
  );
  const currentAnimRef = useRef<RNAnimated.CompositeAnimation | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playingRef = useRef(false);
  const speedRef = useRef(1);
  const currentVtRef = useRef(0);
  const anchorVtRef = useRef(0);
  const anchorRealMsRef = useRef(0);

  useEffect(() => {
    const pts = toRoutePoints(points);
    routePointsRef.current = pts;
    // Create the marker (and seed the virtual clock) once, when the route first
    // has points. Live appends within the same day must not reset an in-flight
    // playback; a day change remounts this component (key={selectedDate}).
    if (pts.length && !playbackPointRef.current) {
      currentVtRef.current = pts[0].t;
      const created = new MapLibreAnimated.Point(
        pointGeometry([pts[0].lon, pts[0].lat]),
      );
      playbackPointRef.current = created;
      setPlaybackPoint(created);
    }
  }, [points]);

  const clearTicker = useCallback(() => {
    if (tickerRef.current) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
  }, []);

  const ensurePlaybackPoint = useCallback(() => {
    const pts = routePointsRef.current;
    if (!playbackPointRef.current && pts.length) {
      const created = new MapLibreAnimated.Point(
        pointGeometry([pts[0].lon, pts[0].lat]),
      );
      playbackPointRef.current = created;
      setPlaybackPoint(created);
    }
    return playbackPointRef.current;
  }, []);

  const stopAnim = useCallback(() => {
    currentAnimRef.current?.stop();
    currentAnimRef.current = null;
  }, []);

  const finishPlayback = useCallback(() => {
    const pts = routePointsRef.current;
    playingRef.current = false;
    clearTicker();
    stopAnim();
    if (pts.length) {
      currentVtRef.current = pts[pts.length - 1].t;
      onPlaybackProgress?.(1, currentVtRef.current);
    }
    onPlaybackEnded?.();
  }, [clearTicker, onPlaybackEnded, onPlaybackProgress, stopAnim]);

  // Animate the marker one GPS leg at a time; each leg's duration is its real
  // GPS time span divided by speed, so the dot moves at the true recorded pace
  // - the animation runs natively for smoothness. The chain recurses through a
  // ref so the callback can reference the next iteration without a self-cycle.
  const animateLegChainRef = useRef<(fromVt: number, speed: number) => void>(
    () => undefined,
  );
  const animateLegChain = useCallback(
    (fromVt: number, speed: number) => {
      const pts = routePointsRef.current;
      const point = playbackPointRef.current;
      if (!point || pts.length < 2) {
        finishPlayback();
        return;
      }
      const legIndex = legIndexForVirtualTime(pts, fromVt);
      if (legIndex >= pts.length - 1) {
        finishPlayback();
        return;
      }
      const target = pts[legIndex + 1];
      const duration = Math.max(1, (target.t - fromVt) / speed);
      const anim = point.timing({
        toValue: pointGeometry([target.lon, target.lat]),
        duration,
        easing: Easing.linear,
      });
      currentAnimRef.current = anim;
      anim.start(({ finished }) => {
        if (!finished || !playingRef.current) {
          return;
        }
        if (legIndex + 1 >= pts.length - 1) {
          finishPlayback();
          return;
        }
        animateLegChainRef.current(target.t, speed);
      });
    },
    [finishPlayback],
  );
  useEffect(() => {
    animateLegChainRef.current = animateLegChain;
  }, [animateLegChain]);

  const startProgressTicker = useCallback(() => {
    clearTicker();
    tickerRef.current = setInterval(() => {
      if (!playingRef.current) {
        return;
      }
      const pts = routePointsRef.current;
      if (!pts.length) {
        return;
      }
      const t0 = pts[0].t;
      const tN = pts[pts.length - 1].t;
      const vt = Math.min(
        tN,
        anchorVtRef.current + (Date.now() - anchorRealMsRef.current) * speedRef.current,
      );
      const ratio = tN > t0 ? (vt - t0) / (tN - t0) : 0;
      onPlaybackProgress?.(clamp01(ratio), vt);
    }, PROGRESS_PING_MS);
  }, [clearTicker, onPlaybackProgress]);

  const startPlayback = useCallback(
    (speed: number) => {
      const pts = routePointsRef.current;
      if (pts.length < 2) {
        return;
      }
      const t0 = pts[0].t;
      const tN = pts[pts.length - 1].t;
      // If already playing, settle the current virtual time before re-anchoring
      // (this path also handles a live speed change).
      if (playingRef.current) {
        currentVtRef.current = Math.min(
          tN,
          anchorVtRef.current + (Date.now() - anchorRealMsRef.current) * speedRef.current,
        );
      }
      if (currentVtRef.current >= tN) {
        currentVtRef.current = t0;
      }
      const point = ensurePlaybackPoint();
      if (!point) {
        return;
      }
      setPlaybackVisible(true);
      playingRef.current = true;
      speedRef.current = speed;
      anchorVtRef.current = currentVtRef.current;
      anchorRealMsRef.current = Date.now();
      stopAnim();
      point.setValue(pointGeometry(positionAtVirtualTime(pts, currentVtRef.current)));
      animateLegChain(currentVtRef.current, speed);
      startProgressTicker();
    },
    [animateLegChain, ensurePlaybackPoint, startProgressTicker, stopAnim],
  );

  const pausePlayback = useCallback(() => {
    const pts = routePointsRef.current;
    if (!playingRef.current || !pts.length) {
      return;
    }
    const t0 = pts[0].t;
    const tN = pts[pts.length - 1].t;
    currentVtRef.current = Math.max(
      t0,
      Math.min(
        tN,
        anchorVtRef.current + (Date.now() - anchorRealMsRef.current) * speedRef.current,
      ),
    );
    playingRef.current = false;
    stopAnim();
    clearTicker();
  }, [clearTicker, stopAnim]);

  const seekPlayback = useCallback(
    (ratio: number) => {
      const pts = routePointsRef.current;
      if (!pts.length) {
        return;
      }
      const t0 = pts[0].t;
      const tN = pts[pts.length - 1].t;
      const vt = t0 + (tN - t0) * clamp01(ratio);
      playingRef.current = false;
      stopAnim();
      clearTicker();
      currentVtRef.current = vt;
      const point = ensurePlaybackPoint();
      if (point) {
        setPlaybackVisible(true);
        point.setValue(pointGeometry(positionAtVirtualTime(pts, vt)));
      }
      onPlaybackProgress?.(clamp01(ratio), vt);
    },
    [clearTicker, ensurePlaybackPoint, onPlaybackProgress, stopAnim],
  );

  const stopPlayback = useCallback(() => {
    const pts = routePointsRef.current;
    playingRef.current = false;
    stopAnim();
    clearTicker();
    currentVtRef.current = pts.length ? pts[0].t : 0;
    setPlaybackVisible(false);
  }, [clearTicker, stopAnim]);

  useImperativeHandle(
    ref,
    () => ({
      play: startPlayback,
      pause: pausePlayback,
      seek: seekPlayback,
      stop: stopPlayback,
    }),
    [pausePlayback, seekPlayback, startPlayback, stopPlayback],
  );

  // Tear down timers/animations if the component unmounts mid-playback.
  useEffect(
    () => () => {
      if (tickerRef.current) {
        clearInterval(tickerRef.current);
      }
      currentAnimRef.current?.stop();
    },
    [],
  );

  const fitToRoute = useCallback(() => {
    const camera = cameraRef.current;
    if (!camera || !points.length) {
      return;
    }
    const lons = points.map((point) => point.longitude);
    const lats = points.map((point) => point.latitude);
    let west = Math.min(...lons);
    let east = Math.max(...lons);
    let south = Math.min(...lats);
    let north = Math.max(...lats);
    // Pad a zero-area (single point) box so fitBounds doesn't zoom to infinity.
    if (points.length === 1) {
      west -= 0.003;
      east += 0.003;
      south -= 0.003;
      north += 0.003;
    }
    camera.fitBounds([west, south, east, north], {
      padding: { top: 36, right: 36, bottom: 36, left: 36 },
      duration: 300,
    });
  }, [points]);

  // Fit once per mount when the map is ready and points are present. Live
  // appends within the same day must not keep re-centering (MobilityScreen
  // remounts this via key={selectedDate} when the day changes).
  useEffect(() => {
    if (mapReady && points.length && !hasFitRef.current) {
      hasFitRef.current = true;
      fitToRoute();
    }
  }, [mapReady, points.length, fitToRoute]);

  // Native map is available whenever there are points; only web falls back to
  // the SVG preview. (The old WebView-specific failure paths are gone.)
  useEffect(() => {
    onFallback?.(Platform.OS === "web" || !points.length);
  }, [onFallback, points.length]);

  if (!points.length) {
    return (
      <View style={styles.empty}>
        <AppIcon name="map-outline" color={colors.accent} size={30} />
        <Text style={styles.emptyTitle}>今天还没有轨迹</Text>
        <Text style={styles.emptyCopy}>
          打开持续授权后，走过的路线会出现在这里
        </Text>
      </View>
    );
  }

  if (Platform.OS === "web") {
    return <RoutePreview points={points} />;
  }

  return (
    <Map
      mapStyle={MAP_STYLE_URL}
      onDidFinishLoadingMap={() => setMapReady(true)}
      style={styles.map}>
      <Camera ref={cameraRef} />

      <GeoJSONSource id="route-source" data={routeLine}>
        <Layer
          id="route-line"
          type="line"
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{ "line-color": ROUTE_COLOR, "line-width": 5, "line-opacity": 0.92 }}
        />
      </GeoJSONSource>

      <GeoJSONSource id="endpoints-source" data={endpoints}>
        <Layer
          id="route-start"
          type="circle"
          filter={["==", ["get", "role"], "start"]}
          paint={{
            "circle-radius": 7,
            "circle-color": ROUTE_COLOR,
            "circle-stroke-width": 3,
            "circle-stroke-color": "#ffffff",
          }}
        />
        <Layer
          id="route-end"
          type="circle"
          filter={["==", ["get", "role"], "end"]}
          paint={{
            "circle-radius": 7,
            "circle-color": "#ffffff",
            "circle-stroke-width": 3,
            "circle-stroke-color": ROUTE_COLOR,
          }}
        />
      </GeoJSONSource>

      {playbackVisible && playbackPoint ? (
        <MapLibreAnimated.GeoJSONSource id="playback-source" data={playbackPoint}>
          <Layer
            id="playback-dot"
            type="circle"
            paint={{
              "circle-radius": 8,
              "circle-color": PLAYBACK_COLOR,
              "circle-stroke-width": 3,
              "circle-stroke-color": "#ffffff",
            }}
          />
        </MapLibreAnimated.GeoJSONSource>
      ) : null}
    </Map>
  );
}

function RoutePreview({ points }: RouteMapProps) {
  const normalized = useMemo(() => {
    const latitudes = points.map((point) => point.latitude);
    const longitudes = points.map((point) => point.longitude);
    const minLat = Math.min(...latitudes);
    const maxLat = Math.max(...latitudes);
    const minLon = Math.min(...longitudes);
    const maxLon = Math.max(...longitudes);
    const latRange = Math.max(maxLat - minLat, 0.001);
    const lonRange = Math.max(maxLon - minLon, 0.001);
    return points.map((point) => ({
      x: 22 + ((point.longitude - minLon) / lonRange) * 276,
      y: 198 - ((point.latitude - minLat) / latRange) * 160,
    }));
  }, [points]);

  return (
    <View style={styles.preview}>
      <Svg height="100%" viewBox="0 0 320 220" width="100%">
        <Line x1="0" y1="52" x2="320" y2="14" stroke="#D5DDD3" strokeWidth="8" />
        <Line x1="32" y1="220" x2="82" y2="0" stroke="#D5DDD3" strokeWidth="7" />
        <Line x1="0" y1="176" x2="320" y2="118" stroke="#F9FAF7" strokeWidth="19" />
        <Line x1="196" y1="220" x2="246" y2="0" stroke="#F9FAF7" strokeWidth="15" />
        <Polyline
          fill="none"
          points={normalized.map((point) => `${point.x},${point.y}`).join(" ")}
          stroke={colors.accent}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="5"
        />
        <Circle
          cx={normalized[0].x}
          cy={normalized[0].y}
          fill={colors.accent}
          r="7"
          stroke={colors.white}
          strokeWidth="3"
        />
        <Circle
          cx={normalized.at(-1)?.x}
          cy={normalized.at(-1)?.y}
          fill={colors.white}
          r="7"
          stroke={colors.accent}
          strokeWidth="3"
        />
      </Svg>
      <Text style={styles.previewAttribution}>
        路线预览 · 地图仅在移动端加载
      </Text>
    </View>
  );
}

export const RouteMap = memo(forwardRef(RouteMapComponent));

const styles = StyleSheet.create({
  map: {
    backgroundColor: colors.background,
    flex: 1,
  },
  empty: {
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    flex: 1,
    gap: 5,
    justifyContent: "center",
    padding: 24,
  },
  emptyTitle: {
    ...typography.section,
    color: colors.text,
    marginTop: 4,
  },
  emptyCopy: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: "center",
  },
  preview: {
    backgroundColor: "#E4E9E1",
    flex: 1,
    overflow: "hidden",
    position: "relative",
  },
  previewAttribution: {
    ...typography.caption,
    backgroundColor: "rgba(255,255,255,0.82)",
    borderRadius: radius.sm,
    bottom: 8,
    color: colors.textMuted,
    paddingHorizontal: 7,
    paddingVertical: 3,
    position: "absolute",
    right: 8,
  },
});
