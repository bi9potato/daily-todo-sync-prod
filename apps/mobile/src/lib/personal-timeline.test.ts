import { buildPersonalTimeline } from "./personal-timeline";

test("combines and sorts personal events without uploading local expenses", () => {
  const events = buildPersonalTimeline({
    tasks: {
      date: "2026-07-12",
      pending: [],
      done: [{
        id: "task-1", taskId: "task-1", rootId: "task-1", taskDate: "2026-07-12", text: "测试", note: "", status: "done", source: "manual", sortOrder: 1, isPinned: false, isLowPriority: false, createdAt: "2026-07-12T08:00:00Z", updatedAt: "2026-07-12T09:00:00Z", completedAt: "2026-07-12T09:00:00Z", carryoverFromOccurrenceId: null, firstCreatedAt: "2026-07-12T08:00:00Z", reminderTime: null, reminderAt: null, isRecurring: false, isLongTerm: false, isArchived: false, archivedAt: null, repeat: { kind: "none", interval: 1, daysOfWeek: [], until: null }, location: null, attachments: [],
      }],
    },
    mobilitySegments: [],
    deviceItems: [],
    expenses: [{
      id: "expense-1", occurredAt: Date.parse("2026-07-12T10:00:00Z"), detectedAt: Date.parse("2026-07-12T10:00:00Z"), amountMinor: 1200, currency: "CNY", moneyNature: "purchase_expense", category: null, merchant: "商店", account: null, reviewState: "confirmed", confidenceLevel: "high", confidenceReasons: [], excludedFromTotals: false, originalTransactionId: null, sourceSummary: "manual",
    }],
  });
  expect(events.map((event) => event.source)).toEqual(["expense", "task"]);
  expect(events[0].synced).toBe(false);
  expect(events[1].synced).toBe(true);
});
