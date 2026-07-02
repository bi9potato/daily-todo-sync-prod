import dayjs from "dayjs";
import "dayjs/locale/zh-cn";

// Date keys are local-calendar "YYYY-MM-DD" strings. dayjs parses them in
// local time (unlike `new Date("YYYY-MM-DD")`, which parses UTC), and the
// zh-cn locale provides Monday-first weeks plus the 周X / X weekday names
// used across the app.
const DATE_KEY = "YYYY-MM-DD";

function day(key: string) {
  return dayjs(key).locale("zh-cn");
}

export function toDateKey(date: Date) {
  return dayjs(date).format(DATE_KEY);
}

export function fromDateKey(key: string) {
  return day(key).toDate();
}

export function addDays(key: string, amount: number) {
  return day(key).add(amount, "day").format(DATE_KEY);
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

export function formatLongDate(key: string) {
  return day(key).format("M月D日 ddd");
}

export function formatMonthDay(key: string) {
  return day(key).format("M月D日");
}

export function shortWeekday(key: string) {
  return day(key).format("dd");
}

export function getCenteredDates(center: string, radius = 2) {
  return Array.from({ length: radius * 2 + 1 }, (_, index) =>
    addDays(center, index - radius),
  );
}

export function getWeekRange(center: string) {
  const start = day(center).startOf("week");
  return {
    start: start.format(DATE_KEY),
    end: start.add(6, "day").format(DATE_KEY),
  };
}

export function addMonths(key: string, amount: number) {
  return day(key).add(amount, "month").format(DATE_KEY);
}

export function getMonthRange(center: string) {
  const monthStart = day(center).startOf("month");
  const start = monthStart.startOf("week");
  return {
    start: start.format(DATE_KEY),
    end: start.add(41, "day").format(DATE_KEY),
    monthStart: monthStart.format(DATE_KEY),
    monthEnd: monthStart.endOf("month").format(DATE_KEY),
  };
}
