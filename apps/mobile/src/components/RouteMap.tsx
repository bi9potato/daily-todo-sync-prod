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
import { Platform, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Polyline } from "react-native-svg";
import { WebView } from "react-native-webview";

import { AppIcon } from "./AppIcon";
import { recordClientLog } from "@/lib/client-logs";
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

function serializePoints(points: MobilityPoint[]) {
  return JSON.stringify(
    points.map((point) => [
      point.latitude,
      point.longitude,
      new Date(point.recordedAt).getTime(),
    ]),
  ).replace(/</g, "\\u003c");
}

function createRouteScript(points: MobilityPoint[], fitRoute: boolean) {
  return `window.setRoute(${serializePoints(points)},${fitRoute});true;`;
}

function createMapHtml() {
  return `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
    <style>
      html,body,#map{height:100%;width:100%;margin:0;background:#e9ece7}
      .leaflet-control-attribution{font:10px system-ui;color:#687168;background:rgba(255,255,255,.82)!important}
      .leaflet-control-zoom a{width:42px!important;height:42px!important;line-height:42px!important;font-size:24px!important;color:#2C5745!important}
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script>
      // unpkg is frequently unreachable from mainland-China networks, which
      // used to leave the map (and with it the whole playback UI) blank
      // until the 10s timeout kicked in. npmmirror serves the same files
      // domestically; unpkg stays as the fallback for everyone else. A
      // terminal failure posts map-load-failed so RN can swap to the SVG
      // preview immediately instead of waiting out the timeout.
      const LEAFLET_SOURCES=[
        'https://registry.npmmirror.com/leaflet/1.9.4/files/dist',
        'https://unpkg.com/leaflet@1.9.4/dist'
      ];
      function loadCss(base){
        const link=document.createElement('link');
        link.rel='stylesheet';
        link.href=base+'/leaflet.css';
        document.head.appendChild(link);
      }
      function loadLeaflet(index){
        if(index>=LEAFLET_SOURCES.length){
          window.ReactNativeWebView.postMessage('map-load-failed');
          return;
        }
        const base=LEAFLET_SOURCES[index];
        const script=document.createElement('script');
        script.src=base+'/leaflet.js';
        script.onload=()=>{loadCss(base);initMap()};
        script.onerror=()=>loadLeaflet(index+1);
        document.body.appendChild(script);
      }
      const fallback=[39.9042,116.4074];
      function initMap(){
      const map=L.map('map',{
        attributionControl:true,
        boxZoom:true,
        doubleClickZoom:true,
        dragging:true,
        keyboard:true,
        scrollWheelZoom:true,
        touchZoom:true,
        zoomControl:true
      });
      map.zoomControl.setPosition('bottomright');
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
        maxZoom:19,
        attribution:'© OpenStreetMap'
      }).addTo(map);
      let route=null;
      let markers=[];
      let routePoints=[];
      let playbackMarker=null;
      let playbackTimer=null;
      let playbackState=null;
      let lastProgressPostedAt=0;
      map.setView(fallback,11);
      window.setRoute=(points,fitRoute)=>{
        if(!points.length){return}
        routePoints=points;
        if(route){
          route.setLatLngs(points);
          markers[0].setLatLng(points[0]);
          markers[1].setLatLng(points[points.length-1]);
        }else{
          // smoothFactor 1 (Leaflet's default) instead of 1.5: the higher
          // value simplifies the polyline and visibly cut corners off an
          // already-thinned, sparse track, so the drawn route drifted away
          // from where you actually walked. 1 keeps it faithful to the points.
          route=L.polyline(points,{color:'#2C5745',weight:5,opacity:.92,lineCap:'round',lineJoin:'round',smoothFactor:1}).addTo(map);
          markers=[
            L.circleMarker(points[0],{radius:7,color:'#fff',weight:3,fillColor:'#2C5745',fillOpacity:1}).addTo(map),
            L.circleMarker(points[points.length-1],{radius:7,color:'#2C5745',weight:3,fillColor:'#fff',fillOpacity:1}).addTo(map)
          ];
        }
        if(fitRoute){
          if(points.length===1){map.setView(points[0],16)}
          else{map.fitBounds(route.getBounds(),{padding:[28,28]})}
        }
      };

      // Playback runs entirely inside the WebView (driven by
      // requestAnimationFrame) instead of the RN bridge so the animation
      // stays smooth regardless of the route-update throttle used while a
      // recording is live. Only a throttled progress ping goes back to RN,
      // to keep the scrubber in sync without flooding the bridge at 60fps.
      function pointAtVirtualTime(vt){
        if(!routePoints.length){return null}
        if(vt<=routePoints[0][2]){return routePoints[0]}
        const lastIndex=routePoints.length-1;
        if(vt>=routePoints[lastIndex][2]){return routePoints[lastIndex]}
        let lo=0,hi=lastIndex;
        while(hi-lo>1){
          const mid=(lo+hi)>>1;
          if(routePoints[mid][2]<=vt){lo=mid}else{hi=mid}
        }
        const a=routePoints[lo],b=routePoints[hi];
        const span=b[2]-a[2];
        const t=span>0?(vt-a[2])/span:0;
        return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,vt];
      }
      function ensurePlaybackMarker(){
        if(!playbackMarker){
          playbackMarker=L.circleMarker(routePoints[0],{radius:8,color:'#fff',weight:3,fillColor:'#E8853A',fillOpacity:1}).addTo(map);
        }
      }
      function renderPlaybackAt(vt,notifyRN){
        const point=pointAtVirtualTime(vt);
        if(!point){return}
        ensurePlaybackMarker();
        playbackMarker.setLatLng(point);
        if(notifyRN){
          const first=routePoints[0][2],last=routePoints[routePoints.length-1][2];
          const ratio=last>first?(vt-first)/(last-first):0;
          window.ReactNativeWebView.postMessage(JSON.stringify({type:'playback-progress',ratio:Math.max(0,Math.min(1,ratio)),timestamp:vt}));
        }
      }
      function stopPlaybackLoop(){
        if(playbackTimer){cancelAnimationFrame(playbackTimer);playbackTimer=null}
      }
      window.startPlayback=(speed)=>{
        if(!routePoints.length){return}
        const first=routePoints[0][2],last=routePoints[routePoints.length-1][2];
        const currentVt=playbackState?playbackState.currentVt:first;
        playbackState={playing:true,speed:speed||1,anchorRealMs:Date.now(),anchorVt:currentVt,currentVt};
        stopPlaybackLoop();
        const step=()=>{
          if(!playbackState||!playbackState.playing){return}
          const elapsedReal=Date.now()-playbackState.anchorRealMs;
          const vt=Math.min(playbackState.anchorVt+elapsedReal*playbackState.speed,last);
          playbackState.currentVt=vt;
          const now=Date.now();
          const shouldNotify=now-lastProgressPostedAt>=120;
          if(shouldNotify){lastProgressPostedAt=now}
          renderPlaybackAt(vt,shouldNotify);
          if(vt>=last){
            playbackState.playing=false;
            window.ReactNativeWebView.postMessage(JSON.stringify({type:'playback-ended'}));
            return;
          }
          playbackTimer=requestAnimationFrame(step);
        };
        playbackTimer=requestAnimationFrame(step);
      };
      window.pausePlayback=()=>{
        if(playbackState&&playbackState.playing){
          const elapsedReal=Date.now()-playbackState.anchorRealMs;
          playbackState.currentVt=playbackState.anchorVt+elapsedReal*playbackState.speed;
          playbackState.playing=false;
        }
        stopPlaybackLoop();
      };
      window.seekPlayback=(ratio)=>{
        if(!routePoints.length){return}
        const first=routePoints[0][2],last=routePoints[routePoints.length-1][2];
        const vt=first+(last-first)*Math.max(0,Math.min(1,ratio));
        playbackState={playing:false,speed:(playbackState&&playbackState.speed)||1,anchorRealMs:Date.now(),anchorVt:vt,currentVt:vt};
        stopPlaybackLoop();
        renderPlaybackAt(vt,true);
      };
      window.stopPlayback=()=>{
        stopPlaybackLoop();
        playbackState=null;
        if(playbackMarker){map.removeLayer(playbackMarker);playbackMarker=null}
      };

        window.ReactNativeWebView.postMessage('map-ready');
      }
      loadLeaflet(0);
    </script>
  </body>
</html>`;
}

