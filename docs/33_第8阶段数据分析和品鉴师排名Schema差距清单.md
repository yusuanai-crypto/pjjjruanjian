# 第 8 阶段数据分析和品鉴师排名 Schema 差距清单

本文对照 `docs/31_第8阶段数据分析和品鉴师排名开发文档.md`、阶段计划、PRD、功能拆分、数据库初步设计、第 7 阶段开发文档、Schema 差距清单和云服务器测试验收清单，检查当前 `server/api/prisma/schema.prisma`、后端模块和 Flutter 数据分析页面现状。

本次只做文档检查，不修改 `schema.prisma`，不新增 migration，不连接生产库，也不做云端写入。当前工作区已有多处未提交改动和未跟踪文件，本清单只新增本文档，不回滚或覆盖既有改动。

## 1. 总体结论

- 第 8 阶段第一版需要的核心源数据字段基本已落库：旅行团、订单、订单明细、售后退款、客户标记、旅行团标记、提成记录和旅行团财务汇总均已有模型基础。
- 当前没有 analytics 相关 Prisma model/table，也没有 `analytics_daily_snapshots` 或 `taster_daily_snapshots`。按第 8 阶段文档，第一版可以先不新增统计快照表，优先实时聚合源数据。
- 当前后端没有 analytics module/controller/service，只有角色菜单中已有 `analytics` 入口标识。
- 当前 Flutter `apps/mobile_desktop/lib/features/analytics/analytics_page.dart` 仍是静态指标和 `_tasterRankingRecords` 假数据，没有调用 `BusinessApi`，`BusinessApi` 也没有 analytics 方法。
- 字段层面没有必须立即补的字段；索引层面建议补 5 个组合索引，主要服务日期范围、状态、旅行团、品鉴师和全局标记过滤查询。
- 第 7 阶段云端验收未闭环，且 `docs/30_第7阶段云服务器测试验收清单.md` 记录第 7 阶段核心接口在云端仍返回 `404`、远端测试库未确认。因此第 8 阶段云端 migrate、seed、登录、写入 smoke 必须继续等待。

## 2. 源模型字段检查

### 2.1 `SalesOrder`

结论：第 8 阶段销售额、打蛋率有效订单判断、订单追溯所需字段和关系均已存在。

| 检查项 | 当前状态 | 说明 |
| --- | --- | --- |
| `orderDate` | 已有 | `orderDate DateTime @map("order_date") @db.Date`，适合订单经营口径日期范围。 |
| `status` | 已有 | `SalesOrderStatus` 含 `valid`、`partial_refund`、`refunded`、`cancelled`。 |
| `travelGroupId` | 已有 | 可关联旅行团，用于团维度统计、打蛋率和品鉴师排名。 |
| `customerId` | 已有 | 可关联客户，用于客户追溯；客户标记不参与订单可见性判断。 |
| `totalAmountCents` | 已有 | 订单原始销售额，单位分。 |
| `financeMark` | 已有 | 订单自身确认标记，决定订单在全局过滤下是否可见。 |
| `items` | 已有 | `SalesOrderItem[]`，可追溯订单明细。 |
| `afterSalesOrders` | 已有 | 可追溯售后退款记录。 |

兼容提醒：
- 订单统计开启全局过滤时只依赖 `SalesOrder.financeMark=true`，不附加 `customer.financeMark` 或 `travelGroup.financeMark` 条件。
- `travelGroupId` 是可空字段。订单经营指标沿用订单自身标记作用域；品鉴师排名、团均、人均、打蛋率等旅行团本体口径仍要求旅行团自身标记作用域通过。

### 2.2 `AfterSalesOrder`

结论：第 8 阶段退款扣减和售后追溯所需字段已存在。

| 检查项 | 当前状态 | 说明 |
| --- | --- | --- |
| `refundAmountCents` | 已有 | 退款金额，单位分。 |
| `financeConfirmed` | 已有 | 已确认退款才扣减统计净销售额。 |
| `salesOrderId` | 已有 | 必填关系，可回到订单、客户和旅行团作用域。 |
| `createdAt` | 已有 | 可按文档第一版建议作为售后记录日期范围字段。 |

