# 第 9 阶段 AI 数据助手 Schema/配置/代码差距清单

生成日期：2026-07-04

本清单根据 `docs/35_第9阶段AI数据助手开发文档.md`，并对照 `server/api/prisma/schema.prisma`、`server/api/src`、`apps/mobile_desktop/lib` 生成。当前只做本地文档差距确认，不修改 `schema.prisma`，不生成 migration，不编写 AI 业务代码。

## 1. 巡检结论

| 检查项 | 当前状态 | 结论 |
| --- | --- | --- |
| `AiChatMessage` / `ai_chat_messages` | `schema.prisma` 中未发现 model 或 table 映射 | 缺失 |
| `User` 与 AI 对话记录外键 | `User.id` 为 `String @db.Char(36)`，可作为 `AiChatMessage.userId` 外键；但 `User` 尚无 `aiChatMessages` 反向关系字段 | 可支持，需补 relation |
| AI module/controller/service | `server/api/src/modules` 下没有 `ai` 目录，`AppModule` 未挂载 AI 模块 | 缺失 |
| AI 配置/mock/超时/env 读取 | 未发现 `AI_ENABLED`、`AI_MOCK_MODE`、`AI_PROVIDER`、`AI_TIMEOUT_MS` 等读取 | 缺失 |
| 统一角色权限 helper | 有 `auth/roles.js` 角色菜单/权限定义，业务 service 内也有多处 `requireAnyRole`；但没有统一可注入、可复用的 AI policy helper | 部分具备，需抽象 |
| 全局标记过滤 helper | `analytics/analytics-scope.helper.ts` 已导出客户、旅行团、订单、售后标记过滤 helper，并被 business-data、customers、commissions 复用 | 已有可复用基础 |
| 第 6 阶段只读接口 | 售后、财务、库管、订单查询已有 GET 接口和 service 方法 | 可复用，只能走读接口/服务方法 |
| 第 7 阶段只读接口 | 提成记录、旅行团返积分汇总、规则 GET 已有；重算、确认、手工录入为写操作 | 可复用 GET，禁止复用写接口 |
| 第 8 阶段 analytics/ranking | 当前本地代码已有 analytics module/controller/service/helper/API 和 Flutter BusinessApi 方法；但云端第 8 阶段仍未闭环 | 本地可复用，云端受阻 |
| Flutter AI 页面/API | `ai_assistant_page.dart` 仍是本地占位消息；`BusinessApi` 无 AI 方法 | 缺失 |

## 2. 当前已有 Schema 基础

### 2.1 用户与角色

`User` 已有：

- `id String @id @default(uuid()) @db.Char(36)`。
- `role UserRole`，枚举包含 `admin`、`boss`、`front_desk`、`sales`、`finance`、`warehouse`、`after_sales`、`taster`。
- 已与操作日志、旅行团、订单、售后、提成记录等建立多组关系。

结论：`User` 能作为 `AiChatMessage.userId` 的外键目标。新增 AI 对话记录时建议同步在 `User` 上增加反向关系字段，避免 Prisma relation 校验失败或关系不完整。

### 2.2 全局标记相关字段

当前已落库字段包括：

- `SystemSetting.settingKey/settingValue`，用于保存 `only_show_marked_records` 等全局开关。
- `TravelGroup.financeMark`、`Customer.financeMark`、`SalesOrder.financeMark`。
- `SalesOrder.customerId`、`SalesOrder.travelGroupId` 可用于通过客户和旅行团过滤订单。
- `AfterSalesOrder.salesOrderId` 可用于通过订单作用域过滤售后。
- `CommissionRecord.salesOrderId`、`CommissionRecord.travelGroupId`、`TravelGroupFinanceSummary.travelGroupId` 可用于提成/积分作用域过滤。

当前已有索引包括：

- `travel_groups`: `financeMark`、`visitDate`、`visitDate + financeMark`。
- `customers`: `financeMark`。
- `sales_orders`: `financeMark`、`orderDate`、`status`、`orderDate + status`、`travelGroupId + status`。
- `after_sales_orders`: `salesOrderId`、`financeConfirmed`、`status + createdAt`、`financeConfirmed + createdAt`、`salesOrderId + financeConfirmed`。
- `commission_records`: `targetType + targetUserId + createdAt`、`travelGroupId + targetType` 等。

## 3. 缺失的 AI 对话记录表

当前 `schema.prisma` 没有：

- `model AiChatMessage`。
- `@@map("ai_chat_messages")`。
- `User.aiChatMessages` 或等价反向关系字段。
- 对话按用户、会话、意图、创建时间查询所需索引。

