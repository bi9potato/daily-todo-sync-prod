import type { PropsWithChildren } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";

import { enterEasing, exitEasing, motionDurations } from "@/lib/motion";

// The one motion primitive used everywhere a "switch" happens that isn't
// already covered by native-stack's own transition (route swaps get both:
// see (app)/_layout.tsx's screenOptions.animation): local view-mode
// toggles (MobilityScreen's map/details, CalendarScreen's day/week/month)
// and modal sheet content. Entrance fades in with a short rise on the
// emphasized-decelerate curve (no spring overshoot); exit is a plain,
// quicker fade so outgoing content doesn't fight the incoming content's
// motion for attention.
const ENTERING = FadeInDown.duration(motionDurations.enter)
  .easing(enterEasing)
  .withInitialValues({ opacity: 0, transform: [{ translateY: 14 }] });
const EXITING = FadeOut.duration(motionDurations.exit).easing(exitEasing);

export function ScreenEnter({
  children,
  style,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return (
    <Animated.View entering={ENTERING} exiting={EXITING} style={style}>
      {children}
    </Animated.View>
  );
}
