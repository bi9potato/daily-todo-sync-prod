import { useEffect, useMemo, useState } from "react";

import { mobilitySegmentKey } from "@/lib/mobility-view-model";
import { reverseGeocode } from "@/lib/reverse-geocode";
import type { MobilitySegment } from "@/types";

// Visit/Trip segmentation now happens server-side (mobility/segmentation.py)
// so the Timeline UI, the map, and the Google Takeout export all agree on
// the same boundaries. The client's only remaining job is turning a visit's
// coordinate into a place name, the same on-device reverse geocode it did
// before this moved server-side.
export function useSegmentPlaceNames(segments: MobilitySegment[]) {
  const visits = useMemo(
    () => segments.filter((segment) => segment.type === "visit"),
    [segments],
  );
  const [resolvedNames, setResolvedNames] = useState<Record<string, string>>(
    {},
  );
  const unresolvedKeys = visits
    .filter((segment) => !resolvedNames[mobilitySegmentKey(segment)])
    .map(mobilitySegmentKey)
    .join("|");

  useEffect(() => {
    const unresolved = visits.filter(
      (segment) => !resolvedNames[mobilitySegmentKey(segment)],
    );
    if (!unresolved.length) {
      return;
    }
    let cancelled = false;
    void Promise.all(
      unresolved.map(async (segment, index) => {
        if (segment.latitude == null || segment.longitude == null) {
          return [mobilitySegmentKey(segment), `停留地点 ${index + 1}`] as const;
        }
        const label = await reverseGeocode(segment.latitude, segment.longitude);
        return [mobilitySegmentKey(segment), label || `停留地点 ${index + 1}`] as const;
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
