# 第 4 阶段客户和销售订单 Schema 差距清单

对照范围：

- 第 4 阶段业务口径：`docs/17_第4阶段客户和销售订单开发文档.md`
- 阶段计划和数据库设计：`docs/06_开发阶段计划.md`、`docs/05_数据库初步设计.md`
- 第 3 阶段旅行团口径和云端验收基线：`docs/13_第3阶段旅行团管理开发文档.md`、`docs/16_第3阶段云服务器测试验收清单.md`
- 当前 Prisma schema：`server/api/prisma/schema.prisma`

本文只记录 schema 差距、迁移判断和兼容策略，不修改 `schema.prisma`，不编写 migration，不连接生产库或云端数据库。

## 1. 总体结论

当前 schema 已有 `SalesOrder` / `sales_orders` 和 `SalesOrderItem` / `sales_order_items`，但还没有 `Customer` model，也没有 `customers` 表。现有销售订单仍直接保存 `customerName`、`customerPhone`、`province`、`city`、`district`、`address` 等客户快照字段。

第 4 阶段核心 schema 差距集中在三处：

1. 新增独立 `Customer` / `customers` 表，并给 `SalesOrder` 增加 `customerId` 关联。
2. 扩展 `sales_orders` 的销售单号、物流、打包、开票、财务备注等字段。
3. 扩展 `sales_order_items` 的小计、备注、排序字段。

全局“只查询已标记信息”开启后，各类业务数据独立判断自身标记：客户查询使用 `customers.finance_mark`，订单查询使用 `sales_orders.finance_mark`，旅行团查询使用 `travel_groups.finance_mark`。订单标记表示该订单及订单中保存的客户快照已经确认，关联客户或旅行团的标记不决定订单可见性。

第 3 阶段云服务器验收文档显示云端写入型 smoke 尚未闭环，且远端库名缺少明确测试标识。因此涉及云端 `migrate deploy`、seed 或写入 smoke 前，必须先确认远端连接的是测试库。本清单仅用于本地方案设计。

## 2. 当前是否已有 Customer model 或 customers 表

当前没有。

证据和判断：

- `schema.prisma` 顶部注释明确写着“独立客户、售后、提成和 AI 等完整目标表仍按后续阶段追加 migration”。
- 当前 model 列表中没有 `Customer`。
- 当前已落库业务表清单包含 `sales_orders`、`sales_order_items`，不包含 `customers`。
- 当前 `User` 关系中只有 `salesOrders`、`markedSalesOrders`，没有客户相关关系。
- 当前订单接口和 seed 都直接使用 `customerName`、`customerPhone` 和地址字段。

需要新增 `Customer` model 和 `customers` 表。第 4 阶段不建议只在现有 `sales_orders` 上继续追加客户字段，因为售后、复购、客户财务标记和全局过滤都需要稳定的客户主数据。

## 3. SalesOrder 已有字段

当前 `SalesOrder` 对应表 `sales_orders`，已有字段如下。

