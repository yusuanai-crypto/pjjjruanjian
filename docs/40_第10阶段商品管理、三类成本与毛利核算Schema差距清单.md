# 第 10 阶段商品管理、三类成本与毛利核算 Schema 差距清单

更新日期：2026-07-11

本清单以当前 `server/api/prisma/schema.prisma`、`20260711000100_stage10_product_cost_schema`、NestJS 服务和 Flutter 实现为准。早期“待新增”规划已落地，不再作为当前差距。

## 1. 实施结论

| 范围 | 当前实现 | 状态 |
| --- | --- | --- |
| `Product` 商品主数据 | `id/name/normalizedName/unit/isActive/notes` 及创建、修改审计字段；无排序字段 | 已落地 |
| 名称去重 | `name` 唯一，`normalizedName` 全局唯一；服务端 trim + NFKC + 去空白 + 小写规范化 | 已落地 |
| `ProductActualCost` | 按商品保存多条历史，含整数分成本、生效区间、启用状态和审计字段 | 已落地 |
| 成本区间防重叠 | Service 校验 + MySQL insert/update trigger 双重防护 | 已落地 |
| `SalesOrderItem` | 新增可空 `productId`/`unit`/`actualUnitCostCents`/`actualCostSubtotalCents`/`grossProfitCents`，保留 `productName` | 已落地 |
| `TravelGroupTastingItem` | 新增可空 `productId`，保留名称、单位和 `sortOrder` | 已落地 |
| 两类扣减规则 | `SalesDeductionRule` 和 `AgencyDeductionRule` 新增可空 `productId`，保留 `productName` 快照 | 已落地 |
| 外键策略 | 四个历史关联字段均为可空且 `onDelete: SetNull`；实际成本对商品为 `Restrict` | 已落地 |
| 历史数据 | migration 只增表/列/索引/外键/约束，不删除、不重写旧业务数据 | 已落地 |
| 历史成本缺口 | 旧订单的三个成本/毛利字段保持 `null`，不使用当前成本回填 | 已落地 |

## 2. 实际 Schema 口径

### 2.1 `Product`

- `name` 长度 160，trim 后非空且唯一。
- `normalizedName` 用于规范化全局去重，唯一。
- `unit` 长度 20，trim 后必填。
- `isActive` 默认 `true`。
- `createdById` / `updatedById` 可空，用户删除时 `SetNull`。
- 不存在 `sortOrder`、库存、批次或进销存字段。

### 2.2 `ProductActualCost`

- `costCents` 为非负整数分。
- `effectiveFrom` 必填，`effectiveTo` 可空，结束日不能早于开始日。
- 同一商品可保存多条历史，启用记录的生效区间不得重叠。
- 索引覆盖 `productId + isActive + effectiveFrom/effectiveTo`。
- 该表只表示商品实际成本，不代替销售扣单成本或旅行社扣酒成本。

### 2.3 历史兼容字段

| Model | 新字段 | 兼容原则 |
| --- | --- | --- |
| `SalesOrderItem` | `productId?`, `unit?`, `actualUnitCostCents?`, `actualCostSubtotalCents?`, `grossProfitCents?` | 旧 `productName` 保留；旧成本字段为 `null` |
| `TravelGroupTastingItem` | `productId?` | 旧名称、单位、顺序正常显示 |
| `SalesDeductionRule` | `productId?` | 新写入必须传 ID；旧规则可使用规范化名称兼容匹配 |
| `AgencyDeductionRule` | `productId?` | 新写入必须传旅行社 ID + 商品 ID；重叠维度为旅行社 + 商品 + 日期 |

## 3. 迁移与数据回填

迁移文件：`server/api/prisma/migrations/20260711000100_stage10_product_cost_schema/migration.sql`。

迁移行为：

1. 创建 `products` 和 `product_actual_costs`。
2. 向四个旧表增加可空 `product_id`。
3. 向 `sales_order_items` 增加可空单位、实际成本和毛利快照。
4. 增加非空/trim/非负/日期区间约束、必要索引及成本区间防重叠 trigger。
5. 不含 `UPDATE` 旧订单成本的 SQL，不伪造历史毛利。

初始化与回填：

- 受版本控制的 16 项数据位于 `server/api/prisma/stage10-product-seed-data.js`。
- 商品库启用日在同文件的 `STAGE10_PRODUCT_CATALOG_GO_LIVE_DATE` 配置，当前为 `2026-07-11`。
- 回填脚本位于 `server/api/prisma/stage10-product-seed.js`；匹配不到、重复候选或冲突时 warning，不猜测。
- 脚本不写入旧订单成本/毛利，不改写旧名称、单位、成交价、提成或积分快照。

## 4. 当前剩余差距

| 差距 | 影响 | 处理方式 |
| --- | --- | --- |
| 本机没有可连接的 MySQL 隔离测试库 | 本轮未实际执行 `prisma migrate deploy` 和 seed 写库演练 | 在云端/本地隔离测试库按第 42 号清单执行，不得直连生产库 |
| 云端部署和 API smoke 未执行 | 不能声称第 10 阶段云端验收通过 | 需填写测试环境、版本、数据库和验收人证据 |
| 完整库存、批次成本、进销存、自动退货成本冲回、老板查看成本 | 不属于本阶段 | 保持范围外，不在 Schema 中预埋 |

## 5. 本地 Schema 验收记录

2026-07-11 实际执行：

- `prisma generate --schema prisma/schema.prisma`：通过，Prisma Client `6.19.3` 生成成功。
- `prisma validate --schema prisma/schema.prisma`：通过。
- `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`：通过，生成 44,820 字节 SQL，包含商品表、实际成本表、商品外键和毛利字段；仅属于从空库到当前 Schema 的静态演练。
- `prisma-stage10-product-schema.test.js` 和 `prisma-schema-smoke.test.js`：纳入后端全量测试并通过。
- 真实数据库 `migrate deploy` / seed：未执行，原因是本机无 `DATABASE_URL`、无 `.env`、无 MySQL 客户端且 `127.0.0.1:3306` 不可连接。

## 6. 结论

Schema 和迁移文件的第 10 阶段代码差距已关闭；当前剩余阻塞是“真实隔离 MySQL 测试库的迁移/seed 演练”和“云端 smoke”，不是 Schema 定义缺失。
