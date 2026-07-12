# Microsoft To Do 双向同步计划（延期待开发）

状态：**延期**（2026-07-12 用户决定先做任务详情界面重构与性能优化）。

## 目标

Daily Todo（Android）与 Microsoft To Do 双向同步：两边的新增、修改、完成、删除互通。

## 技术方案（已调研）

- **API**：Microsoft Graph `/me/todo/lists/{id}/tasks`，增量用 delta 查询。
- **认证**：公共客户端 + PKCE 授权码流程（无 client secret），token 存 SecureStore，
  重定向 URI `daily-todo://auth/microsoft`，权限 `Tasks.ReadWrite` + `offline_access`。
- **同步引擎**：客户端侧（当前服务器 API 镜像部署通道受 GitHub 账单限制，避免后端改动）。
  - 本地映射表存 AsyncStorage：`occurrenceId ↔ graphTaskId` + deltaLink。
  - 触发时机：应用启动、回到前台、任务 mutation 成功后节流触发。
  - 冲突策略：以 `lastModifiedDateTime` 较新者为准；完成状态冲突时偏向"已完成"。
- **映射**：本应用"今日任务" ↔ To Do 指定列表（默认新建 "Daily Todo" 列表）；
  reminderTime → `reminder.dateTime`；长期/低优先任务首版不同步。

## 用户侧前置步骤（开工前需要提供 Client ID）

1. 打开 portal.azure.com → App registrations → New registration。
2. 账户类型选"任何组织目录中的账户和个人 Microsoft 账户"。
3. 重定向 URI 选"公共客户端/本机(移动和桌面)"，填 `daily-todo://auth/microsoft`。
4. API 权限添加 Microsoft Graph 委托权限：`Tasks.ReadWrite`、`offline_access`。
5. 把"应用程序(客户端) ID"（GUID）提供给开发。

## 实现清单（预估）

- [ ] lib/microsoft-auth.ts：PKCE 流程 + token 刷新（expo-web-browser / expo-auth-session）。
- [ ] lib/microsoft-todo-api.ts：lists/tasks/delta 封装。
- [ ] lib/microsoft-sync.ts：双向同步引擎 + 映射存储 + 冲突解决（纯函数部分补单测）。
- [ ] 我的账户页新增"Microsoft To Do"区块：连接/断开、选择列表、最近同步时间、错误显示。
- [ ] 三仓库同步 + 发布说明。
