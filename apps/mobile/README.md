# Daily Todo Mobile

React Native + Expo Android 客户端，复用仓库中的 Django API。

## 开发

在仓库根目录执行：

```bash
pnpm install
pnpm dev:mobile
```

启动 Android 模拟器：

```bash
pnpm android
```

默认连接线上 API。需要连接其他环境时，复制 `.env.example` 为 `.env.local`：

```env
EXPO_PUBLIC_API_BASE_URL=https://example.com/api
```

## 质量检查

```bash
pnpm check:mobile
pnpm --filter @daily-todo-sync/mobile lint
pnpm --filter @daily-todo-sync/mobile doctor
```

## 下载 Android 测试 APK

移动端相关文件推送到 `main` 后，GitHub Actions 会运行 `Android APK`：

1. 打开仓库的 `Actions` 页面。
2. 在左侧选择 `Android APK`。
3. 打开最新的成功运行。
4. 在页面底部 `Artifacts` 下载 `daily-todo-android-debug`。
5. 解压后安装 `daily-todo-debug.apk`。

压缩包同时包含 `daily-todo-debug.apk.sha256`。Windows 可用以下命令校验：

```powershell
Get-FileHash .\daily-todo-debug.apk -Algorithm SHA256
```

APK 使用稳定缓存的 Android Debug 签名，仅用于内部测试。正式发布需要独立的生产签名和 AAB。

如需更换 APK 内置的 API 地址，在仓库 `Settings → Secrets and variables → Actions →
Variables` 中设置 `MOBILE_API_BASE_URL`。

## 目录

- `src/app`：Expo Router 入口和全局 Provider
- `src/screens`：登录、今日、日历、AI、个人页
- `src/components`：日期轨、任务行、编辑器和底部导航
- `src/lib`：API、日期和安全凭据存储
- `src/theme.ts`：移动端设计令牌

访问令牌和刷新令牌通过 `expo-secure-store` 保存，不写入 AsyncStorage。