const MAP_SOURCE = { html: createMapHtml() };
// While a recording is active, new points can arrive every few seconds.
// Pushing the full route across the WebView bridge on every single arrival
// (re-serializing potentially thousands of points each time) is what made
// the map feel slow or briefly lock up, so trailing updates are coalesced
// into at most one bridge call per interval.
const ROUTE_UPDATE_THROTTLE_MS = 2_000;

function RouteMapComponent(
  { points = EMPTY_POINTS, onFallback, onPlaybackEnded, onPlaybackProgress }: RouteMapProps,
  ref: ForwardedRef<RouteMapHandle>,
) {
  const webViewRef = useRef<WebView>(null);
  const mapReadyRef = useRef(false);
  const webViewStartedRef = useRef(false);
  const [mapFailed, setMapFailed] = useState(false);
  // Separate from mapFailed: becomes true only once the WebView has
  // actually loaded Leaflet and confirmed via the "map-ready" postMessage
  // that window.startPlayback/etc. exist. Playback controls must stay
  // hidden until this flips - otherwise tapping play while the page is
  // still loading calls a function that doesn't exist yet in the WebView's
  // JS context and silently does nothing.
  const [mapReady, setMapReady] = useState(false);
  const lastPushedAtRef = useRef(0);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateRoute = useCallback(
    (fitRoute: boolean) => {
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      const push = () => {
        lastPushedAtRef.current = Date.now();
        webViewRef.current?.injectJavaScript(
          createRouteScript(points, fitRoute),
        );
      };
      if (fitRoute) {
        // Explicit fit requests (map just became ready, or the user changed
        // the selected day) should always apply immediately.
        push();
        return;
      }
      const elapsed = Date.now() - lastPushedAtRef.current;
      if (elapsed >= ROUTE_UPDATE_THROTTLE_MS) {
        push();
      } else {
        pendingTimerRef.current = setTimeout(push, ROUTE_UPDATE_THROTTLE_MS - elapsed);
      }
    },
    [points],
  );

  useEffect(
    () => () => {
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (mapReadyRef.current) {
      updateRoute(false);
    }
  }, [updateRoute]);

  useEffect(() => {
    if (Platform.OS === "web" || !points.length) {
      webViewStartedRef.current = false;
      return;
    }
    if (webViewStartedRef.current) {
      return;
    }
    webViewStartedRef.current = true;
    mapReadyRef.current = false;
    setMapFailed(false);
    setMapReady(false);
    // Generous because a cold load may be fetching Leaflet over a slow
    // domestic connection; explicit failures (map-load-failed, renderer
    // death) bail out long before this fires.
    const timer = setTimeout(() => {
      if (!mapReadyRef.current) {
        setMapFailed(true);
        recordClientLog("warn", "Mobility route map failed to become ready in time", {
          source: "mobility-map",
        });
      }
    }, 10000);
    return () => clearTimeout(timer);
  }, [points.length]);

  useEffect(() => {
    onFallback?.(
      Platform.OS === "web" || mapFailed || !points.length || !mapReady,
    );
  }, [mapFailed, mapReady, onFallback, points.length]);

  useImperativeHandle(
    ref,
    () => ({
      play: (speed) =>
        webViewRef.current?.injectJavaScript(`window.startPlayback(${speed});true;`),
      pause: () => webViewRef.current?.injectJavaScript("window.pausePlayback();true;"),
      seek: (ratio) =>
        webViewRef.current?.injectJavaScript(`window.seekPlayback(${ratio});true;`),
      stop: () => webViewRef.current?.injectJavaScript("window.stopPlayback();true;"),
    }),
    [],
  );

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

  if (Platform.OS === "web" || mapFailed) {
    return <RoutePreview points={points} />;
  }

  return (
    <WebView
      ref={webViewRef}
      javaScriptEnabled
      nestedScrollEnabled
      onMessage={({ nativeEvent }) => {
        if (nativeEvent.data === "map-ready") {
          mapReadyRef.current = true;
          setMapFailed(false);
          setMapReady(true);
          updateRoute(true);
          return;
        }
        if (nativeEvent.data === "map-load-failed") {
          // Every Leaflet source failed - swap to the SVG preview now
          // instead of letting the readiness timeout run out.
          setMapFailed(true);
          recordClientLog("warn", "Mobility route map assets failed to load", {
            source: "mobility-map",
          });
          return;
        }
        try {
          const payload = JSON.parse(nativeEvent.data) as {
            type?: string;
            ratio?: number;
            timestamp?: number;
          };
          if (
            payload.type === "playback-progress" &&
            typeof payload.ratio === "number"
          ) {
            onPlaybackProgress?.(payload.ratio, payload.timestamp ?? 0);
          } else if (payload.type === "playback-ended") {
            onPlaybackEnded?.();
          }
        } catch {
          // Ignore malformed bridge messages.
        }
      }}
      onError={(event) => {
        setMapFailed(true);
        recordClientLog("warn", "Mobility route map WebView error", {
          source: "mobility-map",
          context: { description: event.nativeEvent.description },
        });
      }}
      onRenderProcessGone={() => {
        // Android reclaims WebView renderer processes under memory
        // pressure (commonly while the app sits in the background). The
        // page's JS context is gone with it: the map shows blank and every
        // playback function stops existing. Reload rebuilds the page; the
        // map-ready handshake then re-pushes the route.
        mapReadyRef.current = false;
        setMapReady(false);
        recordClientLog("warn", "Mobility route map renderer was reclaimed; reloading", {
          source: "mobility-map",
        });
        webViewRef.current?.reload();
      }}
      onHttpError={(event) => {
        setMapFailed(true);
        recordClientLog("warn", "Mobility route map WebView HTTP error", {
          source: "mobility-map",
          context: { statusCode: event.nativeEvent.statusCode },
        });
      }}
      originWhitelist={["*"]}
      overScrollMode="never"
      scrollEnabled={false}
      setSupportMultipleWindows={false}
      source={MAP_SOURCE}
      style={styles.webview}
    />
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
  webview: {
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
