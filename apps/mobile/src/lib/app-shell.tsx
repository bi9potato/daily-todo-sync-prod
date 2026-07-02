import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import type { AppSection } from "@/components/AppDrawer";
import { getMe } from "@/lib/api";
import { routeForSection } from "@/lib/app-routes";
import { toDateKey } from "@/lib/date";
import { useMobilityRuntime } from "@/lib/useMobilityRuntime";
import type { CalendarViewMode } from "@/screens/CalendarScreen";

type AppShellContextValue = {
  today: string;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  calendarView: CalendarViewMode;
  setCalendarView: (view: CalendarViewMode) => void;
  displayName: string;
  mobilityRuntime: ReturnType<typeof useMobilityRuntime>;
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  navigateToSection: (section: AppSection) => void;
  openDate: (date: string) => void;
};

const AppShellContext = createContext<AppShellContextValue | null>(null);

// Owns everything that used to live in MainApp's useState calls and now
// needs to survive across route changes (a single long-lived
// useMobilityRuntime subscription in particular - it must not be
// re-created every time the user switches sections).
export function AppShellProvider({ children }: PropsWithChildren) {
  const router = useRouter();
  const [today] = useState(() => toDateKey(new Date()));
  const [selectedDate, setSelectedDate] = useState(today);
  const [calendarView, setCalendarView] = useState<CalendarViewMode>("week");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const mobilityRuntime = useMobilityRuntime(today);
  const meQuery = useQuery({ queryKey: ["me"], queryFn: getMe });
  const displayName =
    meQuery.data?.displayName || meQuery.data?.username || "Daily Todo";

  const navigateToSection = useCallback(
    (section: AppSection) => {
      // Sections are lateral siblings picked from a drawer, not a
      // drill-down flow, so replace rather than push: the Android back
      // button should exit the app from wherever the user currently is,
      // not unwind through every section ever visited.
      router.replace(routeForSection(section));
    },
    [router],
  );

  const openDate = useCallback(
    (date: string) => {
      setSelectedDate(date);
      navigateToSection("today");
    },
    [navigateToSection],
  );

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const value = useMemo<AppShellContextValue>(
    () => ({
      today,
      selectedDate,
      setSelectedDate,
      calendarView,
      setCalendarView,
      displayName,
      mobilityRuntime,
      drawerOpen,
      openDrawer,
      closeDrawer,
      navigateToSection,
      openDate,
    }),
    [
      today,
      selectedDate,
      calendarView,
      displayName,
      mobilityRuntime,
      drawerOpen,
      openDrawer,
      closeDrawer,
      navigateToSection,
      openDate,
    ],
  );

  return (
    <AppShellContext.Provider value={value}>
      {children}
    </AppShellContext.Provider>
  );
}

export function useAppShell() {
  const context = useContext(AppShellContext);
  if (!context) {
    throw new Error("useAppShell must be used within AppShellProvider");
  }
  return context;
}
