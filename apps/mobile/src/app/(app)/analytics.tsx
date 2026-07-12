import { Platform } from "react-native";
import { Redirect } from "expo-router";

import { ScreenEnter } from "@/components/ScreenEnter";
import { useAppShell } from "@/lib/app-shell";
import { sectionEnabledOnPlatform } from "@/lib/platform-sections";
import { AnalyticsScreen } from "@/screens/AnalyticsScreen";

export default function AnalyticsRoute() {
  const { today } = useAppShell();
  if (!sectionEnabledOnPlatform("analytics", Platform.OS)) {
    return <Redirect href="/today" />;
  }
  return (
    <ScreenEnter style={{ flex: 1 }}>
      <AnalyticsScreen today={today} />
    </ScreenEnter>
  );
}
