# DEV_LOG

## 2026-06-23

### 第 1 阶段完成后文档整理

- 更新 `docs/09_第1阶段基础框架和登录权限模块.md`，按当前 NestJS + Prisma + MySQL 主路径重写第 1 阶段状态、接口契约、迁移和 seed、旧 JSON/旧 Node 文件状态、新开发者从零启动步骤，以及第 2 阶段及后续未完成范围。
- 更新 `docs/04_项目目录结构.md`，将原先的未来建议目录改为当前实际目录结构，标注 Flutter、NestJS、Prisma、共享包、旧入口和旧 JSON 仓储的保留状态。
- 更新 `docs/05_数据库初步设计.md`，新增“当前第 1 阶段实际落库状态”，明确当前只迁移 `users`、`system_settings`、`operation_logs`，并补充迁移、seed、旧 JSON 导入命令。
- 更新 `apps/mobile_desktop/README.md`，补充 Flutter 本地运行前置条件、Windows 启动命令、Android/iOS 生成方式、API 地址配置和当前真实接入范围。
- 更新 `docs/10_第2阶段前端UI设计.md`，修正登录页已接真实接口、后端已迁移 NestJS、Windows 平台目录已存在等旧描述。
- 未修改业务代码、迁移 SQL 或测试代码。

### 验证

- 已运行：`cd D:\jiangjiu\server\api`
- 已运行：`npm.cmd test`
- 结果：13 个后端测试全部通过。
- 已运行：`cd D:\jiangjiu\apps\mobile_desktop`
- 已运行：`flutter --version`
- 结果：当前环境未安装 Flutter 或未加入 PATH，PowerShell 提示 `flutter` 命令不可识别，未能执行 Flutter 侧运行验证。

## 2026-06-23

### Flutter analyze info 级提示清理

- 仅修改 `apps/mobile_desktop/lib` 下 Dart 文件，未新增接口、未调整业务逻辑、未重构页面结构。
- 清理 `deprecated_member_use`：将 `withOpacity(...)` 改为 `withValues(alpha: ...)`，将 `surfaceVariant` 改为 `surfaceContainerHighest`，将 `MaterialStatePropertyAll` 改为 `WidgetStatePropertyAll`，并将 `DropdownButtonFormField.value` 改为 `initialValue`。
- 清理 `prefer_const_constructors` / `prefer_const_literals_to_create_immutables`：为静态 `MetricData`、`AppRecordList`、`ResponsiveFormGrid`、`FormSection`、`Wrap`、`Row`、`BorderRadius` 等补充 `const` 上下文。
- 清理 `non_constant_identifier_names`：将登录页私有方法 `_LoginForm()` 改为 `_loginForm()`。
- 清理 `prefer_null_aware_operators`：将搜索框清空按钮回调改为 `controller?.clear`。

### 验证

- 已运行：`cd D:\jiangjiu\apps\mobile_desktop`
- 已运行：`flutter analyze`
- 结果：当前环境未安装 Flutter 或未加入 PATH，PowerShell 提示 `flutter` 命令不可识别，未能在本机完成 Flutter analyzer 复验。
- 已运行：`cd D:\jiangjiu\server\api`
- 已运行：`npm.cmd test`
- 结果：13 个后端测试全部通过。

## 2026-06-23

### Flutter analyze 配置修复

- 仅修改 `apps/mobile_desktop` 相关文件，用于修复 Flutter analyze 的阻塞项。
- 更新 `apps/mobile_desktop/pubspec.yaml`，新增 `dev_dependencies`：
  - `flutter_test` 使用 Flutter SDK 内置测试包。
  - `flutter_lints: ^4.0.0`，匹配项目当前 `sdk: ">=3.3.0 <4.0.0"` 下限，并满足 `analysis_options.yaml` 中 `package:flutter_lints/flutter.yaml` 的引用。
- 更新 `apps/mobile_desktop/test/widget_test.dart`，移除 Flutter 模板默认的 `MyApp`/计数器测试，改为适配当前入口 `JiangjiuApp` 的启动 smoke test；测试使用 `SharedPreferences.setMockInitialValues({})`，避免真实本地存储依赖。
- 未改动业务页面结构和业务功能。

### 验证

- 已运行：`cd D:\jiangjiu\apps\mobile_desktop`
- 已运行：`flutter pub get`
- 结果：当前环境未安装 Flutter 或未加入 PATH，PowerShell 报 `flutter` 命令不可识别，未能执行。
- 已运行：`flutter analyze`
- 结果：当前环境未安装 Flutter 或未加入 PATH，未能执行；按代码层面已补齐 `flutter_lints` 和不适配的 widget test。
- 已运行：`flutter run -d windows`
- 结果：当前环境未安装 Flutter 或未加入 PATH，未能执行。

## 2026-06-23

### 旧 JSON 迁移缺文件跳过逻辑修正

