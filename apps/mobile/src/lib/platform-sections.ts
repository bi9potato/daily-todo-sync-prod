import type { AppSection } from "./app-routes";

// Features with no Android product surface right now (audit roadmap 4.2:
// analytics, calendar, sleep, passwords, and AI stay web/iOS-only until
// usage data justifies bringing them back). Hiding them in the drawer is
// not enough on its own - restored navigation state, deep links, and
// notification taps can still open a registered route - so their route
// components also consult this list and redirect to "today" on Android.
export const ANDROID_HIDDEN_SECTIONS: readonly AppSection[] = [
  "analytics",
  "calendar",
  "sleep",
  "passwords",
  "ai",
];

export function sectionEnabledOnPlatform(
  section: AppSection,
  platform: string,
): boolean {
  return platform !== "android" || !ANDROID_HIDDEN_SECTIONS.includes(section);
}