| 当前 Prisma 字段 | 数据库字段 | 当前类型/约束 | 第 4 阶段口径判断 |
| --- | --- | --- | --- |
| `id` | `id` | `Char(36)`，主键，UUID 默认值 | 已满足 |
| `orderNo` | `order_no` | `VarChar(80)`，唯一 | 字段和唯一约束已满足；系统生成规则还需后端加强 |
| `orderType` | `order_type` | `SalesOrderType`，默认 `TRAVEL_GROUP` | 枚举值已覆盖第 4 阶段口径 |
| `travelGroupId` | `travel_group_id` | `Char(36)`，可空，关联 `travel_groups.id`，`onDelete: SetNull` | 已有；`orderType=travel_group` 时必填需由接口校验 |
| `customerName` | `customer_name` | `VarChar(100)`，必填 | 已有，继续作为下单时客户姓名快照 |
| `customerPhone` | `customer_phone` | `VarChar(30)`，可空 | 已有，继续作为下单时客户电话快照 |
| `province` | `province` | `VarChar(60)`，可空 | 已有，继续作为地址快照 |
| `city` | `city` | `VarChar(60)`，可空 | 已有，继续作为地址快照 |
| `district` | `district` | `VarChar(60)`，可空 | 已有，继续作为地址快照 |
| `address` | `address` | `VarChar(255)`，可空 | 已有，继续作为地址快照 |
| `orderDate` | `order_date` | `Date`，必填 | 已满足 |
| `totalAmountCents` | `total_amount_cents` | `Int`，默认 `0` | 已有；第 4 阶段应以后端明细合计为准 |
| `cashOnDeliveryAmountCents` | `cash_on_delivery_amount_cents` | `Int`，默认 `0` | 已满足 |
| `remark` | `remark` | `Text`，可空 | 已满足 |
| `status` | `status` | `SalesOrderStatus`，默认 `VALID` | 枚举值已覆盖第 4 阶段口径 |
| `financeMark` | `finance_mark` | `Boolean`，默认 `false` | 已有；表示订单及订单中保存的客户快照已经确认，并决定订单在全局过滤下是否可见 |
| `markedById` | `marked_by` | `Char(36)`，可空，关联 `users.id` | 已满足订单标记审计 |
| `markedAt` | `marked_at` | `DateTime(0)`，可空 | 已满足订单标记审计 |
| `salesUserId` | `sales_user_id` | `Char(36)`，可空，关联 `users.id` | 已有；新建销售订单时销售角色应默认当前用户 |
| `createdById` | `created_by_id` | `Char(36)`，可空 | 已有 |
| `updatedById` | `updated_by_id` | `Char(36)`，可空 | 已有 |
| `createdAt` | `created_at` | `DateTime(0)`，默认当前时间 | 已满足 |
| `updatedAt` | `updated_at` | `DateTime(0)`，`@updatedAt` | 已满足 |

当前已有索引：

- `order_no` 唯一索引。
- `travel_group_id` 索引。
- `sales_user_id` 索引。
- `finance_mark` 索引。
- `marked_by` 索引。
- `order_type` 索引。
- `order_date` 索引。
- `customer_phone` 索引。
- `status` 索引。

## 4. SalesOrder 缺失字段和口径差异

第 4 阶段建议给 `sales_orders` 增加以下字段。

| 建议 Prisma 字段 | 建议数据库字段 | 建议类型/默认值 | 是否可空 | 说明 |
| --- | --- | --- | --- | --- |
| `customerId` | `customer_id` | `Char(36)` | 旧数据先可空 | 关联 `customers.id`。新建订单必须有客户，但旧订单需先兼容回填。 |
| `salesFormNo` | `sales_form_no` | `VarChar(80)` | 可空 | 线下销售单或外部单号。 |
| `logisticsMethod` | `logistics_method` | `VarChar(80)` | 可空 | 库管维护物流方式，例如韵达、安能、顺丰。 |
| `packingStatus` | `packing_status` | 建议新增 enum，默认 `PENDING` 或由服务按明细决定 | 不建议可空 | 库管打包状态。全部自带订单默认 `PACKED` 的规则更适合由服务层按明细设置。 |
| `packageCount` | `package_count` | `Int`，默认 `0` | 不建议可空 | 打包件数，后端校验非负整数。 |
| `warehouseRemark` | `warehouse_remark` | `Text` | 可空 | 库管备注。 |
| `logisticsNo` | `logistics_no` | `VarChar(120)` | 可空 | 物流单号，财务维护或核对。 |
| `logisticsFeeCents` | `logistics_fee_cents` | `Int`，默认 `0` | 不建议可空 | 运费，单位分。 |
| `invoiceRequired` | `invoice_required` | `Boolean`，默认 `false` | 不建议可空 | 客户是否需要开票，销售或售后填写。 |
| `invoiceIssued` | `invoice_issued` | `Boolean`，默认 `false` | 不建议可空 | 财务确认是否已开票。 |
| `financeRemark` | `finance_remark` | `Text` | 可空 | 财务核对备注。 |

建议新增枚举：

```text
SalesOrderPackingStatus
  PENDING  -> pending
  PACKING  -> packing
  PACKED   -> packed
  ABNORMAL -> abnormal
```

当前 `SalesOrderType`、`SalesOrderStatus`、`SalesOrderDeliveryType` 已覆盖第 4 阶段文档口径，暂不需要新增订单类型、订单状态或配送方式枚举。

