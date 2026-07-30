# 第 6 阶段售后、财务、库管查询 Schema 差距清单

检查日期：2026-07-02

检查范围：

- 主文档：`docs/23_第6阶段售后财务库管查询开发文档.md`
- 参考文档：`docs/06_开发阶段计划.md`、`docs/01_PRD.md`、`docs/02_功能模块拆分.md`、`docs/05_数据库初步设计.md`、`docs/17_第4阶段客户和销售订单开发文档.md`、`docs/20_第5阶段二维码销售单和导出开发文档.md`、`docs/22_第5阶段云服务器测试验收清单.md`
- 代码对照：`server/api/prisma/schema.prisma`、`server/api/prisma/seed.ts`、`server/api/src/modules/business-data/business-data.nest.service.ts`

本清单只做本地文档检查和 schema 差距分析，不修改 `schema.prisma`，不生成 migration，不连接生产库。

## 1. 总结结论

当前 `schema.prisma` 已具备第 4、第 5 阶段订单协作基础：客户表、销售订单表、订单明细表、订单状态、配送明细、物流/打包/开票/标记字段、二维码字段、日结对账表、系统设置和操作日志均已落库。

第 6 阶段最大 schema 缺口是独立售后单表尚未落库。当前没有 `AfterSalesOrder` model，也没有 `after_sales_orders` 表，因此售后单号、售后状态、问题类型、处理类型、退款金额、财务确认、售后历史和售后退款汇总都没有稳定数据来源。

财务 overview 当前的 `refundAmountCents` 来自订单状态为 `REFUNDED` 或 `PARTIAL_REFUND` 的订单整单金额合计，不是售后单 `refundAmountCents` 合计。该口径无法表达部分退款真实金额，也无法区分待财务确认退款。

库管发货第一版建议继续使用 `packingStatus=PACKED` 表达库管已处理，不建议本轮新增 `shippedAt`、`shippedById`。如后续业务明确需要单独记录发货时间，再追加字段。

## 2. 已有字段

### 2.1 `SalesOrder`

当前 `SalesOrder` 已有以下第 6 阶段可复用字段：

| 能力 | 已有字段 | 说明 |
| --- | --- | --- |
| 系统单号 | `orderNo` | 唯一，映射 `order_no` |
| 销售单号 | `salesFormNo` | 映射 `sales_form_no`，第 5 阶段公开销售单和导出已复用 |
| 订单类型 | `orderType` | enum，含 `TRAVEL_GROUP`、`BUYBACK`、`EXTERNAL`、`INTERNAL`、`AFTER_SALES` |
| 订单状态 | `status` | enum，含 `VALID`、`PARTIAL_REFUND`、`REFUNDED`、`CANCELLED` |
| 客户关联和快照 | `customerId`、`customerName`、`customerPhone`、`province`、`city`、`district`、`address` | 可支撑售后按客户定位订单 |
| 旅行团关联 | `travelGroupId` | 可支撑按旅行团查询订单和售后上下文 |
| 金额 | `totalAmountCents`、`paymentDetails`、`cashOnDeliveryAmountCents` | 财务收款和代收统计以明细分类快照为准，旧字段仅兼容兜底 |
| 物流 | `logisticsMethod`、`logisticsNo`、`logisticsFeeCents` | 物流方式由库管维护，物流单号和运费由财务维护 |
| 打包 | `packingStatus`、`packageCount`、`warehouseRemark` | 可支撑待打包、打包中、已打包、异常 |
| 开票 | `invoiceRequired`、`invoiceIssued` | 可支撑待开票查询 |
| 标记 | `financeMark`、`markedById`、`markedAt` | 订单自身确认标记，决定订单在全局过滤下是否可见 |
| 审计 | `createdById`、`updatedById`、`createdAt`、`updatedAt` | 可支撑基础审计 |
| 二维码 | `qrCodeToken`、`qrCodeGeneratedAt`、`qrCodeExpiresAt` | 第 5 阶段字段，非第 6 阶段新增 |

已有索引包括：`customerId`、`travelGroupId`、`salesUserId`、`financeMark`、`markedById`、`orderType`、`orderDate`、`customerPhone`、`status`、`salesFormNo`、`qrCodeExpiresAt`、`packingStatus`、`logisticsNo`。

### 2.2 `SalesOrderItem`

当前 `SalesOrderItem` 已有：

