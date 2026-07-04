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
  type LngLatBounds,
  type StyleSpecification,
} from "@maplibre/maplibre-react-native";

import { AppIcon } from "./AppIcon";
import { recordClientLog } from "@/lib/client-logs";
import type { LiveLocation } from "@/lib/useLiveLocation";
import { colors, radius, typography } from "@/theme";
import type { MobilityPoint } from "@/types";

export type RouteMapHandle = {
  play: (speed: number) => void;
  pause: () => void;
  seek: (ratio: number) => void;
  stop: () => void;
  // Recenter the camera on the live location and zoom in to a street-level
  // view, the way tapping Google Maps' locate button snaps to your position.
  centerOnLive: () => void;
};

type RouteMapProps = {
  points: MobilityPoint[];
  // The live "you are here" fix (foreground position + compass heading). When
  // present the map draws a blue puck and heading beam on top of the recorded
  // route, independent of the coarse background footprint recording.
  liveLocation?: LiveLocation | null;
  // While true the camera keeps the live puck centered as new fixes arrive.
  followLive?: boolean;
  onFallback?: (fallback: boolean) => void;
  onPlaybackEnded?: () => void;
  onPlaybackProgress?: (ratio: number, timestampMs: number) => void;
  // Fired when the user pans/zooms the map by hand, so the screen can drop out
  // of follow mode instead of fighting the gesture on the next fix.
  onUserPan?: () => void;
};

const EMPTY_POINTS: MobilityPoint[] = [];

// The style is defined inline instead of fetched from a style server: the
// OpenFreeMap vector style this map first shipped with is served through
// Cloudflare and never loaded on some mainland-China networks, which left the
// whole map blank (no basemap, no route layers, and onDidFinishLoadingMap
// never fired). A local style keeps every layer available unconditionally;
// only individual tile fetches can fail, and they fail per-tile. The tiles
// are the same openstreetmap.org rasters the previous Leaflet WebView used -
// reachable from China and WGS84, so they align with raw GPS points with no
// GCJ-02 offset.
const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: [
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#E4E9E1" },
    },
    { id: "osm", type: "raster", source: "osm" },
  ],
};

const ROUTE_COLOR = "#2C5745";
const PLAYBACK_COLOR = "#E8853A";
// The live puck uses the same blue every consumer map (Google/Apple) uses for
// "you are here", deliberately distinct from the green recorded route so the
// two never read as the same thing.
const LIVE_COLOR = "#1A73E8";
// How long to glide the live dot to each new fix. Position arrives ~1Hz; a
// short linear tween turns those steps into continuous motion like a nav app
// instead of a teleport every second.
const LIVE_TWEEN_MS = 950;
const LIVE_FOLLOW_ZOOM = 16;
// Throttle for the scrubber progress ping back to the consumer, matching the
// old WebView cadence so the slider stays smooth without a 60fps flood.
const PROGRESS_PING_MS = 120;

// Heading beam geometry. The beam is a small circular sector in real-world
// meters pointing where the phone faces - the same metaphor as Google Maps'
// blue cone - built as a GeoJSON polygon so it rotates purely from data with
// no image asset to bundle or rotate natively.
const EARTH_RADIUS_METERS = 6378137;
const BEAM_RADIUS_METERS = 32;
const BEAM_HALF_ANGLE_DEGREES = 30;
const BEAM_ARC_STEPS = 12;

// Offset a lon/lat by a local east/north displacement in meters using the
// standard equirectangular approximation. Accurate to well under a meter at
// the beam's ~30m scale, which is all the visual needs.
function offsetMeters(
  lon: number,
  lat: number,
  eastMeters: number,
  northMeters: number,
): [number, number] {
  const dLat = (northMeters / EARTH_RADIUS_METERS) * (180 / Math.PI);
  const dLon =
    (eastMeters / (EARTH_RADIUS_METERS * Math.cos((lat * Math.PI) / 180))) *
    (180 / Math.PI);
  return [lon + dLon, lat + dLat];
}

