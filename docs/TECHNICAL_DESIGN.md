# Daily Todo Sync 技术设计文档

## 1. 项目名称

GitHub 仓库名：`daily-todo-sync`

这个名字直接表达项目目标：每日待办、跨天结转、多端同步。

## 2. 项目目标

- 做一个现代化的每日待办应用。
- 支持账号、邮箱、密码注册登录。
- 未完成事项只在当天真正结束后，进入第二天的待处理列表。
- 未来支持 Android 和 iOS。
- 未来支持离线使用和多端同步。
- 初期尽量 0 成本或使用 DigitalOcean 学生额度。
- 架构保持可迁移，不把自己锁死在某一家云服务上。

## 3. 第一版暂时不做的事

- 暂时不上架 App Store / Google Play。
- 暂时不做手机号登录。
- 暂时不做邮箱验证。
- 暂时不做端到端加密。
- 暂时不做 Kubernetes。
- 暂时不做微服务。
- 前端暂时不直接访问 Supabase。

## 4. 当前项目状态

当前项目是纯静态前端：

- `index.html`
- `styles.css`
- `app.js`
- 数据保存在浏览器 `localStorage`

当前还没有后端，也没有真正的数据库。

## 5. 目标架构

```text
浏览器
  |
  | HTTPS
  v
DigitalOcean VM 上的 Caddy
  |
  | /          -> React 前端静态文件
  | /api/*     -> Django API
  | /admin/*   -> Django Admin
  v
Django + Django Ninja 后端
  |
  | PostgreSQL 连接
  v
Supabase 托管 PostgreSQL
```

未来手机端：

```text
Expo React Native App
  |
  | 先写本地 SQLite
  v
本地 mutation queue
  |
  | 联网后通过 HTTPS 同步
  v
Django API
  |
  v
Supabase PostgreSQL
```

## 6. 技术选型

### 6.1 Web 前端

使用：

- React
- TypeScript
- Vite
- React Router
- TanStack Query
- Zod 或 Valibot

原因：

- 这个产品是登录后的工具型应用，不需要 SEO 和 SSR。
- Vite 简单、快、部署成本低。
- React 以后可以平滑延伸到 React Native / Expo。
- TypeScript 能减少 API、同步、日期逻辑里的低级错误。

暂时不使用 Next.js，因为第一版不需要服务端渲染。

### 6.2 未来手机端

使用：

- Expo
- React Native
- TypeScript
- SQLite

原因：

- Web 端 React 经验可以复用。
- Expo 可以降低 iOS / Android 构建、签名和测试复杂度。
- SQLite 适合手机端离线缓存和离线写入。

### 6.3 后端

使用：

- Python
- Django
- Django Ninja
- Django ORM
- Django migrations

选择 Django 而不是 FastAPI 的原因：

- Django 内置用户、密码哈希、权限、后台管理和迁移体系。
- 账号注册登录这种需求，Django 更省心。
- Django Admin 可以帮助早期快速检查用户和任务数据。
- Django Ninja 可以提供现代化 typed API 和 OpenAPI 文档。
- 这个项目的性能瓶颈更可能在数据库设计、同步逻辑和网络，而不是 Python 框架本身。

### 6.4 数据库

使用：

- Supabase 托管 PostgreSQL

这里把 Supabase 只当成托管 Postgres 用。第一版暂时不用 Supabase Auth，也不让前端直接访问 Supabase。

原因：

- Supabase 底层是标准 PostgreSQL。
- 免费额度足够早期开发。
- 比自己在 1GB VM 上维护 Postgres 更省心。
- 以后如果 Supabase 不合适，可以迁移到其他 PostgreSQL 服务。

### 6.5 登录认证

第一版支持：

- 用户名
- 邮箱
- 密码
- 暂时不做邮箱验证

后端负责：

- 密码哈希
- 注册接口
- 登录接口
- 刷新 token 接口
- 退出登录接口
- 当前用户接口

推荐认证模型：

- 短期 access token
- 长期 refresh token
- refresh token 在服务端只保存哈希

这样以后手机端也可以直接复用。

## 7. 数据模型草案

### 7.1 用户表

从一开始就使用自定义 Django User model。

字段：

```text
id
username
email
password
is_active
is_staff
date_joined
created_at
updated_at
```

约束：

- `username` 唯一
- `email` 唯一

### 7.2 任务表

任务表保存用户创建的原始任务。

字段：

```text
id
user_id
root_id
text
created_at
updated_at
deleted_at
```

说明：

- `root_id` 用来标记同一个逻辑任务跨天结转后的共同来源。
- `deleted_at` 用软删除，方便以后做离线同步。

### 7.3 每日任务出现表

一个任务在某一天出现一次，就是一个 occurrence。

字段：

```text
id
user_id
task_id
root_id
task_date
status
completed_at
carryover_from_occurrence_id
created_at
updated_at
deleted_at
version
client_mutation_id
```

状态：

```text
pending
done
```

关键约束：

```text
unique(user_id, root_id, task_date)
```

这个约束保证跨天结转是幂等的，不会重复生成。

### 7.4 Refresh Token 表

字段：

```text
id
user_id
token_hash
created_at
expires_at
revoked_at
user_agent
ip_address
```

### 7.5 未来同步表

未来做完整离线同步时增加：

```text
id
user_id
client_id
client_mutation_id
operation
entity_type
entity_id
payload
created_at
applied_at
```

这个可以等在线版稳定后再做。

## 8. 跨天结转规则

业务规则：

日期 `D` 的未完成事项，只有在真实日期进入 `D + 1` 后，才进入 `D + 1` 的待处理列表。

不能因为用户提前点开明天，就提前生成结转事项。

实现方式：

