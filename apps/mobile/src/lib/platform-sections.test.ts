import {
  ANDROID_HIDDEN_SECTIONS,
  sectionEnabledOnPlatform,
} from "./platform-sections";

test.each([...ANDROID_HIDDEN_SECTIONS])(
  "%s stays unreachable on Android",
  (section) => {
    expect(sectionEnabledOnPlatform(section, "android")).toBe(false);
  },
);

test.each([...ANDROID_HIDDEN_SECTIONS])(
  "%s remains available off Android",
  (section) => {
    expect(sectionEnabledOnPlatform(section, "ios")).toBe(true);
    expect(sectionEnabledOnPlatform(section, "web")).toBe(true);
  },
);

test.each([
  "today",
  "long-term",
  "low-priority",
  "mobility",
  "device-timeline",
  "expenses",
  "timeline",
  "services",
  "profile",
] as const)("%s stays available on Android", (section) => {
  expect(sectionEnabledOnPlatform(section, "android")).toBe(true);
});
