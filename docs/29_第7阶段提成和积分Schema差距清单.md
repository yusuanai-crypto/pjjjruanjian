# 第 7 阶段提成和积分 Schema 差距清单

检查日期：2026-07-03

检查范围：

- 主文档：`docs/27_第7阶段提成和积分开发文档.md`
- 参考文档：`docs/06_开发阶段计划.md`、`docs/01_PRD.md`、`docs/02_功能模块拆分.md`、`docs/05_数据库初步设计.md`、`docs/23_第6阶段售后财务库管查询开发文档.md`、`docs/25_第6阶段售后财务库管查询Schema差距清单.md`、`docs/26_第6阶段云服务器测试验收清单.md`
- 代码对照：`server/api/prisma/schema.prisma`、`server/api/prisma/seed.ts`、`server/api/src/modules/business-data/business-data.nest.service.ts`

本清单只做本地文档检查和 schema 差距分析，不修改 `schema.prisma`，不生成 migration，不连接生产库。第 6 阶段云端仍未闭环前，第 7 阶段只建议继续本地设计、schema/migration 准备、测试和文档，不做云端写入。

## 1. 总结结论

当前 `schema.prisma` 已具备第 7 阶段计算所需的部分基础事实表：`users`、`customers`、`travel_groups`、`travel_agencies`、`sales_orders`、`sales_order_items`、`after_sales_orders`、`operation_logs` 均已存在。

第 7 阶段核心缺口仍然明确：当前没有旅行社扣酒成本规则表、旅行社返点比例规则表、销售扣单成本规则表、员工提成规则表、提成/积分记录表、旅行团返积分财务汇总表，也没有外联归属字段。也就是说，现在能找到订单、销售、旅行团、品鉴师、旅行社名称和已确认售后退款事实，但还不能稳定保存规则、计算结果、计算快照、返积分汇总和外联提成来源。

当前 `SalesOrder` 已有 `salesUserId`、`travelGroupId`、`totalAmountCents`、`status`、`items`、`afterSalesOrders`，可作为第 7 阶段订单级核算入口。当前 `User` 已有 `leaderId`，可作为组长提成来源，但 seed 没有配置销售组长样例。当前 `TravelGroup` 已有 `tasterId`、`travelAgency`、`financeMark`、`points`、`returnedPoints`、`unreturnedPoints`、`liquorCostDeductionCents`、`orderAmountCents` 等兼容字段，但旅行社仍是名称文本，不是 `travel_agencies.id` 外键关联。

第 6 阶段 `AfterSalesOrder` 已在本地 schema 落库，包含 `refundAmountCents` 和 `financeConfirmed`，可以作为第 7 阶段退款调整来源。云端方面，`docs/26_第6阶段云服务器测试验收清单.md` 仍记录测试库未确认、第 6 阶段路由云端 404、未执行 migrate/seed/login/write smoke，因此第 7 阶段不能直接做云端写入。

## 2. 指定检查项结论

| 检查项 | 当前结论 | 说明 |
| --- | --- | --- |
| `agency_deduction_rules` | 缺失 | 未发现 model/table/seed。 |
| `agency_rebate_rules` | 缺失 | 未发现 model/table/seed。 |
| `sales_deduction_rules` | 缺失 | 未发现 model/table/seed。 |
| `commission_rules` | 缺失 | 未发现 model/table/seed。 |
| `commission_records` | 缺失 | 未发现 model/table/seed。 |
| `travel_group_finance_summaries` | 缺失 | 未发现 model/table/seed。 |
| `SalesOrder.salesUserId` | 已有 | 可用于销售提成来源。 |
| `SalesOrder.travelGroupId` | 已有 | 可关联旅行团，但第 6 阶段售后 seed 多数订单为 `EXTERNAL` 且 `travelGroupId=null`。 |
| `SalesOrder.totalAmountCents` | 已有 | 保留原始销售金额，退款不应直接覆盖该字段。 |
| `SalesOrder.status` | 已有 | enum：`VALID`、`PARTIAL_REFUND`、`REFUNDED`、`CANCELLED`。 |
| `SalesOrder.items` | 已有 | `SalesOrderItem[]`，含产品名、数量、小计，可用于扣单/扣酒成本计算。 |
| `SalesOrder.afterSalesOrders` | 已有 | 可汇总已财务确认退款。 |
| `User.leaderId` | 已有 | 可用于组长提成；seed 暂无组长账号和归属样例。 |
| `TravelGroup.tasterId` | 已有 | 可用于品鉴师提成归属。 |
| `TravelGroup.travelAgency` | 已有 | 文本字段；当前不与 `TravelAgency.id` 建外键。 |
| `TravelGroup.financeMark` | 已有 | 可复用全局标记过滤。 |
| `TravelGroup.points/returnedPoints/unreturnedPoints` | 已有 | 旧积分兼容字段，不能替代第 7 阶段明细和汇总快照。 |
| `TravelGroup.liquorCostDeductionCents/orderAmountCents` | 已有 | 旧汇总兼容字段，建议由新汇总服务同步维护或只读展示。 |
| 外联归属字段 | 缺失 | `SalesOrder`、`TravelGroup`、`User` 中未发现 `outreachUserId` 或同义字段。 |
| `TravelAgency` 与 `TravelGroup` 关系 | 名称文本为主 | `travel_agencies.name` 唯一；`travel_groups.travel_agency` 仅保存名称文本。 |
| `AfterSalesOrder.refundAmountCents` | 已有 | 第 7 阶段有效金额可按已确认退款扣减。 |
| `AfterSalesOrder.financeConfirmed` | 已有 | 可区分已确认/待确认退款。 |
| `operation_logs` | 基本足够 | 通用 before/after JSON 足以记录规则修改、重算、确认和取消确认，但需约定 action 命名。 |
| seed 可核算链路 | 部分不足 | 有订单、旅行团、售后退款、销售、品鉴师、旅行社样例；缺组长、外联、第 7 阶段规则，且“有旅行团订单”和“有退款订单”未串成同一条完整核算样例。 |
| 全局标记过滤复用 | 已有基础 | 订单、售后、财务 workbench 已有订单作用域 helper；第 7 阶段应复用，不另写一套过滤逻辑。 |