建议第一版新增 model：

```prisma
model AiChatMessage {
  id               String   @id @default(uuid()) @db.Char(36)
  conversationId   String?  @map("conversation_id") @db.VarChar(64)
  userId           String   @map("user_id") @db.Char(36)
  userRole         String   @map("user_role") @db.VarChar(32)
  question         String   @db.Text
  answer           String   @db.Text
  intent           String?  @db.VarChar(64)
  dataScope        Json?    @map("data_scope")
  toolCalls        Json?    @map("tool_calls")
  sourceSummary    Json?    @map("source_summary")
  warnings         Json?
  modelProvider    String?  @map("model_provider") @db.VarChar(64)
  modelName        String?  @map("model_name") @db.VarChar(128)
  promptTokens     Int?     @map("prompt_tokens")
  completionTokens Int?     @map("completion_tokens")
  latencyMs        Int?     @map("latency_ms")
  errorCode        String?  @map("error_code") @db.VarChar(64)
  createdAt        DateTime @default(now()) @map("created_at") @db.DateTime(0)

  user User @relation("AiChatMessageUser", fields: [userId], references: [id], onDelete: Restrict)

  @@index([userId, createdAt])
  @@index([conversationId, createdAt])
  @@index([intent, createdAt])
  @@map("ai_chat_messages")
}
```

同时建议在 `User` 中增加：

```prisma
aiChatMessages AiChatMessage[] @relation("AiChatMessageUser")
```

说明：

- `userRole` 保存提问时角色快照，避免后续用户角色变化后无法审计当时回答口径。
- `toolCalls` 只保存工具名、参数摘要、行数、耗时和过滤状态，不保存原始 SQL、数据库连接串或大量原始数据。
- `sourceSummary` 优先保存脱敏摘要和业务 id，不保存完整手机号、地址等敏感信息。
- `onDelete: Restrict` 更适合审计记录；现有系统一般通过 `isActive` 停用用户，而不是物理删除用户。

## 4. 建议环境变量

当前代码未读取以下 AI 配置。建议第 9 阶段新增集中配置读取，且本地默认 mock：

| 环境变量 | 建议默认值 | 当前状态 | 用途 |
| --- | --- | --- | --- |
| `AI_ENABLED` | `false` | 缺失 | 控制 AI 入口是否启用 |
| `AI_MOCK_MODE` | `true` | 缺失 | 本地无外部供应商时走 mock |
| `AI_PROVIDER` | 空 | 缺失 | 供应商标识 |
| `AI_API_KEY` | 空 | 缺失 | 只从环境变量读取，不入库 |
| `AI_BASE_URL` | 空 | 缺失 | 供应商网关地址 |
| `AI_MODEL` | 空 | 缺失 | 模型名 |
| `AI_TIMEOUT_MS` | `20000` | 缺失 | 模型调用超时 |
| `AI_MAX_QUESTION_LENGTH` | `500` | 缺失 | 用户问题长度限制 |
| `AI_DAILY_LIMIT_PER_USER` | `100` | 缺失 | 用户级限流 |
| `AI_HISTORY_RETENTION_DAYS` | `180` | 缺失 | 对话记录保留策略 |

配置风险：

- Nest 入口目前主要直接读取 `process.env.PORT` 等基础变量，未见统一配置模块。
- `dotenv` 依赖存在，但运行入口未统一加载 AI 配置；seed/scripts 有 `dotenv/config`。
- Flutter 端不应出现任何 AI API Key 或供应商配置。

## 5. 后端模块差距

当前已有：

- `AuthModule`、`SettingsModule`、`BusinessDataModule`、`CommissionsModule`、`AnalyticsModule` 等。
- `AnalyticsModule` 已挂载到 `AppModule`。
- `AuthNestService.authenticateRequest` 可获取登录用户。
- `SettingsNestService.getGlobalMarkQuery()` 可读取 `onlyShowMarkedRecords`。
- `analytics/analytics-scope.helper.ts` 可复用全局标记过滤 where。

当前缺失：

