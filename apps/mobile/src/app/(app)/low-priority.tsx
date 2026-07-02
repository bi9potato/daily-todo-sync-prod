import { ScreenEnter } from "@/components/ScreenEnter";
import { useAppShell } from "@/lib/app-shell";
import { TodayScreen } from "@/screens/TodayScreen";

export default function LowPriorityRoute() {
  const { today } = useAppShell();
  return (
    <ScreenEnter style={{ flex: 1 }}>
      <TodayScreen selectedDate={today} viewMode="low-priority" />
    </ScreenEnter>
  );
}
