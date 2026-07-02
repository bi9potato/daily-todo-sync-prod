import type { PropsWithChildren } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";

// The one motion primitive used everywhere a "switch" happens that isn't
// already covered by native-stack's own transition (route swaps get both:
// see (app)/_layout.tsx's screenOptions.animation): local view-mode
// toggles (MobilityScreen's map/details, CalendarScreen's day/week/month)
// and modal sheet content. Entrance fades and rises slightly with a soft
// spring; exit is a plain, quicker fade so outgoing content doesn't fight
// the incoming content's motion for attention.
const ENTERING = FadeInDown.duration(240).springify().damping(18).mass(0.9);
const EXITING = FadeOut.duration(150);

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
