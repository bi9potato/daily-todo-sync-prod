import { Pressable, StyleSheet, Text, View } from "react-native";
import SegmentedControl from "@react-native-segmented-control/segmented-control";

import { AppIcon } from "@/components/AppIcon";
import { VISIT_MARKER_COLOR } from "@/components/RouteMap";
import { VISIT_DWELL_MINUTE_OPTIONS } from "@/lib/mobility-storage";
import {
  formatMobilitySegmentTimeRange,
  mobilitySegmentKey,
} from "@/lib/mobility-view-model";
import { useSegmentPlaceNames } from "@/lib/useSegmentPlaceNames";
import { colors, radius, spacing, typography } from "@/theme";
import type { MobilitySegment } from "@/types";

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

// The "足迹时间轴" card: dwell-threshold picker plus the visit/trip rows.
// Row refs are reported upward so the screen can scroll a row into view
// when its map marker is tapped.
export function MobilityTimeline({
  highlightedSegmentKey,
  onChooseVisitDwellMinutes,
  onPressVisit,
  registerRowRef,
  segments,
  visitDwellMinutes,
}: {
  highlightedSegmentKey: string | null;
  onChooseVisitDwellMinutes: (minutes: number) => void;
  onPressVisit: (segment: MobilitySegment) => void;
  registerRowRef: (key: string, node: View | null) => void;
  segments: MobilitySegment[];
  visitDwellMinutes: number;
}) {
  const segmentPlaceNames = useSegmentPlaceNames(segments);

  return (
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
              onChooseVisitDwellMinutes(minutes);
            }
          }}
          selectedIndex={(VISIT_DWELL_MINUTE_OPTIONS as readonly number[]).indexOf(
            visitDwellMinutes,
          )}
          tintColor={colors.accent}
          values={VISIT_DWELL_MINUTE_OPTIONS.map(String)}
        />
      </View>
      {segments.length ? (
        segments.map((segment, index) => {
          const isLast = index === segments.length - 1;
          if (segment.type === "visit") {
            const key = mobilitySegmentKey(segment);
            const label = segmentPlaceNames[key] || `停留地点 ${index + 1}`;
            const highlighted = highlightedSegmentKey === key;
            return (
              <Pressable
                accessibilityLabel={`查看到访地点 ${label}`}
                accessibilityRole="button"
                key={`${segment.startTime}-${index}`}
                onPress={() => onPressVisit(segment)}
                ref={(node) => {
                  registerRowRef(key, node);
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
                    {formatMobilitySegmentTimeRange(segment)} · 停留{" "}
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
                  {formatMobilitySegmentTimeRange(segment)} · {segment.durationMinutes}{" "}
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
  );
}

const styles = StyleSheet.create({
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
  pressed: {
    opacity: 0.68,
  },
});