- 更新 `server/api/scripts/migrate-legacy-json.js`：当 `data/users.json`、`data/system-settings.json`、`data/operation-logs.json` 不存在时，不再计入失败；对应模块统计为 `skipped=1`、`failed=0`。
- 缺失文件报告从 `ERROR xxx.json: File not found` 改为 `SKIP xxx.json: File not found`。
- 保持已有 JSON 文件的原迁移逻辑不变：文件存在时继续解析、规范化并按原规则导入或 dry-run。
- 保持 dry-run 不写数据库；本次只调整缺文件读取和报告统计。
- 新增 `server/api/test/migrate-legacy-json.test.js`，覆盖 dry-run 下旧 JSON 文件全部不存在时的 CLI 输出、退出码和统计。

### 验证

- 已运行：`cd D:\jiangjiu\server\api`
- 已运行：`node --check scripts\migrate-legacy-json.js`
- 结果：脚本语法检查通过。
- 已运行：`node --test --require ts-node/register test\migrate-legacy-json.test.js`
- 结果：新增迁移测试通过。
- 已运行：`npm.cmd run migrate:legacy-json -- --dry-run`
- 结果：当前工作区缺少三个旧 JSON 文件时，输出 `SKIP`，三类统计均为 `imported=0, skipped=1, failed=0`，命令退出码为 0。
- 已运行：`npm.cmd test`
- 结果：13 个后端测试全部通过。

### 重新运行命令和期望输出

- 命令：`cd D:\jiangjiu\server\api`
- 命令：`npm.cmd run migrate:legacy-json -- --dry-run`
- 期望核心输出：

```text
DRY RUN - no database writes
Legacy JSON to MySQL migration report
users: imported=0, skipped=1, failed=0
  SKIP users.json: File not found
systemSettings: imported=0, skipped=1, failed=0
  SKIP system-settings.json: File not found
operationLogs: imported=0, skipped=1, failed=0
  SKIP operation-logs.json: File not found
```

## 2026-06-22

### 第 1 阶段完整验证：NestJS + Flutter + MySQL + Prisma

- 测试负责人视角完成第 1 阶段验证梳理，范围覆盖 NestJS 后端契约/e2e、Prisma schema、MySQL migrate/seed 可执行性、旧 JSON 迁移脚本、管理员账号流、品鉴师菜单范围、全局标记查询权限，以及 Flutter 登录/菜单接入静态检查。
- 本轮没有新增功能，也没有发现需要修复的第 1 阶段代码缺陷。

### 测试清单与结果

- 通过：`cd D:\jiangjiu\server\api && npm.cmd run build`
  - 结果：Nest 构建通过。
- 通过：`cd D:\jiangjiu\server\api && npm.cmd run prisma:generate`
  - 结果：Prisma Client 6.19.0 生成成功；Prisma 提示 `package.json#prisma` 在 Prisma 7 将废弃，当前不影响第 1 阶段。
- 通过：`cd D:\jiangjiu\server\api && $env:DATABASE_URL='mysql://jiangjiu_user:change_me@127.0.0.1:3306/jiangjiu'; npx.cmd prisma validate`
  - 结果：`prisma/schema.prisma` 校验通过。
- 通过：`cd D:\jiangjiu\server\api && npm.cmd test`
  - 结果：12 个 Node/Nest 测试全部通过。
  - 覆盖：登录、token 鉴权、当前用户、角色目录、改密、管理员用户管理、非管理员拦截、品鉴师菜单和 dataScope、全局标记查询开关、操作日志过滤、第 0 阶段准备确认接口。
- 通过：临时 smoke/e2e 脚本通过 `withPhase1Server` 启动 Nest HTTP 服务并发起真实 HTTP 请求。
  - 结果：管理员登录、创建账号、停用账号、停用后禁止登录、启用账号、重置密码、重置后登录、品鉴师只返回 `dashboard`/`own_taster_receptions`/`own_commissions`、老板/前台可开启全局标记查询、仓库无权开启、老板无权恢复、管理员可恢复，全部通过。
- 通过：`cd D:\jiangjiu\server\api && node --check scripts\migrate-legacy-json.js`
  - 结果：旧 JSON 迁移脚本语法检查通过。
- 通过：`cd D:\jiangjiu\server\api && npm.cmd run migrate:legacy-json -- --help`
  - 结果：脚本帮助和手动运行参数输出正常。
- 条件失败：`cd D:\jiangjiu\server\api && npm.cmd run migrate:legacy-json -- --dry-run`
  - 结果：脚本按预期输出迁移报告，`users.json`、`system-settings.json`、`operation-logs.json` 均因当前工作区不存在而计入 failed；未删除或覆盖任何 JSON 文件。
- 未能执行：`cd D:\jiangjiu\server\api && $env:DATABASE_URL='mysql://jiangjiu_user:change_me@127.0.0.1:3306/jiangjiu'; npm.cmd run prisma:migrate:deploy`
  - 原因：本机 `127.0.0.1:3306` 未开放，`Test-NetConnection` 显示 `TcpTestSucceeded=False`，且未找到 `mysql` 客户端。
- 未能执行：`cd D:\jiangjiu\server\api && $env:DATABASE_URL='mysql://jiangjiu_user:change_me@127.0.0.1:3306/jiangjiu'; npm.cmd run prisma:seed`
  - 原因：Prisma seed 在 `prisma.user.upsert()` 时报 `Can't reach database server at 127.0.0.1:3306`。
