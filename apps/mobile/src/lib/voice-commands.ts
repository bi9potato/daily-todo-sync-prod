// Rule-based parsing for spoken task commands ("添加任务买牛奶"、"完成买牛奶"、
// "删除跑步"). This is the fast, offline path; transcripts it cannot place
// are handed to the optional LLM parser (lib/voice-llm.ts). Pure functions,
// unit tested.

export type VoiceTaskRef = { id: string; text: string };

export type VoiceCommand =
  | { kind: "add"; text: string; reminderTime: string | null }
  | { kind: "complete" | "delete"; taskId: string; taskText: string }
  | { kind: "unmatched"; action: "complete" | "delete"; query: string }
  | { kind: "none" };

const TRAILING_PUNCTUATION = /[。．.!！?？，,\s]+$/;
const LEADING_FILLERS = /^(请|帮我|给我|麻烦)/;

function normalize(input: string) {
  return input.trim().replace(TRAILING_PUNCTUATION, "").replace(LEADING_FILLERS, "");
}

function compact(input: string) {
  return input.replace(/[\s，,。．.!！?？、"“”]/g, "").toLowerCase();
}

const ZH_DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12,
};

function parseHourToken(token: string): number | null {
  if (/^\d{1,2}$/.test(token)) {
    const value = Number(token);
    return value >= 0 && value <= 23 ? value : null;
  }
  return ZH_DIGITS[token] ?? null;
}

const TIME_PATTERN =
  /(上午|早上|中午|下午|晚上)?\s*(\d{1,2}|十一|十二|[零一二两三四五六七八九十])\s*[点:：]\s*(半|\d{1,2})?\s*分?/;

// "下午三点半提醒我" -> "15:30". Only phrases that mention 提醒 count as a
// reminder; a bare time stays part of the task text ("三点开会" is a title).
export function extractReminderTime(input: string): {
  text: string;
  reminderTime: string | null;
} {
  if (!input.includes("提醒")) {
    return { text: input, reminderTime: null };
  }
  const match = TIME_PATTERN.exec(input);
  if (!match) {
    return { text: input.replace(/提醒我?/g, "").trim(), reminderTime: null };
  }
  const [phrase, period, hourToken, minuteToken] = match;
  let hour = parseHourToken(hourToken);
  if (hour == null) {
    return { text: input, reminderTime: null };
  }
  if ((period === "下午" || period === "晚上") && hour < 12) {
    hour += 12;
  }
  if (period === "中午" && hour <= 2) {
    hour += 12;
  }
  const minute =
    minuteToken === "半" ? 30 : minuteToken ? Number(minuteToken) : 0;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59 || hour > 23) {
    return { text: input, reminderTime: null };
  }
  const reminderTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const text = input
    .replace(new RegExp(`(在|到)?${escapeRegExp(phrase)}(的时候)?提醒我?`), "")
    .replace(new RegExp(`提醒我?(在|到)?${escapeRegExp(phrase)}(的时候)?`), "")
    .replace(new RegExp(escapeRegExp(phrase)), "")
    .replace(/提醒我?/g, "")
    .trim();
  return { text, reminderTime };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Finds the task the user most plausibly meant. Exact match first, then the
// longest containment either way; spoken text rarely matches verbatim.
export function matchVoiceTask(
  query: string,
  tasks: VoiceTaskRef[],
): VoiceTaskRef | null {
  const wanted = compact(query);
  if (!wanted) {
    return null;
  }
  let best: VoiceTaskRef | null = null;
  let bestScore = 0;
  for (const task of tasks) {
    const candidate = compact(task.text);
    if (!candidate) {
      continue;
    }
    let score = 0;
    if (candidate === wanted) {
      score = wanted.length + 1000;
    } else if (candidate.includes(wanted)) {
      score = wanted.length;
    } else if (wanted.includes(candidate)) {
      score = candidate.length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = task;
    }
  }
  return best;
}

const ADD_PATTERN = /^(添加|新增|新建|加个|加一个|加上|记一下|记录|记)(任务|待办)?[:：，,\s]*(.+)$/;
const COMPLETE_PATTERN = /^(完成|做完了?|勾掉|勾选|打勾)(任务|待办)?[:：，,\s]*(.+)$/;
const COMPLETE_SUFFIX_PATTERN = /^(.+?)(完成了|做完了|搞定了)$/;
const DELETE_PATTERN = /^(删除|删掉|移除|去掉)(任务|待办)?[:：，,\s]*(.+)$/;

export function parseVoiceCommand(
  transcript: string,
  tasks: { pending: VoiceTaskRef[]; done: VoiceTaskRef[] },
): VoiceCommand {
  const input = normalize(transcript);
  if (!input) {
    return { kind: "none" };
  }

  const complete =
    COMPLETE_PATTERN.exec(input) ??
    (COMPLETE_SUFFIX_PATTERN.exec(input)
      ? ["", "完成", undefined, COMPLETE_SUFFIX_PATTERN.exec(input)![1]]
      : null);
  if (complete) {
    const query = String(complete[3]).trim();
    const task = matchVoiceTask(query, tasks.pending);
    return task
      ? { kind: "complete", taskId: task.id, taskText: task.text }
      : { kind: "unmatched", action: "complete", query };
  }

  const removed = DELETE_PATTERN.exec(input);
  if (removed) {
    const query = removed[3].trim();
    const task = matchVoiceTask(query, [...tasks.pending, ...tasks.done]);
    return task
      ? { kind: "delete", taskId: task.id, taskText: task.text }
      : { kind: "unmatched", action: "delete", query };
  }

  const added = ADD_PATTERN.exec(input);
  if (added) {
    const { text, reminderTime } = extractReminderTime(added[3].trim());
    if (text) {
      return { kind: "add", text, reminderTime };
    }
  }

  return { kind: "none" };
}