## 3. 当前已有字段

### 3.1 `User`

当前 `User` 已有：

| 能力 | 已有字段 | 说明 |
| --- | --- | --- |
| 员工身份 | `id`、`name`、`username`、`role`、`phone`、`isActive` | 可作为提成对象和操作人。 |
| 组长归属 | `leaderId` | 自关联到 `users.id`，并有 `@@index([leaderId])`。 |
| 销售订单关系 | `salesOrders` | 通过 `SalesOrder.salesUserId` 关联。 |
| 品鉴师旅行团关系 | `tasterTravelGroups` | 通过 `TravelGroup.tasterId` 关联。 |
| 售后确认关系 | `financeConfirmedAfterSalesOrders` | 已用于第 6 阶段退款确认。 |

可复用结论：`leaderId` 可以直接作为销售组长提成来源。缺口在 seed 和业务校验：销售没有组长时，应不生成组长提成记录，并返回 `missing_leader` warning。

### 3.2 `SalesOrder`

当前 `SalesOrder` 已有以下第 7 阶段可复用字段：

| 能力 | 已有字段 | 说明 |
| --- | --- | --- |
| 订单编号和日期 | `orderNo`、`orderDate`、`salesFormNo` | 规则默认按 `orderDate` 匹配生效区间。 |
| 订单类型 | `orderType` | 可区分旅行团、外部、内部、售后等订单。 |
| 旅行团关联 | `travelGroupId`、`travelGroup` | 用于旅行社积分、品鉴师提成和旅行团汇总。 |
| 客户关联和快照 | `customerId`、`customerName`、`customerPhone`、地址字段 | 用于全局标记过滤和导出展示。 |
| 销售归属 | `salesUserId`、`salesUser` | 用于销售提成。 |
| 金额 | `totalAmountCents` | 原始销售金额；第 7 阶段有效金额应扣已确认售后退款。 |
| 订单状态 | `status` | `VALID`、`PARTIAL_REFUND`、`REFUNDED`、`CANCELLED`。 |
| 订单明细 | `items` | 可按 `productName + quantity` 匹配扣单/扣酒规则。 |
| 售后记录 | `afterSalesOrders` | 可汇总 `financeConfirmed=true` 的 `refundAmountCents`。 |
| 标记过滤 | `financeMark`、`customer.financeMark`、`travelGroup.financeMark` | 订单查询和导出只复用订单自身标记作用域；客户和旅行团各自使用自身作用域。 |

当前缺少 `outreachUserId`，因此无法生成外联提成。第 7 阶段应新增可空字段，历史订单默认为空。

### 3.3 `SalesOrderItem`

当前 `SalesOrderItem` 已有：

| 能力 | 已有字段 | 说明 |
| --- | --- | --- |
| 订单关联 | `salesOrderId` | 关联 `sales_orders.id`。 |
| 酒品匹配 | `productName` | 第 7 阶段规则默认按名称匹配。 |
| 数量和金额 | `quantity`、`unitPriceCents`、`subtotalCents` | 可用于扣单/扣酒成本和快照。 |
| 配送方式 | `deliveryType` | 对第 7 阶段不是主口径，但可用于导出展示。 |

风险：当前按 `productName` 文本匹配规则，缺少酒品字典 ID。第 7 阶段第一版可以用文本匹配，但应在计算快照中保存订单明细原始产品名、数量、匹配到的规则 ID 和未匹配 warning。

### 3.4 `TravelGroup`

当前 `TravelGroup` 已有：

| 能力 | 已有字段 | 说明 |
| --- | --- | --- |
| 团基础信息 | `groupNo`、`visitDate`、`groupType`、`guideName`、`guidePhone` | 可用于列表、汇总和导出。 |
| 旅行社名称 | `travelAgency` | 文本字段，不是外键。 |
| 品鉴师归属 | `tasterId`、`tasterName`、`taster` | 可用于品鉴师提成。 |
| 财务标记 | `financeMark`、`markedById`、`markedAt` | 可复用全局标记过滤。 |
| 旧汇总金额 | `salesAmountCents`、`liquorCostDeductionCents`、`orderAmountCents` | 兼容字段，不应作为第 7 阶段权威明细。 |
| 旧积分字段 | `points`、`returnedPoints`、`unreturnedPoints` | 兼容字段，不应替代返积分汇总表。 |
| 信息发送状态 | `guideInfoSent`、`travelAgencyInfoSent` | 可同步到新的旅行团返积分汇总或继续读取原字段。 |