不建议变更或删除的字段：

- `customerName`、`customerPhone`、`province`、`city`、`district`、`address` 必须保留，作为订单历史客户快照。
- `financeMark`、`markedById`、`markedAt` 必须保留，避免破坏旧订单标记接口、旧页面和旧测试。
- `travelGroupId` 继续可空，以兼容非旅行团订单；`orderType=travel_group` 的必填规则由后端校验承接。

## 5. SalesOrderItem 已有字段

当前 `SalesOrderItem` 对应表 `sales_order_items`，已有字段如下。

| 当前 Prisma 字段 | 数据库字段 | 当前类型/约束 | 第 4 阶段口径判断 |
| --- | --- | --- | --- |
| `id` | `id` | `Char(36)`，主键，UUID 默认值 | 已满足 |
| `salesOrderId` | `sales_order_id` | `Char(36)`，必填，关联 `sales_orders.id`，`onDelete: Cascade` | 已满足 |
| `productName` | `product_name` | `VarChar(160)`，必填 | 已满足；第 4 阶段仍不接商品库 |
| `quantity` | `quantity` | `Int`，默认 `1` | 字段已有；正整数规则由后端校验 |
| `unitPriceCents` | `unit_price_cents` | `Int`，默认 `0` | 已满足 |
| `deliveryType` | `delivery_type` | `SalesOrderDeliveryType`，默认 `SHIPPING` | 已满足 |
| `createdAt` | `created_at` | `DateTime(0)`，默认当前时间 | 已满足 |

当前已有索引：

- `sales_order_id` 索引。

当前外键：

- `sales_order_items.sales_order_id` 关联 `sales_orders.id`，删除订单时级联删除明细。

## 6. SalesOrderItem 缺失字段和口径差异

第 4 阶段建议给 `sales_order_items` 增加以下字段。

| 建议 Prisma 字段 | 建议数据库字段 | 建议类型/默认值 | 是否可空 | 说明 |
| --- | --- | --- | --- | --- |
| `subtotalCents` | `subtotal_cents` | `Int`，默认 `0` | 不建议可空 | 明细小计，旧数据可按 `quantity * unit_price_cents` 回填。 |
| `notes` | `notes` | `Text` | 可空 | 明细备注。 |
| `sortOrder` | `sort_order` | `Int`，默认 `0` | 不建议可空 | 前端展示顺序，旧数据可按创建顺序回填。 |
| `updatedAt` | `updated_at` | `DateTime(0)`，`@updatedAt` | 可选 | 当前明细只有 `createdAt`。若第 4 阶段支持整组替换，可不强制；若支持单条更新，建议补齐。 |

需要注意：

- 当前后端构造订单明细时，如果 `items` 为空，会生成空数组，不会在 schema 层阻止订单无明细。第 4 阶段“订单必须有订单明细”应由后端接口校验实现，数据库层不容易直接约束“至少一条明细”。
- 当前后端会把 `quantity` 小于 1 的值夹成 `1`，而第 4 阶段文档要求数量小于等于 0 创建失败。此项是接口行为差距，不是 schema 字段差距。
- `subtotalCents` 可存储，也可 DTO 计算。考虑财务核对和历史快照，建议落字段并由后端在创建/替换明细时写入。

## 7. 新增 Customer 表设计建议

建议新增 `Customer` model，对应 `customers` 表。

| 建议 Prisma 字段 | 数据库字段 | 建议类型/约束 | 说明 |
| --- | --- | --- | --- |
| `id` | `id` | `Char(36)`，主键，UUID 默认值 | 客户主键。 |
| `name` | `name` | `VarChar(100)`，必填 | 客户姓名。 |
| `phone` | `phone` | `VarChar(30)`，可空或应用层建议必填 | 第 4 阶段不强制唯一。 |
| `province` | `province` | `VarChar(60)`，可空 | 收货省份。 |
| `city` | `city` | `VarChar(60)`，可空 | 收货城市。 |
| `district` | `district` | `VarChar(60)`，可空 | 收货区县。 |
| `address` | `address` | `VarChar(255)`，可空 | 详细地址。 |
| `financeMark` | `finance_mark` | `Boolean`，默认 `false` | 客户财务标记主路径。 |
| `markedById` | `marked_by` | `Char(36)`，可空 | 最后一次标记操作人，建议关联 `users.id`。 |
| `markedAt` | `marked_at` | `DateTime(0)`，可空 | 最后一次标记时间。 |
| `notes` | `notes` | `Text`，可空 | 客户备注。 |
| `createdById` | `created_by_id` | `Char(36)`，可空 | 创建客户的员工 ID。 |
| `updatedById` | `updated_by_id` | `Char(36)`，可空 | 最后修改人 ID。 |
| `createdAt` | `created_at` | `DateTime(0)`，默认当前时间 | 创建时间。 |
| `updatedAt` | `updated_at` | `DateTime(0)`，`@updatedAt` | 更新时间。 |

