import { ScreenEnter } from "@/components/ScreenEnter";
import { useAppShell } from "@/lib/app-shell";
import { ExpenseTrackingScreen } from "@/screens/ExpenseTrackingScreen";
import { useLocalSearchParams } from "expo-router";

export default function ExpensesRoute() {
  const { today } = useAppShell();
  const { manual } = useLocalSearchParams<{ manual?: string }>();
  return (
    <ScreenEnter style={{ flex: 1 }}>
      <ExpenseTrackingScreen openManualOnMount={manual === "1"} today={today} />
    </ScreenEnter>
  );
}
