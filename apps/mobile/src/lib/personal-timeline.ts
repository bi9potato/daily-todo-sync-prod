import type { ExpenseTransaction } from "./expense-tracking";
import type { DayTodos, DeviceTimelineItem, MobilitySegment } from "@/types";

export type PersonalTimelineSource = "task" | "location" | "device" | "expense";
export type PersonalTimelineEvent = {
  id: string;
  source: PersonalTimelineSource;
  timestamp: string;
  title: string;
  detail: string;
  synced: boolean;
};

export function buildPersonalTimeline({
  deviceItems,
  expenses,
  mobilitySegments,
  tasks,
}: {
  deviceItems: DeviceTimelineItem[];
  expenses: ExpenseTransaction[];
  mobilitySegments: MobilitySegment[];
  tasks: DayTodos | undefined;
}) {
  const events: PersonalTimelineEvent[] = [];
  for (const task of [...(tasks?.pending ?? []), ...(tasks?.done ?? [])]) {
    const timestamp = task.completedAt ?? task.updatedAt;
    events.push({
      id: `task:${task.id}:${timestamp}`,
      source: "task",
      timestamp,
      title: task.status === "done" ? "完成任务" : "更新任务",
      detail: task.text,
      synced: true,
    });
  }
  for (const [index, segment] of mobilitySegments.entries()) {
    const visit = segment.type === "visit";
    events.push({
      id: `location:${segment.startTime}:${index}`,
      source: "location",
      timestamp: segment.startTime,
      title: visit ? "停留地点" : modeLabel(segment.mode),
      detail: visit
        ? `停留 ${segment.durationMinutes} 分钟`
        : `${formatDistance(segment.distanceMeters ?? 0)} · ${segment.durationMinutes} 分钟`,
      synced: true,
    });
  }
  for (const [index, item] of deviceItems.entries()) {
    const timestamp = item.startTime ?? item.time ?? item.endTime;
    if (!timestamp) continue;
    events.push({
      id: `device:${timestamp}:${index}`,
      source: "device",
      timestamp,
      title: item.type === "app" ? item.appLabel || item.packageName || "应用使用" : deviceLabel(item.type),
      detail: item.type === "app" ? `${Math.max(0, Math.round(item.durationMinutes ?? 0))} 分钟` : "设备事件",
      synced: true,
    });
  }
  for (const item of expenses) {
    events.push({
      id: `expense:${item.id}`,
      source: "expense",
      timestamp: new Date(item.occurredAt).toISOString(),
      title: expenseLabel(item.moneyNature),
      detail: `${formatCny(item.amountMinor)}${item.merchant ? ` · ${item.merchant}` : ""}`,
      synced: false,
    });
  }
  return events.sort(
    (left, right) =>
      new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime(),
  );
}

function modeLabel(mode: MobilitySegment["mode"]) {
  return ({ WALKING: "步行", CYCLING: "骑行", IN_VEHICLE: "乘车", SUBWAY: "地铁", TRAIN: "火车", HIGH_SPEED_RAIL: "高铁", FLIGHT: "飞行" } as const)[mode ?? "WALKING"] ?? "移动";
}

function deviceLabel(type: DeviceTimelineItem["type"]) {
  return ({ screen_on: "点亮屏幕", screen_off: "熄灭屏幕", unlock: "解锁", shutdown: "关机", boot: "开机", app: "应用使用" } as const)[type];
}

function formatDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} 公里` : `${Math.round(meters)} 米`;
}

function formatCny(amountMinor: number) {
  return `¥${(amountMinor / 100).toFixed(2)}`;
}

function expenseLabel(nature: ExpenseTransaction["moneyNature"]) {
  return ({
    purchase_expense: "消费支出",
    earned_income: "实际收入",
    refund: "退款",
    internal_transfer: "本人互转",
    personal_transfer: "个人转账",
    credit_repayment: "信用还款",
    wallet_topup_withdrawal: "充值/提现",
    loan_principal: "借款本金",
    investment_principal: "投资本金",
    cash_withdrawal_deposit: "存取现金",
    fee_interest: "手续费/利息",
    reversal_failed: "失败/冲正",
    unknown_money_flow: "待判断资金流",
  } as const)[nature];
}
