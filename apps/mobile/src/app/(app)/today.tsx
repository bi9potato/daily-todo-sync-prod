import { ScreenEnter } from "@/components/ScreenEnter";
import { useAppShell } from "@/lib/app-shell";
import { TodayScreen } from "@/screens/TodayScreen";
import { useLocalSearchParams } from "expo-router";

export default function TodayRoute() {
  const { selectedDate } = useAppShell();
  const { compose, voice } = useLocalSearchParams<{
    compose?: string;
    voice?: string;
  }>();
  return (
    <ScreenEnter style={{ flex: 1 }}>
      <TodayScreen
        autoFocusComposer={compose === "1"}
        autoOpenVoice={voice === "1"}
        selectedDate={selectedDate}
      />
    </ScreenEnter>
  );
}
