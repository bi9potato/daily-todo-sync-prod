# Daily Todo Sync

一个面向 Web、未来 Android/iOS 的每日待办应用。当前目标是从静态 MVP 迁移到现代化多端架构：

```text
React + TypeScript + Vite
Django + Django Ninja
Supabase PostgreSQL
Docker Compose + Caddy
GitHub Actions
```

## 当前状态

- `legacy/static-mvp`：已经可用的纯前端 MVP，数据存在浏览器 `localStorage`
- `apps/web`：新的 React Web 应用骨架
- `apps/api`：新的 Django API 应用骨架
- `infra`：部署和反向代理配置
- `docs`：中文技术文档和服务器设置记录

## 本地开发

前端：

```bash
pnpm install
pnpm dev:web
```

后端：

```bash
cd apps/api
python -m venv .venv
.venv\Scripts\activate
pip install -e ".[dev]"
python manage.py migrate
python manage.py runserver
```

## 环境变量

仓库只提交 `.env.example`。真实密钥放在：

- 本机 `.env`
- 服务器 `/opt/daily-todo-sync/.env`
- GitHub Actions Secrets

不要把数据库密码、服务器密码、SSH 私钥或 Django secret 提交到 Git。

## 技术文档

- [技术设计](docs/TECHNICAL_DESIGN.md)
- [服务器初始化](docs/SERVER_SETUP.md)
- [Supabase 设置](docs/SUPABASE_SETUP.md)
- [部署说明](docs/DEPLOYMENT.md)
- [项目信息](docs/PROJECT_INFO.md)
