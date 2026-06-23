# Jiangjiu Flutter Client

Flutter 手机和 Windows 客户端。当前已完成第 2 阶段 UI 骨架，并接入第 1 阶段登录接口。

## 当前状态

- 登录页调用后端 `/api/auth/login`。
- App 启动时读取本地 token，并调用 `/api/auth/me` 恢复会话。
- 登录成功后，菜单来自后端返回的 `menus`。
- 服务器地址和 token 使用 `shared_preferences` 保存在本机。
- 旅行团、订单、二维码销售单、品鉴师总结、财务、库管、售后、数据分析、AI 助手等页面仍是 UI 骨架和假数据。

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
| 密码 | `Admin@123456` |
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
flutter run -d android --dart-define=JIANGJIU_API_BASE_URL=http://10.0.2.2:3000
```

真机调试应把服务器地址改为电脑或服务器在同一局域网内可访问的 IP，例如：

```text
http://192.168.1.20:3000
```

## 常用检查

```powershell
cd D:\jiangjiu\apps\mobile_desktop
flutter analyze
flutter test
```

## 范围说明

- 当前只真实接入登录和会话恢复。
- 业务保存、真实列表查询、二维码生成、AI 查询、导出等逻辑留给后续阶段。
- 金额展示使用“分”作为输入单位，统一通过 `packages/shared` 格式化。
