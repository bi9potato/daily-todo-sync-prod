import { Easing } from "react-native-reanimated";

// Single source of truth for motion across the app, using the Material 3
// "emphasized" easing pair: entrances decelerate into place, exits
// accelerate away, and nothing overshoots - motion reads calm and precise
// instead of bouncy. Exits are deliberately shorter than entrances so
// outgoing content never competes with what replaces it.
export const enterEasing = Easing.bezier(0.05, 0.7, 0.1, 1);
export const exitEasing = Easing.bezier(0.3, 0, 0.8, 0.15);

export const motionDurations = {
  exit: 160,
  enter: 260,
  panelEnter: 320,
  panelExit: 200,
} as const;
