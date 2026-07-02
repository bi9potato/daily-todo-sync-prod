import { useAppShell } from "@/lib/app-shell";
import { AnalyticsScreen } from "@/screens/AnalyticsScreen";

export default function AnalyticsRoute() {
  const { today } = useAppShell();
  return <AnalyticsScreen today={today} />;
}
