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
pnpm --filter @daily-todo-sync/mobile exec expo-doctor
```

## 目录

- `src/app`：Expo Router 入口和全局 Provider
- `src/screens`：登录、今日、日历、AI、个人页
- `src/components`：日期轨、任务行、编辑器和底部导航
- `src/lib`：API、日期和安全凭据存储
- `src/theme.ts`：移动端设计令牌

访问令牌和刷新令牌通过 `expo-secure-store` 保存，不写入 AsyncStorage。
