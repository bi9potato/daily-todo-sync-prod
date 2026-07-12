import {
  isReminderTimeUpcoming,
  reminderTimeAsDate,
} from "./task-reminder-time";

describe("reminderTimeAsDate", () => {
  test("parses HH:mm", () => {
    const date = reminderTimeAsDate("14:30");
    expect(date.getHours()).toBe(14);
    expect(date.getMinutes()).toBe(30);
    expect(date.getSeconds()).toBe(0);
  });

  test("falls back to 09:00 for non-numeric values", () => {
    const date = reminderTimeAsDate("abc");
    expect(date.getHours()).toBe(9);
    expect(date.getMinutes()).toBe(0);
  });

  test("treats an empty value as midnight (Number('') is 0)", () => {
    const date = reminderTimeAsDate("");
    expect(date.getHours()).toBe(0);
    expect(date.getMinutes()).toBe(0);
  });

  test("keeps a valid hour when only minutes are malformed", () => {
    const date = reminderTimeAsDate("14:xx");
    expect(date.getHours()).toBe(14);
    expect(date.getMinutes()).toBe(0);
  });
});

describe("isReminderTimeUpcoming", () => {
  const now = new Date("2026-07-12T10:00:00").getTime();

  test("accepts a later time on the same day", () => {
    expect(isReminderTimeUpcoming("2026-07-12", "10:01", now)).toBe(true);
  });

  test("rejects a time that already passed", () => {
    expect(isReminderTimeUpcoming("2026-07-12", "09:59", now)).toBe(false);
    expect(isReminderTimeUpcoming("2026-07-12", "10:00", now)).toBe(false);
  });

  test("accepts future dates and rejects past dates", () => {
    expect(isReminderTimeUpcoming("2026-07-13", "00:01", now)).toBe(true);
    expect(isReminderTimeUpcoming("2026-07-11", "23:59", now)).toBe(false);
  });

  test("rejects malformed dates", () => {
    expect(isReminderTimeUpcoming("not-a-date", "10:30", now)).toBe(false);
  });

  test("tolerates seconds in the stored time", () => {
    expect(isReminderTimeUpcoming("2026-07-12", "10:30:00", now)).toBe(true);
  });
});