| 能力 | 已有字段 | 说明 |
| --- | --- | --- |
| 订单关联 | `salesOrderId` | 关联 `sales_orders.id` |
| 明细金额 | `productName`、`quantity`、`unitPriceCents`、`subtotalCents` | 支撑订单金额计算 |
| 配送口径 | `deliveryType` | enum，含 `SELF_PICKUP`、`SHIPPING`；库管查询可按是否存在邮寄明细过滤 |
| 展示和备注 | `notes`、`sortOrder`、`createdAt` | 支撑销售单和订单详情展示 |

已有索引包括：`salesOrderId`、`salesOrderId + sortOrder`。

### 2.3 `Customer` 和 `TravelGroup`

当前 `Customer` 已有 `financeMark`、`markedById`、`markedAt`，并已建立与 `SalesOrder` 的关系。客户查询在全局标记开关开启时可直接复用 `customers.finance_mark = true`。

当前 `TravelGroup` 已有 `financeMark`、`markedById`、`markedAt`，并已建立与 `SalesOrder` 的关系。旅行团查询判断旅行团自身标记；订单查询只判断订单自身标记。

### 2.4 `SystemSetting` 和 `OperationLog`

`SystemSetting` 已保存全局标记过滤相关设置，seed 中已有 `only_show_marked_records=false` 和 `marked_records_restore_required=false`。

`OperationLog` 已支持 `beforeData`、`afterData`、`entityType`、`entityId` 和 `ipAddress`，可复用到第 6 阶段售后单创建、售后状态变更、售后财务确认、订单状态联动和库管/财务字段更新。

## 3. 缺失字段和缺失表

### 3.1 独立售后单表缺失

当前没有 `AfterSalesOrder` model，也没有 `after_sales_orders` 表。`schema.prisma` 顶部注释也说明售后、提成和 AI 等完整目标表仍按后续阶段追加 migration。

因此当前缺少：

- 售后单号：`afterSalesNo`
- 原订单关联：`salesOrderId`
- 客户关联：`customerId`
- 问题类型：`issueType`
- 处理类型：`actionType`
- 问题描述：`description`
- 处理内容：`resolution`
- 退款金额：`refundAmountCents`
- 售后状态：`status`
- 财务确认：`financeConfirmed`
- 财务确认人：`financeConfirmedById`
- 财务确认时间：`financeConfirmedAt`
- 经办人：`handledById`
- 处理时间：`handledAt`
- 完成时间：`completedAt`
- 备注：`notes`
- 创建/更新人：`createdById`、`updatedById`
- 创建/更新时间：`createdAt`、`updatedAt`

### 3.2 `SalesOrder` 不建议补退款金额字段

第 6 阶段文档明确要求原订单 `totalAmountCents` 不改，保留原始销售事实；退款事实应来自售后单。当前 `SalesOrder` 只有状态字段，没有退款金额字段。这个缺口不建议通过在 `sales_orders` 上新增 `refundAmountCents` 解决，应通过 `after_sales_orders.refund_amount_cents` 汇总解决。

### 3.3 `shippedAt`、`shippedById` 当前缺失

当前 `SalesOrder` 没有 `shippedAt`、`shippedById` 或同义字段。第 6 阶段文档默认不新增，先用 `packingStatus=packed` 表示库管已处理。当前 schema 现状与该默认方案一致。

### 3.4 财务确认字段应放在售后单

当前没有 `financeConfirmed`、`financeConfirmedById`、`financeConfirmedAt`。这些字段应随 `AfterSalesOrder` 新增，而不是加到 `SalesOrder`，因为确认对象是一笔售后退款事实，不是整张订单。

## 4. 建议新增表

建议新增 `AfterSalesOrder` model，对应 `after_sales_orders` 表：

