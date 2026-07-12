// Helpers for the "HH:mm" reminder-time strings tasks store.

// A Date for the time picker's initial position; falls back to 09:00 when
// the stored value is empty or malformed.
export function reminderTimeAsDate(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  const date = new Date();
  date.setHours(
    Number.isFinite(hours) ? hours : 9,
    Number.isFinite(minutes) ? minutes : 0,
    0,
    0,
  );
  return date;
}

// Whether taskDate + reminderTime still lies in the future. Android exact
// alarms scheduled in the past fire immediately, so saving one would ring
// the moment the editor closes.
export function isReminderTimeUpcoming(
  taskDate: string,
  reminderTime: string,
  now: number = Date.now(),
): boolean {
  const reminderDate = new Date(`${taskDate}T${reminderTime.slice(0, 5)}:00`);
  return !Number.isNaN(reminderDate.getTime()) && reminderDate.getTime() > now;
}
