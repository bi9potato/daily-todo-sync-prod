import { ScreenEnter } from "@/components/ScreenEnter";
import { useAppShell } from "@/lib/app-shell";
import { ExpenseTrackingScreen } from "@/screens/ExpenseTrackingScreen";

export default function ExpensesRoute() {
  const { today } = useAppShell();
  return (
    <ScreenEnter style={{ flex: 1 }}>
      <ExpenseTrackingScreen today={today} />
    </ScreenEnter>
  );
}
