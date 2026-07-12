import { Platform } from "react-native";
import { Redirect } from "expo-router";

import { ScreenEnter } from "@/components/ScreenEnter";
import { useAppShell } from "@/lib/app-shell";
import { sectionEnabledOnPlatform } from "@/lib/platform-sections";
import { CalendarScreen } from "@/screens/CalendarScreen";

export default function CalendarRoute() {
  const { calendarView, openDate, selectedDate, setSelectedDate, today } =
    useAppShell();
  if (!sectionEnabledOnPlatform("calendar", Platform.OS)) {
    return <Redirect href="/today" />;
  }
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