兼容建议：新增 `travel_group_finance_summaries` 后，以新汇总表为第 7 阶段权威来源。旧字段如果 Flutter 旧页面仍读取，可由汇总刷新服务同步写入；如果不再使用，应在 API 层明确标注为兼容展示字段。

### 3.5 `TravelAgency`

当前 `TravelAgency` 只有基础资料：

| 字段 | 说明 |
| --- | --- |
| `id` | UUID 主键。 |
| `name` | 唯一名称。 |
| `contactName`、`contactPhone`、`notes` | 基础信息。 |

当前没有 `TravelGroup.agencyId`，也没有 `TravelAgency.travelGroups` 关系。因此现阶段旅行社规则不能只依赖 ID，必须兼容历史 `travelGroup.travelAgency` 文本。

### 3.6 `AfterSalesOrder`

当前 `AfterSalesOrder` 已有：

| 能力 | 已有字段 | 说明 |
| --- | --- | --- |
| 售后单号 | `afterSalesNo` | 唯一。 |
| 原订单 | `salesOrderId`、`salesOrder` | 可追溯到订单。 |
| 客户 | `customerId`、`customer` | 可用于标记过滤和展示。 |
| 处理类型 | `issueType`、`actionType`、`status` | 可判断退款、退货、取消等。 |
| 退款金额 | `refundAmountCents` | 单位分。 |
| 财务确认 | `financeConfirmed`、`financeConfirmedById`、`financeConfirmedAt` | 第 7 阶段只扣减已确认退款。 |
| 审计 | `handledById`、`createdById`、`updatedById`、时间字段 | 可追溯售后处理。 |

可复用结论：第 7 阶段默认有效金额可按以下口径计算：

```text
已确认退款金额 = SUM(after_sales_orders.refund_amount_cents WHERE finance_confirmed = true)
订单有效金额 = max(0, sales_orders.total_amount_cents - 已确认退款金额)
```

待确认退款不应扣减已确认核算结果，应进入 warnings 或待调整列表。

### 3.7 `OperationLog`

当前 `OperationLog` 已有：

| 字段 | 说明 |
| --- | --- |
| `userId` | 操作人。 |
| `action` | 操作动作，长度 100。 |
| `entityType`、`entityId` | 操作对象。 |
| `beforeData`、`afterData` | JSON，可保存规则修改前后和重算差异。 |
| `ipAddress`、`createdAt` | 审计信息。 |

结论：字段层面足够记录第 7 阶段规则修改、重算、品鉴师提成确认/取消确认、旅行社扣酒成本确认/取消确认和导出动作。建议统一 action 命名，例如：

- `commission_rules.create`
- `commission_rules.update`
- `commission_records.recalculate`
- `commission_records.taster_manual_amount.update`
- `commission_records.confirm.enable`
- `commission_records.confirm.disable`
- `travel_group_finance_summaries.refresh`
- `travel_group_finance_summaries.agency_deduction_confirm.enable`
- `travel_group_finance_summaries.agency_deduction_confirm.disable`
- `commission_records.export`
- `travel_group_finance_summaries.export`

## 4. 缺失字段和缺失表

### 4.1 第 7 阶段核心表缺失

当前缺失以下 model/table：

- `AgencyDeductionRule` / `agency_deduction_rules`
- `AgencyRebateRule` / `agency_rebate_rules`
- `SalesDeductionRule` / `sales_deduction_rules`
- `CommissionRule` / `commission_rules`
- `CommissionRecord` / `commission_records`
- `TravelGroupFinanceSummary` / `travel_group_finance_summaries`

同时缺失对应关系字段、枚举、索引、seed 和测试样例。

### 4.2 外联归属字段缺失

当前没有任何明显的外联归属字段。第 7 阶段外联提成无法只从销售、旅行团或导游推断，否则容易把业务责任算错。

建议在 `SalesOrder` 新增：

```prisma
outreachUserId String? @map("outreach_user_id") @db.Char(36)
outreachUser   User?   @relation("SalesOrderOutreachUser", fields: [outreachUserId], references: [id], onDelete: SetNull)

@@index([outreachUserId])
```

同时在 `User` 新增：

```prisma
outreachSalesOrders SalesOrder[] @relation("SalesOrderOutreachUser")
```

兼容策略：

- 字段可空，不回填历史订单，避免误算。
- 新订单由销售、财务或管理员录入外联人员。
- 历史订单 `outreachUserId=null` 时不生成外联提成记录，返回 `missing_outreach_user` warning。
- 如业务确认旅行团维度也有固定外联，可后续再给 `TravelGroup` 增加 `outreachUserId`，订单创建时继承；第 7 阶段第一版建议以订单字段为权威来源。
- 如果后续外联并非内部员工，应新增外部联系人表；当前文档口径为员工提成，因此先关联 `users.id`。

