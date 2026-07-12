import {
  normalizedRepeatInterval,
  repeatSummaryLabel,
} from "./task-repeat";

describe("repeatSummaryLabel", () => {
  test("long-term tasks always read as daily", () => {
    expect(repeatSummaryLabel(true, "none", "1")).toBe("每天");
    expect(repeatSummaryLabel(true, "weekly", "3")).toBe("每天");
  });

  test("no repeat shows the placeholder", () => {
    expect(repeatSummaryLabel(false, "none", "1")).toBe("重复");
  });

  test.each([
    ["daily", "每天"],
    ["weekdays", "工作日"],
    ["weekly", "每周"],
    ["monthly", "每月"],
    ["yearly", "每年"],
  ] as const)("interval 1 %s uses the preset label", (kind, label) => {
    expect(repeatSummaryLabel(false, kind, "1")).toBe(label);
  });

  test("custom intervals spell out the cadence", () => {
    expect(repeatSummaryLabel(false, "weekly", "2")).toBe("每 2 周");
    expect(repeatSummaryLabel(false, "monthly", "6")).toBe("每 6 月");
  });

  test("weekdays ignores the interval", () => {
    expect(repeatSummaryLabel(false, "weekdays", "4")).toBe("工作日");
  });
});

describe("normalizedRepeatInterval", () => {
  test.each([
    ["3", 3],
    ["1", 1],
    ["0", 1],
    ["", 1],
    ["abc", 1],
    ["12", 12],
  ])("normalizes %s to %i", (input, expected) => {
    expect(normalizedRepeatInterval(input)).toBe(expected);
  });
});
