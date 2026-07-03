import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { AppState } from "react-native";

import { getMe } from "@/lib/api";
import { routeForSection, type AppSection } from "@/lib/app-routes";
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
  const [today, setToday] = useState(() => toDateKey(new Date()));
  const [selectedDateOverride, setSelectedDateOverride] = useState<string | null>(
    null,
  );
  const selectedDate = selectedDateOverride ?? today;
  const [calendarView, setCalendarView] = useState<CalendarViewMode>("week");
  const mobilityRuntime = useMobilityRuntime(today);
  const meQuery = useQuery({ queryKey: ["me"], queryFn: getMe });
  const displayName =
    meQuery.data?.displayName || meQuery.data?.username || "Daily Todo";

  useEffect(() => {
    let midnightTimer: ReturnType<typeof setTimeout> | null = null;

    const refreshToday = () => {
      const nextToday = toDateKey(new Date());
      setToday((current) => (current === nextToday ? current : nextToday));
    };

    const scheduleMidnightRefresh = () => {
      if (midnightTimer) {
        clearTimeout(midnightTimer);
      }
      const now = new Date();
      const nextMidnight = new Date(now);
      nextMidnight.setHours(24, 0, 0, 0);
      midnightTimer = setTimeout(() => {
        refreshToday();
        scheduleMidnightRefresh();
      }, Math.max(1_000, nextMidnight.getTime() - now.getTime() + 1_000));
    };

    refreshToday();
    scheduleMidnightRefresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        refreshToday();
        scheduleMidnightRefresh();
      } else if (midnightTimer) {
        clearTimeout(midnightTimer);
        midnightTimer = null;
      }
    });

    return () => {
      if (midnightTimer) {
        clearTimeout(midnightTimer);
      }
      subscription.remove();
    };
  }, []);

  const setSelectedDate = useCallback(
    (date: string) => {
      setSelectedDateOverride(date === today ? null : date);
    },
    [today],
  );

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
    [navigateToSection, setSelectedDate],
  );

  const value = useMemo<AppShellContextValue>(
    () => ({
      today,
      selectedDate,
      setSelectedDate,
      calendarView,
      setCalendarView,
      displayName,
      mobilityRuntime,
      navigateToSection,
      openDate,
    }),
    [
      today,
      selectedDate,
      calendarView,
      displayName,
      mobilityRuntime,
      navigateToSection,
      openDate,
      setSelectedDate,
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