## 5. 建议新增表

### 5.1 旅行社扣酒成本规则 `AgencyDeductionRule`

建议表名：`agency_deduction_rules`。

| 字段 | 建议 Prisma 字段 | 说明 |
| --- | --- | --- |
| 主键 | `id` | UUID。 |
| 旅行社 ID | `agencyId` | 可空，关联 `travel_agencies.id`。 |
| 旅行社名称快照 | `agencyName` | 可空，兼容 `travel_groups.travelAgency` 文本。 |
| 酒品名称 | `productName` | 与 `sales_order_items.product_name` 匹配。 |
| 扣酒成本 | `deductionCostCents` | 每瓶/件扣酒成本，单位分。 |
| 生效开始 | `effectiveFrom` | 日期。 |
| 生效结束 | `effectiveTo` | 可空。 |
| 是否启用 | `isActive` | 默认 true。 |
| 备注 | `notes` | 可空。 |
| 审计 | `createdById`、`updatedById`、`createdAt`、`updatedAt` | 规则修改需记录操作日志。 |

建议索引：

- `@@index([agencyId])`
- `@@index([agencyName])`
- `@@index([productName])`
- `@@index([isActive])`
- `@@index([effectiveFrom])`
- `@@index([effectiveTo])`
- 可选组合索引：`@@index([agencyId, productName, isActive, effectiveFrom])`
- 可选组合索引：`@@index([agencyName, productName, isActive, effectiveFrom])`

约束建议：

- `deductionCostCents >= 0`，service 层校验。
- `effectiveTo` 不得早于 `effectiveFrom`。
- 同一旅行社维度、同一产品、启用规则的生效区间不得重叠。MySQL/Prisma 不适合直接表达时间区间排斥约束，应在 service 层校验，必要时事务内加锁。
- `agencyId` 和 `agencyName` 至少填一个；如果两者都填，`agencyName` 作为快照，不作为强一致外键。

### 5.2 旅行社返点比例规则 `AgencyRebateRule`

建议表名：`agency_rebate_rules`。

| 字段 | 建议 Prisma 字段 | 说明 |
| --- | --- | --- |
| 主键 | `id` | UUID。 |
| 旅行社 ID | `agencyId` | 可空，关联 `travel_agencies.id`。 |
| 旅行社名称快照 | `agencyName` | 可空，兼容历史文本。 |
| 日返比例 | `dailyRebateRate` | `Decimal @db.Decimal(10, 4)`。 |
| 月返比例 | `monthlyRebateRate` | `Decimal @db.Decimal(10, 4)`，默认 0。 |
| 合计比例 | `totalRebateRate` | 可选冗余展示字段。 |
| 生效开始 | `effectiveFrom` | 日期。 |
| 生效结束 | `effectiveTo` | 可空。 |
| 是否启用 | `isActive` | 默认 true。 |
| 备注 | `notes` | 可空。 |
| 审计 | `createdById`、`updatedById`、`createdAt`、`updatedAt` | 规则修改需记录日志。 |

建议索引：

- `@@index([agencyId])`
- `@@index([agencyName])`
- `@@index([isActive])`
- `@@index([effectiveFrom])`
- `@@index([effectiveTo])`
- 可选组合索引：`@@index([agencyId, isActive, effectiveFrom])`
- 可选组合索引：`@@index([agencyName, isActive, effectiveFrom])`

约束建议：

- `dailyRebateRate >= 0`，`monthlyRebateRate >= 0`。
- 同一旅行社维度、启用规则的生效区间不得重叠。
- `totalRebateRate` 如保存，应由 service 计算，避免人工填写不一致。

### 5.3 销售扣单成本规则 `SalesDeductionRule`

建议表名：`sales_deduction_rules`。

| 字段 | 建议 Prisma 字段 | 说明 |
| --- | --- | --- |
| 主键 | `id` | UUID。 |
| 酒品名称 | `productName` | 与订单明细产品名匹配。 |
| 扣单成本 | `deductionCostCents` | 每瓶/件扣单成本，单位分。 |
| 生效开始 | `effectiveFrom` | 日期。 |
| 生效结束 | `effectiveTo` | 可空。 |
| 是否启用 | `isActive` | 默认 true。 |
| 备注 | `notes` | 可空。 |
| 审计 | `createdById`、`updatedById`、`createdAt`、`updatedAt` | 规则修改需记录日志。 |

建议索引：

- `@@index([productName])`
- `@@index([isActive])`
- `@@index([effectiveFrom])`
- `@@index([effectiveTo])`
- 可选组合索引：`@@index([productName, isActive, effectiveFrom])`

约束建议：

- `deductionCostCents >= 0`。
- 同一产品、启用规则的生效区间不得重叠。

### 5.4 员工提成规则 `CommissionRule`

建议表名：`commission_rules`。