兼容提醒：
- `AfterSalesOrder` 没有独立 `financeMark`，统计过滤应通过 `salesOrder` 复用订单作用域。
- 当前还存在 `financeConfirmedAt`。若后续业务决定“退款进入统计”的日期应按财务确认时间而非售后创建时间，则需要同步调整口径和索引；第一版按文档建议先使用 `financeConfirmed + createdAt`。

### 2.3 `TravelGroup`

结论：第 8 阶段接待指标、品鉴师排名、打蛋率和旅行团追溯所需字段和关系均已存在。

| 检查项 | 当前状态 | 说明 |
| --- | --- | --- |
| `visitDate` | 已有 | `visitDate DateTime @map("visit_date") @db.Date`，用于接待/品鉴师口径。 |
| `guestCount` | 已有 | 接待人数和人均销售额分母。 |
| `tasterId` | 已有 | 品鉴师排名主归属字段。 |
| `tasterName` | 已有 | 品鉴师展示快照，适合人员被改名或删除后的展示兜底。 |
| `groupType` | 已有 | 可支持团型筛选。 |
| `financeMark` | 已有 | 旅行团全局标记过滤核心字段。 |
| `salesOrders` | 已有 | 可回溯该团订单并计算团维度销售额。 |

兼容提醒：
- `tasterId` 可空。第 8 阶段应按文档归入“未分配品鉴师”，并返回 warning。
- 品鉴师排名应按 `visitDate` 范围筛旅行团，再汇总关联订单和售后，不应简单按 `SalesOrder.orderDate` 排名。

### 2.4 `Customer`

结论：全局标记过滤所需客户字段已存在。

| 检查项 | 当前状态 | 说明 |
| --- | --- | --- |
| `financeMark` | 已有 | 客户已标记是订单作用域过滤的必要条件。 |

### 2.5 `CommissionRecord` 和 `TravelGroupFinanceSummary`

结论：第 7 阶段表已落库，但第 8 阶段第一版核心统计不建议以它们作为主事实源。

| 模型 | 当前状态 | 第 8 阶段读取建议 |
| --- | --- | --- |
| `CommissionRecord` | 已有 | 可用于提成/积分相关页面、交叉核对、风险提示；不建议作为经营销售额、退款额、打蛋率和品鉴师销售排名主来源。 |
| `TravelGroupFinanceSummary` | 已有 | 可用于旅行团返积分和财务汇总核对；第 8 阶段看板第一版建议仍按 `TravelGroup`、`SalesOrder`、`AfterSalesOrder` 实时聚合，保证可追溯。 |

原因：
- 第 8 阶段统计页只读，不重新计算或改写第 7 阶段提成积分。
- 每个统计指标都要能追溯到原始旅行团、订单或售后记录，直接读源表更透明。
- 第 7 阶段云端尚未闭环，直接依赖第 7 阶段接口或汇总结果会放大部署和口径风险。

## 3. Analytics 表和快照表

当前 `schema.prisma` 和 migrations 中未发现 analytics 相关 model/table：

- 未发现 `Analytics*` model。
- 未发现 `analytics_daily_snapshots`。
- 未发现 `taster_daily_snapshots`。
- 仅有第 7 阶段的 `sourceSnapshot`、`ruleSnapshot` 等计算快照字段。

第一版建议：
- 不新增统计快照表。
- 直接实时聚合 `travel_groups`、`sales_orders`、`after_sales_orders`。
- 只有在本地压测证明实时聚合明显变慢后，再设计 `analytics_daily_snapshots` 或 `taster_daily_snapshots`。

## 4. 当前索引差距

### 4.1 已有且可复用的索引

