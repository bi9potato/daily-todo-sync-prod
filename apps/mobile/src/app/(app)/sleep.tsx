import { ScreenEnter } from "@/components/ScreenEnter";
import { SleepScreen } from "@/screens/SleepScreen";

export default function SleepRoute() {
  return (
    <ScreenEnter style={{ flex: 1 }}>
      <SleepScreen />
    </ScreenEnter>
  );
}