- 通过：`rg "/api/auth/login|/api/auth/me|Authorization|Bearer|shared_preferences|destinationsForBackendMenus|JIANGJIU_API_BASE_URL" apps\mobile_desktop\lib apps\mobile_desktop\pubspec.yaml -n`
  - 结果：Flutter 登录、token、恢复当前用户、服务器地址配置、本地保存和后端菜单映射代码入口均已存在。
- 未能执行：`cd D:\jiangjiu\apps\mobile_desktop && flutter pub get`
  - 原因：当前环境未安装 Flutter，`flutter` 命令不可识别。
- 未能执行：`cd D:\jiangjiu\apps\mobile_desktop && flutter analyze`
  - 原因：当前环境未安装 Flutter。
- 未能执行：`cd D:\jiangjiu\apps\mobile_desktop && flutter run -d windows --dart-define=JIANGJIU_API_BASE_URL=http://127.0.0.1:3000`
  - 原因：当前环境未安装 Flutter。

### 复现命令

- 后端构建：`cd D:\jiangjiu\server\api && npm.cmd run build`
- 后端单元/e2e：`cd D:\jiangjiu\server\api && npm.cmd test`
- Prisma 生成：`cd D:\jiangjiu\server\api && npm.cmd run prisma:generate`
- Prisma schema 校验：`cd D:\jiangjiu\server\api && $env:DATABASE_URL='mysql://<user>:<password>@<host>:3306/<db>'; npx.cmd prisma validate`
- MySQL 迁移：`cd D:\jiangjiu\server\api && $env:DATABASE_URL='mysql://<user>:<password>@<host>:3306/<db>'; npm.cmd run prisma:migrate:deploy`
- Seed：`cd D:\jiangjiu\server\api && $env:DATABASE_URL='mysql://<user>:<password>@<host>:3306/<db>'; npm.cmd run prisma:seed`
- JSON 迁移试跑：`cd D:\jiangjiu\server\api && npm.cmd run migrate:legacy-json -- --dry-run`
- JSON 迁移正式执行：`cd D:\jiangjiu\server\api && npm.cmd run migrate:legacy-json -- --data-dir D:\backup\jiangjiu-data`
- Flutter 依赖：`cd D:\jiangjiu\apps\mobile_desktop && flutter pub get`
- Flutter 静态分析：`cd D:\jiangjiu\apps\mobile_desktop && flutter analyze`
- Flutter Windows 运行：`cd D:\jiangjiu\apps\mobile_desktop && flutter run -d windows --dart-define=JIANGJIU_API_BASE_URL=http://127.0.0.1:3000`

## 2026-06-22

### Flutter 第 1 阶段真实登录接入

- 在 `apps/mobile_desktop/lib/core` 下新增 `api`、`auth`、`storage`、`config` 分层：
  - `core/api/api_client.dart`：封装 JSON HTTP 请求、Bearer token 头、后端 `{ data }` / `{ error }` 响应解析和登录错误映射。
  - `core/auth/auth_models.dart`：定义 `AuthUser`、`AuthMenu`、`AuthSession`，解析后端 `user`、`permissions`、`menus`、`dataScope`。
  - `core/auth/auth_service.dart`：接入 `POST /api/auth/login` 和 `GET /api/auth/me`。
  - `core/auth/auth_controller.dart`：集中管理登录、token 保存、启动恢复、退出登录和错误提示。
  - `core/storage/session_storage.dart`：使用 `shared_preferences` 保存 token 和服务器地址。
  - `core/config/app_config.dart`：提供默认服务器地址，并支持 `--dart-define=JIANGJIU_API_BASE_URL=...`。
- 更新 `apps/mobile_desktop/pubspec.yaml`，新增 `shared_preferences` 依赖。
- 更新登录页：保留现有登录卡片和服务器地址输入，移除原型角色下拉；点击登录时调用真实 `POST /api/auth/login`，失败时显示清晰错误提示。
- 更新 App 启动流程：应用启动后读取本地 token 和服务器地址，若存在 token 则调用 `GET /api/auth/me` 恢复当前用户和菜单；token 失效时清除本地 token 并回到登录页。
- 更新 Shell / Dashboard / RoleMenu 的菜单来源：根据后端返回的 `menus` 映射到当前 Flutter 骨架已有页面入口；未开发旅行团、订单、售后等业务保存逻辑。
- 菜单映射仅暴露当前 UI 骨架已有入口，例如 `travel_groups -> travel_group_form`、`sales_orders -> order_form`、`finance_workspace -> finance_query`、`warehouse_workspace -> warehouse_packing`；第 1 阶段账号、权限、设置、日志类菜单统一映射到现有角色菜单页占位。

### Flutter 运行命令

- 后端启动并可访问后，在客户端目录执行：`cd D:\jiangjiu\apps\mobile_desktop`
- 拉取依赖：`flutter pub get`
- Windows 运行：`flutter run -d windows --dart-define=JIANGJIU_API_BASE_URL=http://127.0.0.1:3000`
- Android 模拟器访问本机后端时通常使用：`flutter run -d android --dart-define=JIANGJIU_API_BASE_URL=http://10.0.2.2:3000`
- 也可以在登录页“服务器地址”输入框手动填写后端地址，登录成功后会保存该地址供下次启动恢复使用。

### 验证

