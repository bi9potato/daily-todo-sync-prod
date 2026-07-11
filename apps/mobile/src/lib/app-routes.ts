import type { Href } from "expo-router";

// The lateral sections reachable from the app drawer. Declared here (rather
// than in the drawer component) so route helpers and the app shell can depend
// on the union without importing a UI module.
export type AppSection =
  | "today"
  | "long-term"
  | "low-priority"
  | "analytics"
  | "calendar"
  | "mobility"
  | "device-timeline"
  | "expenses"
  | "timeline"
  | "services"
  | "sleep"
  | "passwords"
  | "ai"
  | "profile";

// Route paths for the "(app)" group - group folders are stripped from the
// URL by expo-router, so these are the bare paths (not "/(app)/today").
const SECTION_ROUTES: Record<AppSection, Href> = {
  today: "/today",
  "long-term": "/long-term",
  "low-priority": "/low-priority",
  analytics: "/analytics",
  calendar: "/calendar",
  mobility: "/mobility",
  "device-timeline": "/device-timeline",
  expenses: "/expenses",
  timeline: "/timeline" as Href,
  services: "/services" as Href,
  sleep: "/sleep",
  passwords: "/passwords",
  ai: "/ai",
  profile: "/profile",
};

const PATH_TO_SECTION = Object.fromEntries(
  (Object.entries(SECTION_ROUTES) as [AppSection, Href][]).map(
    ([section, href]) => [href, section],
  ),
) as Record<string, AppSection>;

export function routeForSection(section: AppSection): Href {
  return SECTION_ROUTES[section];
}

export function sectionForPath(pathname: string): AppSection {
  return PATH_TO_SECTION[pathname] ?? "today";
}
