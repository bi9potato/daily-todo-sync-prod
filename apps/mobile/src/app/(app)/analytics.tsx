import { ScreenEnter } from "@/components/ScreenEnter";
import { useAppShell } from "@/lib/app-shell";
import { AnalyticsScreen } from "@/screens/AnalyticsScreen";

export default function AnalyticsRoute() {
  const { today } = useAppShell();
  return (
    <ScreenEnter style={{ flex: 1 }}>
      <AnalyticsScreen today={today} />
    </ScreenEnter>
  );
}