建议关系：

- `Customer.salesOrders` 一对多关联 `SalesOrder.customerId`。
- `Customer.markedBy` 关联 `User`，`onDelete: SetNull`。
- `SalesOrder.customer` 关联 `Customer`，`onDelete: SetNull`，以避免误删客户导致历史订单丢关联失败；业务层应不提供物理删除客户。

关于 `createdById`、`updatedById`：

- 当前多数业务表保留这两个字段，但不全部建立 Prisma relation。
- 若第 4 阶段希望强化审计，可给 `customers.created_by_id`、`customers.updated_by_id` 建外键到 `users.id`，`onDelete: SetNull`。
- 若优先保持现有 schema 风格，可先只建字段和索引，由操作日志提供审计追踪。

## 8. 索引和外键差距

### 8.1 customers 建议索引

| 表 | 索引/约束 | 原因 |
| --- | --- | --- |
| `customers` | `phone` 普通索引 | 售后和销售按电话搜索；第 4 阶段不建议唯一。 |
| `customers` | `name` 普通索引 | 支持按姓名搜索。 |
| `customers` | `finance_mark` 普通索引 | 全局标记过滤和财务筛选。 |
| `customers` | `created_by_id` 普通索引 | 销售自己的客户范围和审计查询。 |
| `customers` | `updated_at` 普通索引 | 客户列表按最近更新排序或增量检查。 |
| `customers` | `marked_by` 普通索引 | 标记操作审计和关联查询。 |

不建议第 4 阶段新增：

- `customers.phone` 唯一约束。文档明确先不强制手机号全局唯一，避免代下单、家庭共用电话等真实场景保存失败。

### 8.2 sales_orders 建议新增索引

| 表 | 索引/约束 | 当前状态 | 原因 |
| --- | --- | --- | --- |
| `sales_orders` | `customer_id` 普通索引 | 缺失 | 客户详情查最近订单、按客户筛选订单。 |
| `sales_orders` | `packing_status` 普通索引 | 缺失 | 库管按打包状态查待处理订单。 |
| `sales_orders` | `logistics_no` 普通索引 | 缺失 | 财务或售后按物流单号核对。 |
| `sales_orders` | `sales_form_no` 普通索引 | 缺失，可选 | 如线下单号需要搜索，建议加。 |

当前已有且继续保留：

- `travel_group_id`
- `sales_user_id`
- `order_date`
- `order_no` 唯一索引
- `status`
- `finance_mark`
- `customer_phone`

### 8.3 sales_order_items 建议新增索引

| 表 | 索引/约束 | 当前状态 | 原因 |
| --- | --- | --- | --- |
| `sales_order_items` | `(sales_order_id, sort_order)` 组合索引 | 缺失 | 订单详情按稳定顺序加载明细。 |

当前已有并继续保留：

- `sales_order_id` 普通索引。

### 8.4 建议外键

| 表 | 字段 | 关联 | 删除策略建议 | 当前状态 |
| --- | --- | --- | --- | --- |
| `sales_orders` | `customer_id` | `customers.id` | `SetNull` | 缺失 |
| `sales_orders` | `travel_group_id` | `travel_groups.id` | `SetNull` | 已有 |
| `sales_orders` | `sales_user_id` | `users.id` | `SetNull` | 已有 |
| `sales_orders` | `marked_by` | `users.id` | `SetNull` | 已有 |
| `sales_order_items` | `sales_order_id` | `sales_orders.id` | `Cascade` | 已有 |
| `customers` | `marked_by` | `users.id` | `SetNull` | 缺失 |
| `customers` | `created_by_id` | `users.id` | `SetNull`，可选 | 缺失 |
| `customers` | `updated_by_id` | `users.id` | `SetNull`，可选 | 缺失 |