| 字段 | 建议 Prisma 字段 | 说明 |
| --- | --- | --- |
| 主键 | `id` | UUID。 |
| 规则名称 | `ruleName` | 例如销售提成、外联提成、组长提成。 |
| 目标类型 | `targetType` | `CommissionRuleTargetType`。 |
| 比例 | `rate` | `Decimal @db.Decimal(10, 4)`。 |
| 生效开始 | `effectiveFrom` | 日期。 |
| 生效结束 | `effectiveTo` | 可空。 |
| 是否启用 | `isActive` | 默认 true。 |
| 备注 | `notes` | 可空。 |
| 审计 | `createdById`、`updatedById`、`createdAt`、`updatedAt` | 规则修改需记录日志。 |

默认规则 seed：

- 销售提成：`0.0200`
- 外联提成：`0.0080`
- 组长提成：`0.0024`

建议索引：

- `@@index([targetType])`
- `@@index([isActive])`
- `@@index([effectiveFrom])`
- `@@index([effectiveTo])`
- 可选组合索引：`@@index([targetType, isActive, effectiveFrom])`

约束建议：

- `rate >= 0`。
- 同一 `targetType`、启用规则的生效区间不得重叠。
- 品鉴师提成不建议放入自动比例规则；按第 7 阶段文档，应走手工录入提成记录。

### 5.5 提成和积分记录 `CommissionRecord`

建议表名：`commission_records`。

该表是第 7 阶段金额追溯的核心，必须能追溯到订单、旅行团、售后退款、命中的规则和计算快照。员工提成、品鉴师手工提成、旅行社日返/月返可放在同一张结果表，但类型必须清晰。

| 字段 | 建议 Prisma 字段 | 说明 |
| --- | --- | --- |
| 主键 | `id` | UUID。 |
| 订单 ID | `salesOrderId` | 可空；订单级自动记录必填。 |
| 旅行团 ID | `travelGroupId` | 可空；旅行团汇总、品鉴师提成可用。 |
| 售后单 ID | `afterSalesOrderId` | 可空；如记录单笔售后调整来源时使用。 |
| 员工提成规则 ID | `commissionRuleId` | 可空，关联 `commission_rules.id`。 |
| 旅行社返点规则 ID | `agencyRebateRuleId` | 可空，关联 `agency_rebate_rules.id`。 |
| 目标类型 | `targetType` | `CommissionTargetType`。 |
| 目标用户 ID | `targetUserId` | 销售、外联、组长、品鉴师。 |
| 旅行社 ID | `agencyId` | 可空，关联 `travel_agencies.id`。 |
| 旅行社名称快照 | `agencyName` | 兼容历史文本。 |
| 原始订单金额 | `grossAmountCents` | 订单原始销售金额快照。 |
| 已确认退款 | `confirmedRefundAmountCents` | 参与本次计算的已确认退款金额。 |
| 基础金额 | `baseAmountCents` | 员工或旅行社上单金额。 |
| 扣减成本 | `deductionAmountCents` | 销售扣单或旅行社扣酒成本。 |
| 比例快照 | `rateSnapshot` | Decimal，可空。 |
| 提成金额 | `amountCents` | 员工提成金额，单位分。 |
| 返积分金额 | `pointsCents` | 旅行社返积分金额，单位分。 |
| 是否手工 | `manualInput` | 品鉴师手工提成为 true。 |
| 是否确认 | `isConfirmed` | 品鉴师提成确认使用。 |
| 确认人 | `confirmedById` | 可空。 |
| 确认时间 | `confirmedAt` | 可空。 |
| 计算版本 | `calculationVersion` | 例如 `stage7_v1`。 |
| 计算说明 | `calculationNote` | 文本说明和 warnings 摘要。 |
| 规则快照 | `ruleSnapshot` | JSON，保存命中的主规则和扣单/扣酒明细规则。 |
| 来源快照 | `sourceSnapshot` | JSON，保存订单、明细、旅行团、旅行社、退款、人员归属等关键数据。 |
| 审计 | `createdById`、`updatedById`、`createdAt`、`updatedAt` | 保存记录生成和修改来源。 |

说明：

- 如果只设置一个通用 `ruleId`，需要额外保存 `ruleType`，否则无法区分来自哪张规则表。
- 因为一次计算可能同时命中一条提成比例规则和多条扣单/扣酒成本规则，建议使用明确外键保存主比例规则，并在 `ruleSnapshot` 中保存所有扣减规则 ID、产品名、数量、单价和金额。
- 自动重算应幂等更新同一业务键，不应每次插入重复记录。

建议索引：

- `@@index([salesOrderId])`
- `@@index([travelGroupId])`
- `@@index([afterSalesOrderId])`
- `@@index([commissionRuleId])`
- `@@index([agencyRebateRuleId])`
- `@@index([targetType])`
- `@@index([targetUserId])`
- `@@index([agencyId])`
- `@@index([isConfirmed])`
- `@@index([createdAt])`
- 可选组合索引：`@@index([targetType, targetUserId, createdAt])`
- 可选组合索引：`@@index([travelGroupId, targetType])`

建议唯一约束：

- 自动员工提成：`salesOrderId + targetType + targetUserId`。
- 旅行社日返/月返：`salesOrderId + targetType + agencyId`；若 `agencyId` 为空，则用 service 层按 `salesOrderId + targetType + agencyName` 防重。
- 品鉴师手工提成：`travelGroupId + targetType + targetUserId`。

