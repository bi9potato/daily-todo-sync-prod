const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const SHORT_WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function fromDateKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(key: string, amount: number) {
  const date = fromDateKey(key);
  date.setDate(date.getDate() + amount);
  return toDateKey(date);
}

export function datesBetween(start: string, end: string) {
  const dates: string[] = [];
  for (let current = start; current <= end; current = addDays(current, 1)) {
    dates.push(current);
  }
  return dates;
}

export function formatLongDate(key: string) {
  const date = fromDateKey(key);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]}`;
}

export function formatMonthDay(key: string) {
  const date = fromDateKey(key);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function shortWeekday(key: string) {
  return SHORT_WEEKDAYS[fromDateKey(key).getDay()];
}

export function getCenteredDates(center: string, radius = 2) {
  return Array.from({ length: radius * 2 + 1 }, (_, index) =>
    addDays(center, index - radius),
  );
}

export function getWeekRange(center: string) {
  const date = fromDateKey(center);
  const mondayOffset = date.getDay() === 0 ? -6 : 1 - date.getDay();
  const start = addDays(center, mondayOffset);
  return { start, end: addDays(start, 6) };
}
