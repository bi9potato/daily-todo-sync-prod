import { useAppShell } from "@/lib/app-shell";
import { TodayScreen } from "@/screens/TodayScreen";

export default function LowPriorityRoute() {
  const { today } = useAppShell();
  return <TodayScreen selectedDate={today} viewMode="low-priority" />;
}