// Build the heading beam as a wedge fanning out from the current position
// toward `headingDeg` (degrees clockwise from north).
function headingBeam(
  lon: number,
  lat: number,
  headingDeg: number,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const ring: [number, number][] = [[lon, lat]];
  const start = headingDeg - BEAM_HALF_ANGLE_DEGREES;
  const end = headingDeg + BEAM_HALF_ANGLE_DEGREES;
  for (let step = 0; step <= BEAM_ARC_STEPS; step += 1) {
    const bearing =
      ((start + ((end - start) * step) / BEAM_ARC_STEPS) * Math.PI) / 180;
    const east = Math.sin(bearing) * BEAM_RADIUS_METERS;
    const north = Math.cos(bearing) * BEAM_RADIUS_METERS;
    ring.push(offsetMeters(lon, lat, east, north));
  }
  ring.push([lon, lat]);
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}

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

const FIT_PADDING = { top: 36, right: 36, bottom: 36, left: 36 };
// Expand degenerate bounding boxes to roughly a 400m span: a day spent at one
// place collapses to a single anchor point, and fitting a zero-area box would
// otherwise zoom to building level (or, for fitBounds, to infinity).
const MIN_BOUNDS_SPAN_DEGREES = 0.004;

function routeBounds(points: MobilityPoint[]): LngLatBounds {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const point of points) {
    west = Math.min(west, point.longitude);
    east = Math.max(east, point.longitude);
    south = Math.min(south, point.latitude);
    north = Math.max(north, point.latitude);
  }
  const lonPad = Math.max(0, (MIN_BOUNDS_SPAN_DEGREES - (east - west)) / 2);
  const latPad = Math.max(0, (MIN_BOUNDS_SPAN_DEGREES - (north - south)) / 2);
  return [west - lonPad, south - latPad, east + lonPad, north + latPad];
}

