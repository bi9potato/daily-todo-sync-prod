export function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(dateKey: string, amount: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  date.setDate(date.getDate() + amount);
  return toDateKey(date);
}

export function fromDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function startOfWeek(dateKey: string) {
  const date = fromDateKey(dateKey);
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  return toDateKey(date);
}

export function endOfWeek(dateKey: string) {
  return addDays(startOfWeek(dateKey), 6);
}

export function startOfMonth(dateKey: string) {
  const date = fromDateKey(dateKey);
  return toDateKey(new Date(date.getFullYear(), date.getMonth(), 1, 12));
}

export function endOfMonth(dateKey: string) {
  const date = fromDateKey(dateKey);
  return toDateKey(new Date(date.getFullYear(), date.getMonth() + 1, 0, 12));
}

export function datesBetween(start: string, end: string) {
  const dates: string[] = [];
  let current = start;
  while (current <= end) {
    dates.push(current);
    current = addDays(current, 1);
  }
  return dates;
}

export function formatShortDate(dateKey: string) {
  const date = fromDateKey(dateKey);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function weekdayLabel(dateKey: string) {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][fromDateKey(dateKey).getDay()];
}
