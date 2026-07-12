import { Platform } from "react-native";
import { Redirect } from "expo-router";

import { ScreenEnter } from "@/components/ScreenEnter";
import { useAppShell } from "@/lib/app-shell";
import { sectionEnabledOnPlatform } from "@/lib/platform-sections";
import { AiScreen } from "@/screens/AiScreen";

export default function AiRoute() {
  const { selectedDate } = useAppShell();
  if (!sectionEnabledOnPlatform("ai", Platform.OS)) {
    return <Redirect href="/today" />;
  }
  return (
    <ScreenEnter style={{ flex: 1 }}>
      <AiScreen selectedDate={selectedDate} />
    </ScreenEnter>
  );
}