- 已运行：`flutter --version`
- 结果：当前环境未安装 Flutter，无法执行 Flutter 编译、依赖拉取、静态分析和启动验证。
- 已运行：`dart --version`
- 结果：当前环境未安装 Dart，无法执行 `dart format` 或 `flutter analyze`。
- 已运行：`rg "LoginPage\(|AppShell\(|buildPageForDestination\(|DashboardPage\(|RoleMenuPage\(" apps\mobile_desktop\lib -n`
- 结果：已确认登录页、Shell、页面工厂、Dashboard、RoleMenu 调用点均更新为新的真实登录状态入参。
- 范围说明：本次只接登录、token、当前用户和角色菜单，不开发旅行团、订单、售后等业务保存。

## 2026-06-22

### 旧 JSON 状态到 MySQL 一次性迁移

- 新增 `server/api/scripts/migrate-legacy-json.js`，用于手动读取旧 `data/users.json`、`data/system-settings.json`、`data/operation-logs.json` 并导入 MySQL 的 `users`、`system_settings`、`operation_logs`。
- 迁移脚本默认只插入不存在的数据：用户按 `id`/`username` 判重，系统设置按 `setting_key` 判重，操作日志按 `id` 判重，重复执行不会重复插入。
- 用户迁移保留旧 `id`、`username`、`role`、`isActive`、`createdAt`、`updatedAt`，并同步 `name`、`passwordHash`、`phone`、`leaderId`；`leaderId` 会在用户创建后第二阶段回填，避免外键顺序问题。
- 默认不覆盖数据库已有管理员或已有用户；只有显式添加 `--update-existing-users`，且旧 JSON 与数据库记录 `username` 相同时才更新已有用户字段。若同名用户的数据库 `id` 与旧 `id` 不同，脚本保留数据库现有主键并输出 warning。
- 系统设置默认不覆盖已有 `setting_key`；如需用旧 JSON 状态覆盖数据库设置，需要显式添加 `--update-existing-settings`。
- 操作日志为追加型迁移：已存在同 `id` 日志会跳过；日志引用的 `userId` 若不存在，会以 `NULL` 写入外键并输出 warning，避免整批日志因历史脏引用失败。
- 迁移输出报告包含 `users`、`systemSettings`、`operationLogs` 三类的 `imported`、`skipped`、`failed` 统计，并列出错误和 warning。
- 更新 `server/api/package.json`，新增命令：`npm.cmd run migrate:legacy-json`。

### 迁移命令

- 先执行数据库结构迁移：`cd D:\jiangjiu\server\api && npm.cmd run prisma:migrate:deploy`
- 首次试跑不写库：`npm.cmd run migrate:legacy-json -- --dry-run`
- 默认导入旧 JSON：`npm.cmd run migrate:legacy-json`
- 从备份目录导入：`npm.cmd run migrate:legacy-json -- --data-dir D:\backup\jiangjiu-data`
- 明确允许更新同 username 的已有用户和已有设置：`npm.cmd run migrate:legacy-json -- --update-existing-users --update-existing-settings`

### 验证 SQL / 接口方法

- SQL 验证用户：`SELECT id, username, role, is_active, created_at, updated_at FROM users ORDER BY created_at;`
- SQL 验证设置：`SELECT setting_key, setting_value, updated_by, updated_at FROM system_settings ORDER BY setting_key;`
- SQL 验证日志：`SELECT id, user_id, action, entity_type, entity_id, created_at FROM operation_logs ORDER BY created_at;`
- SQL 验证重复执行没有新增：迁移前后分别执行 `SELECT COUNT(*) FROM users;`、`SELECT COUNT(*) FROM system_settings;`、`SELECT COUNT(*) FROM operation_logs;`，第二次迁移后数量应保持不变，除非显式启用更新参数。
- 接口验证登录：`POST /api/auth/login`，请求体 `{ "username": "旧用户名", "password": "旧密码" }`。
- 接口验证用户：管理员 token 请求 `GET /api/users`，确认旧用户可见且角色、启停状态正确。
- 接口验证设置：登录 token 请求 `GET /api/settings/global-mark-query`，确认全局标记查询设置与旧 JSON 一致。
- 接口验证日志：管理员 token 请求 `GET /api/operation-logs`，或追加 `?action=...`、`?entityType=...`、`?userId=...` 过滤。

### 验证

- 已运行：`cd D:\jiangjiu\server\api`
- 已运行：`node --check scripts\migrate-legacy-json.js`
- 已运行：`npm.cmd run migrate:legacy-json -- --help`
- 已运行：`npm.cmd test`
- 结果：12 个后端契约测试全部通过。
- 已运行：`npm.cmd run build`
- 结果：Nest 构建通过。
- 当前工作区没有真实 `server/api/data/users.json`、`server/api/data/system-settings.json`、`server/api/data/operation-logs.json`，因此未对真实 MySQL 执行导入。

## 2026-06-22

### 第 1 阶段：NestJS 业务模块 + Prisma 迁移