| 字段 | Prisma 建议 | 数据库映射 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | `String @id @default(uuid()) @db.Char(36)` | `id` | 是 | 主键 |
| `afterSalesNo` | `String @unique @map("after_sales_no") @db.VarChar(80)` | `after_sales_no` | 是 | 售后单号，建议 `ASyyyyMMddNNN` |
| `salesOrderId` | `String @map("sales_order_id") @db.Char(36)` | `sales_order_id` | 是 | 原订单 ID |
| `customerId` | `String? @map("customer_id") @db.Char(36)` | `customer_id` | 否 | 从订单客户带出，兼容旧数据 |
| `issueType` | enum 或 `String @map("issue_type") @db.VarChar(40)` | `issue_type` | 是 | 问题类型 |
| `actionType` | enum 或 `String @map("action_type") @db.VarChar(40)` | `action_type` | 是 | 处理类型 |
| `description` | `String @db.Text` | `description` | 是 | 问题描述 |
| `resolution` | `String? @db.Text` | `resolution` | 否 | 处理内容/结果 |
| `refundAmountCents` | `Int @default(0) @map("refund_amount_cents")` | `refund_amount_cents` | 是 | 本次退款金额，单位分 |
| `status` | enum 或 `String @db.VarChar(40)` | `status` | 是 | 售后状态 |
| `financeConfirmed` | `Boolean @default(false) @map("finance_confirmed")` | `finance_confirmed` | 是 | 财务是否确认 |
| `financeConfirmedById` | `String? @map("finance_confirmed_by_id") @db.Char(36)` | `finance_confirmed_by_id` | 否 | 财务确认人 |
| `financeConfirmedAt` | `DateTime? @map("finance_confirmed_at") @db.DateTime(0)` | `finance_confirmed_at` | 否 | 财务确认时间 |
| `handledById` | `String? @map("handled_by_id") @db.Char(36)` | `handled_by_id` | 否 | 经办人或最后处理人 |
| `handledAt` | `DateTime? @map("handled_at") @db.DateTime(0)` | `handled_at` | 否 | 最近处理时间 |
| `completedAt` | `DateTime? @map("completed_at") @db.DateTime(0)` | `completed_at` | 否 | 完成时间 |
| `notes` | `String? @db.Text` | `notes` | 否 | 内部备注 |
| `createdById` | `String? @map("created_by_id") @db.Char(36)` | `created_by_id` | 否 | 创建人 |
| `updatedById` | `String? @map("updated_by_id") @db.Char(36)` | `updated_by_id` | 否 | 更新人 |
| `createdAt` | `DateTime @default(now()) @map("created_at") @db.DateTime(0)` | `created_at` | 是 | 创建时间 |
| `updatedAt` | `DateTime @updatedAt @map("updated_at") @db.DateTime(0)` | `updated_at` | 是 | 更新时间 |

建议同时在 `User`、`SalesOrder`、`Customer` 上补关系字段，但不改变既有表数据含义。

## 5. 枚举建议

当前 schema 已使用 Prisma enum 表达订单类型、订单状态、配送类型和打包状态。第 6 阶段售后状态、问题类型、处理类型也建议采用 enum，保持风格一致。

建议新增：

- `AfterSalesStatus`：`NEGOTIATING`、`WAITING_RECEIVE`、`WAITING_RESEND`、`WAITING_REFUND`、`COMPLETED`
- `AfterSalesIssueType`：`QUALITY_ISSUE`、`LOGISTICS_DAMAGE`、`WRONG_ITEM`、`MISSING_ITEM`、`CUSTOMER_RETURN`、`INVOICE_ISSUE`、`OTHER`
- `AfterSalesActionType`：`RECORD_ONLY`、`REFUND`、`RETURN_REFUND`、`RESEND`、`EXCHANGE`、`CANCEL_ORDER`

如担心 MySQL enum 后续扩展成本，也可以第一版使用 `String @db.VarChar(40)`，在 service 层做白名单校验。考虑当前 schema 已经大量使用 enum，第 6 阶段建议继续用 enum，除非业务明确要求后台可配置。

## 6. 索引建议

新增 `after_sales_orders` 后建议添加：

| 索引/约束 | 目的 |
| --- | --- |
| `@unique([afterSalesNo])` 或字段级 `@unique` | 售后单号唯一，支撑并发生成兜底 |
| `@@index([salesOrderId])` | 查询订单售后历史 |
| `@@index([customerId])` | 按客户查售后 |
| `@@index([status])` | 售后状态工作台 |
| `@@index([issueType])` | 问题类型筛选 |
| `@@index([actionType])` | 处理类型筛选 |
| `@@index([financeConfirmed])` | 财务待确认售后 |
| `@@index([createdAt])` | 售后创建日期范围 |
| `@@index([handledById])` | 经办人筛选 |

可选组合索引：

- `@@index([status, createdAt])`：售后列表常见筛选。
- `@@index([financeConfirmed, createdAt])`：财务待确认列表常见筛选。

第一版如果担心索引过多，可先按文档要求添加单列索引，组合索引等查询慢时再补。

## 7. 约束建议

建议关系约束：

- `salesOrderId` 必填，关联 `SalesOrder.id`。售后单必须依附原订单。
- `customerId` 可空，关联 `Customer.id`，删除客户时建议 `onDelete: SetNull`。
- `financeConfirmedById`、`handledById`、`createdById`、`updatedById` 可空，关联 `User.id`，删除用户时建议 `onDelete: SetNull`。

建议业务约束：

