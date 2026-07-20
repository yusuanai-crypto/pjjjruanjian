# Jiangjiu Flutter Client

Flutter 手机和 Windows 客户端。当前已完成第 2 阶段 UI 骨架，并接入登录、会话恢复、后端菜单、全局标记查询开关和一部分业务 API。

## 当前状态

- 登录页调用后端 `/api/auth/login`。
- App 启动时读取本地 token，并调用 `/api/auth/me` 恢复会话。
- 登录成功后，菜单来自后端返回的 `menus`，再由 `destinations.dart` 映射到 Flutter 页面。
- 服务器地址和 token 使用 `shared_preferences` 保存在本机。
- Shell 顶部的全局标记查询开关调用 `/api/settings/global-mark-query`、`/enable`、`/restore`。
- 旅行团录入页已调用 `/api/travel-groups` 读取和创建旅行团，标记按钮调用 `/api/travel-groups/:id/finance-mark`。
- 旅行团待处理状态统一在“旅行团管理”中筛选和查看，兼容接口 `/api/pending-travel-groups` 继续保留。
- 订单录入页已调用 `/api/sales-orders` 保存订单；暂存为本页本地草稿，历史客户和酒品明细仍是页面内数据。
- 订单管理页已调用 `/api/sales-orders` 读取订单，标记按钮调用 `/api/sales-orders/:id/finance-mark`。
- 订单绑定与离店备注页已读取后端旅行团和订单，并通过 `PATCH /api/travel-groups/:id` 保存离店时间和备注；订单勾选绑定仍是本地交互。
- 财务查询页已调用 `/api/finance/overview`；对账表已调用 `/api/reconciliations/:businessDate` 读取和保存。
- 首页指标和待办、旅行团管理、积分表、二维码销售单、我的接待、库管打包、售后开单、数据分析、AI 助手仍是 UI 骨架或假数据。

## 本地运行前置条件

- 已安装 Flutter SDK 3.3+。
- 已启用对应平台，例如 Windows 桌面开发。
- 后端 NestJS API 已启动，默认地址为 `http://127.0.0.1:3000`。

后端启动参考：

```powershell
cd D:\jiangjiu\server\api
npm.cmd install
npm.cmd run prisma:generate
npm.cmd run prisma:migrate:deploy
npm.cmd run prisma:seed
npm.cmd run start:dev
```

## Windows 本地运行

```powershell
cd D:\jiangjiu\apps\mobile_desktop
flutter pub get
flutter run -d windows --dart-define=JIANGJIU_API_BASE_URL=http://127.0.0.1:3000
```

登录默认值：

| 字段 | 值 |
| --- | --- |
| 账号 | `admin` |
| 密码 | 部署人员通过 `SEED_ADMIN_PASSWORD` 设置的管理员密码 |
| 服务器地址 | `http://127.0.0.1:3000` |

登录页可以手动修改服务器地址；修改后登录成功会保存该地址。

## Android 或 iOS

当前仓库已包含 Windows 平台目录，未提交 Android/iOS 平台目录。需要移动端调试时先生成对应平台：

```powershell
cd D:\jiangjiu\apps\mobile_desktop
flutter create . --platforms=android,ios
flutter pub get
```

Android 模拟器访问宿主机后端通常使用：

```powershell
flutter run -d android --dart-define=JIANGJIU_API_BASE_URL=https://10.0.2.2:3000
```

真机调试应把服务器地址改为电脑或服务器在同一局域网内可访问的 IP，例如：

```text
https://192.168.1.20:3000
```

## 常用检查

```powershell
cd D:\jiangjiu\apps\mobile_desktop
flutter analyze
flutter test
```

## Transport and secure session storage

- Release and profile builds accept only HTTPS API base URLs. Debug/test builds
  may use HTTP only with `localhost`, `127.0.0.0/8`, or `::1`; emulator aliases
  and LAN addresses still require HTTPS.
- API addresses without a scheme are normalized to `https://`.
- Bearer tokens are stored with `flutter_secure_storage` (Android Keystore,
  iOS Keychain, and Windows Credential Manager/DPAPI-backed storage).
  `SharedPreferences` retains only non-secret settings such as the API base
  URL.
- Android requires API 23 or newer for the selected secure-storage version.
  Auto Backup is disabled so encrypted values are not restored without their
  Keystore key. Release cleartext traffic is disabled in the manifest.
- iOS Runner configurations include the Keychain entitlement and retain ATS
  without arbitrary-load exceptions.
- Windows builds require the C++ ATL optional component in Visual Studio Build
  Tools for `flutter_secure_storage`.

## 范围说明

- 当前真实接入的业务能力集中在旅行团录入与管理、订单录入、订单管理、财务概览、对账表和全局标记查询开关。
- 订单录入表单已调用 `BusinessApi.createSalesOrder`，但完整商品选择、订单绑定旅行团和持久化草稿仍待后续阶段补齐。
- 二维码生成、AI 查询、导出、售后、库管、提成、完整统计分析和独立客户库留给后续阶段。
- 金额展示使用“分”作为输入单位，统一通过 `packages/shared` 格式化。