Prisma/MySQL 对包含 nullable 字段的唯一约束行为需要谨慎评估。若字段可能为空，第一版可通过 service 层 upsert 查询键保证幂等，并配合必要的非空业务条件。

### 5.6 旅行团返积分汇总 `TravelGroupFinanceSummary`

建议表名：`travel_group_finance_summaries`。

| 字段 | 建议 Prisma 字段 | 说明 |
| --- | --- | --- |
| 主键 | `id` | UUID。 |
| 旅行团 ID | `travelGroupId` | 唯一，关联 `travel_groups.id`。 |
| 总销售额 | `totalSalesAmountCents` | 建议保存原始销售额合计。 |
| 已确认退款 | `confirmedRefundAmountCents` | 已财务确认售后退款。 |
| 有效销售额 | `effectiveSalesAmountCents` | 原始销售额 - 已确认退款。 |
| 总扣酒成本 | `totalAgencyDeductionCents` | 旅行社扣酒成本。 |
| 扣酒成本确认 | `agencyDeductionConfirmed` | 默认 false。 |
| 扣酒成本确认人 | `agencyDeductionConfirmedById` | 可空。 |
| 扣酒成本确认时间 | `agencyDeductionConfirmedAt` | 可空。 |
| 总上单金额 | `totalAgencyNetAmountCents` | 有效销售额 - 扣酒成本。 |
| 总日返金额 | `totalDailyRebateCents` | 日返合计。 |
| 总月返金额 | `totalMonthlyRebateCents` | 月返合计。 |
| 已返金额 | `paidRebateCents` | 财务填写。 |
| 未返金额 | `unpaidRebateCents` | 系统计算。 |
| 备注 | `notes` | 财务备注。 |
| 导游信息已发送 | `guideInfoSent` | 可从旧字段同步或独立维护。 |
| 旅行社信息已发送 | `travelAgencyInfoSent` | 可从旧字段同步或独立维护。 |
| 计算版本 | `calculationVersion` | 例如 `stage7_v1`。 |
| 来源快照 | `sourceSnapshot` | JSON，保存参与汇总的订单、退款和规则摘要。 |
| 审计 | `updatedById`、`createdAt`、`updatedAt` | 保存更新人和时间。 |

建议索引和约束：

- `@@unique([travelGroupId])`
- `@@index([agencyDeductionConfirmed])`
- `@@index([agencyDeductionConfirmedById])`
- `@@index([updatedAt])`
- `paidRebateCents >= 0`、`unpaidRebateCents >= 0` 由 service 层校验。
- 扣酒成本金额变化后，应自动重置 `agencyDeductionConfirmed=false` 并清空确认人和确认时间。

## 6. 建议新增枚举

当前 schema 已大量使用 Prisma enum。第 7 阶段建议继续使用 enum，并用 `@map` 映射数据库小写值。

```prisma
enum CommissionRuleTargetType {
  SALES_COMMISSION    @map("sales_commission")
  OUTREACH_COMMISSION @map("outreach_commission")
  LEADER_COMMISSION   @map("leader_commission")

  @@map("commission_rule_target_type")
}

enum CommissionTargetType {
  SALES_COMMISSION    @map("sales_commission")
  OUTREACH_COMMISSION @map("outreach_commission")
  LEADER_COMMISSION   @map("leader_commission")
  TASTER_COMMISSION   @map("taster_commission")
  AGENCY_DAILY_REBATE @map("agency_daily_rebate")
  AGENCY_MONTHLY_REBATE @map("agency_monthly_rebate")

  @@map("commission_target_type")
}
```

如果业务方后续希望后台动态新增提成类型，再考虑字典表。第一版按固定枚举更利于权限、导出和测试稳定。

## 7. 旅行社关联和规则匹配策略

### 7.1 当前状态

当前 `travel_agencies` 是独立基础资料表，`name` 唯一。当前 `travel_groups.travelAgency`、`guide_carried_groups.travelAgency`、`pending_travel_groups.travelAgency` 和 `guides.travelAgency` 都是名称文本字段，不是 `travel_agencies.id` 外键。

因此，第 7 阶段规则匹配不能假设旅行团一定有 `agencyId`。

### 7.2 推荐匹配优先级

建议按以下顺序匹配旅行社规则：

1. 如果未来订单或旅行团已有 `agencyId`，优先用 `agencyId` 匹配启用规则。
2. 当前阶段从 `travelGroup.travelAgency` 读取名称，按规范化名称匹配 `travel_agencies.name`，获得 `agencyId`。
3. 如果名称能匹配到 `travel_agencies`，优先使用该 `agencyId` 的规则，并保存 `agencyId + agencyName` 快照。
4. 如果名称无法匹配 ID，则回退到规则表的 `agencyName` 文本匹配。
5. 如果仍无规则，按扣减成本 0 或返点比例 0 处理，并在 `calculationNote/sourceSnapshot` 中记录 `missing_agency_rule` 或 `missing_agency_deduction_rule`。

名称规范化建议：

- `trim`
- 全角/半角和大小写根据实际数据再定；第一版至少去首尾空格。
- 不建议模糊匹配自动命中规则，避免把相似旅行社算错。

兼容建议：