- `refundAmountCents >= 0`。Prisma schema 不能直接稳定表达 MySQL check 兼容性时，应在 service 层强校验；如目标 MySQL 版本明确支持，再在 migration 中加 check。
- `financeConfirmed=false` 时，`financeConfirmedById` 和 `financeConfirmedAt` 应为空；取消确认时同步清空。
- `status=COMPLETED` 时必须有 `resolution` 或 `notes`，由 service 层校验。
- 单笔售后退款和同订单累计退款不应超过原订单总额，除非业务单独确认允许超额赔付。

## 8. 财务 Overview 差距

当前 `/api/finance/overview`：

- 查询 `salesOrder.findMany` 和 `travelGroup.findMany`。
- `salesAmountCents` 来自非 `CANCELLED` 订单的 `totalAmountCents` 合计。
- `refundAmountCents` 来自状态为 `REFUNDED` 或 `PARTIAL_REFUND` 的订单 `totalAmountCents` 合计。
- `cashOnDeliveryAmountCents` 兼容指标来自非 `CANCELLED` 订单的 `COLLECT_ON_DELIVERY` 明细有符号合计；只有无明细过渡数据才回退旧列。
- 返回 `recentOrders`，尚无售后待确认、净销售额、物流费用、待开票、待标记等第 6 阶段 workbench 指标。

缺口：

- 缺少 `after_sales_orders.refund_amount_cents` 汇总。
- 缺少 `financeConfirmed=false` 的待确认售后口径。
- 部分退款会被按整单金额计入退款，金额不准确。
- 缺少 `netSalesAmountCents = grossSalesAmountCents - confirmed/refundAmountCents`。
- 缺少物流费用合计、待补物流单号、待补运费、待开票、客户待标记、旅行团待标记等指标。

建议：

- 新增售后单表后，财务退款金额以售后单 `refundAmountCents` 为来源。
- 对财务 overview 的口径需明确是“全部退款事实”还是“已财务确认退款”。建议指标分开：`refundAmountCents` 汇总已确认退款，`pendingAfterSalesRefundAmountCents` 汇总待确认退款。
- 订单状态只表达订单生命周期，不再作为退款金额来源。

## 9. Seed 差距

当前 `seed.ts` 已有：

- 售后角色用户：`usr_after_sales_demo`
- 全局标记设置：`only_show_marked_records=false`
- 已标记客户和未标记客户
- 已标记旅行团
- 至少 2 个含邮寄明细、`packingStatus='PENDING'` 的订单
- `invoiceRequired=true` 且 `invoiceIssued=false` 的待开票订单
- `logisticsNo=null`、`logisticsFeeCents=0` 的待补物流/运费订单
- `DailyReconciliation` 中 `afterSalesCents=0`、`refundsCents=0`

当前缺少：

- 售后单 seed，因为表尚不存在。
- 有退款售后单的订单。
- 待补发售后单。
- 待退款但未财务确认售后单。
- 已完成售后单。
- `status='PARTIAL_REFUND'`、`status='REFUNDED'`、`status='CANCELLED'` 的订单样本。
- `packingStatus='PACKING'`、`packingStatus='PACKED'`、`packingStatus='ABNORMAL'` 的库管样本。
- 已打包且物流信息完整的样本。
- 明确用于第 6 阶段财务 overview 的售后退款样本。

第 6 阶段 seed 应在新增售后表后再补，且所有测试客户、订单、售后单、备注继续带 `test` 或 `smoke`。

## 10. 全局标记过滤复用建议

当前订单查询已经有统一入口：

- `buildScopedSalesOrderWhere(actor, baseWhere)`
- `buildGlobalSalesOrderMarkScope()`
- `assertPassesGlobalSalesOrderMarkScope(order)`

当前规则是：全局开关开启时，订单只判断自身 `SalesOrder.financeMark=true`；关联客户和旅行团的标记不参与订单可见性判断。

第 6 阶段建议复用方式：

- 售后列表以 `after_sales_orders -> sales_orders -> customer/travelGroup` 为主路径过滤，不单独发明一套标记规则。
- 售后详情读取时，先查售后单并 include 原订单、客户、旅行团，再复用订单标记校验逻辑；未通过时返回 404，避免泄露未标记数据存在。
- 财务 overview/workbench 继续通过 `buildScopedSalesOrderWhere` 过滤订单类指标，并对售后退款汇总加入同样的订单关联过滤。
- 库管订单查询继续复用 `buildScopedSalesOrderWhere` 和 warehouse 角色数据范围，筛选邮寄明细或待打包状态。
- 如果新增 `/api/warehouse/orders` 包装接口，内部仍应复用同一套订单查询 helper。

需要注意：当前 helper 是 `BusinessDataNestService` 的 private 方法。若新增售后 service，不宜复制粘贴过滤逻辑，建议提取为可复用的查询 scope helper，或将售后 API 第一版放在同一业务服务内复用，后续再抽离。

