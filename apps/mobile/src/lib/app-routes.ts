import type { Href } from "expo-router";

import type { AppSection } from "@/components/AppDrawer";

// Route paths for the "(app)" group - group folders are stripped from the
// URL by expo-router, so these are the bare paths (not "/(app)/today").
const SECTION_ROUTES: Record<AppSection, Href> = {
  today: "/today",
  "long-term": "/long-term",
  "low-priority": "/low-priority",
  analytics: "/analytics",
  calendar: "/calendar",
  mobility: "/mobility",
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