| 表 | 已有索引 | 支持场景 |
| --- | --- | --- |
| `sales_orders` | `orderDate` | 订单经营口径日期范围。 |
| `sales_orders` | `status` | 排除取消订单、筛有效订单。 |
| `sales_orders` | `travelGroupId` | 按旅行团汇总订单。 |
| `sales_orders` | `customerId` | 订单到客户追溯。 |
| `sales_orders` | `financeMark` | 订单自身标记查询。 |
| `after_sales_orders` | `salesOrderId` | 按订单找售后。 |
| `after_sales_orders` | `financeConfirmed` | 已确认退款过滤。 |
| `after_sales_orders` | `createdAt` | 售后日期范围。 |
| `after_sales_orders` | `(financeConfirmed, createdAt)` | 已支持文档要求的确认状态 + 创建时间查询。 |
| `travel_groups` | `visitDate` | 接待日期范围。 |
| `travel_groups` | `tasterId` | 品鉴师过滤/归属。 |
| `travel_groups` | `financeMark` | 旅行团全局标记过滤。 |
| `travel_groups` | `groupType` | 团型筛选。 |
| `customers` | `financeMark` | 客户全局标记过滤。 |
| `commission_records` | `salesOrderId`、`travelGroupId`、`afterSalesOrderId`、`targetType`、`targetUserId`、`(targetType, targetUserId, createdAt)`、`(travelGroupId, targetType)` | 第 7 阶段提成积分读取和交叉核对。 |
| `travel_group_finance_summaries` | `travelGroupId` 唯一、`agencyDeductionConfirmed`、`updatedAt` | 第 7 阶段旅行团返积分汇总读取。 |

### 4.2 建议补充的组合索引

这些索引本次只列建议，不修改 schema，不写 migration。

| 优先级 | 建议索引 | 当前状态 | 主要原因 |
| --- | --- | --- | --- |
| P1 | `sales_orders(order_date, status)` / Prisma `@@index([orderDate, status])` | 缺失 | overview 的出单销售额、净销售额、状态过滤会高频按日期范围 + 状态聚合。 |
| P1 | `sales_orders(travel_group_id, status)` / Prisma `@@index([travelGroupId, status])` | 缺失 | 打蛋率、品鉴师排名、团维度销售额需要快速判断某团是否有有效订单。 |
| P1 | `after_sales_orders(sales_order_id, finance_confirmed)` / Prisma `@@index([salesOrderId, financeConfirmed])` | 缺失 | 计算每个订单/每批订单的已确认退款时更直接。 |
| P1 | `travel_groups(visit_date, taster_id)` / Prisma `@@index([visitDate, tasterId])` | 缺失 | 品鉴师排名按到店日期筛团，再按品鉴师归组。 |
| P1 | `travel_groups(visit_date, finance_mark)` / Prisma `@@index([visitDate, financeMark])` | 缺失 | 全局标记开启后，接待指标和排名需要按 visitDate + 已标记旅行团过滤。 |
| P2 | `travel_groups(visit_date, group_type)` / Prisma `@@index([visitDate, groupType])` | 缺失 | 若第 8 阶段开放团型筛选，可减少日期范围 + 团型查询成本。 |

暂不建议第一轮补统计快照表索引，因为第一版不新增快照表。

## 5. 后端 Analytics 现状

当前 `server/api/src/modules` 下没有 analytics 目录，也没有 analytics controller/service/module。`AppModule` 未导入 AnalyticsModule。

已有相关基础：
- `BusinessDataNestService` 中已有订单、售后、旅行团的私有作用域 helper。
- `Commissions` 相关 service 中已有提成/旅行团汇总的全局标记过滤逻辑。
- `OperationLogsModule` 已存在，可供第 8 阶段导出操作写日志。
- 角色菜单中已有 `analytics` 入口标识，老板和管理员菜单包含数据分析。

差距：
- 缺少统一日期范围 helper。
- 缺少 analytics 查询作用域 helper。
- 缺少 `/api/analytics/overview`、`/api/analytics/taster-rankings`、详情、source 明细、trends、export API。
- 缺少 analytics API 权限测试、全局标记过滤测试和导出日志测试。

## 6. Flutter Analytics 现状

当前 `apps/mobile_desktop/lib/features/analytics/analytics_page.dart` 仍是假数据页面：

- 指标卡片写死 `38265000`、`2180000`、`286`、`18.6%` 等静态数值。
- 品鉴师排名使用本地常量 `_tasterRankingRecords`。
- 风险提示使用 `AppRecordList` 静态样例。
- 页面没有调用 `BusinessApi`。
- `BusinessApi` 当前没有 `getAnalyticsOverview`、`listTasterRankings`、`getAnalyticsTrends`、source 明细或导出方法。

兼容策略：
- 后续改造时保留当前日期预设和 UI 骨架，但数据源必须改为后端 API。
- 不允许前端本地过滤替代后端全局标记过滤。
- ranking、detail、source、export 必须使用同一套后端作用域。

## 7. 全局标记过滤复用方案

第 8 阶段不应复制一套新的 `financeMark` where 条件，应复用或抽出已有订单/旅行团作用域。

