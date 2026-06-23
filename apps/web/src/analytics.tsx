import { useMemo } from "react";

import type { DayTodos, TodoOccurrence } from "./api";
import { addDays, formatShortDate, fromDateKey } from "./date";

type DailyAnalytics = {
  carryover: number;
  completionRate: number;
  date: string;
  done: number;
  pending: number;
  recurring: number;
  reminders: number;
  total: number;
};

type TodayAnalyticsSnapshot = DailyAnalytics & {
  allItems: TodoOccurrence[];
  carryoverRate: number;
  doneItems: TodoOccurrence[];
  focusScore: number;
  insights: string[];
  pendingItems: TodoOccurrence[];
  recurringRate: number;
  reminderCoverage: number;
};

type WeekdayAnalytics = {
  completionRate: number;
  done: number;
  label: string;
  total: number;
};

type AnalyticsSnapshot = {
  activeDays: number;
  bestDay: DailyAnalytics | null;
  carryoverRate: number;
  completionRate: number;
  completionStreak: number;
  dailyStats: DailyAnalytics[];
  done: number;
  insights: string[];
  pending: number;
  recurringRate: number;
  reminderCoverage: number;
  total: number;
  weekdayStats: WeekdayAnalytics[];
};

const WEEKDAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function emptyDay(date: string): DayTodos {
  return { date, pending: [], done: [] };
}

function orderedDayItems(day: DayTodos) {
  return [...day.pending, ...day.done].sort(compareOccurrences);
}

function compareOccurrences(left: TodoOccurrence, right: TodoOccurrence) {
  if (left.isPinned !== right.isPinned) {
    return left.isPinned ? -1 : 1;
  }
  if (left.sortOrder !== right.sortOrder) {
    return left.sortOrder - right.sortOrder;
  }
  return left.createdAt.localeCompare(right.createdAt);
}