- 第 7 阶段第一版可以不强制给 `TravelGroup` 增加 `agencyId`，先通过 `agencyName` 快照兼容历史数据。
- 如果后续希望彻底解决旅行社统计偏差，应追加 `travel_groups.agency_id` 并做只读回填清单；回填前必须确认不覆盖生产数据。
- `CommissionRecord` 和 `TravelGroupFinanceSummary.sourceSnapshot` 必须保存当次匹配到的旅行社名称、规则 ID 和规则快照，避免未来旅行社改名影响历史核算。

## 8. 第 6 阶段依赖风险

本地 schema 层面，第 6 阶段依赖已经具备：

- `after_sales_orders` 表存在。
- `AfterSalesOrder.refundAmountCents` 已落库。
- `AfterSalesOrder.financeConfirmed` 已落库。
- 售后单已关联 `SalesOrder` 和 `Customer`。
- 财务确认人和确认时间已落库。

第 7 阶段可将已财务确认售后退款作为核算调整来源。建议计算时同时保存：

- 参与扣减的售后单 ID 列表。
- 每笔售后单的 `refundAmountCents`。
- `financeConfirmed` 状态和确认时间快照。
- 未确认退款列表或金额，用于 warnings。

风险：

- 第 6 阶段云端未闭环，测试库未确认，云端第 6 阶段路由曾返回 404。第 7 阶段不得在云端执行 migrate、seed、登录或写入 smoke，除非先确认远端数据库是测试库并完成第 6 阶段云端验收。
- 第 6 阶段售后退款没有退货明细级数量。第 7 阶段第一版只能按退款金额调整有效销售额，不能按退货酒品数量自动反算扣单/扣酒成本。
- 订单状态和售后事实必须保持一致。`REFUNDED` 或 `PARTIAL_REFUND` 不能单独作为退款金额来源，金额应来自已确认售后单。

## 9. Seed 差距

当前 `seed.ts` 已有：

- 默认管理员和各角色演示账号：老板、前台、销售、财务、库管、售后、品鉴师。
- 旅行社样例：`黔程旅行社`、`导游自带`、`山水国旅`。
- 旅行团样例：有 `travelAgency`、`tasterId`、旧积分字段和旧汇总字段。
- 旅行团订单样例：`SO-20260622-031`，有关联旅行团、客户、销售人员、订单明细和金额。
- 第 6 阶段售后订单样例：部分退款、待补发、待确认退款、已退款、已取消。
- 已确认退款售后样例：如 `AS20260702001`、`AS20260702004`。
- 未确认退款售后样例：如 `AS20260702003`。
- 操作日志 seed。

当前不足：

- 没有 `commission_rules`、`sales_deduction_rules`、`agency_deduction_rules`、`agency_rebate_rules` seed。
- 没有 `commission_records` 或 `travel_group_finance_summaries` seed。
- 没有外联用户样例，也没有订单外联归属。
- 没有销售组长样例，`usr_sales_demo` 没有 `leaderId`。
- 第 6 阶段退款订单多为 `orderType='EXTERNAL'` 且 `travelGroupId=null`，不能完整验证旅行社返积分、品鉴师提成和旅行团汇总。
- `SO-20260622-031` 虽有关联旅行团和销售人员，但没有售后退款样例，不能验证第 7 阶段退款调整。
- 当前旅行社名称和 `travel_agencies.name` 可以匹配，但没有 ID 关联样例。

第 7 阶段 seed 建议新增：

1. 组长用户：例如 `usr_sales_leader_demo`，并设置 `usr_sales_demo.leaderId=usr_sales_leader_demo`。
2. 外联用户：例如 `usr_outreach_demo`，订单设置 `outreachUserId`。
3. 一组默认提成规则：销售 2%、外联 0.8%、组长 0.24%。
4. 一组销售扣单规则：覆盖 seed 订单明细产品。
5. 一组旅行社扣酒成本规则：覆盖 `黔程旅行社` 和 seed 订单明细产品。
6. 一组旅行社返点比例规则：包含日返、月返比例。
7. 一张完整核算链路订单：关联旅行团、旅行社名称、品鉴师、销售、外联、销售组长、订单明细、已确认退款和未确认退款。
8. 一张缺规则订单：验证 `missing_*_rule` warning。
9. 一张缺外联订单和一张缺组长订单：验证不生成对应提成并返回 warnings。
10. 一条品鉴师手工提成记录样例：未确认和已确认各一条。
11. 一条旅行团返积分汇总样例：未确认扣酒成本和已确认扣酒成本各一条。

所有第 7 阶段测试数据名称、备注、订单号、售后描述应继续包含 `test` 或 `smoke`。

## 10. 全局标记过滤复用建议

当前后端已有订单和售后作用域基础：

- `buildScopedSalesOrderWhere(actor, baseWhere)`
- `buildScopedAfterSalesOrderWhere(actor, baseWhere)`
- `buildGlobalSalesOrderMarkScope()`
- `assertPassesGlobalSalesOrderMarkScope(order)`

当前全局开关开启时，订单必须满足：

- 订单自身 `SalesOrder.financeMark=true`。
- 关联客户或旅行团的标记不参与该订单及其提成记录的可见性判断。

