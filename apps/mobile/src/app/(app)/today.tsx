import { useAppShell } from "@/lib/app-shell";
import { TodayScreen } from "@/screens/TodayScreen";

export default function TodayRoute() {
  const { selectedDate } = useAppShell();
  return <TodayScreen selectedDate={selectedDate} />;
}
