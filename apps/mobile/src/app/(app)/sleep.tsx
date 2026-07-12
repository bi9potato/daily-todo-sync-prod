import { Platform } from "react-native";
import { Redirect } from "expo-router";

import { ScreenEnter } from "@/components/ScreenEnter";
import { sectionEnabledOnPlatform } from "@/lib/platform-sections";
import { SleepScreen } from "@/screens/SleepScreen";

export default function SleepRoute() {
  if (!sectionEnabledOnPlatform("sleep", Platform.OS)) {
    return <Redirect href="/today" />;
  }
  return (
    <ScreenEnter style={{ flex: 1 }}>
      <SleepScreen />
    </ScreenEnter>
  );
}
