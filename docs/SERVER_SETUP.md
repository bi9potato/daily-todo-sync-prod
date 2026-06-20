# DigitalOcean 服务器初始化步骤

服务器名称：`daily-todo-sync-sgp1-01`

当前目标：

1. 确认服务器时间正确。
2. 更新系统。
3. 创建非 root 的部署用户。
4. 配置基础 SSH 安全。
5. 安装 Docker 和 Docker Compose。
6. 后续用于 GitHub Actions 自动部署。

## 1. 第一次登录

本机执行：

```powershell
ssh root@68.183.180.19
```

第一次连接时输入：

```text
yes
```

## 2. 检查服务器时间

登录服务器后执行：

```bash
date
timedatectl
```

这个项目的跨天逻辑依赖服务器日期，所以时间必须正确。

推荐时区设置为 UTC，业务里再按用户时区处理。

如果时间同步没有开启，执行：

```bash
timedatectl set-ntp true
```

## 3. 更新系统

```bash
apt update
apt upgrade -y
reboot
```

重启后重新登录：

```powershell
ssh root@68.183.180.19
```

## 4. 创建部署用户

```bash
adduser deploy
usermod -aG sudo deploy
```

把 root 的 SSH 公钥复制给 deploy：

```bash
mkdir -p /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
```

测试：

```powershell
ssh deploy@68.183.180.19
```

## 5. SSH 安全设置

确认 deploy 用户可以登录后，再禁用 root 密码登录和 SSH 密码登录。

注意：

- 不要把服务器密码贴到聊天、Issue、README 或任何 Git 记录里。
- 如果密码已经贴出来，建议立刻执行 `passwd` 修改。
- 修改 SSH 配置前，保留当前 root 和 deploy 两个已登录窗口，不要急着关闭。

先查看当前 SSH 实际配置：

```bash
sudo sshd -T | grep -E '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication|pubkeyauthentication)'
```

编辑：

```bash
sudo nano /etc/ssh/sshd_config
```

确认或修改：

```text
PermitRootLogin prohibit-password
PasswordAuthentication no
PubkeyAuthentication yes
```

推荐创建单独配置文件覆盖默认值：

```bash
sudo tee /etc/ssh/sshd_config.d/99-daily-todo-hardening.conf >/dev/null <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
PermitRootLogin prohibit-password
EOF
```

检查配置语法：

```bash
sudo sshd -t
```

如果没有输出，说明语法通过。然后执行：

```bash
sudo systemctl reload ssh
```

再次查看实际配置：

```bash
sudo sshd -T | grep -E '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication|pubkeyauthentication)'
```

注意：

先不要完全禁用 root 登录，等 deploy 用户稳定可用后再说。

## 6. 安装 Docker

安装 Docker 前，先配置防火墙。

## 6. 配置服务器防火墙

当前阶段只放行：

- SSH: `22`
- HTTP: `80`
- HTTPS: `443`

执行：

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status verbose
```

预期结果：

```text
Status: active
22/tcp                     ALLOW IN    Anywhere
80/tcp                     ALLOW IN    Anywhere
443/tcp                    ALLOW IN    Anywhere
```

如果开启了 IPv6，也可能看到对应的 `(v6)` 规则。

## 7. 安装 Docker

使用 Docker 官方仓库安装。

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

把 `deploy` 加入 docker 用户组：

```bash
sudo usermod -aG docker deploy
```

然后退出重新登录 `deploy`，让用户组生效：

```bash
exit
```

本机重新连接：

```powershell
ssh deploy@68.183.180.19
```

验证：

```bash
docker --version
docker compose version
docker run hello-world
```

如果 `hello-world` 输出成功信息，Docker 就安装好了。

当前已验证版本：

```text
Docker version 29.6.0
Docker Compose version v5.1.4
```

## 8. 创建部署目录

应用以后放在：

```text
/opt/daily-todo-sync
```

创建目录：

```bash
sudo mkdir -p /opt/daily-todo-sync
sudo chown -R deploy:deploy /opt/daily-todo-sync
```

## 9. 最小 HTTP 健康检查

在正式应用部署前，先用 Nginx 容器确认 80 端口能从公网访问。

```bash
cd /opt/daily-todo-sync
mkdir -p smoke
cat > smoke/index.html <<'EOF'
daily-todo-sync vm ok
EOF
docker run -d --name daily-todo-smoke -p 80:80 -v "$PWD/smoke:/usr/share/nginx/html:ro" nginx:alpine
docker ps
```

在浏览器打开：

```text
http://68.183.180.19
```

如果看到 `daily-todo-sync vm ok`，说明公网 80 端口正常。

测试完成后删除临时容器：

```bash
docker rm -f daily-todo-smoke
```

当前已验证：

- SSH key 登录正常
- `deploy` 用户 sudo 正常
- SSH 密码登录已禁用
- UFW 防火墙已启用
- Docker 正常
- Docker Compose 正常
- 公网 HTTP 80 端口正常

## 10. 创建服务器环境变量文件

真实密钥只放在服务器 `.env`，不要写进 Git。

```bash
cd /opt/daily-todo-sync
nano .env
```

写入内容。

`DATABASE_URL` 推荐使用 Supabase 的 `Session pooler` 连接串，而不是 Direct connection。

Session pooler 连接串通常类似：

```text
postgresql://postgres.aekujtmkegncmvwqiwhw:你的数据库密码@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
```

以 Supabase Dashboard 复制出来的实际内容为准。

```text
DJANGO_SECRET_KEY=后面生成的随机值
DJANGO_DEBUG=false
DJANGO_ALLOWED_HOSTS=68.183.180.19,68.183.180.19.sslip.io
DATABASE_URL=Supabase Session pooler 连接串
ACCESS_TOKEN_TTL_MINUTES=15
REFRESH_TOKEN_TTL_DAYS=30
CORS_ALLOWED_ORIGINS=http://68.183.180.19,https://68.183.180.19.sslip.io
```

保存后设置权限：

```bash
chmod 600 /opt/daily-todo-sync/.env
```

注意：

- 不要用 `cat /opt/daily-todo-sync/.env` 打印真实环境变量。
- 检查权限时用 `ls -la /opt/daily-todo-sync/.env`。
- 如果 `.env` 内容被贴到聊天、Issue、README 或 GitHub，需要重置对应密码。

生成正式 `DJANGO_SECRET_KEY`：

```bash
python3 - <<'PY'
from secrets import token_urlsafe
print(token_urlsafe(50))
PY
```

把输出复制到 `.env` 的 `DJANGO_SECRET_KEY=` 后面。

## 11. 测试 Supabase PostgreSQL 连接

使用临时 Postgres Docker 镜像测试连接：

```bash
cd /opt/daily-todo-sync
docker run --rm --env-file .env postgres:16-alpine \
  sh -c 'psql "$DATABASE_URL" -c "select current_database(), current_user, now();"'
```

如果看到 `current_database` 是 `postgres`，`current_user` 是 `postgres`，说明 VM 到 Supabase 数据库连接正常。

当前已验证：

```text
current_database: postgres
current_user: postgres
connection: OK
```
