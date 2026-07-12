import type { RepeatKind } from "@/types";

export const repeatOptions: { value: RepeatKind; label: string }[] = [
  { value: "none", label: "不重复" },
  { value: "daily", label: "每天" },
  { value: "weekdays", label: "工作日" },
  { value: "weekly", label: "每周" },
  { value: "monthly", label: "每月" },
  { value: "yearly", label: "每年" },
];

export const repeatUnitOptions: {
  value: Exclude<RepeatKind, "none" | "weekdays">;
  label: string;
}[] = [
  { value: "daily", label: "天" },
  { value: "weekly", label: "周" },
  { value: "monthly", label: "月" },
  { value: "yearly", label: "年" },
];

// Label for the repeat quick action in the task editor. Long-term tasks are
// forced onto a daily cadence; "重复" doubles as the untouched placeholder.
export function repeatSummaryLabel(
  isLongTerm: boolean,
  repeatKind: RepeatKind,
  repeatInterval: string,
): string {
  if (isLongTerm) {
    return "每天";
  }
  if (repeatKind === "none") {
    return "重复";
  }
  if (Number.parseInt(repeatInterval, 10) > 1 && repeatKind !== "weekdays") {
    const unit =
      repeatUnitOptions.find((option) => option.value === repeatKind)?.label ??
      "";
    return `每 ${repeatInterval} ${unit}`;
  }
  return (
    repeatOptions.find((option) => option.value === repeatKind)?.label ?? "重复"
  );
}

// The interval a payload should persist: at least 1, defaulting when the
// text field holds something unparsable.
export function normalizedRepeatInterval(repeatInterval: string): number {
  return Math.max(1, Number.parseInt(repeatInterval, 10) || 1);
}