## 9. 冗余客户字段兼容策略

当前 `sales_orders` 中的 `customer_name`、`customer_phone`、`province`、`city`、`district`、`address` 不应删除，也不应在新增客户表后改为只读客户实时资料。

建议定位：

- `customers` 保存客户当前资料，用于复购、售后定位、客户标记和客户列表。
- `sales_orders.customer_*` 和地址字段保存下单时快照，用于历史订单展示、财务核对和旧客户端兼容。
- 订单创建时，如果传 `customerId`，后端读取客户当前资料并写入订单快照。
- 订单创建时，如果传新客户对象，后端在同一事务中创建客户，再把客户资料写入订单快照和 `customerId`。
- 后续修改客户资料，不反向更新历史订单快照。
- 如果业务允许修改订单收货信息，应修改订单快照字段，而不是自动修改客户主档；是否同步回客户主档需要单独确认。

迁移时的兼容顺序：

1. 先新增 `customers` 表和 nullable `sales_orders.customer_id`。
2. 保留旧订单查询对 `customerName`、`customerPhone` 的搜索。
3. 回填 `customer_id` 后，订单 DTO 同时返回 `customerId`、嵌套 `customer` 和旧快照字段。
4. Flutter 和测试完全切到新 DTO 后，旧快照字段仍继续保留，不做删除计划。

## 10. 回填策略

建议以幂等脚本或兼容 migration 回填旧订单客户。由于当前云端测试库尚未确认，不应先在云端执行。

### 10.1 客户聚合规则

建议默认聚合键：

1. `normalized(customer_phone) + normalized(customer_name)`。
2. 电话为空时，使用 `normalized(customer_name) + normalized(province/city/district/address)`。
3. 姓名为空理论上不应存在，因为当前 `customer_name` 必填；如遇异常数据，记录到人工审计清单，不自动创建客户。

手机号不做唯一约束，因此聚合结果只是回填策略，不代表业务上同一手机号只能有一个客户。

### 10.2 客户字段来源

每个聚合客户建议取：

- `name`：聚合键中的客户姓名。
- `phone`：聚合键中的客户电话，可空。
- `province/city/district/address`：优先取该聚合组最近订单的非空地址快照。
- `notes`：可空；不建议自动拼接订单备注，避免污染客户主档。
- `createdById`：可取该组最早订单的 `createdById` 或 `salesUserId`。
- `updatedById`：回填执行人或最近订单的 `updatedById`。
- `createdAt`：可取该组最早订单 `createdAt`。
- `updatedAt`：回填执行时间或最近订单 `updatedAt`。

### 10.3 financeMark 回填建议

`sales_orders.finance_mark` 与 `customers.finance_mark` 是两个独立业务标记，迁移时不得互相级联或推导：

1. 不覆盖 `sales_orders.finance_mark`，保留每张订单原有确认状态。
2. `customers.finance_mark` 按客户主档独立初始化和复核，不从该客户历史订单标记聚合推导。
3. 标记订单时不得级联修改关联客户或旅行团；标记客户或旅行团时也不得修改历史订单标记。

### 10.4 幂等要求

回填脚本必须满足：

- 可重复执行，不重复造客户。
- 每次执行前能先 dry-run 输出将创建多少客户、将回填多少订单、多少订单无法匹配。
- 对已存在 `customer_id` 的订单不覆盖，除非显式传入修复模式。
- 不覆盖订单客户快照字段。
- 输出无法自动处理的异常数据清单，例如同聚合键下地址差异过大、标记混合、电话格式异常。

## 11. 全局标记过滤差距

当前后端统一口径：

- `buildGlobalCustomerMarkScope(true)` 返回 `Customer.financeMark = true`。
- `buildGlobalSalesOrderMarkScope(true)` 返回 `SalesOrder.financeMark = true`，不生成客户或旅行团关联条件。
- `buildGlobalTravelGroupMarkScope(true)` 返回 `TravelGroup.financeMark = true`。
- 售后单通过关联销售订单继承订单自身标记规则。
- 订单列表、关键词搜索、详情、旅行团详情中的订单、导出、统计、提成、排名和 AI 查询必须复用相同订单作用域。
- 关闭开关后不附加标记条件，仍按原有角色和数据范围查询。

