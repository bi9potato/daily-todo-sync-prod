import { ScreenEnter } from "@/components/ScreenEnter";
import { useAppShell } from "@/lib/app-shell";
import { TodayScreen } from "@/screens/TodayScreen";

export default function LongTermRoute() {
  const { today } = useAppShell();
  return (
    <ScreenEnter style={{ flex: 1 }}>
      <TodayScreen selectedDate={today} viewMode="long-term" />
    </ScreenEnter>
  );
}
