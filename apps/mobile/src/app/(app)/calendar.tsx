import { useAppShell } from "@/lib/app-shell";
import { CalendarScreen } from "@/screens/CalendarScreen";

export default function CalendarRoute() {
  const { calendarView, openDate, selectedDate, setSelectedDate, today } =
    useAppShell();
  return (
    <CalendarScreen
      mode={calendarView}
      onOpenDate={openDate}
      onSelectDate={setSelectedDate}
      selectedDate={selectedDate}
      today={today}
    />
  );
}