- 用户请求某天列表时，后端调用 `ensure_day(user, date)`。
- 如果 `date <= server_today`，后端确保从过去到这天的结转都已经生成。
- 如果 `date > server_today`，只返回用户手动创建在未来日期的任务。
- 依靠 `unique(user_id, root_id, task_date)` 保证重复调用不会重复结转。

伪流程：

```text
GET /api/days/2026-06-21
  if requested_date <= today:
    ensure_day(user, requested_date)
  return occurrences for requested_date
```

完成任务时：

- 当前 occurrence 标记为 done。
- 删除或隐藏同一个 `root_id` 后续日期里的自动 pending 副本。
- 历史已完成记录保留。

注意：

服务器时间必须正确，否则跨天逻辑会错。因此 VM 初始化时必须检查 `timedatectl`。

## 9. API 草案

基础路径：

```text
/api
```

认证：

```text
POST /auth/register
POST /auth/login
POST /auth/refresh
POST /auth/logout
GET  /auth/me
```

待办：

```text
GET    /days/{date}
POST   /days/{date}/tasks
PATCH  /occurrences/{id}
DELETE /occurrences/{id}
POST   /days/{date}/clear-completed
```

未来同步：

```text
POST /sync/push
GET  /sync/pull?since=...
POST /sync
```

## 10. 离线策略

第一版 Web：

- 在线优先。
- 后端和数据库是事实来源。
- 可以先不做完整离线。

第二阶段 Web：

- IndexedDB 缓存最近几天。
- 本地写入先进入 mutation queue。
- 有网时后台同步到后端。

未来手机端：

- SQLite 保存任务和每日出现记录。
- mutation queue 保存本地修改。
- 同步接口负责合并到服务端。

初始冲突规则：

- `version` 更高者优先。
- 版本冲突时，`updated_at` 更新者优先。
- `deleted_at` 优先于普通更新，除非服务端发现有更新的 mutation。

## 11. 部署架构

第一阶段部署：

```text
DigitalOcean Droplet
  Ubuntu 24.04 LTS
  Docker
  Docker Compose
  Caddy
  Django API container
  React 静态文件

Supabase
  PostgreSQL

GitHub
  代码仓库
  GitHub Actions
  GitHub Container Registry
```

第一台 Droplet 推荐配置：

```text
Region: Singapore
OS: Ubuntu 24.04 LTS x64
Plan: Basic Regular SSD, 1 vCPU, 1 GB RAM, 25 GB SSD
IPv6: enabled
Monitoring: enabled
Backups: disabled initially
Managed DB: disabled
```

原因：

- 数据库不跑在 VM 上，所以 1GB RAM 起步够用。
- Caddy + Django + 静态前端可以先跑起来。
- DigitalOcean 学生额度足够后面升级。

## 12. CI/CD

使用 GitHub Actions。

流程：

```text
push main
  -> 检查前端
  -> 测试前端
  -> 测试后端
  -> 构建前端
  -> 构建后端 Docker image
  -> 推送 image 到 GHCR
  -> SSH 到 VM
  -> docker compose pull
  -> docker compose run --rm api python manage.py migrate
  -> docker compose up -d
  -> 健康检查
```

选择 GitHub Actions 的原因：

- 代码会放在 GitHub。
- 不需要额外 CI 服务。
- 和 GHCR、SSH 部署配合简单。
- 比 Jenkins、Kubernetes、自建 CI 更轻。

## 13. 安全基线

立刻要做：

- 只允许 SSH key 登录。
- 禁止 SSH 密码登录。
- 创建非 root 的 `deploy` 用户。
- 防火墙只放行 SSH、HTTP、HTTPS。
- 服务器 `.env` 保存 secrets，不提交到 Git。
- GitHub Actions secrets 保存部署密钥和环境变量。
- 登录密码必须走 HTTPS。

后面再做：

- 邮箱验证。
- 密码重置邮件。
- 登录限流。
- 认证审计日志。
- 自动备份。

## 14. 环境变量草案

后端：

```text
DJANGO_SECRET_KEY=
DJANGO_DEBUG=false
DJANGO_ALLOWED_HOSTS=
DATABASE_URL=
ACCESS_TOKEN_TTL_MINUTES=15
REFRESH_TOKEN_TTL_DAYS=30
CORS_ALLOWED_ORIGINS=
```

前端：

```text
VITE_API_BASE_URL=/api
```

部署：

```text
IMAGE_TAG=
DOMAIN_OR_SSLIP_HOST=
```

## 15. 开发阶段

### 阶段 1：Monorepo 骨架

- 创建 `apps/web`
- 创建 `apps/api`
- 创建 `infra`
- 当前静态版本先保留作为交互参考

### 阶段 2：后端 MVP

- Django 项目
- 自定义用户模型
- 注册、登录、当前用户接口
- Task 和 Occurrence 模型
- 带跨天结转逻辑的每日列表接口

### 阶段 3：Web MVP

- React 应用框架
- 注册登录页面
- 每日待办页面
- 日期切换
- 添加、完成、删除任务
- 跨天提示 UI

### 阶段 4：部署

- Dockerfile
- Docker Compose
- Caddy 配置
- GitHub Actions 部署
- DigitalOcean VM 初始化

### 阶段 5：Web 离线

- IndexedDB 缓存
- mutation queue
- 同步接口

### 阶段 6：手机端

- Expo app
- 共享核心逻辑
- SQLite
- 同步

## 16. 当前默认决策

- 认证用 token，而不是只用 session，因为未来要接手机端。
- 第一阶段前端由 VM 上的 Caddy 提供，不先上 Cloudflare Pages。
- 第一阶段不做邮箱验证。
- 公开分享前建议买域名。
- 数据库用 Supabase PostgreSQL，不在 VM 上自建 Postgres。