function RouteMapComponent(
  {
    points = EMPTY_POINTS,
    liveLocation = null,
    followLive = false,
    onFallback,
    onPlaybackEnded,
    onPlaybackProgress,
    onUserPan,
  }: RouteMapProps,
  ref: ForwardedRef<RouteMapHandle>,
) {
  const cameraRef = useRef<CameraRef>(null);
  const hasFitRef = useRef(false);
  // The camera must frame the route from its very first frame, without
  // waiting for the style to finish loading: fitBounds used to run only from
  // onDidFinishLoadingMap, so a slow or failed style load left the camera on
  // a zoomed-out null island forever. The native camera applies
  // initialViewState once, when it attaches to the map, and ignores later
  // updates - so recomputing on live appends cannot re-center mid-gesture.
  const initialViewState = useMemo(
    () =>
      points.length
        ? { bounds: routeBounds(points), padding: FIT_PADDING }
        : undefined,
    [points],
  );
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

  // --- Live "you are here" puck + heading beam -----------------------------
  // The live fix is animated with its own MapLibreAnimated.Point (independent
  // of the playback dot) so it glides between the ~1Hz fixes instead of
  // teleporting, matching a nav app's continuous motion.
  const liveLocationRef = useRef<LiveLocation | null>(null);
  const livePointRef = useRef<InstanceType<typeof MapLibreAnimated.Point> | null>(
    null,
  );
  const [livePoint, setLivePoint] = useState<InstanceType<
    typeof MapLibreAnimated.Point
  > | null>(null);
  const hasCenteredLiveRef = useRef(false);

  const beamFeature = useMemo<GeoJSON.Feature<GeoJSON.Polygon> | null>(() => {
    if (!liveLocation || liveLocation.heading == null) {
      return null;
    }
    return headingBeam(
      liveLocation.longitude,
      liveLocation.latitude,
      liveLocation.heading,
    );
  }, [liveLocation]);

  const centerOnLive = useCallback(() => {
    const current = liveLocationRef.current;
    const camera = cameraRef.current;
    if (!current || !camera) {
      return;
    }
    // v11 CameraRef: setStop takes a CameraStop ({ center, zoom, duration,
    // easing }); there is no setCamera/moveTo in this version.
    void camera
      .setStop({
        center: [current.longitude, current.latitude],
        zoom: LIVE_FOLLOW_ZOOM,
        duration: 600,
        easing: "ease",
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    liveLocationRef.current = liveLocation;
    if (!liveLocation) {
      return;
    }
    const geometry = pointGeometry([
      liveLocation.longitude,
      liveLocation.latitude,
    ]);
    const point = livePointRef.current;
    if (!point) {
      const created = new MapLibreAnimated.Point(geometry);
      livePointRef.current = created;
      setLivePoint(created);
    } else {
      point
        .timing({ toValue: geometry, duration: LIVE_TWEEN_MS, easing: Easing.linear })
        .start();
    }
    if (followLive && cameraRef.current) {
      // Linear easing (not "fly") so following glides straight to the new fix
      // instead of arcing out and back; zoom is omitted to keep the user's
      // current zoom level.
      void cameraRef.current
        .setStop({
          center: [liveLocation.longitude, liveLocation.latitude],
          duration: LIVE_TWEEN_MS,
          easing: "linear",
        })
        .catch(() => undefined);
    }
  }, [liveLocation, followLive]);

  // With no recorded route to frame, snap to the first live fix once so the
  // map opens on the user instead of null island; the route-bounds path above
  // already covers the with-route case.
  useEffect(() => {
    if (
      mapReady &&
      !points.length &&
      liveLocation &&
      !hasCenteredLiveRef.current
    ) {
      hasCenteredLiveRef.current = true;
      centerOnLive();
    }
  }, [mapReady, points.length, liveLocation, centerOnLive]);

  useImperativeHandle(
    ref,
    () => ({
      play: startPlayback,
      pause: pausePlayback,
      seek: seekPlayback,
      stop: stopPlayback,
      centerOnLive,
    }),
    [centerOnLive, pausePlayback, seekPlayback, startPlayback, stopPlayback],
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
    camera.fitBounds(routeBounds(points), {
      padding: FIT_PADDING,
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

  // The native map is worth showing whenever there is either a recorded route
  // or a live fix to place the puck on; only web (no native map) and the truly
  // empty state fall back to the SVG preview / empty card.
  useEffect(() => {
    onFallback?.(Platform.OS === "web" || (!points.length && !liveLocation));
  }, [onFallback, points.length, liveLocation]);

  if (!points.length && !liveLocation) {
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
      // TextureView instead of the default SurfaceView: the map sits inside a
      // scrolling, rounded, overflow-hidden card, where SurfaceView's
      // hole-punched rendering can show up blank or bleed past the clip.
      androidView="texture"
      // Gesture props are passed explicitly - on Android the native view only
      // calls requestDisallowInterceptTouchEvent when the pan prop was
      // actually delivered, and an omitted prop never reaches the view
      // manager. Without it the surrounding ScrollView intercepts every
      // touch-move, killing both panning and pinch zoom.
      dragPan
      touchZoom
      doubleTapZoom
      // Keep the route map north-up and flat, like the Leaflet map before it;
      // accidental two-finger twists otherwise rotate it mid-pinch.
      touchRotate={false}
      touchPitch={false}
      mapStyle={MAP_STYLE}
      onDidFailLoadingMap={() => {
        recordClientLog("warn", "Route map failed to load", {
          source: "mobility",
        });
      }}
      onDidFinishLoadingMap={() => setMapReady(true)}
      // A hand pan/zoom drops follow mode so the camera stops chasing the puck
      // and fighting the gesture; programmatic follow moves report
      // userInteraction false and are ignored here.
      onRegionDidChange={(event) => {
        if (event.nativeEvent.userInteraction) {
          onUserPan?.();
        }
      }}
      style={styles.map}>
      <Camera ref={cameraRef} initialViewState={initialViewState} />

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

      {/* Heading beam sits under the dot so the dot always reads on top. */}
      {beamFeature ? (
        <GeoJSONSource id="live-heading-source" data={beamFeature}>
          <Layer
            id="live-heading-fill"
            type="fill"
            paint={{ "fill-color": LIVE_COLOR, "fill-opacity": 0.22 }}
          />
        </GeoJSONSource>
      ) : null}

      {liveLocation && livePoint ? (
        <MapLibreAnimated.GeoJSONSource id="live-source" data={livePoint}>
          <Layer
            id="live-accuracy"
            type="circle"
            paint={{
              "circle-radius": 11,
              "circle-color": LIVE_COLOR,
              "circle-opacity": 0.18,
            }}
          />
          <Layer
            id="live-dot"
            type="circle"
            paint={{
              "circle-radius": 7,
              "circle-color": LIVE_COLOR,
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