- 新增 `server/api/src/modules/auth/auth.module.ts`：注册第 1 阶段登录鉴权控制器和 `AuthNestService`，导入用户与操作日志模块。
- 新增 `server/api/src/modules/users/users.module.ts`：注册用户管理控制器和 `UsersNestService`，通过 `forwardRef` 与 Auth 模块处理鉴权依赖。
- 新增 `server/api/src/modules/settings/settings.module.ts`：注册系统设置控制器和 `SettingsNestService`，保留全局标记查询开关接口。
- 新增 `server/api/src/modules/operation-logs/operation-logs.module.ts`：导出 `OperationLogsNestService`，为第 1 阶段模块提供统一操作日志落库能力。
- 新增 `server/api/src/modules/auth/auth.nest.service.ts`：使用 Prisma 用户数据完成登录、token 校验、当前会话、修改密码、角色目录和管理员校验；继续复用现有 `token.js`、`password.js`、`roles.js`。
- 新增 `server/api/src/modules/users/users.nest.service.ts`：使用 Prisma 读写 `users`，实现管理员创建、查询、修改、启停、重置密码和密码更新。
- 新增 `server/api/src/modules/settings/settings.nest.service.ts`：使用 Prisma 读写 `system_settings`，实现老板/前台/管理员开启全局标记查询、管理员恢复开关。
- 新增 `server/api/src/modules/operation-logs/operation-log.nest.service.ts`：使用 Prisma 写入和查询 `operation_logs`，支持按 `action`、`entityType`、`userId` 过滤。
- 新增 `server/api/src/modules/users/user-role.mapper.ts`：集中维护接口小写角色与 Prisma `UserRole` 枚举之间的映射，避免接口返回 `SALES` 这类数据库枚举值。
- 更新 `server/api/src/app.module.ts`：第 1 阶段 auth、users、settings、operation-logs 改为 Nest 模块提供；仅第 0 阶段准备确认项继续保留旧服务注入。
- 更新第 1 阶段 Nest 控制器：控制器不再注入 legacy token/factory，改为调用对应 Nest service，并保持 `/api` 全局前缀下的原接口路径与响应结构。
- 更新 `server/api/src/common/guards/auth-user.guard.ts`：基础鉴权 Guard 同步切换为 `AuthNestService`，避免后续使用 Guard 时仍依赖 legacy token。
- 更新 `server/api/test/helpers/phase1-api.js`：契约测试通过 `@nestjs/testing` 启动 AppModule，并覆盖 `PrismaService` 为内存 Prisma 替身；测试不连接真实 MySQL，但验证服务层已经按 Prisma API 读写。

### 第 1 阶段接口契约

- `POST /api/auth/login`：请求 `{ username, password }`；成功返回 `{ token, expiresAt, user, permissions, menus, dataScope }`；错误码包含 `LOGIN_FIELDS_REQUIRED`、`INVALID_CREDENTIALS`、`ACCOUNT_DISABLED`。
- `GET /api/auth/me`：请求头 `Authorization: Bearer <token>`；成功返回 `{ user, permissions, menus, dataScope }`；错误码包含 `AUTH_TOKEN_REQUIRED`、`INVALID_AUTH_TOKEN`、`AUTH_USER_NOT_FOUND`、`ACCOUNT_DISABLED`。
- `POST /api/auth/change-password`：请求头 token，请求 `{ currentPassword, newPassword }`；成功返回 `{ user, permissions, menus, dataScope }`；错误码包含 `CURRENT_PASSWORD_INCORRECT`、`WEAK_PASSWORD`。
- `GET /api/auth/roles`：请求头 token；成功返回 `{ roles }`，其中品鉴师保留 `dashboard`、`own_taster_receptions`、`own_commissions` 菜单和 self scope。
- `GET /api/users`：管理员 token；成功返回 `{ users }`；非管理员返回 `ADMIN_REQUIRED`。
- `POST /api/users`：管理员 token，请求 `{ name, username, password, role, phone?, leaderId?, isActive? }`；成功返回 `{ user, permissions, menus }`；错误码包含 `USERNAME_EXISTS`、`INVALID_USERNAME`、`INVALID_ROLE`、`WEAK_PASSWORD`、`ADMIN_REQUIRED`。
- `GET /api/users/:id`：管理员 token；成功返回 `{ user }`；不存在返回 `USER_NOT_FOUND`。
- `PATCH /api/users/:id`：管理员 token，请求 `{ name?, role?, phone?, leaderId?, isActive? }`；成功返回 `{ user }`；错误码包含 `INVALID_ROLE`、`USER_NOT_FOUND`。
- `POST /api/users/:id/disable` 与 `POST /api/users/:id/enable`：管理员 token；成功返回 `{ user }`；管理员禁用自己返回 `CANNOT_DISABLE_SELF`。
- `POST /api/users/:id/reset-password`：管理员 token，请求 `{ newPassword }`；成功返回 `{ user }`；弱密码返回 `WEAK_PASSWORD`。
- `GET /api/settings/global-mark-query`：登录 token；成功返回 `{ settings }`，字段包含 `onlyShowMarkedRecords`、`restoreRequired`、`openedBy`、`openedAt`、`restoredBy`、`restoredAt`、`updatedAt`。
- `POST /api/settings/global-mark-query/enable`：管理员、老板、前台 token；成功返回 `{ settings }`；仓库等无权角色返回 `PERMISSION_DENIED`。
- `POST /api/settings/global-mark-query/restore`：管理员 token；成功返回 `{ settings }`；老板/前台返回 `ADMIN_REQUIRED`。
- `GET /api/operation-logs`：管理员 token；可选 query `action`、`entityType`、`userId`；成功返回 `{ logs }`；非管理员返回 `ADMIN_REQUIRED`。

