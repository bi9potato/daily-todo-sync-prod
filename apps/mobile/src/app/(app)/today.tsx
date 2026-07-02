import { ScreenEnter } from "@/components/ScreenEnter";
import { useAppShell } from "@/lib/app-shell";
import { TodayScreen } from "@/screens/TodayScreen";

export default function TodayRoute() {
  const { selectedDate } = useAppShell();
  return (
    <ScreenEnter style={{ flex: 1 }}>
      <TodayScreen selectedDate={selectedDate} />
    </ScreenEnter>
  );
}
