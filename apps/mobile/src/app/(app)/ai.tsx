import { ScreenEnter } from "@/components/ScreenEnter";
import { useAppShell } from "@/lib/app-shell";
import { AiScreen } from "@/screens/AiScreen";

export default function AiRoute() {
  const { selectedDate } = useAppShell();
  return (
    <ScreenEnter style={{ flex: 1 }}>
      <AiScreen selectedDate={selectedDate} />
    </ScreenEnter>
  );
}