建议抽象为 analytics 统一 scope helper：

| 作用域 | 建议规则 |
| --- | --- |
| 订单作用域 | 复用现有 `buildGlobalSalesOrderMarkScope` 逻辑：开启全局标记过滤时，只要求订单自身 `SalesOrder.financeMark=true`。 |
| 旅行团作用域 | 复用现有 `buildGlobalGroupMarkScope` 逻辑：开启全局标记过滤时，要求 `travel_groups.finance_mark=true`。 |
| 售后作用域 | 不给售后单另建标记口径，统一通过 `salesOrder` 套订单作用域。 |
| 品鉴师排名作用域 | 先按旅行团作用域筛 `visitDate` 范围内的团，再在这些团的关联订单和售后中聚合金额。 |
| 明细和导出作用域 | 与 overview/ranking 使用同一 helper 生成的 where，不能绕开统计作用域重新拼条件。 |
| 第 7 阶段表作用域 | 如果读取 `CommissionRecord`，优先通过 `salesOrder` 过滤；没有订单但有旅行团的记录，通过旅行团作用域过滤。读取 `TravelGroupFinanceSummary` 时通过 `travelGroup.financeMark` 过滤。 |

注意：
- `SalesOrder.financeMark` 是订单查询、统计、导出、售后和 AI 订单数据的统一标记条件；analytics 不得另行叠加客户或旅行团标记条件。
- 打蛋率、团均、人均、品鉴师排名都属于旅行团口径，必须以过滤后的旅行团集合为分母。

## 8. 迁移风险

当前不需要新增字段或新增表。若后续按本文建议补组合索引，主要风险是索引 DDL：

- 大表加索引可能锁表或拖慢写入；虽然当前预计数据量不大，仍应在本地和测试库先执行。
- Prisma 生成的索引名需检查是否超过数据库限制，必要时使用 `map` 指定稳定索引名。
- `sales_orders(order_date, status)`、`travel_groups(visit_date, taster_id)` 等组合索引会增加写入成本，但第 8 阶段统计读多写少，收益大于成本。
- 不新增统计快照表时没有快照回填风险；后续若新增快照表，则需要处理历史回填、口径版本、重算幂等和源数据变更后的同步问题。

## 9. 兼容策略

- 第一版保持源表实时聚合，不改源数据结构。
- 销售额默认按 `SalesOrder.orderDate`；接待、打蛋率和品鉴师排名默认按 `TravelGroup.visitDate`。
- 金额统一使用分字段，避免浮点误差。
- `cancelled` 订单不进入原始出单销售额；`valid`、`partial_refund`、`refunded` 按第 8 阶段文档口径进入原始出单销售额，再扣减已确认售后退款。
- 售后退款只统计 `financeConfirmed=true` 的记录；未确认退款可进入 warnings，不扣减净销售额。
- `tasterId` 为空的旅行团归入“未分配品鉴师”，并在 warnings 中提示。
- 导出写 `operation_logs`；普通 overview、ranking、trend 读取不写日志。
- 所有统计页面只读，不修改订单、旅行团、售后、提成或积分源数据。

## 10. 第 7 阶段依赖风险

第 8 阶段本地文档和本地开发可以继续推进，但云端写入必须等待第 7 阶段闭环：

- `docs/30_第7阶段云服务器测试验收清单.md` 记录第 7 阶段核心接口云端仍返回 `404`。
- 远端数据库是否为测试库尚未确认。
- 未确认测试库前，不执行云端 `migrate`、`seed`、登录或写入 smoke。
- 第 8 阶段统计依赖第 6 阶段售后退款事实和第 7 阶段提成积分口径稳定；云端第 7 阶段未闭环前，第 8 阶段只做本地开发、测试和文档。

## 11. 后续建议

1. 在后续 schema/migration 提示词中只补组合索引，不新增统计快照表。
2. 先开发 analytics 日期范围 helper 和统一作用域 helper，避免 overview、ranking、detail、export 各写各的过滤条件。
3. 用本地 seed 准备可人工核算样例，覆盖订单、旅行团、售后、未确认退款、未分配品鉴师、全局标记过滤。
4. 后端 API 完成后再改 Flutter 假数据页面，前端只消费后端结果，不自行决定统计口径。
