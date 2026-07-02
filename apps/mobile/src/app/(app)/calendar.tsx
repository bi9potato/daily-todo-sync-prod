import { ScreenEnter } from "@/components/ScreenEnter";
import { useAppShell } from "@/lib/app-shell";
import { CalendarScreen } from "@/screens/CalendarScreen";

export default function CalendarRoute() {
  const { calendarView, openDate, selectedDate, setSelectedDate, today } =
    useAppShell();
  return (
    <ScreenEnter style={{ flex: 1 }}>
      <CalendarScreen
        mode={calendarView}
        onOpenDate={openDate}
        onSelectDate={setSelectedDate}
        selectedDate={selectedDate}
        today={today}
      />
    </ScreenEnter>
  );
}