### 兼容策略

- 密码哈希方案未变化，继续使用现有 `pbkdf2_sha256$...` 格式和 `password.js` 校验逻辑；已有密码无需迁移或重置，seed 也继续使用同一哈希函数。
- Token 方案未切换为新的第三方 JWT 库，继续复用现有 HMAC token helper，避免客户端登录态和接口响应结构发生变化。
- Prisma `UserRole` 在数据库/Client 层使用大写枚举，接口层继续返回既有小写角色字符串，例如 `front_desk`、`sales`。
- 第 1 阶段测试不依赖真实 MySQL；真实环境仍需提供 `.env` 中的 `DATABASE_URL` 后再运行迁移和 seed。

### 验证

- 已运行：`cd D:\jiangjiu\server\api`
- 已运行：`npm.cmd run prisma:generate`
- 结果：Prisma Client 生成成功；Prisma 提示 `package.json#prisma` 在 Prisma 7 将废弃，当前不影响 Prisma 6.19.0。
- 已运行：`$env:DATABASE_URL='mysql://jiangjiu_user:change_me@127.0.0.1:3306/jiangjiu'; npx.cmd prisma validate`
- 结果：schema 校验通过。
- 已运行：`npm.cmd run build`
- 结果：Nest TypeScript 构建通过。
- 已运行：`npm.cmd test`
- 结果：12 个测试全部通过，覆盖管理员权限、老板/前台开启开关、管理员恢复开关、品鉴师 self scope 和操作日志过滤。

### 范围说明

- 本次只迁移第 1 阶段 auth、users、settings、operation-logs。
- 未开发旅行团、订单、售后、提成、统计、AI 等后续业务接口。
- 旧 JS service/repository/password/token/roles 文件仍保留作为兼容参考；其中 password/token/roles 仍被新 Nest service 复用，暂不删除。

## 2026-06-19

### 第 0 阶段：准备和确认

- 新增 `preparation-confirmation` 后端模块，只覆盖准备确认清单、确认状态更新和阶段汇总。
- 新增 10 个确认项，对应 `docs/06_开发阶段计划.md` 中第 0 阶段的待确认事项。
- 新增本地 JSON 状态文件 `server/api/data/preparation-confirmations.json`，用于在未进入数据库阶段前保存确认进度。
- 新增接口文档 `docs/07_第0阶段准备确认模块.md`，包含新增文件作用、接口请求参数和返回结果。
- 新增测试 `server/api/test/preparation-confirmation.test.js`，覆盖列表、更新、汇总、阻塞项和 HTTP 接口。

### 验证

- 已运行：`cd D:\jiangjiu\server\api`
- 已运行：`npm.cmd test`
- 结果：5 个测试全部通过。

### 范围说明

- 未开发登录、权限、旅行团、订单、售后、提成、AI 和 Flutter 页面。
- 未引入数据库和 Prisma，避免提前进入第 1 阶段之后的工作。

## 2026-06-21

### 第 0 阶段：部署准备信息补充

- 根据阿里云 ECS 控制台截图新增 `docs/08_部署准备信息.md`。
- 保存截图附件到 `docs/aliyun/ecs-instance-launch-advisor-20260619.png`。
- 将 `infrastructure-accounts` 确认项更新为 `in_review`，记录云服务器基础信息已收集，域名、Docker、SSH、备份和苹果开发者账号仍待确认。

## 2026-06-22

### 第 1 阶段：基础框架和登录权限

- 发现当前仓库与阶段计划存在差异：文档规划为 NestJS + Flutter + MySQL，但当前实际代码是原生 Node.js HTTP API，且尚未有 Flutter 工程、Prisma Client 依赖和数据库迁移目录。本次未直接重构框架，先沿用现有后端结构实现登录权限基础能力。
- 新增 `auth` 后端模块，支持员工账号密码登录、token 鉴权、当前登录人查询、修改密码、角色权限菜单返回。
- 新增 `users` 后端模块，支持管理员创建、查询、修改、停用、启用员工账号和重置密码。
- 新增 `settings` 后端模块，支持老板、前台、管理员开启全局“只查询已标记信息”开关，只有管理员可恢复。
- 新增 `operation-logs` 后端模块，记录登录、密码修改、账号管理和全局开关操作，并提供管理员查询接口。
- 新增通用 HTTP 和错误工具，减少新增模块中的重复请求解析和响应代码。
- 新增接口文档 `docs/09_第1阶段基础框架和登录权限模块.md`，包含新增文件作用、接口请求参数、返回结果和测试方法。
- 新增测试 `server/api/test/auth-users-settings.test.js`，覆盖登录、账号管理、品鉴师菜单范围、非管理员权限拦截、全局标记开关和操作日志。

### 验证

- 已运行：`cd D:\jiangjiu\server\api`
- 已运行：`npm.cmd test`
- 结果：9 个测试全部通过。

