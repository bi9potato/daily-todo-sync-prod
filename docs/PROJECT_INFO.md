# 项目信息

这个文件只记录非敏感信息。

不要在这里写：

- 服务器密码
- 数据库密码
- SSH 私钥
- Supabase service role key
- GitHub token
- 完整 `DATABASE_URL`

## GitHub 仓库

```text
daily-todo-sync
```

## DigitalOcean VM

```text
Name: daily-todo-sync-sgp1-01
Public IPv4: 68.183.180.19
Region: Singapore
OS: Ubuntu 24.04 LTS
User: deploy
```

已完成：

- SSH key 登录
- `deploy` 用户
- UFW 防火墙
- Docker
- Docker Compose
- 公网 HTTP 80 端口测试

## Supabase

```text
Project name: daily-todo-sync-db
Project URL: https://aekujtmkegncmvwqiwhw.supabase.co
Current region: Southeast Asia (Singapore), ap-southeast-1
Database host: db.aekujtmkegncmvwqiwhw.supabase.co
Database port: 5432
Database name: postgres
Database user: postgres
Session pooler host: aws-1-ap-southeast-1.pooler.supabase.com
Session pooler user: postgres.aekujtmkegncmvwqiwhw
```

当前判断：

当前 Supabase 项目区域正确，和 DigitalOcean Singapore VM 匹配。

之前误建的 Sydney 项目不再使用，可以删除。

当前已验证：

- VM 上 Docker 容器可以通过 Supabase Session pooler 连接 PostgreSQL。

## 密钥保存位置

真实密钥只放在：

- 本机未提交的 `.env`
- VM 上的 `/opt/daily-todo-sync/.env`
- GitHub Actions Secrets
- 你自己的密码管理器

仓库里只保留 `.env.example`。
