import { useAppShell } from "@/lib/app-shell";
import { TodayScreen } from "@/screens/TodayScreen";

export default function LongTermRoute() {
  const { today } = useAppShell();
  return <TodayScreen selectedDate={today} viewMode="long-term" />;
}