### 范围说明

- 未开发 Flutter 登录页面，因为当前仓库还没有 Flutter 客户端工程；本次只提供客户端登录所需后端接口、角色菜单和数据范围。
- 未接入 MySQL 运行时和 Prisma Client，账号、系统设置、操作日志暂存本地 JSON；正式数据库接入时应迁移到 `users`、`system_settings`、`operation_logs`。
- 未开发旅行团、订单、售后、提成、统计、AI 等后续阶段接口。

### 第 1 阶段：接口契约测试整理

- 新增 `server/api/test/helpers/phase1-api.js` 测试辅助文件，统一创建隔离测试服务、发起 JSON 请求、登录管理员、创建测试用户，并提供会话、当前用户、公开用户、系统设置、操作日志和错误响应的契约断言。
- 重写 `server/api/test/auth-users-settings.test.js` 为第 1 阶段接口契约测试，固定登录、当前用户、角色菜单、修改密码、用户管理、全局标记开关和操作日志接口的路径、请求参数、返回结构、状态码和错误码。
- 覆盖稳定错误码：`LOGIN_FIELDS_REQUIRED`、`INVALID_CREDENTIALS`、`AUTH_TOKEN_REQUIRED`、`INVALID_AUTH_TOKEN`、`CURRENT_PASSWORD_INCORRECT`、`WEAK_PASSWORD`、`USERNAME_EXISTS`、`INVALID_ROLE`、`ACCOUNT_DISABLED`、`ADMIN_REQUIRED`、`PERMISSION_DENIED`。
- 发现文档与现有接口有一处轻微差异：`POST /api/auth/change-password` 文档示例中的 `permissions`、`menus`、`dataScope` 写为空，但现有接口返回完整当前会话结构。此次未修改业务实现，契约测试按现有接口行为固定。

### 验证

- 已运行：`cd D:\jiangjiu\server\api`
- 已运行：`npm.cmd test`
- 结果：12 个测试全部通过。

### 范围说明

- 未修改第 1 阶段业务实现代码。
- 未迁移 NestJS，未接入 MySQL。
- 未改动旅行团、订单、售后、提成、统计、AI 等后续阶段范围。

### 第 2 阶段：前端 UI 设计

- 新增 Flutter 客户端骨架 `apps/mobile_desktop`，包含 `main.dart`、App 入口、主题、导航目标、页面工厂和响应式 Shell。
- 新增共享 Dart 包 `packages/shared`，集中维护角色、角色菜单、订单状态、配送方式、打包状态、售后状态、物流方式、团型、日期预设和金额/日期格式化。
- 实现登录页、首页、角色菜单、旅行团录入、订单录入、二维码销售单、品鉴师接待总结、财务查询、库管打包、售后开单、数据分析和 AI 助手页面骨架。
- 抽出通用组件：响应式布局、通用列表、搜索、筛选、日期范围选择、状态标签、金额显示、表单区块、空状态、加载态、错误态和指标卡片。
- 页面已处理手机端单列/抽屉导航和 Windows 端侧边导航/双栏布局差异。
- 新增阶段说明文档 `docs/10_第2阶段前端UI设计.md`，记录页面覆盖、组件清单、适配方式、运行方式和当前限制。

### 验证

- 已运行：`flutter --version`
- 结果：当前环境未安装 Flutter，无法运行 Flutter 客户端编译、分析和启动验证。
- 已运行：`dart --version`
- 结果：当前环境未安装 Dart，无法运行 Dart 格式化和静态分析。
- 已运行：`rg --files apps\mobile_desktop packages\shared`
- 结果：Flutter 客户端和共享包文件已创建。
- 已运行：`cd D:\jiangjiu\server\api`
- 已运行：`npm.cmd test`
- 结果：后端既有 9 个测试全部通过。

### 范围说明

- 本次只做第 2 阶段 UI 页面骨架和设计系统，不实现旅行团、订单、售后、财务、统计、AI 的真实接口和业务逻辑。
- 二维码销售单页面仅提供预览和二维码占位，真实二维码生成留到第 5 阶段。
- 数据分析和 AI 助手仅提供页面路径和假数据展示，真实统计与 AI 查询留到第 8、9 阶段。

### NestJS + TypeScript 基础框架升级

- 新增 NestJS 基础配置：`server/api/nest-cli.json`、`server/api/tsconfig.json`、`server/api/tsconfig.build.json`、`server/api/src/main.ts`、`server/api/src/app.module.ts`。
- 更新 `server/api/package.json`，新增 `build`、`start`、`start:dev`、`start:legacy` 和 TypeScript 测试启动方式；新增 NestJS、TypeScript、ts-node 等依赖，并生成 `package-lock.json`。
- 新增 `server/api/.gitignore`，忽略 `node_modules/` 和 `dist/`。
- 建立 common 层骨架：统一异常过滤器、统一响应拦截器、基础鉴权 Guard、角色 Guard、请求校验 Pipe、请求 IP 工具。
- 新增 Nest 控制器适配层：`auth.nest.controller.ts`、`users.nest.controller.ts`、`settings.nest.controller.ts`、`operation-log.nest.controller.ts`、`preparation-confirmation.nest.controller.ts`。
- 保留旧原生 Node HTTP 实现作为参考：`src/main.js`、`src/app.js` 和旧 `*.controller.js` 均未删除；新增 Nest 控制器复用现有 JS service/repository，未迁移业务表，未接 MySQL。
- 保留 `/api` 全局前缀，现有第 0 阶段和第 1 阶段接口路径继续通过 Nest 应用暴露。
- 调整测试辅助启动器，契约测试现在通过 `NestFactory.create(AppModule)` 启动 Nest HTTP 服务，不再通过旧 `createApp()` 启动。

