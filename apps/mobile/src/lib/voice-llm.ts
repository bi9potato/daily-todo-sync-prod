import {
  getAssistantApiKey,
  getAssistantLlmSettings,
} from "./assistant-settings";
import {
  matchVoiceTask,
  type VoiceCommand,
  type VoiceTaskRef,
} from "./voice-commands";
import { withTimeout } from "./with-timeout";

// The escalation path for transcripts the rule parser cannot place: an
// OpenAI-compatible chat completion turns free-form speech ("明天下午三点
// 提醒我开会那条不用做了") into the same VoiceCommand shape. Returns null
// when no key is configured or the provider fails, so the caller can fall
// back to a "didn't understand" hint instead of hanging the flow.

const SYSTEM_PROMPT = [
  "你是一个待办应用的语音指令解析器。用户会说一句话，你要输出 JSON：",
  '{"action":"add|complete|delete|none","title":"新任务标题","reminderTime":"HH:mm或null","target":"要完成/删除的既有任务的原文"}',
  "规则：add 时填 title（若说了提醒时间则填 reminderTime，24 小时制）；",
  "complete/delete 时 target 必须从给出的任务列表里选最接近的一项原文；",
  "无法判断时 action 用 none。只输出 JSON，不要输出其他内容。",
].join("\n");

export async function isVoiceLlmConfigured(): Promise<boolean> {
  const settings = await getAssistantLlmSettings();
  return settings.hasApiKey;
}

function chatCompletionsUrl(baseUrl: string) {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return /\/v\d+$/.test(trimmed)
    ? `${trimmed}/chat/completions`
    : `${trimmed}/v1/chat/completions`;
}

export async function parseVoiceCommandWithLlm(
  transcript: string,
  tasks: { pending: VoiceTaskRef[]; done: VoiceTaskRef[] },
): Promise<VoiceCommand | null> {
  const [settings, apiKey] = await Promise.all([
    getAssistantLlmSettings(),
    getAssistantApiKey(),
  ]);
  if (!apiKey) {
    return null;
  }
  const taskLines = [
    ...tasks.pending.map((task) => `- ${task.text}`),
    ...tasks.done.map((task) => `- ${task.text}（已完成）`),
  ].join("\n");
  try {
    const response = await withTimeout(
      fetch(chatCompletionsUrl(settings.baseUrl), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: settings.model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: `今天的任务列表：\n${taskLines || "（空）"}\n\n用户说：${transcript}`,
            },
          ],
        }),
      }),
      15_000,
      "语音解析超时",
    );
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      return null;
    }
    const parsed = JSON.parse(content) as {
      action?: string;
      title?: string;
      reminderTime?: string | null;
      target?: string;
    };
    if (parsed.action === "add" && parsed.title?.trim()) {
      const reminderTime =
        parsed.reminderTime && /^\d{2}:\d{2}$/.test(parsed.reminderTime)
          ? parsed.reminderTime
          : null;
      return { kind: "add", text: parsed.title.trim(), reminderTime };
    }
    if (
      (parsed.action === "complete" || parsed.action === "delete") &&
      parsed.target?.trim()
    ) {
      const pool =
        parsed.action === "complete"
          ? tasks.pending
          : [...tasks.pending, ...tasks.done];
      const task = matchVoiceTask(parsed.target, pool);
      return task
        ? { kind: parsed.action, taskId: task.id, taskText: task.text }
        : { kind: "unmatched", action: parsed.action, query: parsed.target.trim() };
    }
    return { kind: "none" };
  } catch {
    return null;
  }
}
