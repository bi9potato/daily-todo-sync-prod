import { useAppShell } from "@/lib/app-shell";
import { MobilityScreen } from "@/screens/MobilityScreen";

export default function MobilityRoute() {
  const { mobilityRuntime, today } = useAppShell();
  return <MobilityScreen runtime={mobilityRuntime} today={today} />;
}
