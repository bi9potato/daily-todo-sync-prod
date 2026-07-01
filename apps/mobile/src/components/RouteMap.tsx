import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Polyline } from "react-native-svg";
import { WebView } from "react-native-webview";

import { AppIcon } from "./AppIcon";
import { colors, radius, typography } from "@/theme";
import type { MobilityPoint } from "@/types";

type RouteMapProps = {
  points: MobilityPoint[];
};

const EMPTY_POINTS: MobilityPoint[] = [];

function serializePoints(points: MobilityPoint[]) {
  return JSON.stringify(
    points.map((point) => [point.latitude, point.longitude]),
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
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
    <style>
      html,body,#map{height:100%;width:100%;margin:0;background:#e9ece7}
      .leaflet-control-attribution{font:10px system-ui;color:#687168;background:rgba(255,255,255,.82)!important}
      .leaflet-control-zoom a{width:42px!important;height:42px!important;line-height:42px!important;font-size:24px!important;color:#2C5745!important}
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
      const fallback=[39.9042,116.4074];
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
      map.setView(fallback,11);
      window.setRoute=(points,fitRoute)=>{
        if(route){map.removeLayer(route)}
        markers.forEach((marker)=>map.removeLayer(marker));
        markers=[];
        if(!points.length){return}
        route=L.polyline(points,{color:'#2C5745',weight:5,opacity:.92,lineCap:'round'}).addTo(map);
        markers=[
          L.circleMarker(points[0],{radius:7,color:'#fff',weight:3,fillColor:'#2C5745',fillOpacity:1}).addTo(map),
          L.circleMarker(points[points.length-1],{radius:7,color:'#2C5745',weight:3,fillColor:'#fff',fillOpacity:1}).addTo(map)
        ];
        if(fitRoute){
          if(points.length===1){map.setView(points[0],16)}
          else{map.fitBounds(route.getBounds(),{padding:[28,28]})}
        }
      };
      window.ReactNativeWebView.postMessage('map-ready');
    </script>
  </body>
</html>`;
}

const MAP_SOURCE = { html: createMapHtml() };

function RouteMapComponent({ points = EMPTY_POINTS }: RouteMapProps) {
  const webViewRef = useRef<WebView>(null);
  const mapReadyRef = useRef(false);
  const webViewStartedRef = useRef(false);
  const [mapFailed, setMapFailed] = useState(false);
  const updateRoute = useCallback(
    (fitRoute: boolean) => {
      webViewRef.current?.injectJavaScript(
        createRouteScript(points, fitRoute),
      );
    },
    [points],
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
    const timer = setTimeout(() => {
      if (!mapReadyRef.current) {
        setMapFailed(true);
      }
    }, 4000);
    return () => clearTimeout(timer);
  }, [points.length]);

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
          updateRoute(true);
        }
      }}
      onError={() => setMapFailed(true)}
      onHttpError={() => setMapFailed(true)}
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

export const RouteMap = memo(RouteMapComponent);

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