- `server/api/src/modules/ai/`。
- `AiModule`、`AiController`、`AiService`。
- `POST /api/ai/chat`。
- `GET /api/ai/chat/templates`。
- `GET /api/ai/chat/history`。
- `GET /api/ai/capabilities`。
- AI 专用 DTO、问题长度校验、空问题校验、限流、超时、mock/fallback。
- `AiPolicyService`：集中控制 admin/boss/finance/after_sales 的可用能力和越权拒绝。
- `AiToolsService`：白名单只读工具注册，不允许模型动态生成 SQL 或工具。
- `AiIntentService`：规则优先的意图识别、时间范围解析、修改/SQL 类请求拒绝。
- `AiModelClient`：供应商调用封装和 mock 模式。
- `AiPromptBuilder` / `AiResponseFormatter`：来源摘要、warnings、时间范围、数据口径统一输出。
- AI 后端测试：权限、全局标记过滤、mock、超时、写请求拒绝、对话记录写入等。

## 6. 权限与标记过滤复用情况

### 6.1 角色权限

已有基础：

- `auth/roles.js` 定义角色、菜单、权限和数据范围说明。
- 各业务 service 使用 `requireAnyRole(actor, [...])` 做角色门禁。
- `AuthUserGuard`、`RolesGuard` 存在，但当前 controller 多数直接调用 `authService.authenticateRequest(request)`，并在 service 内做角色校验。

缺口：

- `requireAnyRole` 在多个 service 内重复定义，不是统一导出的 helper。
- AI 需要的不只是“能访问某接口”，还要按意图区分：经营建议仅 admin/boss；财务提成仅 admin/boss/finance；售后客户订单仅 admin/after_sales/finance/boss 中的受控范围。
- 后端 role menu 当前只给 admin、boss 下发 `ai_assistant`，finance、after_sales 尚未加入第 9 阶段建议的 AI 第一版入口。

建议：

- 新增 `AiPolicyService` 或通用 `policy` helper，封装 `canUseAi(role)`、`canUseIntent(role, intent)`、`scopeDescription(role)`。
- 第一版 AI 只开放 admin、boss、finance、after_sales。
- AI 工具内部再次调用原业务 service 或统一作用域 helper，不能只依赖 controller 层判断。

### 6.2 全局标记过滤

已有可复用 helper：

- `buildGlobalCustomerMarkScope(onlyShowMarkedRecords)`。
- `buildGlobalTravelGroupMarkScope(onlyShowMarkedRecords)`。
- `buildGlobalSalesOrderMarkScope(onlyShowMarkedRecords)`。
- `buildGlobalAfterSalesOrderMarkScope(onlyShowMarkedRecords)`。
- `buildAnalyticsSalesOrderWhere`、`buildAnalyticsTravelGroupWhere`、`buildAnalyticsAfterSalesOrderWhere`。

已复用位置：

- `BusinessDataNestService` 用于订单、旅行团、售后、财务、库管。
- `CustomersNestService` 用于客户查询。
- `CommissionRecordsNestService` 用于提成记录。
- `TravelGroupFinanceSummaryNestService` 用于旅行团返积分汇总。
- `AnalyticsNestService` 用于 overview、ranking、detail、source、trends、export。

缺口：

- helper 放在 `modules/analytics` 下，语义上已是跨模块公共能力，但目录归属容易让 AI 模块依赖 analytics 模块内部路径。
- AI 实现前建议将其保持导出稳定，或后续移动到 `common/scopes` 一类位置时同步更新导入。

## 7. 第 6 阶段可被 AI 只读复用的接口

可复用为 AI 只读工具的路径：

| AI 工具方向 | 可复用接口/方法 | 角色现状 | 备注 |
| --- | --- | --- | --- |
| `customer.orderLookup` | `GET /api/sales-orders`、`GET /api/sales-orders/:id`、`BusinessDataNestService.listSalesOrders/getSalesOrder` | admin/boss/sales/finance/warehouse/after_sales 读 | AI 应限制返回字段和条数，脱敏手机号/地址 |
| `customer.lookup` | `GET /api/customers`、`GET /api/customers/:id`、`CustomersNestService.listCustomers/getCustomer` | admin/boss/sales/finance/after_sales 读 | 可按姓名、电话、客户 id 查询 |
| `afterSales.lookup` | `GET /api/after-sales-orders`、`GET /api/after-sales-orders/:id` | admin/boss/finance/after_sales/sales 读 | 售后历史、退款状态、问题类型 |
| `refund.query` | `GET /api/finance/overview`、`GET /api/finance/workbench`、售后 GET | admin/boss/finance 读 | 已确认/待确认退款、净销售额 |
| `finance.summary` | `GET /api/finance/overview`、`GET /api/finance/workbench` | admin/boss/finance 读 | 物流费、待开票、待标记、待确认售后 |
| `logistics.lookup` | `GET /api/warehouse/orders`、订单 GET | admin/boss/warehouse 读 | 第 9 阶段第一版 warehouse 默认不开放；boss/admin 可用于物流查询 |
| `reconciliation.lookup` | `GET /api/reconciliations/:businessDate` | 需按现有 service 权限 | 可用于财务核对，但不是第 9 文档核心第一批工具 |

