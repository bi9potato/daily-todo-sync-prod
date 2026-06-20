# 部署说明

## 1. 当前部署方式

第一版使用 GitHub Actions 构建 Docker 镜像，并把镜像推到 GitHub Container Registry。
服务器通过 Docker Compose 拉取镜像并启动：

```text
Caddy -> React Web
Caddy -> Django API
Django API -> Supabase PostgreSQL
```

## 2. 服务器目录

服务器目录固定为：

```text
/opt/daily-todo-sync
```

这个目录里需要有：

```text
.env
compose.yml
infra/Caddyfile
```

注意：`.env` 不进 Git，不会被 GitHub Actions 覆盖。

## 3. 服务器 `.env` 需要的变量

示例：

```text
DJANGO_SECRET_KEY=change-me
DJANGO_DEBUG=false
DJANGO_ALLOWED_HOSTS=68.183.180.19,68.183.180.19.sslip.io
DATABASE_URL=postgresql://user:password@pooler-host:5432/postgres
ACCESS_TOKEN_TTL_MINUTES=15
REFRESH_TOKEN_TTL_DAYS=30
CORS_ALLOWED_ORIGINS=http://68.183.180.19,https://68.183.180.19.sslip.io
CSRF_TRUSTED_ORIGINS=https://68.183.180.19.sslip.io
TZ=Asia/Shanghai
APP_HOST=68.183.180.19.sslip.io
APP_IP=68.183.180.19
```

## 4. GitHub Secrets

仓库需要配置这些 Secrets：

```text
DROPLET_HOST=服务器公网 IP
DROPLET_USER=deploy
DROPLET_SSH_KEY=用于登录服务器的私钥内容
DROPLET_PORT=22
```

不要把私钥、数据库密码、服务器密码写进仓库文件。

## 5. 启用自动部署

当前 deploy workflow 支持两种触发：

- 手动运行 `Deploy` workflow。
- 设置 GitHub Repository Variable：`ENABLE_DEPLOY=true` 后，push 到 `main` 自动部署。

这么做的原因是：在 Secrets 还没配齐前，普通 push 不会误触发失败部署。

## 6. 第一次部署后检查

在服务器执行：

```bash
cd /opt/daily-todo-sync
docker compose -f compose.yml ps
docker compose -f compose.yml logs api --tail=100
docker compose -f compose.yml logs caddy --tail=100
```

浏览器访问：

```text
https://68.183.180.19.sslip.io
https://68.183.180.19.sslip.io/api/health
```