## 11. 迁移风险

### 11.1 云端前置风险

`docs/22_第5阶段云服务器测试验收清单.md` 明确：可以进入第 6 阶段设计讨论，但不建议进入第 6 阶段实现、部署或云端验收闭环。云端 migration、seed、登录或写入 smoke 前必须先确认远端数据库是测试库。

本清单后续如进入 schema 和 migration 实现，应继续遵守：

- 未确认测试库前，只做只读检查。
- 不连接生产库。
- 不覆盖生产数据。
- 云端 `migrate deploy` 和 seed 必须等测试库、部署版本和 SSH/运维入口确认后执行。

### 11.2 数据兼容风险

- 新增表本身对旧订单低风险，因为不要求历史订单必须有售后单。
- `salesOrderId` 必填会要求创建售后单时必须找到原订单；这是业务正确约束。
- `customerId` 建议可空，避免旧订单或异常订单没有客户关联时无法创建售后记录。
- `afterSalesNo` 唯一约束存在并发冲突风险，需要售后单号生成逻辑重试。
- 如果采用 enum，后续新增售后状态、问题类型、处理类型需要 migration；如果业务类型未定，先用 String + service 校验更灵活。
- 财务 overview 切换退款来源后，历史没有售后单的数据会导致退款金额从“按订单状态整单计”变为 0，需要兼容过渡口径。

### 11.3 统计口径风险

- 当前旅行团概要 `refreshTravelGroupOrderSummary` 只按 `VALID`、`PARTIAL_REFUND` 订单汇总整单 `totalAmountCents`，没有扣减售后退款。第 6 阶段若要求净销售额影响旅行团有效金额，需要同步设计，不应只改财务 overview。
- `PARTIAL_REFUND` 当前只能表达状态，不能表达退款金额。新增售后表后，状态和退款金额要保持一致，否则财务统计会出现“状态已部分退款但无售后退款事实”或相反情况。
- `DailyReconciliation.afterSalesCents/refundsCents` 是手工日结口径，不应被误用为售后单明细来源。

## 12. 兼容策略

建议分阶段兼容：

1. 先新增 `after_sales_orders` 表，不改旧订单，不回填历史售后。
2. 售后 API 创建售后单时从订单带出 `customerId`，但允许为空。
3. 订单状态联动只在售后单创建/更新后发生，不批量改历史订单。
4. 财务 overview 第一版可同时返回旧口径字段和新口径字段，例如 `legacyRefundOrderAmountCents` 与 `refundAmountCents`，待前端和验收稳定后再收敛。
5. 现有 `/api/sales-orders/:id/status` 保留，供管理员/财务/售后做兼容状态修正；第 6 阶段主路径逐步迁移到售后单状态流转。
6. 订单 `financeMark` 表示订单及订单中保存的客户快照已经确认，是订单查询的唯一全局标记条件；客户查询仍以 `Customer.financeMark` 为准。
7. 库管继续使用现有 `packingStatus`、`logisticsMethod`、`packageCount`、`warehouseRemark`，不引入库存批次、出库单或快递轨迹表。

## 13. 是否需要 `shippedAt` 的建议

本阶段不建议新增 `shippedAt`、`shippedById`。

理由：

- 第 6 阶段文档默认方案是用 `packingStatus=packed` 表示库管已处理。
- 当前 `SalesOrderPackingStatus` 已有 `PENDING`、`PACKING`、`PACKED`、`ABNORMAL`，足以支撑库管查询工作台第一版。
- 当前物流单号和运费由财务维护，物流方式和打包状态由库管维护；“已发货时间”如果没有清晰操作按钮和责任归属，容易与“已打包”混淆。
- 第 6 阶段不接快递 API，不做物流轨迹抓取，新增发货时间的收益有限。

建议保留扩展点：

- 如果业务后续确认需要区分“已打包”和“已交运/已发货”，再新增 `shippedAt`、`shippedById`，并增加明确的 `mark shipped` 接口和操作日志。
- 不建议只新增字段但没有流程，否则字段容易长期为空或被随意填写。

## 14. 下一步建议

后续进入实现时，建议顺序如下：

1. 新增 `AfterSalesOrder` schema、关系和 migration。
2. 新增售后单号生成 helper。
3. 补第 6 阶段 seed：售后、退款、待确认、待补发、已完成、已打包、异常、待开票、待标记样本。
4. 新增售后 API，并复用全局标记过滤。
5. 增强财务 overview/workbench，退款来源改为售后单汇总。
6. 库管查询先复用现有订单字段和 `packingStatus`，暂不加 `shippedAt`。