兼容要求：

- 旧订单即使没有 `customer_id`，仍可按订单自身 `financeMark` 判断。
- 保留 `/api/sales-orders/:id/finance-mark`，页面文案明确为“订单标记”。
- `/api/customers/:id/finance-mark` 和旅行团标记接口只修改对应实体，不级联修改订单。

## 12. 旧测试数据、seed 和旅行团订单概要影响

### 12.1 seed 影响

当前 `server/api/prisma/seed.ts` 直接 upsert 示例销售订单：

- `orderNo = SO-20260622-031`
- `customerName = 王女士`
- `customerPhone = 13800006621`
- 地址字段直接写在订单上
- 明细只有 `productName`、`quantity`、`unitPriceCents`、`deliveryType`
- 没有 `Customer`，没有 `customerId`
- 没有物流、打包、开票字段

第 4 阶段 schema 变更后 seed 需要调整：

1. 先 upsert 示例客户。
2. 创建或更新销售订单时 connect `customerId`，并继续写入客户快照字段。
3. 给订单补 `salesFormNo`、`packingStatus`、`logisticsMethod`、`logisticsNo`、`logisticsFeeCents`、`invoiceRequired`、`invoiceIssued`、`financeRemark` 等示例值或默认值。
4. 给明细补 `subtotalCents`、`notes`、`sortOrder`。
5. seed 中至少覆盖一个邮寄订单，方便库管打包页本地验证。
6. seed 中至少覆盖一个客户标记示例，方便财务和全局过滤本地验证。

### 12.2 测试影响

当前后端测试和 helpers 仍大量按旧订单结构创建测试数据：

- 创建订单时传 `customerName`、`customerPhone`，不传 `customerId`。
- 全局标记测试通过 `setSalesOrderFinanceMark` 标记订单。
- 订单 DTO 只断言旧客户快照字段和订单 `financeMark`。
- 测试 helper 的 in-memory 数据结构没有 `customers` 集合。

第 4 阶段需要同步更新测试：

- 增加 customer model/schema smoke 断言。
- 增加客户 CRUD、客户标记和客户筛选测试。
- 新建订单测试覆盖：使用已有客户、新建客户、缺客户失败。
- 全局标记测试覆盖订单自身标记矩阵，并分别覆盖客户、旅行团自身标记查询。
- 订单标记接口测试保留，并断言它不级联修改客户或旅行团标记。
- 明细测试增加 `subtotalCents`、`notes`、`sortOrder`。
- 库管和财务字段接口测试增加物流、打包、开票字段。

### 12.3 旅行团订单概要影响

当前旅行团详情 DTO 会 include `salesOrders`，并通过 `toTravelGroupOrderSummaryDto` 返回：

- `orderNo`
- `orderType`
- `orderDate`
- `customerName`
- `customerPhone`
- `totalAmountCents`
- `cashOnDeliveryAmountCents`
- `status`
- `financeMark`
- `markedById`
- `markedAt`
- `salesUserId`

当前 `orderSummary` 汇总所有 include 出来的订单数量、总金额和货到付款金额。第 4 阶段影响：

1. 订单概要应增加 `customerId` 和嵌套客户标记状态，至少让前端区分客户标记与订单标记。
2. 全局标记开启后，旅行团详情中的 `salesOrders` 概要只保留订单自身 `financeMark=true` 的订单。
3. 有效订单判断应继续只计算 `valid`、`partial_refund`，不应把 `refunded`、`cancelled` 算作出单。
4. 如果后续订单状态修改接口落地，旅行团 `orderSummary`、品鉴师待总结规则和旅行团汇总金额需要跟随状态变化重新计算或动态计算。
5. 当前创建订单时会直接累加旅行团 `salesAmountCents`、`orderAmountCents`、`cashOnDeliveryCents`。如果后续允许订单状态、金额、明细修改，需要设计反向调整或改为动态汇总，否则旧累计字段会产生漂移。

## 13. 迁移风险

