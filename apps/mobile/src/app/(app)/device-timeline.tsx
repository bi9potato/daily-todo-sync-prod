import { ScreenEnter } from "@/components/ScreenEnter";
import { useAppShell } from "@/lib/app-shell";
import { DeviceTimelineScreen } from "@/screens/DeviceTimelineScreen";

export default function DeviceTimelineRoute() {
  const { deviceTimeline, today } = useAppShell();
  return (
    <ScreenEnter style={{ flex: 1 }}>
      <DeviceTimelineScreen runtime={deviceTimeline} today={today} />
    </ScreenEnter>
  );
}
