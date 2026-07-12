import {
  extractReminderTime,
  matchVoiceTask,
  parseVoiceCommand,
} from "./voice-commands";

const tasks = {
  pending: [
    { id: "p1", text: "买牛奶" },
    { id: "p2", text: "给妈妈打电话" },
    { id: "p3", text: "跑步 5 公里" },
  ],
  done: [{ id: "d1", text: "交水电费" }],
};

describe("parseVoiceCommand add", () => {
  test.each([
    "添加任务买牛奶",
    "添加 买牛奶",
    "新增任务：买牛奶",
    "记一下买牛奶",
    "帮我添加任务买牛奶。",
  ])("%s creates 买牛奶", (input) => {
    expect(parseVoiceCommand(input, tasks)).toEqual({
      kind: "add",
      text: "买牛奶",
      reminderTime: null,
    });
  });

  test("extracts a reminder time from the add phrase", () => {
    expect(parseVoiceCommand("添加任务下午三点提醒我开会", tasks)).toEqual({
      kind: "add",
      text: "开会",
      reminderTime: "15:00",
    });
  });

  test("a bare time without 提醒 stays in the title", () => {
    expect(parseVoiceCommand("添加任务三点开会", tasks)).toEqual({
      kind: "add",
      text: "三点开会",
      reminderTime: null,
    });
  });
});

describe("parseVoiceCommand complete", () => {
  test.each(["完成买牛奶", "完成任务 买牛奶", "买牛奶完成了", "勾掉买牛奶"])(
    "%s completes p1",
    (input) => {
      expect(parseVoiceCommand(input, tasks)).toEqual({
        kind: "complete",
        taskId: "p1",
        taskText: "买牛奶",
      });
    },
  );

  test("fuzzy-matches partial task names", () => {
    expect(parseVoiceCommand("完成打电话", tasks)).toEqual({
      kind: "complete",
      taskId: "p2",
      taskText: "给妈妈打电话",
    });
  });

  test("reports an unmatched target", () => {
    expect(parseVoiceCommand("完成写周报", tasks)).toEqual({
      kind: "unmatched",
      action: "complete",
      query: "写周报",
    });
  });
});

describe("parseVoiceCommand delete", () => {
  test("deletes pending tasks", () => {
    expect(parseVoiceCommand("删除跑步", tasks)).toEqual({
      kind: "delete",
      taskId: "p3",
      taskText: "跑步 5 公里",
    });
  });

  test("can delete an already-done task", () => {
    expect(parseVoiceCommand("删掉交水电费", tasks)).toEqual({
      kind: "delete",
      taskId: "d1",
      taskText: "交水电费",
    });
  });
});

test("unrelated speech returns none", () => {
  expect(parseVoiceCommand("今天天气怎么样", tasks)).toEqual({ kind: "none" });
  expect(parseVoiceCommand("", tasks)).toEqual({ kind: "none" });
});

describe("extractReminderTime", () => {
  test.each([
    ["下午三点提醒我开会", "开会", "15:00"],
    ["晚上8点半提醒我遛狗", "遛狗", "20:30"],
    ["提醒我上午9点吃药", "吃药", "09:00"],
    ["中午十二点提醒吃饭", "吃饭", "12:00"],
    ["18点45提醒我下班", "下班", "18:45"],
  ])("%s -> %s @ %s", (input, text, time) => {
    expect(extractReminderTime(input)).toEqual({ text, reminderTime: time });
  });

  test("no 提醒 keyword means no reminder", () => {
    expect(extractReminderTime("下午三点开会")).toEqual({
      text: "下午三点开会",
      reminderTime: null,
    });
  });
});

describe("matchVoiceTask", () => {
  test("prefers the exact match over containment", () => {
    const refs = [
      { id: "a", text: "买牛奶和面包" },
      { id: "b", text: "买牛奶" },
    ];
    expect(matchVoiceTask("买牛奶", refs)?.id).toBe("b");
  });

  test("ignores spacing and punctuation", () => {
    expect(matchVoiceTask("跑步5公里", tasks.pending)?.id).toBe("p3");
  });

  test("returns null when nothing overlaps", () => {
    expect(matchVoiceTask("写代码", tasks.pending)).toBeNull();
  });
});