不应复用为 AI 工具的路径：

- `POST /api/after-sales-orders`。
- `PATCH /api/after-sales-orders/:id`、`:id/status`、`:id/finance-confirm`。
- `PATCH /api/sales-orders/:id/finance`、`:id/packing`、`:id/status`、`:id/finance-mark`。
- `PATCH /api/warehouse/orders/:id/packing`。
- 任何会修改订单、售后、客户、旅行团标记、财务字段、库管字段或写操作日志的路径。

## 8. 第 7 阶段可被 AI 只读复用的接口

可复用为 AI 只读工具的路径：

| AI 工具方向 | 可复用接口/方法 | 角色现状 | 备注 |
| --- | --- | --- | --- |
| `commission.query` | `GET /api/commission-records`、`GET /api/commission-records/:id` | admin/finance/boss 读 | 销售/外联/组长/品鉴师提成和旅行社返积分记录 |
| `commission.self` | `GET /api/commission-records/me` | taster 本人 | 第 9 第一版 taster 默认不开放 AI，可后续扩展 |
| `travelGroup.financeSummary` | `GET /api/travel-group-finance-summaries`、`GET /api/travel-group-finance-summaries/:travelGroupId` | admin/finance/boss 读 | 旅行团返积分、扣酒成本、已返/未返 |
| `commission.ruleExplain` | `GET /api/commission-rules`、`GET /api/sales-deduction-rules`、`GET /api/agency-deduction-rules`、`GET /api/agency-rebate-rules` | admin/finance/boss 读 | 仅用于解释规则摘要，避免暴露过多规则明细 |

不应复用为 AI 工具的路径：

- `POST /api/commission-records/recalculate` 或任何重算入口。
- `PATCH /api/commission-records/:id/manual-amount`。
- `PATCH /api/commission-records/:id/confirm`。
- `POST /api/travel-group-finance-summaries/:travelGroupId/refresh`。
- `PATCH /api/travel-group-finance-summaries/:travelGroupId`。
- `PATCH /api/travel-group-finance-summaries/:travelGroupId/agency-deduction-confirm`。
- 规则新增、修改、批量导入接口。
- 导出接口不建议作为 AI 工具；导出会生成文件并写导出日志，AI 应使用受限列表/详情结果。

## 9. 第 8 阶段可被 AI 只读复用的接口

当前本地代码已有 `AnalyticsModule`，与 `docs/33_第8阶段数据分析和品鉴师排名Schema差距清单.md` 中“尚无 analytics module”的旧状态不同。第 37 阶段清单以当前代码为准。

可复用为 AI 只读工具的路径：

| AI 工具方向 | 可复用接口/方法 | 角色现状 | 备注 |
| --- | --- | --- | --- |
| `analytics.overview` | `GET /api/analytics/overview`、`AnalyticsNestService.getOverview` | admin/boss/finance 读 | 销售额、退款、净销售额、接待、打蛋率、warnings |
| `analytics.trends` | `GET /api/analytics/trends` | admin/boss/finance 读 | 日/月趋势，适合经营解释 |
| `analytics.tasterRankings` | `GET /api/analytics/taster-rankings` | admin/boss/finance 读 | 品鉴师排名、打蛋率、销售额 |
| `analytics.tasterDetail` | `GET /api/analytics/taster-rankings/:tasterId` | admin/boss/finance 读 | 品鉴师详情和来源明细 |
| `analytics.source.orders` | `GET /api/analytics/source/orders` | admin/boss/finance 读 | 追溯订单来源，AI 需限制字段 |
| `analytics.source.travelGroups` | `GET /api/analytics/source/travel-groups` | admin/boss/finance 读 | 追溯旅行团和无有效订单团 |
| `analytics.source.afterSales` | `GET /api/analytics/source/after-sales` | admin/boss/finance 读 | 追溯售后退款来源 |

不建议复用为 AI 工具的路径：

- `GET /api/analytics/overview/export`。
- `GET /api/analytics/taster-rankings/export`。

原因：导出接口返回文件、可能写 `operation_logs`，不适合自然语言问答链路。

## 10. Flutter 缺口

当前已有：

