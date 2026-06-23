# Daily Todo Sync AI Native 设计规划

## 目标

Daily Todo Sync 的 AI native 方向不是把所有界面删掉，只剩一个聊天框，而是让聊天框成为主入口，让所有任务能力都工具化、可解释、可确认、可撤销。

用户可以用自然语言完成任务创建、整理、分析、提醒、重复、日历同步等操作；传统 UI 继续存在，负责承载明确状态、精细编辑和可视化反馈。

## 产品原则

1. 聊天是主入口，UI 是状态面板。
2. AI 不直接写数据库，必须通过受控工具调用。
3. 高风险操作必须确认，例如删除、批量修改、同步外部服务。
4. 每次 AI 操作都要留下日志，方便解释、撤销和调试。
5. 先做内部工具注册表，后续再扩展 MCP。
6. 移动端优先，输入框要像系统级命令栏一样稳定存在。

## 第一阶段：AI 输入框雏形

范围：

- 底部 AI 输入框。
- 支持自然语言新增任务。
- 支持“分析今天”。
- 返回 AI 回复和结构化 actions。
- 操作成功后刷新任务列表。

示例：

```text
添加 明天早上 10 点看护照
总结一下今天干了啥
创建一个长期任务：每天复习英语
```

当前阶段可以先用规则解析，先不接真实大模型。重点是把接口、日志、工具边界打好。

## 第二阶段：工具调用层

后端建立 `ai/actions` 或 `assistant/tools` 层，每个工具都是明确函数：

- `create_task`
- `update_task`
- `delete_task`
- `restore_task`
- `reorder_tasks`
- `set_reminder`
- `set_repeat`
- `pin_task`
- `move_to_long_term`
- `move_to_low_priority`
- `sync_google_calendar`
- `analyze_today`
- `plan_week`

每个工具需要定义：

- 输入 schema
- 权限检查
- 是否需要用户确认
- 成功返回
- 失败返回
- 是否支持撤销

## 第三阶段：确认和撤销

AI 对高风险动作先生成草案：

```json
{
  "intent": "bulk_update",
  "summary": "把 5 个低优先级任务移动到明天",
  "requiresConfirmation": true,
  "actions": [...]
}
```

前端显示确认卡片，用户确认后再执行。

需要支持撤销：

- 删除任务：进入回收站，可恢复。
- 批量移动：记录原始日期和排序。
- 批量改标签：记录原始标签状态。

## 第四阶段：接入真实大模型

推荐架构：

```text
用户输入
  -> AI Orchestrator
  -> 意图识别
  -> 工具选择
  -> 需要确认则返回确认卡
  -> 执行工具
  -> 写入 AgentRun / ToolCall 日志
  -> 返回自然语言结果
```

模型只输出结构化 action，不直接写库。

建议使用 JSON schema / function calling，让模型严格输出：

- `reply`
- `actions`
- `requiresConfirmation`
- `confidence`
- `missingFields`

## 第五阶段：Skills

Skills 是产品内的可组合能力，不是外部 MCP。

推荐内置 skills：

- 每日复盘 skill：总结完成项、未完成项、拖延项。
- 周计划 skill：按日期和优先级安排任务。
- 日历同步 skill：检查哪些任务适合同步到 Google Calendar。
- 任务清理 skill：找重复任务、过期任务、长期未处理任务。
- 低优先级整理 skill：把不紧急任务收纳到底部栏目。

## 第六阶段：MCP

MCP 放在更后面，用于让外部 AI 客户端调用 Daily Todo Sync，或者让本应用连接更多外部系统。

适合 MCP 的场景：

- 让 Codex / Claude Desktop / 其他 AI 工具读取和操作 Todo。
- 连接 Notion、Gmail、Google Drive、Calendar。
- 暴露标准工具：`list_tasks`、`create_task`、`update_task`、`summarize_day`。

不建议一开始就做 MCP，因为当前核心是产品内体验，而不是外部生态。

## 数据模型建议

后续新增：

- `AgentRun`
  - user
  - input_text
  - reply
  - status
  - created_at

- `AgentToolCall`
  - run
  - tool_name
  - input_json
  - output_json
  - status
  - requires_confirmation
  - created_at

- `AgentConfirmation`
  - run
  - status
  - confirmed_at
  - rejected_at

## 近期实现顺序

1. AI 输入框雏形。
2. 后端 `/api/ai/chat`。
3. 支持新增任务和今日分析。
4. 工具调用日志表。
5. 确认卡片。
6. 接入真实大模型。
7. 扩展到批量整理、周计划、Google Calendar 智能同步。
8. 最后再做 MCP。

