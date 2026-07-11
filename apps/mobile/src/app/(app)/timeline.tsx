import { ScreenEnter } from "@/components/ScreenEnter";
import { useAppShell } from "@/lib/app-shell";
import { PersonalTimelineScreen } from "@/screens/PersonalTimelineScreen";

export default function TimelineRoute() {
  const { today } = useAppShell();
  return <ScreenEnter style={{ flex: 1 }}><PersonalTimelineScreen today={today} /></ScreenEnter>;
}