export function AnalyticsDashboard({
  days,
  today,
}: {
  days: DayTodos[];
  today: string;
}) {
  const snapshot = useMemo(
    () => buildTodayAnalyticsSnapshot(days, today),
    [days, today],
  );

  return (
    <section className="analytics-dashboard today-analytics">
      <div className="analytics-hero surface-panel">
        <div>
          <p className="eyebrow">今日复盘</p>
          <h2>{snapshot.total > 0 ? "今天的推进已经整理好了" : "今天还没有任务记录"}</h2>
          <p className="muted">
            {today} · 完成 {snapshot.done} 项，待处理 {snapshot.pending} 项。
          </p>
        </div>
        <div className="completion-ring-wrap">
          <div
            className="completion-ring"
            style={{
              background: `conic-gradient(var(--accent) ${snapshot.completionRate}%, rgba(213, 221, 211, 0.72) 0)`,
            }}
          >
            <span>{snapshot.completionRate}%</span>
          </div>
          <small>今日完成率</small>
        </div>
      </div>

      <div className="metric-grid">
        <MetricCard label="今日任务" value={String(snapshot.total)} detail="全部待办" />
        <MetricCard label="已完成" value={String(snapshot.done)} detail="今天做完的事" />
        <MetricCard label="未完成" value={String(snapshot.pending)} detail="还留在今天" />
        <MetricCard label="专注分" value={`${snapshot.focusScore}`} detail="完成率与压力综合" />
      </div>

      <div className="analytics-grid today-analytics-grid">
        <section className="analytics-panel surface-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">结构</p>
              <h2>今天任务构成</h2>
            </div>
          </div>
          <div className="today-donut-row">
            <div
              className="today-donut"
              style={{
                background: `conic-gradient(var(--accent) 0 ${snapshot.completionRate}%, rgba(216, 206, 181, 0.95) ${snapshot.completionRate}% 100%)`,
              }}
            >
              <span>{snapshot.done}/{snapshot.total}</span>
            </div>
            <div className="today-legend">
              <span><i className="legend-done" />已完成 {snapshot.done}</span>
              <span><i className="legend-pending" />未完成 {snapshot.pending}</span>
              <span><i className="legend-muted" />结转 {snapshot.carryover}</span>
            </div>
          </div>
        </section>

        <section className="analytics-panel surface-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">质量</p>
              <h2>今天的任务状态</h2>
            </div>
          </div>
          <div className="quality-list">
            <QualityMeter label="提醒覆盖" value={snapshot.reminderCoverage} />
            <QualityMeter label="结转压力" value={snapshot.carryoverRate} inverse />
            <QualityMeter label="重复任务" value={snapshot.recurringRate} />
          </div>
        </section>

        <section className="analytics-panel surface-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">已完成</p>
              <h2>今天干了啥</h2>
            </div>
            <span>{snapshot.doneItems.length} 项</span>
          </div>
          <TaskSummaryList
            emptyText="今天还没有完成项。"
            items={snapshot.doneItems}
          />
        </section>

        <section className="analytics-panel surface-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">未完成</p>
              <h2>今天还剩什么</h2>
            </div>
            <span>{snapshot.pendingItems.length} 项</span>
          </div>
          <TaskSummaryList
            emptyText="今天没有遗留任务，节奏很干净。"
            items={snapshot.pendingItems}
          />
        </section>

        <section className="analytics-panel surface-panel today-insights-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">总结</p>
              <h2>今天的下一步</h2>
            </div>
          </div>
          <ul className="insight-list">
            {snapshot.insights.map((insight) => (
              <li key={insight}>{insight}</li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
}

function TaskSummaryList({
  emptyText,
  items,
}: {
  emptyText: string;
  items: TodoOccurrence[];
}) {
  if (items.length === 0) {
    return <p className="task-summary-empty">{emptyText}</p>;
  }

  return (
    <ul className="task-summary-list">
      {items.slice(0, 8).map((item) => (
        <li key={item.id}>
          <span>{item.text}</span>
          {item.reminderTime ? <time>{item.reminderTime}</time> : null}
        </li>
      ))}
      {items.length > 8 ? <li className="task-summary-more">还有 {items.length - 8} 项</li> : null}
    </ul>
  );
}

function LegacyAnalyticsDashboard({
  days,
  range,
  today,
}: {
  days: DayTodos[];
  range: { start: string; end: string };
  today: string;
}) {
  const snapshot = useMemo(
    () => buildAnalyticsSnapshot(days, today),
    [days, today],
  );

  return (
    <section className="analytics-dashboard">
      <div className="analytics-hero surface-panel">
        <div>
          <p className="eyebrow">节奏概览</p>
          <h2>把每天的任务流动看清楚</h2>
          <p className="muted">
            {range.start} - {range.end}，共 {snapshot.activeDays} 个有任务的日子。
          </p>
        </div>
        <div className="completion-ring-wrap">
          <div
            className="completion-ring"
            style={{
              background: `conic-gradient(var(--accent) ${snapshot.completionRate}%, rgba(213, 221, 211, 0.72) 0)`,
            }}
          >
            <span>{snapshot.completionRate}%</span>
          </div>
          <small>完成率</small>
        </div>
      </div>

      <div className="metric-grid">
        <MetricCard label="总任务" value={String(snapshot.total)} detail="近 30 天" />
        <MetricCard label="已完成" value={String(snapshot.done)} detail="保持推进" />
        <MetricCard label="待处理" value={String(snapshot.pending)} detail="当前压力" />
        <MetricCard
          label="连续完成"
          value={`${snapshot.completionStreak} 天`}
          detail="有任务且全完成"
        />
      </div>

      <div className="analytics-grid">
        <section className="analytics-panel surface-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">趋势</p>
              <h2>完成节奏</h2>
            </div>
            <span>{snapshot.dailyStats.length} 天</span>
          </div>
          <div className="trend-bars" aria-label="近 30 天完成趋势">
            {snapshot.dailyStats.map((day) => (
              <span
                className={day.date === today ? "is-today" : ""}
                key={day.date}
                style={{
                  height: `${Math.max(8, day.completionRate)}%`,
                }}
                title={`${day.date}: ${day.done}/${day.total}`}
              />
            ))}
          </div>
          <div className="trend-footer">
            <span>{formatShortDate(range.start)}</span>
            <span>{formatShortDate(range.end)}</span>
          </div>
        </section>

        <section className="analytics-panel surface-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">结构</p>
              <h2>任务质量</h2>
            </div>
          </div>
          <div className="quality-list">
            <QualityMeter label="提醒覆盖" value={snapshot.reminderCoverage} />
            <QualityMeter label="结转压力" value={snapshot.carryoverRate} inverse />
            <QualityMeter label="重复任务" value={snapshot.recurringRate} />
          </div>
        </section>

        <section className="analytics-panel surface-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">周内节奏</p>
              <h2>哪天最稳</h2>
            </div>
          </div>
          <div className="weekday-list">
            {snapshot.weekdayStats.map((day) => (
              <div className="weekday-row" key={day.label}>
                <span>{day.label}</span>
                <div className="weekday-track">
                  <i style={{ width: `${day.completionRate}%` }} />
                </div>
                <strong>{day.done}/{day.total}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="analytics-panel surface-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">洞察</p>
              <h2>下一步建议</h2>
            </div>
          </div>
          <ul className="insight-list">
            {snapshot.insights.map((insight) => (
              <li key={insight}>{insight}</li>
            ))}
          </ul>
        </section>
      </div>

      <section className="calendar-sync-panel surface-panel">
        <div>
          <p className="eyebrow">Google Calendar</p>
          <h2>同步策略：Todo 单向写入日历</h2>
          <p className="muted">
            暂不做双向同步。任务创建和更新后只推送到 Google Calendar，
            Google Calendar 里的改动不会反向修改 Todo。
          </p>
        </div>
        <div className="sync-flow" aria-label="单向同步流程">
          <span>Todo</span>
          <i />
          <span>Google Calendar</span>
        </div>
      </section>
    </section>
  );
}

function MetricCard({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <section className="metric-card surface-panel">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </section>
  );
}

function QualityMeter({
  inverse = false,
  label,
  value,
}: {
  inverse?: boolean;
  label: string;
  value: number;
}) {
  const score = inverse ? 100 - value : value;
  return (
    <div className="quality-meter">
      <div>
        <span>{label}</span>
        <strong>{value}%</strong>
      </div>
      <div className="meter-track">
        <i
          className={score >= 65 ? "is-strong" : score >= 35 ? "is-medium" : ""}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
    </div>
  );
}


function buildTodayAnalyticsSnapshot(
  days: DayTodos[],
  today: string,
): TodayAnalyticsSnapshot {
  const day = days.find((item) => item.date === today) ?? emptyDay(today);
  const allItems = orderedDayItems(day);
  const doneItems = allItems.filter((item) => item.status === "done");
  const pendingItems = allItems.filter((item) => item.status !== "done");
  const carryover = allItems.filter((item) => item.source === "carryover").length;
  const recurring = allItems.filter((item) => item.isRecurring).length;
  const reminders = allItems.filter((item) => Boolean(item.reminderTime)).length;
  const completionRate = percentage(doneItems.length, allItems.length);
  const carryoverRate = percentage(carryover, allItems.length);
  const reminderCoverage = percentage(reminders, allItems.length);
  const recurringRate = percentage(recurring, allItems.length);
  const focusScore =
    allItems.length === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            100,
            Math.round(completionRate + reminderCoverage * 0.15 - carryoverRate * 0.2),
          ),
        );

  const snapshot: TodayAnalyticsSnapshot = {
    allItems,
    carryover,
    carryoverRate,
    completionRate,
    date: today,
    done: doneItems.length,
    doneItems,
    focusScore,
    insights: [],
    pending: pendingItems.length,
    pendingItems,
    recurring,
    recurringRate,
    reminderCoverage,
    reminders,
    total: allItems.length,
  };

  return {
    ...snapshot,
    insights: buildTodayAnalyticsInsights(snapshot),
  };
}

function buildTodayAnalyticsInsights(snapshot: TodayAnalyticsSnapshot) {
  if (snapshot.total === 0) {
    return ["今天还没有任务记录。可以先加一个最关键的小任务，让分析页开始形成当天画像。"];
  }

  const insights: string[] = [];

  if (snapshot.done > 0) {
    insights.push(`今天已经完成 ${snapshot.done} 项，主要进展已经沉淀在完成列表里。`);
  }

  if (snapshot.pending > 0) {
    insights.push(`还有 ${snapshot.pending} 项未完成，建议先挑最小的一项收尾，避免继续结转。`);
  } else {
    insights.push("今天没有遗留任务，当前节奏很干净。");
  }

  if (snapshot.carryover > 0) {
    insights.push(`今天有 ${snapshot.carryover} 项来自结转，适合检查任务是不是需要拆小。`);
  }

  if (snapshot.reminders === 0 && snapshot.pending > 0) {
    insights.push("未完成任务还没有提醒时间，重要事项可以补一个提醒，减少靠记忆维护。");
  }

  if (snapshot.recurring > 0) {
    insights.push(`今天有 ${snapshot.recurring} 项重复任务，适合后续优先同步到 Google Calendar。`);
  }

  return insights.slice(0, 4);
}

function buildAnalyticsSnapshot(days: DayTodos[], today: string): AnalyticsSnapshot {
  const dailyStats = [...days]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((day) => {
      const items = orderedDayItems(day);
      const done = items.filter((item) => item.status === "done").length;
      const pending = items.length - done;
      const carryover = items.filter((item) => item.source === "carryover").length;
      const recurring = items.filter((item) => item.isRecurring).length;
      const reminders = items.filter((item) => Boolean(item.reminderTime)).length;
      return {
        carryover,
        completionRate: percentage(done, items.length),
        date: day.date,
        done,
        pending,
        recurring,
        reminders,
        total: items.length,
      };
    });

  const total = dailyStats.reduce((sum, day) => sum + day.total, 0);
  const done = dailyStats.reduce((sum, day) => sum + day.done, 0);
  const pending = dailyStats.reduce((sum, day) => sum + day.pending, 0);
  const carryover = dailyStats.reduce((sum, day) => sum + day.carryover, 0);
  const recurring = dailyStats.reduce((sum, day) => sum + day.recurring, 0);
  const reminders = dailyStats.reduce((sum, day) => sum + day.reminders, 0);
  const activeDays = dailyStats.filter((day) => day.total > 0).length;
  const completionRate = percentage(done, total);
  const carryoverRate = percentage(carryover, total);
  const reminderCoverage = percentage(reminders, total);
  const recurringRate = percentage(recurring, total);
  const bestDay =
    dailyStats
      .filter((day) => day.total > 0)
      .sort((left, right) => {
        if (right.completionRate !== left.completionRate) {
          return right.completionRate - left.completionRate;
        }
        return right.done - left.done;
      })[0] ?? null;
  const weekdayStats = buildWeekdayStats(dailyStats);

  const snapshot = {
    activeDays,
    bestDay,
    carryoverRate,
    completionRate,
    completionStreak: completionStreak(dailyStats, today),
    dailyStats,
    done,
    insights: [],
    pending,
    recurringRate,
    reminderCoverage,
    total,
    weekdayStats,
  };

  return {
    ...snapshot,
    insights: buildAnalyticsInsights(snapshot),
  };
}

function buildWeekdayStats(dailyStats: DailyAnalytics[]): WeekdayAnalytics[] {
  return WEEKDAY_NAMES.map((label, index) => {
    const matchedDays = dailyStats.filter(
      (day) => (fromDateKey(day.date).getDay() + 6) % 7 === index,
    );
    const total = matchedDays.reduce((sum, day) => sum + day.total, 0);
    const done = matchedDays.reduce((sum, day) => sum + day.done, 0);
    return {
      completionRate: percentage(done, total),
      done,
      label,
      total,
    };
  });
}

function completionStreak(dailyStats: DailyAnalytics[], today: string) {
  let streak = 0;
  for (const day of [...dailyStats].reverse()) {
    if (day.date > today || day.total === 0) {
      continue;
    }
    if (day.pending > 0) {
      break;
    }
    streak += 1;
  }
  return streak;
}

function buildAnalyticsInsights(
  snapshot: Omit<AnalyticsSnapshot, "insights">,
) {
  if (snapshot.total === 0) {
    return ["先记录几个任务，分析页会自动形成你的节奏画像。"];
  }

  const insights: string[] = [];
  if (snapshot.completionRate >= 80) {
    insights.push("完成率很稳，可以开始把重复任务和提醒做得更精细。");
  } else if (snapshot.completionRate >= 50) {
    insights.push("整体推进正常，建议每天只保留少量真正关键的待处理项。");
  } else {
    insights.push("待处理压力偏高，适合先清理低价值任务，再安排新的任务。");
  }

  if (snapshot.carryoverRate >= 35) {
    insights.push("结转任务占比偏高，说明部分任务需要拆小或重新定义完成标准。");
  }

  if (snapshot.reminderCoverage <= 20 && snapshot.pending >= 5) {
    insights.push("提醒覆盖较低，重要任务可以加提醒，降低靠记忆维护的成本。");
  }

  if (snapshot.recurringRate > 0) {
    insights.push("已有重复任务结构，后续接 Google Calendar 时适合优先同步这类任务。");
  }

  if (snapshot.bestDay) {
    insights.push(
      `${formatShortDate(snapshot.bestDay.date)} 是近期表现最好的日期，可参考那天的任务密度。`,
    );
  }

  return insights.slice(0, 4);
}

function percentage(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}