### 验证

- 已运行：`cd D:\jiangjiu\server\api`
- 已运行：`npm.cmd install`
- 结果：依赖安装成功；npm audit 提示 20 个漏洞，后续可单独处理依赖审计。
- 已运行：`npm.cmd run build`
- 结果：Nest 构建通过。
- 已运行：`npm.cmd test`
- 结果：12 个测试全部通过。

### 旧文件后续清理建议

- Nest 路由稳定后，可以删除旧启动和聚合入口：`server/api/src/main.js`、`server/api/src/app.js`。
- Nest 控制器稳定后，可以删除旧 HTTP 控制器：`auth.controller.js`、`users.controller.js`、`settings.controller.js`、`operation-log.controller.js`、`preparation-confirmation.controller.js`。
- 暂时不要删除现有 JS service/repository/password/token/roles 文件，因为 Nest 控制器目前仍复用这些业务实现以避免重写逻辑。

### 范围说明

- 本次只处理 NestJS + TypeScript 基础框架和现有接口适配。
- 未开发旅行团、订单、售后、提成、AI。
- 未接入 MySQL，未迁移 Prisma 业务表。

### Prisma + MySQL 第 1 阶段接入

- 发现并处理 schema 设计边界问题：原 `prisma/schema.prisma` 包含旅行团、订单、售后、提成、AI 等后续业务模型和外键关系，若直接迁移会一次性创建后续业务表；本次按第 1 阶段要求裁剪为最小 schema，只保留 `UserRole`、`User`、`SystemSetting`、`OperationLog`。
- 新增 `PrismaModule` 和 `PrismaService`，为 NestJS 后端提供统一 Prisma Client 注入点。
- 新增 Prisma 仓储适配层：`users.prisma.repository.ts`、`settings.prisma.repository.ts`、`operation-log.prisma.repository.ts`，在有 `DATABASE_URL` 且未设置 `USE_JSON_STORE=true` 时使用 MySQL；测试环境继续显式使用 JSON 存储。
- 新增第 1 阶段最小迁移：`prisma/migrations/20260622000100_phase1_auth_settings_logs/migration.sql`，只创建 `users`、`system_settings`、`operation_logs`。
- 新增 `prisma/migrations/migration_lock.toml`，锁定迁移 provider 为 MySQL。
- 新增 `.env.example`，提供 `DATABASE_URL` 和 `AUTH_TOKEN_SECRET` 示例，不包含真实密码。
- 新增 `prisma/seed.ts`，创建默认管理员 `admin`、默认系统设置 `only_show_marked_records=false`、`marked_records_restore_required=false`，并写入一条 seed 操作日志。
- 更新 `package.json`，新增 Prisma 命令：`prisma:generate`、`prisma:migrate:dev`、`prisma:migrate:deploy`、`prisma:seed`。
- Prisma 版本固定为 6.19.0，原因是 Prisma 7 不再支持在 `schema.prisma` 中配置 `datasource.url`，与当前项目文档中的 `DATABASE_URL` 方式不匹配。

### 验证

- 已运行：`cd D:\jiangjiu\server\api`
- 已运行：`npm.cmd run prisma:generate`
- 结果：Prisma Client 生成成功。
- 已运行：`$env:DATABASE_URL='mysql://jiangjiu_user:change_me@127.0.0.1:3306/jiangjiu'; npx.cmd prisma validate`
- 结果：schema 校验通过。
- 已运行：`npm.cmd run build`
- 结果：Nest 构建通过。
- 已运行：`npm.cmd test`
- 结果：12 个测试全部通过。

### 迁移和 seed 命令

- 开发环境迁移：`npm.cmd run prisma:migrate:dev -- --name phase1_auth_settings_logs`
- 生产或部署环境迁移：`npm.cmd run prisma:migrate:deploy`
- 生成 Prisma Client：`npm.cmd run prisma:generate`
- 初始化默认管理员和系统设置：`npm.cmd run prisma:seed`

### 回滚注意事项

- Prisma migrate 没有自动 down migration；如需回滚第 1 阶段迁移，应先备份数据库，再按依赖顺序删除外键和表：`operation_logs`、`system_settings`、`users`。
- 如果数据库已经写入真实账号或操作日志，不要直接 drop 表；应先导出数据或新建反向 SQL 并经人工确认。
- 后续阶段新增业务表时，不要把完整业务 schema 一次性恢复进迁移，应按阶段逐步添加。

### 范围说明

- 本次只接入第 1 阶段数据库能力：`users`、`system_settings`、`operation_logs`。
- 未创建旅行团、订单、售后、提成、AI 等后续业务表。
- 未写入真实数据库密码，`.env.example` 仅提供占位示例。
