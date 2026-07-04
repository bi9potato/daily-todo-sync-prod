import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Location from "expo-location";

import { recordClientLog } from "./client-logs";

// A single live fix combining the foreground position stream and the compass
// heading stream. This is deliberately separate from the background footprint
// recording (mobility-native-service): that stream is coarse and de-jittered
// on purpose - it gates on 8m of displacement and a 5s interval so the saved
// route history stays clean - which is exactly why it feels laggy for a
// "where am I right now" dot. This hook instead mirrors how Google Maps drives
// its blue location puck: a high-frequency foreground position watcher plus the
// device compass, running only while the map screen is on screen.
export type LiveLocation = {
  longitude: number;
  latitude: number;
  // Horizontal accuracy radius in meters (null when the platform omits it).
  accuracy: number | null;
  // Direction the phone is pointing, degrees clockwise from true north
  // (0 = north, 90 = east). null while the compass has not produced a fix.
  heading: number | null;
  // expo's calibration level, 0 (uncalibrated) - 3 (high). Used to hide the
  // heading beam while the compass is still figuring itself out.
  headingAccuracy: number | null;
  // Ground speed in m/s when the platform reports it, else null.
  speed: number | null;
  updatedAt: number;
};

// expo streams the compass far faster than the map needs to redraw. Only push
// a new heading through React state when it turned at least this much, so a
// hand tremor does not trigger a beam re-render on every sensor tick.
const HEADING_MIN_DELTA_DEGREES = 2;

function normalizeHeading(value: number) {
  const wrapped = value % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function angularDistance(a: number, b: number) {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Subscribes to the foreground position and compass heading while `enabled`,
 * returning the latest combined fix. Nothing starts until the app already holds
 * foreground location permission (the caller is responsible for requesting it),
 * so this can be flipped on the moment the map screen mounts without surprising
 * a permission dialog. All subscriptions are torn down when `enabled` goes
 * false or the component unmounts, so the sensors never run in the background.
 */
export function useLiveLocation(enabled: boolean): LiveLocation | null {
  const [location, setLocation] = useState<LiveLocation | null>(null);
  // The two streams arrive independently; merge them against the last emitted
  // value so a heading tick keeps the most recent coordinate and vice versa.
  const latestRef = useRef<LiveLocation | null>(null);
  // Only run the foreground watchers while the app is actually in front. The
  // background footprint service already covers the backgrounded case, so
  // keeping the compass + GPS spinning here too would just drain battery for a
  // dot nobody can see.
  const [appActive, setAppActive] = useState(
    () => AppState.currentState === "active",
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setAppActive(state === "active");
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!enabled || !appActive) {
      return;
    }
    let cancelled = false;
    let positionSub: Location.LocationSubscription | null = null;
    let headingSub: Location.LocationSubscription | null = null;

    const publish = (next: LiveLocation) => {
      latestRef.current = next;
      if (!cancelled) {
        setLocation(next);
      }
    };

    const start = async () => {
      const { granted } = await Location.getForegroundPermissionsAsync();
      if (!granted || cancelled) {
        return;
      }
      try {
        positionSub = await Location.watchPositionAsync(
          {
            // High (~10m) rather than BestForNavigation keeps the compass and
            // GPS from pinning the CPU while walking; distanceInterval 0 means
            // the dot still refreshes on the timer even when standing still,
            // which is what makes it feel live instead of frozen.
            accuracy: Location.Accuracy.High,
            timeInterval: 1000,
            distanceInterval: 0,
          },
          (fix) => {
            const previous = latestRef.current;
            publish({
              longitude: fix.coords.longitude,
              latitude: fix.coords.latitude,
              accuracy: fix.coords.accuracy ?? null,
              heading: previous?.heading ?? null,
              headingAccuracy: previous?.headingAccuracy ?? null,
              speed: fix.coords.speed ?? null,
              updatedAt: fix.timestamp,
            });
          },
        );
      } catch (error) {
        recordClientLog("warn", "Live location watch failed", {
          source: "mobility",
          context: {
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
      if (cancelled) {
        return;
      }
      try {
        headingSub = await Location.watchHeadingAsync((reading) => {
          // trueHeading needs location permission (which we have) and is what
          // aligns with the north-up map; it is -1 until the OS has it, so fall
          // back to magnetic north in that window.
          const raw =
            reading.trueHeading >= 0 ? reading.trueHeading : reading.magHeading;
          if (raw == null || Number.isNaN(raw)) {
            return;
          }
          const heading = normalizeHeading(raw);
          const previous = latestRef.current;
          if (
            previous?.heading != null &&
            angularDistance(previous.heading, heading) < HEADING_MIN_DELTA_DEGREES &&
            previous.headingAccuracy === reading.accuracy
          ) {
            return;
          }
          if (!previous) {
            // A heading with no position yet has nothing to anchor the beam to;
            // wait for the first fix.
            return;
          }
          publish({
            ...previous,
            heading,
            headingAccuracy: reading.accuracy ?? null,
            updatedAt: Date.now(),
          });
        });
      } catch (error) {
        recordClientLog("warn", "Live heading watch failed", {
          source: "mobility",
          context: {
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    };

    void start();

    return () => {
      cancelled = true;
      positionSub?.remove();
      headingSub?.remove();
    };
  }, [enabled, appActive]);

  // Gate the returned value on `enabled` rather than resetting state in an
  // effect: turning the feature off should immediately stop showing a puck, but
  // the internal `location` is kept so re-enabling (or returning from the
  // background) can render the last fix instantly instead of flashing empty.
  return enabled ? location : null;
}
