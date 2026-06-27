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

移动端相关文件推送到 `main` 后，GitHub Actions 会运行 `Android APK`。构建和检查全部
通过后，工作流会自动更新 `android-latest` 预发布版本，并替换其中的 APK 和校验文件：

- Release 页面：<https://github.com/bi9potato/daily-todo-sync/releases/tag/android-latest>
- APK 固定直链：<https://github.com/bi9potato/daily-todo-sync/releases/download/android-latest/daily-todo-arm64-v8a.apk>

Release 同时包含 `daily-todo-arm64-v8a.apk.sha256`。Windows 可用以下命令校验：

```powershell
Get-FileHash .\daily-todo-arm64-v8a.apk -Algorithm SHA256
```

APK 只包含 `arm64-v8a`，可独立运行，不依赖 Metro。它使用测试签名，仅用于内部测试；
正式发布需要独立的生产签名和 AAB。

Actions 页面仍会保留同一构建的 `daily-todo-android-arm64-v8a` Artifact 14 天，作为 CI
排查和备用下载。

如需更换 APK 内置的 API 地址，在仓库 `Settings → Secrets and variables → Actions →
Variables` 中设置 `MOBILE_API_BASE_URL`。

## 目录

- `src/app`：Expo Router 入口和全局 Provider
- `src/screens`：登录、今日、日历、AI、个人页
- `src/components`：日期轨、任务行、编辑器和底部导航
- `src/lib`：API、日期和安全凭据存储
- `src/theme.ts`：移动端设计令牌

访问令牌和刷新令牌通过 `expo-secure-store` 保存，不写入 AsyncStorage。
