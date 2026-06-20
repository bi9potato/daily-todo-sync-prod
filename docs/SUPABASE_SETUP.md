# Supabase PostgreSQL 设置步骤

这个项目第一阶段只使用 Supabase 的 PostgreSQL 数据库。

暂时不使用：

- Supabase Auth
- Supabase Storage
- Supabase Realtime
- 前端直连 Supabase

## 1. 创建 Supabase 项目

进入 Supabase Dashboard：

```text
https://supabase.com/dashboard
```

创建新项目：

```text
Project name: daily-todo-sync-db
Region: Singapore 或 Tokyo
Database password: 生成强密码并保存
Plan: Free
```

建议优先选 Singapore，因为你的 DigitalOcean VM 在 Singapore。

如果已经误选 Sydney，而项目还没有正式数据，建议删除并重建到 Singapore。

## 2. 获取数据库连接字符串

进入项目后：

```text
Project Settings -> Database -> Connection string
```

Supabase 会给几种连接方式。

这个项目部署时推荐使用：

```text
Session pooler
```

不要优先使用：

```text
Direct connection
```

原因：

- Supabase 免费项目的 Direct connection 可能走 IPv6。
- Docker 容器或某些服务器网络环境可能没有 IPv6 出站能力。
- Session pooler 兼容 IPv4，更适合我们当前 DigitalOcean VM + Docker 部署。

不要点击 `Enable IPv4 add-on`，这是给 Direct connection 增加 dedicated IPv4 的付费方向。当前项目不需要。

操作步骤：

```text
Connect -> Direct -> Connection Method -> Session pooler -> Type: URI
```

然后复制新的 connection string。

Django 使用 URI 形式：

```text
postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@[POOLER-HOST]:5432/postgres
```

注意：

- 不要把数据库密码提交到 Git。
- 不要把连接字符串贴到 README。
- 部署时放到服务器 `.env` 和 GitHub Actions Secrets。
- 如果密码已经发到聊天、Issue、截图、README 或任何不安全位置，应该立即在 Supabase 里重置。
- 仓库只保存 `.env.example` 这种占位模板，不保存真实 `.env`。

## 3. 第一阶段需要保存的信息

本地或密码管理器里保存：

```text
SUPABASE_PROJECT_NAME=daily-todo-sync
SUPABASE_REGION=
DATABASE_URL=
DATABASE_PASSWORD=
```

当前非敏感连接信息：

```text
Direct Host: db.aekujtmkegncmvwqiwhw.supabase.co
Direct Port: 5432
Project Ref: aekujtmkegncmvwqiwhw
Database: postgres
User: postgres
Session Pooler Host: aws-1-ap-southeast-1.pooler.supabase.com
Session Pooler Port: 5432
Session Pooler User: postgres.aekujtmkegncmvwqiwhw
```

注意：

如果使用 Session pooler，用户名通常不是单纯 `postgres`，而是类似：

```text
postgres.aekujtmkegncmvwqiwhw
```

请以 Supabase Dashboard 给出的连接串为准。

当前已验证：

```text
DigitalOcean VM Docker container -> Supabase Session pooler -> PostgreSQL OK
```

## 4. 连接方式

应用连接路径：

```text
Django API -> Supabase PostgreSQL
```

前端不直接连接数据库。

这样以后如果数据库迁移到别的 PostgreSQL 服务，只需要改后端配置。

## 5. Supabase 创建页推荐选项

因为这个项目第一阶段只让 Django 后端连接数据库，前端不直接调用 Supabase：

- `Enable Data API`：如果页面允许关闭，可以关闭。
- `Automatically expose new tables`：关闭。
- `Enable automatic RLS`：如果 Data API 开着，建议开启；如果 Data API 关闭，影响不大。

核心原则：

```text
前端 -> Django API -> Supabase PostgreSQL
```

不要做：

```text
前端 -> Supabase Data API -> 数据库
```
