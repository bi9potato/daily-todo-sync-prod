# iOS 安装说明（无开发者账号，侧载给朋友）

我们没有 Apple 开发者账号（$99/年），所以 iOS 版**不能**像安卓那样点个链接直接装。
CI 产出的是一个**免签名 IPA**，朋友需要用 **SideStore**（或 AltStore）用**自己的免费 Apple ID**
在自己手机上重新签名安装。下面是一次性设置 + 日常更新的步骤。

## 你会拿到什么

- 每次 `main` 上 `apps/mobile/**` 变动，GitHub Actions 的 **iOS IPA** 工作流会在 macOS runner 上构建，
  并把免签名安装包发布到 GitHub Release `ios-latest`：
  - 直链：`https://github.com/<owner>/<repo>/releases/download/ios-latest/daily-todo.ipa`

## 免费 Apple ID 的硬限制（务必先告诉朋友）

- **证书 7 天过期**：到期后 App 打不开，需要用 SideStore「刷新」一次（SideStore 可在同一 Wi-Fi 下自动刷新，不用连电脑）。
- **同时最多 3 个侧载 App**（含 SideStore 自身），一周内最多装 10 个不同 App。
- 后台定位、计步在免费账号下**可用**（不需要付费专属 entitlement）。

## 一次性设置（每部 iPhone 只需一次，需要一台电脑）

1. 朋友在电脑上按 [SideStore 官方文档](https://docs.sidestore.io/docs/getting-started/) 安装 SideStore 到自己的 iPhone
   （用他自己的 Apple ID）。
2. 安装完成后，SideStore 会常驻在手机上，之后装/刷新 App 不再需要电脑。

## 安装本 App

1. iPhone 上用 Safari 打开上面的 IPA 直链，下载 `daily-todo.ipa`。
2. 打开 **SideStore → 右上角 `+`** → 选择刚下载的 `daily-todo.ipa` → 安装。
3. 首次启动依次授权：
   - 定位：选择**「始终允许」**（后台足迹记录必需）；
   - 动作与健身（Motion & Fitness）：允许（计步必需）。

## 更新到新版本

- CI 每次构建都会覆盖 `ios-latest` 这个 Release。朋友重新下载最新 `daily-todo.ipa`，
  在 SideStore 里对着 App 再装一次即可（保留数据）。
- 只是证书到期、代码没变时，用 SideStore 的**刷新**即可，不必重装。

## 备注

- 这是**内部测试**用的免签名包，不是 App Store 发布。
- 如果以后购买了 Apple 开发者账号，可把 `ios-ipa.yml` 升级为签名 + TestFlight 分发，
  朋友就能直接从 TestFlight 安装、无需 SideStore 和 7 天刷新。
