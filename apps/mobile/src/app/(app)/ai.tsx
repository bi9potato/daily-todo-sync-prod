import { useAppShell } from "@/lib/app-shell";
import { AiScreen } from "@/screens/AiScreen";

export default function AiRoute() {
  const { selectedDate } = useAppShell();
  return <AiScreen selectedDate={selectedDate} />;
}