### 13.1 数据兼容风险

- 旧订单没有 `customer_id`，新增字段第一版必须允许为空。
- 如果 migration 直接把 `customer_id` 设为 `NOT NULL`，旧测试数据和已有环境会失败。
- 如果删除或重命名订单客户快照字段，旧 Flutter、seed、测试和旅行团订单概要都会破坏。
- 如果把 `customers.phone` 设为唯一，真实业务中的代下单、家庭共用电话、历史重复手机号可能导致回填失败。
- 如果将 `sales_orders.finance_mark` 直接改名或删除，当前财务标记接口和全局过滤测试会失败。

### 13.2 全局过滤风险

- 不得把客户或旅行团标记误用为订单可见条件，否则会让已确认订单消失，或让未确认订单越权可见。
- 列表、详情、导出、统计、售后和 AI 若未复用同一作用域，会形成后端权限边界不一致。
- 多实例部署时，全局开关的实时事件还需要 Redis Pub/Sub 等跨实例广播，普通 GET 始终作为最终状态来源。

### 13.3 订单金额风险

- 当前 `totalAmountCents` 可由前端传入，若不传则后端按明细计算。
- 第 4 阶段要求以后端明细计算为准，迁移时不要重算并覆盖旧订单总额，除非先做差异审计。
- 新增 `subtotalCents` 时，旧明细可回填为 `quantity * unitPriceCents`，但不应顺手改旧订单总额。

### 13.4 云端风险

- `docs/16_第3阶段云服务器测试验收清单.md` 记录云端写入型 smoke 未执行，远端库名显示为 `jiangjiu`，缺少 `test` 或 `staging` 标识。
- 未确认测试库前，只能做只读检查，不能执行 `migrate deploy`、seed 或写入 smoke。
- 第 4 阶段新增客户和订单字段会影响核心数据表，误连生产库风险高于普通页面改动。

## 14. 兼容策略

1. 新增 `customers` 表，不重建 `sales_orders`。
2. 第一版 `sales_orders.customer_id` 允许为空；新建订单由后端强制必须有客户，旧订单通过回填逐步补齐。
3. 保留订单客户快照字段，所有 DTO 继续返回 `customerName`、`customerPhone`、地址字段。
4. 保留 `sales_orders.finance_mark` 和 `/api/sales-orders/:id/finance-mark`。
5. 新增客户标记字段和 `/api/customers/:id/finance-mark`；客户、订单、旅行团按各自标记独立过滤。
6. 明细新增字段使用默认值并回填，不删除现有明细字段。
7. 物流、打包、开票字段新增时给安全默认值：金额和件数默认 `0`，布尔默认 `false`，文本可空。
8. 新增枚举 `SalesOrderPackingStatus` 时确认 MySQL enum 值和 Prisma enum 映射，避免和旧数据冲突。
9. 所有新增写入和回填都必须写操作日志或生成审计报告；回填脚本至少要有 dry-run。
10. 第 5 阶段二维码、Excel 导出、第 6 阶段完整售后、第 7 阶段提成积分不在本次 schema 差距清单范围内展开。

## 15. 建议 schema 变更顺序

1. 新增 `Customer` model 和 `customers` 表，包含客户标记字段和基础索引。
2. 给 `SalesOrder` 增加 nullable `customerId` 和 `customer` relation，新增 `customer_id` 索引。
3. 给 `SalesOrder` 增加 `salesFormNo`、物流、打包、开票、财务备注字段和必要索引。
4. 新增 `SalesOrderPackingStatus` enum，或先用字符串字段过渡；若沿用项目现有风格，建议使用 enum。
5. 给 `SalesOrderItem` 增加 `subtotalCents`、`notes`、`sortOrder`，可选增加 `updatedAt`。
6. 编写本地 dry-run 回填脚本：从旧订单快照生成客户并回填 `customer_id`。
7. 更新 seed 先创建客户，再创建订单并连接客户。
8. 更新后端订单 DTO 和查询 include，确保新旧字段同时返回。
9. 更新全局标记过滤测试，确认客户、订单、旅行团分别只判断自身 `financeMark`。
10. 所有本地测试通过且确认云端为测试库后，才能考虑云端 migrate、seed 和 smoke。
