import { ScreenEnter } from "@/components/ScreenEnter";
import { useAppShell } from "@/lib/app-shell";
import { MobilityScreen } from "@/screens/MobilityScreen";

export default function MobilityRoute() {
  const { mobilityRuntime, today } = useAppShell();
  return (
    <ScreenEnter style={{ flex: 1 }}>
      <MobilityScreen runtime={mobilityRuntime} today={today} />
    </ScreenEnter>
  );
}