第 7 阶段应按以下方式复用：

- 提成记录列表：以 `commission_records.salesOrder -> SalesOrder` 为主路径过滤；没有订单但有旅行团的品鉴师记录，应走 `travelGroup.financeMark=true` 的旅行团作用域。
- 返积分明细：优先通过订单作用域过滤；旅行团汇总通过 `travelGroup.financeMark=true` 过滤。
- 重算接口：重算前用同一订单/旅行团作用域校验可见范围；管理员可以管理，但普通列表和导出仍应显示过滤提示。
- 导出接口：和列表使用同一 where builder，不单独拼接过滤条件。
- 售后退款参与核算：通过订单 include 售后，或在售后查询中复用 `buildScopedAfterSalesOrderWhere`，避免未标记订单的售后金额进入结果。
- 老板、财务、管理员查询口径应一致；品鉴师本人提成只返回 `targetUserId=actor.id` 且通过旅行团/订单标记过滤的数据。

实现建议：

- 不复制粘贴全局标记 where。可以把现有 private helper 抽成可复用 scope helper，或第 7 阶段第一版继续放在同一业务 service 内复用。
- `CommissionRecord` 保存快照不代表可以绕过权限过滤。列表和导出仍必须通过关联订单/旅行团实时作用域过滤。
- 对没有订单也没有旅行团的孤立记录，默认不出现在普通列表和导出中，只允许管理员通过异常数据检查入口查看。

## 11. 迁移风险

### 11.1 云端和数据安全风险

- 第 6 阶段云端未闭环前，第 7 阶段不应执行云端 migrate、seed、登录或写入 smoke。
- 未确认远端数据库是测试库前，只能做只读检查。
- 不连接生产库，不覆盖生产数据。
- 当前工作区存在多处未提交改动和未跟踪文件；后续进入 migration 前应先确认变更边界，避免混入无关修改。

### 11.2 数据兼容风险

- 新增第 7 阶段表本身对旧数据低风险，但一旦回填历史提成/积分，必须先冻结规则口径并生成计算快照。
- 旅行社当前是文本字段，旅行社改名或同名脏数据会影响规则匹配。第一版必须保存 `agencyName` 快照。
- 订单明细产品名是文本，扣单/扣酒规则按名称匹配存在错别字风险。缺规则时不应静默算错，应返回 warning。
- `User.leaderId` 可空，历史销售没有组长时不应生成组长提成。
- `outreachUserId` 新增后历史为空，不应为了补齐数据自动推断外联。
- MySQL nullable 唯一约束可能无法完全保证业务幂等，需要 service 层 upsert 查询键配合。
- Decimal 比例和 Int 金额计算要统一四舍五入到分，避免前后端金额不一致。

### 11.3 计算追溯风险

第 7 阶段要求提成和积分金额能追溯到订单、规则、售后退款和计算快照。因此不能只保存最终金额。至少需要在 `CommissionRecord` 和 `TravelGroupFinanceSummary` 保存：

- 订单 ID、旅行团 ID、旅行社 ID/名称。
- 使用的主比例规则 ID。
- 扣单/扣酒规则明细快照。
- 订单明细快照。
- 已确认售后退款明细快照。
- 目标人员归属快照：销售、外联、组长、品鉴师。
- 计算版本和 warnings。

## 12. 兼容策略

建议分阶段处理：

1. 先新增第 7 阶段规则表、记录表和汇总表，不改旧字段含义。
2. 新增 `SalesOrder.outreachUserId`，字段可空，不回填历史订单。
3. 规则表同时支持 `agencyId` 和 `agencyName`，优先 ID、兼容名称。
4. 计算记录保存完整 `ruleSnapshot` 和 `sourceSnapshot`，历史规则变更不影响已保存记录。
5. 新汇总表作为返积分权威来源；旧 `travel_groups.points`、`returned_points`、`unreturned_points`、`liquor_cost_deduction_cents`、`order_amount_cents` 只做兼容展示或由汇总服务同步。
6. 第 6 阶段售后退款只按 `financeConfirmed=true` 参与已确认核算，未确认退款进入 warnings。
7. 品鉴师手工提成修改后必须重置确认状态；自动销售、外联、组长提成默认不需要确认，但要能导出和追溯。
8. 规则修改不自动改历史记录；只有显式重算才更新可重算记录，并写操作日志。

## 13. 下一步建议

后续进入实现时，建议顺序如下：

1. 新增 `SalesOrder.outreachUserId` 和 User 反向关系。
2. 新增 `CommissionRuleTargetType`、`CommissionTargetType` 枚举。
3. 新增 `AgencyDeductionRule`、`AgencyRebateRule`、`SalesDeductionRule`、`CommissionRule`。
4. 新增 `CommissionRecord` 和 `TravelGroupFinanceSummary`。
5. 补第 7 阶段 seed：规则、组长、外联、完整核算链路订单、退款样例、缺规则样例。
6. 开发本地核算 helper 和幂等重算测试。
7. 复用现有订单/售后/旅行团全局标记过滤 helper。
8. 本地测试通过后，再根据第 6 阶段云端闭环情况决定是否进入云端只读检查和测试库确认。