- `apps/mobile_desktop/lib/features/ai_assistant/ai_assistant_page.dart`。
- `apps/mobile_desktop/lib/app/destinations.dart` 中有 `ai_assistant` 入口定义。
- `apps/mobile_desktop/lib/app/page_factory.dart` 可路由到 `AiAssistantPage`。
- `BusinessApi` 已有第 6、7、8 阶段大量方法，包括 finance、after-sales、warehouse、commission、analytics。

当前缺失：

- `AiAssistantPage` 构造函数没有 `apiClient`、`token`、`role` 参数。
- 页面内 `_messages` 是固定本地假消息。
- 发送问题时只是追加固定占位回复，没有调用后端。
- `BusinessApi` 没有 `sendAiChat`、`listAiTemplates`、`listAiHistory`、`getAiCapabilities`。
- 没有 AI 请求/响应 model。
- 没有 loading、retry、401/403/429/500、AI disabled/mock/unavailable 状态。
- 没有 source summary、range、warnings 展示。
- 没有按角色加载模板。
- 没有对话历史入口。
- 后端菜单当前未给 finance/after_sales 下发 `ai_assistant`。

## 11. 迁移风险

新增 `ai_chat_messages` 本身是低耦合新增表，但仍有以下风险：

- 必须确认远端数据库是测试库后再执行任何 migration。
- `User` 关系需同步补反向字段；如果只加 `AiChatMessage.user`，Prisma relation 可能不完整。
- `userId` 非空加 `onDelete: Restrict` 会阻止物理删除已有对话记录的用户；这符合审计，但需要和用户管理策略一致。
- `Json` 字段要求 MySQL 版本支持 JSON；当前既有 schema 已使用 JSON，风险可控。
- `question`、`answer`、`toolCalls`、`sourceSummary` 可能包含敏感信息，必须在 service 层脱敏和限制体积。
- `AI_HISTORY_RETENTION_DAYS` 需要后续清理策略；第一版可先只配置，不做物理删除接口。
- 对话写入是第 9 阶段少数新增写入路径，测试时必须只写测试库。

## 12. 云端前置风险

根据 `docs/34_第8阶段云服务器测试验收清单.md`：

- 第 8 阶段云端 `GET /api/analytics/overview`、`/api/analytics/taster-rankings`、`/api/analytics/trends`、`/api/analytics/source/orders` 仍返回 `404`。
- 远端数据库是否为测试库未确认。
- SSH、PM2、Nginx、部署版本、`DATABASE_URL` 脱敏库名均未确认。
- 未执行第 8 阶段云端 migrate、seed、登录、全局标记过滤、operation_logs 补验收。

对第 9 阶段影响：

- AI 的经营看板、品鉴师排名、趋势和经营建议工具依赖第 8 阶段 analytics，本地可继续开发，云端不可直接验收。
- `POST /api/ai/chat` 会写入 `ai_chat_messages`，未确认测试库前不能做云端对话 smoke。
- 第 9 阶段 migration 需要新增表，未确认测试库前不能执行云端 migrate。
- 如果远端部署版本不含第 8 阶段代码，即使第 9 阶段部署了 AI，核心工具也会取数失败或返回 404。
- 全局标记过滤云端未闭环时，不能证明 AI 云端查询不会泄露未标记客户/旅行团数据。

阶段建议：

1. 第 8 阶段云端未闭环前，第 9 阶段只做本地开发、测试和文档。
2. 云端只允许继续做只读探测：API 路由是否存在、鉴权是否返回 401/403、远端测试库是否确认。
3. 未确认测试库前，不执行 migrate、seed、登录、导出、全局开关修改或 AI 对话记录写入 smoke。

## 13. 建议后续开发顺序

1. 先补 `AiChatMessage` schema 和只包含新表的 migration。
2. 新增 AI 配置读取和本地 mock/fallback。
3. 新增 `AiPolicyService`，锁定第一版角色和意图权限。
4. 注册只读工具：analytics、taster ranking、finance/refund、commission、customer/order/after-sales/logistics。
5. 工具内部复用现有 service 或统一 scope helper，不接收 SQL。
6. 实现 `POST /api/ai/chat`、templates、history、capabilities。
7. Flutter `BusinessApi` 增加 AI 方法和 model。
8. 改造 `AiAssistantPage` 接真实 API、角色模板、history、warnings/source summary。
9. 本地测试覆盖后，再等待第 8 阶段云端闭环和测试库确认。

## 14. 本次验证

- 已执行文档和代码只读检查。
- 已确认 `docs/37_第9阶段AI数据助手Schema差距清单.md` 为新增文档。
- 未修改 `server/api/prisma/schema.prisma`。
- 未新增 migration。
- 未编写 AI 业务代码。
