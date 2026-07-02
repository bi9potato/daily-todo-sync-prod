import dayjs from "dayjs";
import "dayjs/locale/zh-cn";

// Date keys are local-calendar "YYYY-MM-DD" strings. dayjs parses them in
// local time (unlike `new Date("YYYY-MM-DD")`, which parses UTC), and the
// zh-cn locale provides Monday-first weeks plus the 周X weekday names.
const DATE_KEY = "YYYY-MM-DD";

function day(dateKey: string) {
  return dayjs(dateKey).locale("zh-cn");
}

export function toDateKey(date: Date) {
  return dayjs(date).format(DATE_KEY);
}

export function addDays(dateKey: string, amount: number) {
  return day(dateKey).add(amount, "day").format(DATE_KEY);
}

export function fromDateKey(dateKey: string) {
  // Noon instead of midnight, matching the previous implementation, so a
  // DST shift can never move the resulting Date onto the neighbouring day.
  return day(dateKey).hour(12).toDate();
}

export function startOfWeek(dateKey: string) {
  return day(dateKey).startOf("week").format(DATE_KEY);
}

export function endOfWeek(dateKey: string) {
  return day(dateKey).endOf("week").format(DATE_KEY);
}

export function startOfMonth(dateKey: string) {
  return day(dateKey).startOf("month").format(DATE_KEY);
}

export function endOfMonth(dateKey: string) {
  return day(dateKey).endOf("month").format(DATE_KEY);
}

export function datesBetween(start: string, end: string) {
  const last = day(end);
  const dates: string[] = [];
  for (
    let current = day(start);
    !current.isAfter(last);
    current = current.add(1, "day")
  ) {
    dates.push(current.format(DATE_KEY));
  }
  return dates;
}

export function formatShortDate(dateKey: string) {
  return day(dateKey).format("M/D");
}

export function weekdayLabel(dateKey: string) {
  return day(dateKey).format("ddd");
}
