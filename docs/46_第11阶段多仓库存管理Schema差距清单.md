# 第 11 阶段多仓库存管理 Schema 差距清单

更新日期：2026-08-01

## 2026-08-01 仓库目录增量状态

本轮新增 migration：`20260801000200_warehouse_directory`，未修改既有 migration。

已完成：

- `warehouses.parent_warehouse_id` 自外键、父仓索引、自关联 CHECK、默认仓必须为父仓 CHECK。
- `warehouses_two_levels_insert/update` 触发器，阻止把子仓作为父仓，以及把已有子仓的仓库改成子仓。
- `warehouse_product_configurations` 表，包含启用状态、创建/修改人和时间，`warehouse_id + product_id` 唯一。
- Prisma 的 Warehouse 父子关系、Product/Warehouse/User 反向关系。
- 服务端变更父仓前检查历史事实；有库存、批次、流水、占用、单据、调拨、盘点、逐瓶、售后收货或履约历史时拒绝。
- 默认仓和订单履约仓父仓约束；订单占用/出库继续只读写履约父仓的本仓余额。
- 父仓查询对所有直属子仓做数据库全量聚合；逐瓶商品按真实逐瓶状态计算本仓/汇总现存、占用和不可售，并保留正式调拨投影中的在途口径。
- 默认预览、显式 `--apply` 的幂等历史配置回填脚本，来源为余额、批次、流水和逐瓶事实。

部署注意：migration 只扩展结构，不自动写生产业务数据。必须先预览回填候选及样本，确认生产数据状态后再执行应用模式。回滚应用代码时，数据库保持 expand 后的可空父仓列和新增配置表，不应缩回旧 schema 或删除已有配置历史。

> 复核日期：2026-07-27  
> 依据：`docs/44_第11阶段多仓库存管理开发文档.md`、`docs/39` 至 `docs/43`、当前 Prisma Schema、全部 migration、API/Flutter 实现及现有测试。  
> 本文第 1 至 15 节保留第 01 条执行时的基线事实；后续实现状态以第 0 节为准。

## 0. 实施状态更新（第 12 条：库存查询报表与角色化 Excel）

更新时间：2026-07-27。

### 0.1 已完成

第 02 条的 expand 库存底座已经落入当前工作树：`InventoryTrackingMode.QUANTITY`、兼容保留 `ALLOCATED` 的逐瓶状态扩展、Warehouse/Configuration/Stock/Batch/Document/Movement/CommandReceipt/Reservation/Transfer/StockAlertConfig/模式切换审计模型、订单和逐瓶的可空关联，以及数据库 CHECK、唯一键、Restrict/SetNull 外键和流水 UPDATE/DELETE 禁止触发器。对应 migration 为：

- `server/api/prisma/migrations/20260727000300_inventory_expand_foundation/migration.sql`

本次第 03 条新增并完成：

- 独立 `InventoryModule`、`InventoryNestController`、`InventoryAccountingService`、`InventoryPrismaRepository`、提交后补偿服务和逐瓶适配边界；入口位于 `server/api/src/modules/inventory`。
- 内部记账命令：入库、占用、释放、出库、调拨出库进入在途、调拨实收减少在途并增加目标仓、转不可售、恢复可售和整单冲销。
- 所有数量写命令只接受 `QUANTITY`；`NONE` 稳定返回 `INVENTORY_TRACKING_DISABLED`，`SERIALIZED` 稳定返回 `INVENTORY_SERIALIZED_ADAPTER_REQUIRED`，普通数量入口不会修改逐瓶记录。
- 命令先规范化非空 `sourceKey/idempotencyKey` 并校验规范请求 SHA-256 `requestHash`。同 key 同 hash 返回第一次结果；同 key 不同 hash 返回 `INVENTORY_IDEMPOTENCY_KEY_CONFLICT`；来源重复返回 `INVENTORY_SOURCE_KEY_CONFLICT`。HTTP request ID 只写追踪字段，不参与业务 hash。
- 每个事务先创建 `InventoryCommandReceipt`，再读取余额/批次/占用版本，写 POSTED Document/Line 和不可变 Movement，使用 `updateMany(id + version)` 更新 Stock/Batch/Reservation 快照，最后在同一事务写字段白名单 OperationLog、补偿任务和成功回执。
- Stock 的 `onHandQty` 可为负；服务端实时计算 `availableQty/shortageQty`。`reservedQty/unavailableQty/inTransitQty` 在服务端、数据库 CHECK 两层禁止为负。
- 调拨实收涉及两个仓库余额时按固定的 `warehouseId + productId` 顺序处理，降低死锁风险；每侧有独立 movement 和 `lastMovementId`。
- 冲销创建独立 REVERSAL 单据和逐条反向 movement；`reversalOfDocumentId` 与 `reversalOfMovementId` 一对一唯一，同一单据不能冲销两次；原 movement 不做 UPDATE/DELETE。
- Movement 新增可空 `reservationId`，使占用、释放、消费及其冲销能够重建 Reservation 快照。
- 新增持久化 `InventoryPostCommitTask`。库存事实提交后才尝试刷新派生状态；失败只更新补偿任务，不回滚或重放库存事实。每分钟补偿到期任务，并回收超过 5 分钟的 `PROCESSING` 陈旧锁。
- 提供按仓库+商品只读 `GET /api/inventory/rebuild-check`，从全部原始和冲销 movement delta 重算 Stock，并逐批次重算 received/remaining/unavailable；提供管理员 `POST /api/inventory/repair-preview`，仅返回建议补丁和 checksum，明确 `writeApplied=false`。
- 新库存服务未查询或依赖全局 `financeMark`/“只看已标记信息”开关。
- 新 migration `server/api/prisma/migrations/20260727000400_inventory_accounting_core/migration.sql` 仅扩展 `reservation_adjustment` 单据类型、Movement 到 Reservation 的可空外键和提交后补偿表；无 INSERT、历史 UPDATE 或生产配置硬编码。

本次命令的余额语义：

| 命令 | onHand | reserved | unavailable | inTransit |
| --- | ---: | ---: | ---: | ---: |
| 入库（可售） | `+qty` | 0 | 0 | 0 |
| 入库（不可售） | `+qty` | 0 | `+qty` | 0 |
| 占用 | 0 | `+qty` | 0 | 0 |
| 释放占用 | 0 | `-qty` | 0 | 0 |
| 无占用出库 | `-qty` | 0 | 0 | 0 |
| 消费占用并出库 | `-qty` | `-qty` | 0 | 0 |
| 调拨出库 | `-qty` | 0 | 0 | `+qty`（来源仓） |
| 调拨实收 | `+qty`（目标仓） | 0 | 0 | `-qty`（来源仓） |
| 转不可售/恢复可售 | 0 | 0 | `+qty/-qty` | 0 |
| 冲销 | 对原 movement 四类 delta 全部取反 | | | |

新增自动化测试：

- `server/api/test/inventory-accounting-core.test.js`：内存事务回滚夹具覆盖正常命令、负库存/shortage、三类非负约束、两段调拨、幂等和 hash 冲突、sourceKey、并发无丢失更新、模式隔离、成本字段权限、Stock/Batch 重建、管理员零写入预览、事务失败全回滚、提交后失败不重复事实和单次冲销。
- `server/api/test/inventory-accounting.mysql.test.js`：仅在同时设置隔离库 URL 与 `INVENTORY_TEST_DATABASE_CONFIRMED=1` 时运行，验证真实 MySQL 两个并发命令不丢更新及 movement 触发器拒绝 UPDATE/DELETE；当前未连接数据库时明确 skip。
- `server/api/test/prisma-schema-smoke.test.js`：验证第二个 migration 的 enum、表、非空 sourceKey CHECK、唯一键、索引、Restrict 外键、纯 expand 和无数据回填。

### 0.2 第 04 条已完成：仓库主数据、库存总览与字段权限

本次不修改 Prisma Schema 或 migration，不接入库业务单、销售订单自动库存事件或 Flutter。复用第 02/03 条库存底座，新增：

- `InventoryQueryService` 与 `InventoryQueryPrismaRepository`，与写库存事实的 `InventoryAccountingService` 分离。Stock、Batch、Movement 和逐瓶数据只从库存模型读取，不查询 `ProductActualCost`、扣单、提成或旅行社成本。
- 后端角色矩阵：`super_admin/admin` 可管理仓库与预警配置并读取数量/库存采购成本；`warehouse` 只读仓库、数量、非成本批次和流水；`finance/boss` 只读数量及本库存模块的采购成本；`sales/after_sales/taster/front_desk` 均在服务入口返回 `PERMISSION_DENIED`。
- 成本权限在 Prisma `select` 阶段执行：warehouse 查询不选择 `InventoryBatch.purchaseUnitCostCents/costStatus`、`SerializedInventoryUnit.purchaseCostCents` 或 `InventoryMovement.purchaseUnitCostCents`，服务 DTO 也使用白名单，不依赖通用 sanitizer 或客户端隐藏。
- `availableQty = onHandQty - reservedQty - unavailableQty`、`shortageQty = max(0,-availableQty)` 在服务端实时计算。最低库存边界为启用配置下 `availableQty <= minimumAvailableQty`；这些派生值不落库。
- QUANTITY 成本只来自剩余批次采购价；SERIALIZED 成本只来自仍在库逐瓶采购价。返回库存金额、成本覆盖数量和覆盖状态前检查 JS 安全整数；不会回读或改写现有商品实际成本与历史订单成本。
- 仓库新建/修改和默认仓切换使用 `Serializable` 事务。切换时在同一事务清理旧 `activeDefaultKey` 并设置新默认仓，数据库可空唯一键和 CHECK 继续保证最多一个启用默认仓。
- 停用仓库前检查非零 Stock、活动 Reservation、在库逐瓶、DRAFT 库存单据和未完成调拨；命中时稳定返回 `INVENTORY_WAREHOUSE_HAS_ACTIVE_BUSINESS`。历史 Movement 不会被删除，当前默认仓必须先由另一次事务化变更替换。
- 仓库与预警配置生效操作在同一事务写 OperationLog，只记录仓库主数据/阈值白名单，不记录采购成本。异常日志和遗留 OperationLog 读取/Excel 导出的纵深清洗新增库存数量、采购成本、成本覆盖和瓶码字段；新业务 DTO 仍必须前置投影，不能把该清洗当作权限边界。未知异常响应只返回稳定公共错误。
- `GET /api/inventory/rebuild-check` 已收紧为仅 `super_admin/admin`；仍为只读，不覆盖余额。

当前项目未安装 `@nestjs/swagger`，也没有 OpenAPI decorator/生成流程。本次沿用项目的阶段文档接口契约方式，不引入一套未落地的 Swagger 依赖。第 04 条接口契约如下：

| Method/Path | 允许角色 | 主要输入/输出 |
| --- | --- | --- |
| `GET /api/inventory/warehouses` | admin、warehouse、finance、boss | `q/isActive/isDefault/page/pageSize`；返回仓库安全 DTO 与分页 |
| `POST /api/inventory/warehouses` | admin | `code/name/address?/managerUserId?/isActive?/isDefault?` |
| `PATCH /api/inventory/warehouses` | admin | body 中 `id` 或 `warehouseId` 加变更字段 |
| `PATCH /api/inventory/warehouses/:id` | admin | 与集合 PATCH 等价的显式 ID 别名 |
| `GET /api/inventory/stocks` | admin、warehouse、finance、boss | `warehouseId/warehouse/productId/product/inventoryTrackingMode/batchId/batch/hasShortage/isLowStock/hasUnavailable/page/pageSize` |
| `GET /api/inventory/stocks/:warehouseId/:productId` | admin、warehouse、finance、boss | 返回可信数量、预警状态、批次非成本字段；有成本角色另含库存采购成本 |
| `GET /api/inventory/movements` | admin、warehouse、finance、boss | `warehouseId/productId/inventoryTrackingMode/batchId/batch/movementType/dateFrom/dateTo/page/pageSize` |
| `GET /api/inventory/alert-configs` | admin、warehouse、finance、boss | `warehouseId/productId/enabled/page/pageSize` |
| `PATCH /api/inventory/alert-configs` | admin | `warehouseId/productId` 加 `minimumAvailableQty` 或 `enabled` |
| `GET /api/inventory/rebuild-check` | admin | 必填 `warehouseId/productId`；零写入重建校验 |

字段投影：

| 响应面 | warehouse | admin/finance/boss |
| --- | --- | --- |
| Stock 数量 | onHand/reserved/unavailable/inTransit/available/shortage | 相同 |
| 批次 | 供应商、采购单号、生产批次/日期、数量、FIFO 时间 | 另含采购单价分、批次库存金额和成本状态 |
| Stock 成本 | 不查询、不返回 | `inventoryCost`（仅批次/逐瓶库存采购成本） |
| Movement 成本 | 不查询、不返回 | 可返回流水采购单价分和库存金额分 |
| 错误与 OperationLog | 不含采购价、库存金额、成本覆盖或瓶码；预警配置日志只记录阈值主数据 | 写日志仍使用同一业务白名单 |

本步没有新增库存 Excel 导出端点；既有普通订单/售后/公开二维码/AI/OperationLog 导出没有接入库存读模型。新增负向测试向这些投影注入仓库、库存数量、稳定库存行键和采购成本字段，验证白名单结果不传播注入值；库存导出留在后续报表条目，并必须复用同一角色字段集合。

新增测试：

- `server/api/test/inventory-query-api.test.js`：完整角色矩阵、Prisma 成本列前置裁剪、warehouse 字段防泄露、finance/boss/admin 成本视图、负库存/shortage、最低库存等值边界、不可售筛选、分页、默认仓并发、停用守卫、预警配置权限/校验/日志及管理员 rebuild-check。
- `server/api/test/sales-sheet-dto.helper.test.js`、`ai-tools-service.test.js`、`business-data.test.js`、`after-sales-orders.test.js`、`operation-logs-audit.test.js`、`api-exception-filter.test.js`：公开二维码、AI、普通订单、售后、OperationLog 列表/详情/Excel 和异常详情的库存/成本字段注入负向回归。

### 0.3 第 05 条已完成：期初、采购/其他入库与成本补录

本次继续不接销售订单自动库存事件、不开发 Flutter，并把第 03 条的通用记账入口收紧为可独立验证的入库业务闭环：

- 新增 expand-only migration `server/api/prisma/migrations/20260727000500_inventory_inbound_cost_flow/migration.sql`：`InventoryDocument.attachmentMetadata Json?` 保存受限附件元数据；`InventoryBatch.openingEntryKey String? @unique` 配合非空白 CHECK 保存服务端生成的 `opening:<warehouseId>:<productId>`。migration 只有可空列、CHECK 和唯一索引，没有 INSERT、历史 UPDATE、默认仓/阈值/上线时间硬编码，也没有执行到任何数据库。
- 期初、采购入库和其他入库统一走 `InventoryAccountingService.businessInbound`；入库直接生成 POSTED Document/Line、InventoryBatch、不可变 Movement、Stock/Batch 快照、OperationLog、补偿任务和成功回执，全部位于同一 Serializable 事务。`POST /api/inventory/inbounds` 与兼容入口 `POST /api/inventory/commands/inbound` 均使用该严格入口，不存在 controller 直接改余额的旁路。
- 入库按单行、单仓、单商品、整数瓶记账；新批次必须显式提供规范化非空 `batch.sourceLineKey`。`purchaseOrderNo` 与 `productionBatch` 是保留前导零的字符串，允许为空或业务重复；相同仓库/商品/采购单号/生产批次可以分多次收货，真正的重复边界是唯一 `sourceLineKey/sourceKey/idempotencyKey`，重复 source line 稳定返回 `INVENTORY_SOURCE_LINE_KEY_CONFLICT`。
- `warehouse/admin/super_admin` 可生效期初、采购和其他入库，无审批草稿；`finance` 不能改数量或创建入库。warehouse 请求只允许供应商、采购单号、生产批次、生产日期、数量、备注和附件元数据，提交采购价稳定返回 `INVENTORY_COST_FIELD_FORBIDDEN`。
- 附件仅保存 `fileName/contentType/sizeBytes/checksumSha256` 白名单元数据，最多 20 项；不接受路径、URL、下载 token 或任意扩展字段。本步不新增文件上传/下载存储。
- 期初仅在 `InventoryConfiguration.goLiveAt` 已配置、`maintenanceMode=true` 且业务时间不晚于 go-live 时生效；每次请求只录一个仓库+商品。服务预检查加数据库 `openingEntryKey` 唯一约束共同保证同一仓库商品至多一个期初批次，并返回 `INVENTORY_OPENING_WORKFLOW_NOT_CONFIGURED/NOT_ACTIVE`、`INVENTORY_OPENING_AFTER_GO_LIVE` 或 `INVENTORY_OPENING_ALREADY_EXISTS`。仓库名称、默认仓和真实 `goLiveAt` 仍是上线配置，不写入 migration/seed。
- 新批次未提交采购成本时写 `costStatus=PENDING`，入库同时增加 `onHandQty` 和 `unavailableQty`，批次 `remainingQty/unavailableQty` 同步增加；待成本批次不能用普通“恢复可售”或显式批次出库绕过成本状态。
- `finance/admin/super_admin` 使用 `PATCH /api/inventory/batches/:id/cost` 补录或维护非负整数分成本。首次补齐成本在同一事务写 `UNAVAILABLE_ADJUSTMENT` 单据和 `UNAVAILABLE_OUT` 流水，把该批次当前不可售量从 Stock/Batch 快照释放为可售；后续单价维护写新的 POSTED 状态单据但不伪造数量 movement。两类写入都抢占 `InventoryCommandReceipt`、校验 request hash、使用 Batch/Stock version 条件更新并写补偿任务。
- 成本修改 OperationLog 使用专用 `inventory.batch_cost.updated`，明确记录批次、before/after 单价分、成本状态和版本；该日志仍只有管理员日志权限可读。warehouse 的入库/查询 Prisma `select` 和 DTO 在读取前排除采购单价、金额与成本覆盖字段。
- `GET /api/inventory/inbounds`、`GET /api/inventory/inbounds/:id` 提供显式角色投影；warehouse 可读单据、供应商、采购单号、生产批次/日期、数量、备注和安全附件元数据但 Prisma 不选择成本列；finance/admin/boss 可在本库存模块读取批次采购价和库存金额。
- `GET/PATCH /api/inventory/configuration` 提供库存启用配置读取和管理员维护；修改写安全 OperationLog。权限目录新增 configuration/inbounds/batch-cost 权限，但没有扩大 boss 到 `ProductActualCost`、扣单、提成或旅行社成本写/读接口。
- 已生效入库没有数量编辑或物理删除 API。`POST /api/inventory/inbounds/:id/reverse` 必须填写原因，只允许冲销 OPENING/PURCHASE_RECEIPT/OTHER_IN，并生成独立冲销单和反向流水；若待成本不可售转换尚未先冲销，则稳定返回 `INVENTORY_INBOUND_COST_DEPENDENCY_EXISTS`，防止批次快照变负。纠错后用新 source/idempotency/sourceLine 创建正确入库。
- 批次消耗事实继续由带 `batchId` 的 Movement 保存，`remainingQty` 只是可重建快照；无批次的负库存部分仍由库存成本读模型明确为 `uncoveredQty`。本步没有自动 FIFO 跨批次分摊。
- 成本命令不查询、不更新 `ProductActualCost`，也不修改订单成本快照、毛利、扣单、提成、积分或历史口径。

第 05 条接口契约：

| Method/Path | 允许角色 | 说明 |
| --- | --- | --- |
| `GET /api/inventory/configuration` | admin、warehouse、finance、boss | 返回 go-live、策略版本和维护模式，不含成本 |
| `PATCH /api/inventory/configuration` | admin | 维护 `goLiveAt/policyVersion/maintenanceMode` |
| `GET /api/inventory/inbounds` | admin、warehouse、finance、boss | 按仓库、商品、类型、状态、批次和日期筛选分页；成本字段按角色前置投影 |
| `GET /api/inventory/inbounds/:id` | admin、warehouse、finance、boss | 返回单据、单行批次和安全附件元数据 |
| `POST /api/inventory/inbounds` | admin、warehouse | 创建并立即生效 OPENING/PURCHASE_RECEIPT/OTHER_IN |
| `POST /api/inventory/inbounds/:id/reverse` | admin、warehouse | 必填原因；只冲销本阶段三类入库 |
| `PATCH /api/inventory/batches/:id/cost` | admin、finance | 幂等补录/维护采购单价分；不能改数量 |

新增/扩展测试：

- `server/api/test/inventory-accounting-core.test.js`：覆盖 warehouse 成本拒绝、finance 数量拒绝、待成本入库、可售转换、价格维护、ProductActualCost 哨兵不变、幂等/hash 冲突、重复 sourceLine、相同采购单号/生产批次允许分次收货、并发重复、期初流程/唯一性、前导零、附件白名单、冲销原因、普通恢复旁路拒绝和事务全回滚。
- `server/api/test/inventory-query-api.test.js`：覆盖配置和入库路由、完整读取角色矩阵、warehouse 入库成本列 Prisma 前置裁剪、finance/admin/boss 成本 DTO，以及附件任意字段不传播。
- `server/api/test/prisma-schema-smoke.test.js`：覆盖新可空字段、opening 非空白 CHECK/唯一索引、采购单号/生产批次不被误设唯一、metadata-lock 演练注释和 migration 零数据写入。
- `server/api/test/auth-users-settings.test.js`：更新角色权限目录快照，确认 warehouse 只有入库/调拨/不可售数量写权限、finance 只有批次成本写权限、boss 保持库存成本只读。

### 0.4 第 06 条已完成：多仓调拨、分次收货、差异与不可售

本次继续不接销售订单自动库存事件、不开发 Flutter，并将第 03 条的底层两段调拨记账收口为独立、可审计的调拨业务单闭环：

- 新增 expand-only migration `server/api/prisma/migrations/20260727000600_inventory_transfer_unavailable_flow/migration.sql`。`InventoryDocumentType` 与 `InventoryMovementType` 增加 `TRANSFER_DIFFERENCE`；`InventoryTransfer` 增加调出 `sourceKey/idempotencyKey/requestHash` 信封及 `version`；`InventoryTransferLine` 增加新行必填的规范化 `sourceLineKey`、跟踪模式快照、累计不可售数量、逐瓶 ID 契约 JSON 和 `version`；`InventoryTransferReceipt` 增加 `version`。数据库 CHECK 约束调出信封全有或全无、hash 格式、累计数量关系、差异行备注和非负版本，并为调出 source/idempotency 与明细 sourceLine 建唯一索引。
- migration 只扩 enum、可空列、带默认值版本列、CHECK 和唯一索引，不回填历史调拨、不创建仓库、不猜默认仓、不改变现有库存事实。MySQL enum metadata lock 和索引建立必须先在目标版本的隔离副本演练；本次未执行任何数据库 migration。
- 新增调拨业务命令：创建 DRAFT、确认调出、分次确认实收、收货冲销和未收货调出冲销。每个命令先抢占 `InventoryCommandReceipt` 并校验规范化 `sourceKey/idempotencyKey/requestHash`，在 Serializable 事务内写业务单、单据、单据行、不可变流水、版本化余额、角色安全 OperationLog、提交后补偿任务和成功回执。
- 调拨创建要求来源仓与目标仓不同、两仓启用、每个商品只出现一次、每行有稳定 `sourceLineKey`。DRAFT 不写库存事实。QUANTITY 可按整数瓶调拨；NONE 稳定拒绝。SERIALIZED 创建时必须提交数量一致、非空且无重复的 `unitIds`，当前只保存适配契约；确认调出稳定返回 `INVENTORY_SERIALIZED_TRANSFER_STATE_ADAPTER_PENDING`，实际逐瓶仓库/状态联动继续留到第 08 条。
- 调出确认只允许 DRAFT 且只能成功一次：来源仓 `onHand -= qty`、来源仓 `inTransit += qty`，允许普通商品来源仓形成负库存并在返回的调拨行显示 `shortageWarning/sourceShortageQty`。调出单保存独立调出幂等信封、确认人/角色/时间和版本。
- 每次调入确认创建独立 `InventoryTransferReceipt/Line`，保存自己的 `sourceKey/idempotencyKey/requestHash`、确认人/角色/时间、实际收到、其中不可售数量、差异数量和备注；支持部分、多次收货。累计 `received + difference` 不得超过已调出数量，并通过事务、固定 Stock 锁顺序和 line/transfer version 条件更新抵抗并发超收。
- 正常实收使来源仓 `inTransit -= received`、目标仓 `onHand += received`；其中损坏实收同时使目标仓 `unavailable += unavailableQty`。明确少收/丢失时必须提交差异原因和行备注，写 `TRANSFER_DIFFERENCE` 不可变事实，使来源在途减少但不虚增目标 onHand。原流水不修改；收货纠错生成 REVERSAL 单据、反向流水和独立冲销 receipt，并恢复累计值/在途快照。
- 未发生任何收货或差异前可直接理由化冲销调出；一旦已有 receipt/difference，必须先逐笔冲销具体 receipt，使累计实收、不可售与差异全部回到零，才允许再冲销原调出。每一步都生成独立反向单据/流水并保留全部历史；同一 receipt 和同一调出事实不能冲销两次。
- 可售转不可售与不可售恢复端点必须填写原因，只改变 `unavailableQty`，不改变 `onHandQty`；继续复用库存领域服务、不可变流水、幂等回执和版本条件更新。`unavailableQty` 不得为负。
- 查询新增调拨列表/详情，按来源仓、目标仓、商品、状态、日期和分页过滤。每行返回服务端计算的来源/目标 Stock 指标、剩余在途、短缺警告和公司总量；公司总量统一为该商品所有仓 `sum(onHandQty) + sum(inTransitQty)`，与流水重建的在途口径一致。第 13 条 Flutter 调拨页面必须直接消费这些可信字段，不在客户端重算或隐藏负数。
- 角色边界：`super_admin/admin/warehouse` 可创建、调出、收货、冲销和转换不可售；`finance/boss` 只读；`sales/after_sales/taster/front_desk` 后端拒绝。warehouse 的 Prisma 调拨投影不选择采购单价；finance/boss 可读本库存模块采购成本但不返回逐瓶 ID；admin/warehouse 可读调拨逐瓶契约。未扩大 `ProductActualCost`、扣单、提成、旅行社成本或订单成本权限。
- 原先公开的原子 `commands/transfer-out`、`commands/transfer-in` 路由已移除，controller 不能绕开 `InventoryTransfer/Receipt` 业务事实直接改余额；底层方法只保留为领域内部兼容与核心记账测试入口。

第 06 条接口契约：

| Method/Path | 允许角色 | 说明 |
| --- | --- | --- |
| `GET /api/inventory/transfers` | admin、warehouse、finance、boss | 按来源/目标仓、商品、状态、日期分页；数量、短缺和公司总量由服务端计算，成本/瓶码按角色前置投影 |
| `GET /api/inventory/transfers/:id` | admin、warehouse、finance、boss | 返回调出单、累计明细、调出单据、独立 receipts、差异/冲销事实 |
| `POST /api/inventory/transfers` | admin、warehouse | 创建 DRAFT；每行必填稳定 `sourceLineKey`，SERIALIZED 必须给 `unitIds` |
| `POST /api/inventory/transfers/:id/outbound` | admin、warehouse | 幂等确认调出；来源 onHand 转为来源 inTransit |
| `POST /api/inventory/transfers/:id/receipts` | admin、warehouse | 幂等部分/多次实收，可显式记录不可售和理由化差异 |
| `POST /api/inventory/transfers/receipts/:receiptId/reverse` | admin、warehouse | 理由化冲销单次收货，保留原 receipt/流水 |
| `POST /api/inventory/transfers/:id/outbound/reverse` | admin、warehouse | 无收货时可直接冲销；有历史收货时须先逐笔冲销至累计归零 |
| `POST /api/inventory/unavailable/mark` | admin、warehouse | 必填原因；onHand 不变、unavailable 增加 |
| `POST /api/inventory/unavailable/restore` | admin、warehouse | 必填原因；onHand 不变、unavailable 减少且不得为负 |

本次新增/扩展测试覆盖：正常调出/调入、重复确认、部分/多次收货、并发超收只有一个成功、差异与 receipt 冲销、不可售公式、负库存短缺、公司总量守恒、事务失败回滚、角色写权限、warehouse 成本防泄露、finance/boss 瓶码防泄露、Prisma 前置列裁剪、路由契约和 migration CHECK/唯一键/零回填。

### 0.5 第 07 条已完成：普通商品订单占用、出库、释放与换仓

本次仅接入 `QUANTITY` 普通商品，不开发 Flutter，不改变 `NONE` 旧行为，也不改写现有 `SERIALIZED/ALLOCATED` 逐瓶流程：

- 新增 `SalesOrderInventoryService` 作为订单与库存领域之间的唯一适配层。`BusinessDataNestService` 只在现有订单事务内传入订单前后快照，不直接更新 `WarehouseProductStock`、`InventoryMovement` 或库存批次；实际占用、释放和正式出库继续由 `InventoryAccountingService` 写单据、不可变流水、版本化快照、回执、OperationLog 和提交后任务。
- 七条现有写路径均已覆盖：`POST /api/sales-orders`、`PATCH /:id/sales-edit`、通用 `PATCH /:id`、`PATCH /:id/finance` 中的状态、`PATCH /:id/status`、`PATCH /:id/packing`，以及复用同一 packing service 的 `PATCH /api/warehouse/orders/:id/packing` 别名。销售一次编辑同时提交 status、finance、packing 或 items 时也使用同一前后态同步，不存在旁路。
- 库存启用边界由 `InventoryConfiguration.goLiveAt/policyVersion/maintenanceMode` 决定。启用后的新普通订单在事务内查找唯一 `activeDefaultKey=ACTIVE_DEFAULT` 的启用默认仓，由服务端写入 `fulfillmentWarehouseId/inventoryAppliedAt/inventoryPolicyVersion`；客户端提交订单库存字段或明细 `inventoryLineKey` 稳定返回 `INVENTORY_FIELD_SERVER_OWNED`。
- 每个新 `QUANTITY` 明细由服务端生成 `inventory-line:<uuid>` 稳定键。订单更新即使继续使用兼容的 item delete/recreate，也按旧明细匹配保留该键；库存占用与自动命令从不使用会变化的 `SalesOrderItem.id` 作为业务幂等边界。替换商品会生成新键，客户端不能伪造或覆盖。
- shipping 明细保存为占用；self-pickup 明细先建立占用事实再在同一事务消费占用并正式出库；混合订单逐行处理。未出库 shipping 编辑按稳定键只生成实际数量差额的 reserve/release；明细移除释放占用。普通商品可形成负 onHand/available，订单保存和出库不被阻塞。
- shipping 首次进入 `PACKED` 才消费占用并出库；重复保存 PACKED、财务字段、物流号、备注、标记或其他不改变库存目标态的编辑均不生成新 movement。未出库取消/退款只释放占用；已出库取消/退款不自动返库。任一已出库明细更换商品、数量或配送方式稳定返回 `INVENTORY_OUTBOUND_ITEM_IMMUTABLE`，要求走售后履约或库存纠错。
- 出库前 `admin/super_admin/warehouse` 可通过 packing 路径换仓；同一事务先释放原仓占用，再把零占用 Reservation 的履约仓迁移到目标启用仓并重新占用。已有任一明细出库后禁止换仓。finance 无换仓写权限，sales-edit 也不接受履约仓字段。
- 自动订单事件使用规范化、非空的稳定 `sourceKey/idempotencyKey` 和规范请求 SHA-256 `requestHash`；同一订单 `inventoryVersion` 通过条件更新抢占，库存命令回执和 Stock/Reservation 版本共同抵抗并发。相同目标态重复写返回已有事实或零 movement，不会重复占用/出库。
- 订单写入、客户/旅行团汇总、库存命令、库存 OperationLog 仍处于同一个 Serializable 外层事务。库存审计任一步失败会回滚订单状态、单据、流水、余额、占用和回执；提交成功后才分发 `InventoryPostCommitTask`，派生刷新失败只进入补偿重试，不会重放库存事实或佣金副作用。
- `orderType=AFTER_SALES` 的财务负向销售订单在创建和后续同步两处都被明确排除，即使其状态为 PACKED 且明细为 SELF_PICKUP，也不写 `inventoryAppliedAt`、不生成占用或出库。真正的 RESEND/EXCHANGE 仍必须等独立售后履约命令。
- `inventoryAppliedAt` 为空的历史订单继续兼容读取和非库存字段编辑，不补稳定行键、不回填默认仓、不生成流水。历史 PACKED/SELF_PICKUP 不被当作真实出库证明。
- 提交后投影新增 `InventoryAlert` expand-only 表和 migration `20260727000700_sales_order_inventory_alerts`。稳定 `alertKey` 对每个订单库存行生成/解决 `ORDER_SHORTAGE` 预警，不保存具体短缺数、成本或瓶码；只为 warehouse/admin/super_admin 生成安全 Todo，sales 无接收人且订单响应最多保持原有业务状态，不返回缺货数量。
- 普通订单 DTO、列表、详情、公开二维码、Excel、AI 和 OperationLog 仍使用各自显式白名单；未新增履约仓、库存启用边界、稳定行键、Stock、Reservation、Movement、逐瓶内部状态或采购成本字段。销售创建响应和查询均不返回 onHand/reserved/available/shortage。

新增/扩展测试：

- `server/api/test/sales-order-inventory-integration.test.js`：覆盖七条写路径、服务端默认仓与行键、混合配送、编辑差额、换仓、PACKED 幂等、取消/恢复/退款、负库存、历史订单、AFTER_SALES 排除、并发 PACKED 单次出库、事务审计失败全回滚、缺货预警/Todo 角色和字段防泄露，以及列表/详情负向投影。
- `server/api/test/helpers/phase1-api.js`：补齐订单库存、预警、Todo 和补偿任务的事务型测试 delegate；失败回滚会恢复全部库存与订单快照。
- `server/api/test/prisma-schema-smoke.test.js`：验证 `InventoryAlert` 枚举、稳定非空键 CHECK、唯一索引、查询索引、Restrict 外键、纯 expand 和零数据回填。
- 库存核心/查询、普通订单、物流、售后、提成触发、二维码/销售单 DTO、Excel、AI 和 OperationLog 测试作为本条回归面；具体结果见第 0.10 节。

### 0.6 第 08 条已完成：逐瓶多仓、Assignment、订单配瓶与调拨状态联动

本次仅改造后端和数据一致性，不开发 Flutter，不迁移历史 `ALLOCATED`，也不对任何数据库执行 migration：

- 新增 expand-only migration `server/api/prisma/migrations/20260727000800_serialized_inventory_unification/migration.sql` 与 `SerializedInventoryAssignment`。Assignment 使用非空唯一 `sourceKey` 记录 Reservation、Unit、`RESERVED/OUTBOUND/RELEASED` 状态、成本快照和各阶段操作者/时间；可空唯一 `activeUnitKey` 配合数据库 CHECK 保证只有 `RESERVED` 分配持有 `activeUnitKey=serializedUnitId`，从而一瓶不能同时被两张订单有效占用。事实外键均为 Restrict，人员审计外键为 SetNull。
- `SerializedInventoryStatus.ALLOCATED` 继续保留，既有 `RESERVED/OUTBOUND/UNAVAILABLE` 扩展继续使用；本次 migration 无历史 UPDATE、状态替换、仓库猜测或默认仓回填。生产代码没有新的 `ALLOCATED` 写入，历史空 `warehouseId` 或 `ALLOCATED` 瓶不会进入新可售池。
- 新建逐瓶库存统一由 `SerializedInventoryAccountingAdapter.createUnits` 在 Serializable 事务内完成：校验启用仓和 SERIALIZED 商品，抢占 CommandReceipt/校验 requestHash，创建 POSTED Document/Line、逐瓶 Movement、Unit 与 WarehouseProductStock 快照，并写安全 OperationLog/提交后补偿任务。每个新 Unit 必填 `warehouseId`，物流码规范化唯一，批次序号和物流码继续以字符串保存前导零。
- 待补成本瓶以 `PENDING_COST` 计入 `onHand+1/unavailable+1`；finance/admin/super_admin 补齐非负成本后，使用 Unit `id+version+status` 条件更新转 `AVAILABLE`，写 `UNAVAILABLE_OUT` 流水并减少 unavailable。warehouse 的请求、响应和列表都不包含 `purchaseCostCents`，且无法提交成本。采购逐瓶成本不会覆盖 `ProductActualCost` 或历史普通订单成本口径。
- 订单继续先按稳定 `inventoryLineKey` 建立数量需求 Reservation。shipping 保存只增加需求占用，不由 sales 选瓶；sales 提交 `serializedUnitIds` 稳定返回 `SERIALIZED_SELECTION_SERVER_MANAGED`，访问 `/serialized-inventory/available` 返回 `PERMISSION_DENIED`。库管首次 PACKED 可按每个稳定行键提交 `serializedAssignments.unitIds`，事务内将实际选中的瓶原子化为 OUTBOUND；数量大于可售瓶数时未配部分保留为 reservation shortage，不生成假瓶码、假成本或假出库。
- self-pickup 按 `factoryDate、productionBatch、batchSerialNo、normalizedLogisticsCode、id` 的稳定 FIFO 顺序自动匹配；仅实际匹配瓶进入 OUTBOUND 并形成订单成本快照，不足部分继续是未配需求。订单可保存且库存履约保持 PARTIAL，不能把缺瓶部分伪装成完成。shipping 已 RESERVED 的瓶在取消、减量、移除或换仓前先以 RELEASED Assignment、Unit AVAILABLE 和逐瓶 RELEASE movement 原子释放。
- 逐瓶出库成本只汇总有效 Assignment 的成本快照；未配瓶时订单行毛利保持未知而不是伪造逐瓶成本。Unit 上旧 `salesOrderId/salesOrderItemId/orderCostSnapshotCents` 暂时作为兼容镜像保留，新分配真相是稳定行键关联的 Reservation + Assignment，不依赖可变 `SalesOrderItem.id`。
- SERIALIZED 调拨创建必须逐瓶传 `unitIds`。调出时逐瓶使用 `warehouseId+productId+AVAILABLE+version` 条件更新到 OUTBOUND，写每瓶 TRANSFER_OUT movement，并更新来源 onHand/inTransit；部分/多次实收按 receipt 独立保存实际 unit IDs，逐瓶原子切换目标仓和 AVAILABLE/UNAVAILABLE，差异瓶进入理由化 VOID。receipt/outbound 冲销通过反向流水和条件状态恢复，不修改原流水。
- `GET /api/inventory/rebuild-check` 对 SERIALIZED 商品新增只读四方校验：从 Movement 重建 Stock，并核对 Unit 状态、有效 Assignment、Reservation 的 assigned/outbound 快照、OUTBOUND Assignment 的 SALES_OUT 流水，以及 Unit onHand/unavailable 与 WarehouseProductStock。历史 ALLOCATED 单独报告为 `SERIALIZED_LEGACY_ALLOCATED_REQUIRES_CLASSIFICATION`；管理员预览仍为零写入。
- 普通销售订单 DTO 不返回稳定行键、逐瓶分配、瓶码、仓库或成本。只有 super_admin/admin/warehouse 的订单履约投影返回实际 assigned/outbound/unassigned 和最小瓶码字段；该投影不查询或返回采购成本。公开二维码、销售单/Excel、AI、售后关联订单和 OperationLog 继续使用各自显式白名单/纵深清洗，原 Word 物流单导出格式和模板未改。
- 新增只读脚本 `server/api/scripts/plan-serialized-inventory-cutover.ts`。它只扫描 `ALLOCATED` 并输出 `writesPerformed=false` 的 JSON：资料完整的有效未打包 shipping 仅列候选 RESERVED，shipping+PACKED 仅列候选 OUTBOUND；self-pickup、CANCELLED/REFUNDED、缺订单/明细、混合配送、缺仓/成本/瓶资料或其他不确定数据全部列人工确认/冲突，不写库、不进入新可售池。

新增/扩展测试：

- `serialized-inventory-accounting.test.js`：多仓逐瓶入库、待成本/补成本、分配、释放、部分出库、不足、调拨状态/version、前导零，以及 Unit/Assignment/Movement/Stock/Reservation 四方一致性。
- `serialized-sales-order-inventory.test.js`：shipping 需求、库管配瓶、PACKED 仅实际瓶出库和 self-pickup FIFO 不足不造假。
- `serialized-inventory-cutover-preview.test.js`：ALLOCATED 分类只预览且不猜测不完整、混合、自提和终态订单。
- `serialized-inventory.mysql.test.js`：使用两个真实 Prisma Client 和 Serializable 事务抢同一 Unit，断言只有一个订单成功、一个有效 Assignment；仅当 `INVENTORY_TEST_DATABASE_URL` 指向名称含 test/testing/ci/local 且显式 `INVENTORY_TEST_DATABASE_CONFIRMED=1` 时运行，拒绝 production 名称。
- `moutai-serialized-inventory.test.js`、`prisma-schema-smoke.test.js` 与原 DOCX 测试扩展角色投影、warehouse 成本防泄露、sales 禁止选码、ALLOCATED 保留、新代码 Assignment 约束和纯 expand migration。

### 0.7 第 09 条已完成：售后实际收货、返库、冲销与独立补发履约

本次只实现后端、Prisma expand migration 和测试，不开发 Flutter，不执行数据库 migration，也不从历史退款或旧库管确认推导收货事实：

- 复用既有 `AfterSalesOrderItem` 作为唯一售后商品主明细，新增兼容字段 `returnRequired/expectedReturnQty/postedReceivedQty/returnVersion`。新建售后单只有显式提交 `returnRequired=true` 且给出 `0 < expectedReturnQty <= quantity` 才进入退货流程；普通退款、历史商品行、`financeConfirmed`、退款金额、售后状态和旧 `warehouseConfirmedById/At/Note` 均不会被反推为应退或已收。migration 对历史数据只应用 `false/0/0/0` 默认值。
- 新增 `AfterSalesReceipt`、`AfterSalesReceiptLine`、`AfterSalesReceiptSerializedUnit` 以及 `DRAFT/POSTED/REVERSED`、`SALEABLE/UNAVAILABLE/EXCEPTION`、`MATCHED/UNKNOWN/CONFLICT` 枚举。Receipt 保存实际收货仓、创建/生效/冲销三组独立稳定 `sourceKey/idempotencyKey/requestHash` 信封、确认/冲销人员快照、原因和版本；Line 使用 `receiptId + lineNo` 唯一并关联原 `AfterSalesOrderItem`、实际数量和可选普通批次；逐瓶事实保存原瓶、扫描码快照、匹配状态、原仓/原状态和 movement。
- `after_sales_receipt_serialized_units.activeOriginalUnitKey` 是可空唯一键，并由 CHECK 约束只在 MATCHED 时等于原 Unit ID；收货冲销后清空。它与单瓶 `id+version+warehouseId+status` 条件更新共同保证同一有效收货事实不能把一瓶重复恢复入库。业务事实外键全部 Restrict，人员审计外键 SetNull 且保留姓名/角色快照。
- 新增 `AfterSalesInventoryService`，controller 不直接改余额。Receipt 创建只保存 DRAFT，不写库存；只有 `super_admin/admin/warehouse` POST 生效时，才在同一 Serializable 事务内条件抢占 Receipt 和 `AfterSalesOrderItem.returnVersion`、累加 `postedReceivedQty`、调用统一库存领域服务写顾客退货 Document/Line、不可变 Movement、Stock/Batch 或 Unit 快照、CommandReceipt、角色安全 OperationLog 和提交后补偿任务。任一步失败全部回滚。
- 同一商品行所有 POSTED 且未冲销 receipt 的累计实际数量不得超过 `expectedReturnQty`。不同 receipt 可分次、跨仓、按 SALEABLE/UNAVAILABLE 分别收货；同 key 同 hash 返回第一次结果，同 key 不同 hash 稳定返回 `INVENTORY_IDEMPOTENCY_KEY_CONFLICT`，版本条件更新使并发超收只有一个事务成功。
- QUANTITY 实际收货按每条 receipt line 调用 `CUSTOMER_RETURN` 入库语义：SALEABLE 为 `onHand +qty`，UNAVAILABLE 为 `onHand +qty/unavailable +qty`；EXCEPTION 只保存异常事实，不改库存。指定有效批次时同步其可重建快照，未指定批次时保留为无批次覆盖事实。冲销逐个生成独立 REVERSAL 单据和反向 movement，不修改原流水。
- SERIALIZED 收货重新核对原订单的 OUTBOUND Assignment、商品、状态和规范化物流码。只有确属原订单且扫描码匹配的 OUTBOUND 原瓶才能进入目标仓 AVAILABLE/UNAVAILABLE 并同步 Assignment/Movement/Stock/Unit；错误瓶、未知码或资料冲突必须以 EXCEPTION 生效，只记录 UNKNOWN/CONFLICT，不创建假瓶、不恢复原瓶、不增加库存。冲销使用保存的原仓/原状态把 Unit 条件恢复为 OUTBOUND，再冲销对应顾客退货流水。
- `RESEND/EXCHANGE` 使用独立 `POST /api/after-sales-orders/:id/fulfillment` 命令，可按 RESERVE 或 OUTBOUND 调用现有数量/逐瓶履约服务。稳定行键为 `after-sales-fulfillment:<afterSalesOrderId>:<itemId>`，关联的是原始正向 `salesOrderId`；财务负向 `afterSalesSalesOrderId` 和任何 `orderType=AFTER_SALES` 销售订单都不能成为履约来源。普通数量商品继续允许负库存，逐瓶不足只保留未配需求，不伪造瓶码。
- 新退货流程完成状态使用 `postedReceivedQty` 判断；旧 `warehouseConfirmedAt` 仅对 `returnRequired=false` 的遗留流程保持展示/兼容，不能绕过显式应退行。售后角色可读取明细的 `remainingReturnQty/returnProgressStatus` 和 receipt 进度，但 receipt DTO 不返回全仓余额、短缺、采购成本或逐瓶采购价；扫描瓶码明细只给 super_admin/admin/warehouse，after_sales/finance/boss 只拿匹配数量摘要，sales 后端 403。
- 生效与冲销 OperationLog 只保存 receipt、仓库、商品行、实际数量、状态和逐瓶匹配计数白名单，不保存采购成本、库存余额或瓶码；HTTP request ID 仍只用于追踪。普通订单、售后关联订单、公开二维码、AI、Excel 和已有财务/提成统计没有新增库存字段。
- expand-only migration 为 `server/api/prisma/migrations/20260727000900_after_sales_receipts/migration.sql`。它只加默认兼容列、枚举表、CHECK、唯一键、索引和外键，没有业务 INSERT/UPDATE，不伪造历史 receipt、不猜仓库、不触碰 `ProductActualCost`、订单成本快照、退款/提成/积分事实。生产执行前仍须在目标 MySQL 版本的隔离副本演练 DDL 锁、索引耗时和并发条件更新。

第 09 条接口契约：

| Method/Path | 允许角色 | 说明 |
| --- | --- | --- |
| `GET /api/after-sales-orders/:id/receipts` | admin、warehouse、finance、boss、after_sales | receipt 安全进度；只有 admin/warehouse 返回扫描瓶明细，其他角色只返回匹配摘要 |
| `POST /api/after-sales-orders/:id/receipts` | admin、warehouse | 创建 DRAFT；必填实际仓、创建幂等信封和逐行实际数量/状态 |
| `POST /api/after-sales-orders/receipts/:receiptId/post` | admin、warehouse | 幂等生效；此时且仅此时生成顾客退货库存事实 |
| `POST /api/after-sales-orders/receipts/:receiptId/reverse` | admin、warehouse | 必填原因；条件恢复累计值/逐瓶状态并生成反向流水 |
| `POST /api/after-sales-orders/:id/fulfillment` | admin、warehouse | RESEND/EXCHANGE 独立 RESERVE/OUTBOUND；不使用财务负向售后订单 |

新增/扩展测试：

- `server/api/test/after-sales-inventory-receipts.test.js`：只退款和旧库管确认零返库、DRAFT 零写入、实际 POSTED 返库、部分/多仓/可售/不可售、幂等/hash 冲突、并发超收单赢家、冲销、原瓶返库、错误瓶拒绝、未知码异常不造假、RESEND 独立履约、财务负向订单零出库，以及 sales/after_sales/boss 字段权限。
- `server/api/test/after-sales-orders.test.js`：历史与普通售后商品行明确返回 `returnRequired=false/expectedReturnQty=0/postedReceivedQty=0`，证明不从退款和旧状态推导；既有售后财务、退款凭证和状态回归继续执行。
- `server/api/test/prisma-schema-smoke.test.js`：验证新模型/枚举、默认值、三组幂等信封、非空/hash/CHECK、receipt 行唯一键、逐瓶有效键、Restrict/SetNull 外键、纯 expand 和零历史业务写入。

### 0.8 第 10 条已完成：单仓单商品盘点、差异审批、生效与冲销

本次新增 expand-only migration `server/api/prisma/migrations/20260727001000_inventory_stocktakes/migration.sql`，没有插入盘点、仓库、商品、余额、逐瓶或历史订单数据，也没有执行到任何数据库。新增事实如下：

- `Stocktake`：一张只绑定一个 `warehouseId + productId`，保存 `DRAFT/SUBMITTED/APPROVED/REJECTED/POSTED/REVERSED` 状态、跟踪模式快照、创建/提交/审批/驳回/生效/冲销的来源键、幂等键、请求 hash、人员快照、原因、结果单据和版本。正常审批采用同事务“复核快照 -> 记账 -> 写审批及生效审计 -> 终态 POSTED”，不留下已批准但尚未记账的悬挂状态；`APPROVED` 保留为完整状态机枚举和异常恢复边界。
- `StocktakeLine`：固定单行，保存 `snapshotStockVersion/snapshotLastMovementId`、账面 onHand/unavailable、实盘 onHand/unavailable、两类差异和逐瓶快照指纹。提交前不改变库存；审批时同时比较版本、最后流水 ID 和两类账面数量，任一变化稳定返回 `INVENTORY_STOCKTAKE_SNAPSHOT_STALE`，要求重新盘点。
- `StocktakeSerializedScan`：逐条保存物流码快照、匹配 unit、`MATCHED/MISSING/UNKNOWN/CONFLICT`、预期仓库/状态/版本、实盘可售状态和生效 movement。未知码和冲突码禁止审批；缺失的有效瓶逐瓶转 `VOID` 并写 `STOCK_LOSS`，可售/不可售状态差异逐瓶写 `UNAVAILABLE_IN/OUT`；`RESERVED` 缺失、历史 `ALLOCATED`、待补成本直接恢复可售均稳定拒绝，不创建假物流码或假逐瓶记录。逐瓶冲销使用 unit 状态+版本条件更新并逐条生成反向 movement。
- `activeKey = warehouseId:productId` 使用可空唯一键，migration 的 CHECK 规定只有 `DRAFT/SUBMITTED/APPROVED` 可持有该键，`REJECTED/POSTED/REVERSED` 必须清空；因此同仓同商品并发发起最多一个成功。四组提交/审批/驳回/冲销信封均有 all-or-none CHECK，规范化非空业务键、64 位小写 SHA-256、状态审计、数量和逐瓶匹配关系也由数据库约束。
- QUANTITY 盘盈复用 `INBOUND + STOCK_GAIN`，盘亏复用 `OUTBOUND + STOCK_LOSS`，不可售差异复用 `MARK_UNAVAILABLE/RESTORE_AVAILABLE`；全部通过 `InventoryAccountingService.executeAutomaticInTransaction` 在外层 Serializable 事务内记账。零差异不创建 Document/Movement；审批失败时回执、单据、流水、余额、状态和日志全部回滚。普通冲销复用一对一 `REVERSAL`，逐瓶冲销走专用适配器。
- 新增 `GET/POST /api/inventory/stocktakes`、`GET /api/inventory/stocktakes/:id`、`POST .../:id/submit|approve|reject|reverse`。`warehouse/admin/super_admin` 可发起和提交；`boss/admin/super_admin` 可审批、驳回和冲销；`warehouse/finance` 不可审批；sales/after_sales/taster/front_desk 等继续由后端拒绝。finance 的显式 DTO 不返回逐瓶扫描记录，warehouse DTO 不读取或返回采购成本。
- 创建、提交、审批、生效、驳回和冲销分别写角色安全 OperationLog；库存生效子命令继续写自身不可变事实日志和提交后派生刷新任务。仓库停用守卫新增活动盘点阻断，防止盘点进行中停用仓库。
- 当前没有“人员-仓库授权范围”模型，因此第一版 warehouse 可操作全部启用仓库；这是权限收紧的后续差距，不影响本地 Schema、领域服务和 fixture。驳回后本版释放活动键并要求新建盘点，不在已驳回事实上原地覆盖；Flutter 盘点页、扫码交互和审批待办仍留到第 14 条。

### 0.9 第 11 条已完成：复用 TodoReminder 的库存预警与无饥饿补偿

本次只接入既有 TodoReminder，不新增短信、微信或另一套通知中心。新增 expand-only migration `server/api/prisma/migrations/20260727001100_inventory_alert_todos/migration.sql`，没有创建仓库、阈值、告警或待办业务数据，也没有执行到任何数据库：

- `TodoSourceType` 增加 `INVENTORY_ALERT/STOCKTAKE`；`BusinessTodo` 继续使用既有 `ruleCode + sourceType + sourceId` 唯一键，收件人继续使用 `todoId + userId` 唯一键，不另建通知表。
- `InventoryAlert.activeKey String? @unique` 保存规范化 `inventory-alert:<type>:<warehouseId>:<productId>` 活动键。告警恢复时清空活动键并将同源 Todo 置为 `RESOLVED`；再次触发时复用同一 `InventoryAlert` 和 `BusinessTodo`，重置首检时间，并清除收件人的已读、归档、稍后提醒状态。该约束使同一仓库、商品、告警类型最多只有一条由新代码维护的活动事实；协调器还会关闭旧订单行粒度的重复活动告警。
- `InventoryConfiguration.transferOverdueHours Int?` 是可空上线配置，数据库 CHECK 只允许 NULL 或正整数；本地架构和测试 fixture 不依赖生产时长，也没有在 migration/seed 中猜值。配置未设置时不生成调拨逾期告警。
- 新增 `TodoReconcileCursor`，按 `scanType` 持久化 `cursorId/wrappedAt`。库存余额对、库存告警和盘点来源每轮最多处理 200 条并按主键游标继续；到末尾后回绕。Todo 升级与收件人补录也改为主键 keyset 分页，不再永久停留在固定前 200 条。
- `TodoRuleEngine` 新增库存告警和盘点审批规则。LOW_STOCK、NEGATIVE_AVAILABLE、ORDER_SHORTAGE、TRANSFER_OVERDUE 发给 warehouse 和 boss/admin/super_admin；PENDING_COST 发给 finance 和 boss/admin/super_admin；SUBMITTED 盘点发给 boss/admin/super_admin。sales、after_sales、taster、front_desk 不会成为这些规则的业务收件人。
- LOW_STOCK 使用服务端可信 `availableQty = onHandQty - reservedQty - unavailableQty`，在启用阈值下按 `availableQty <= minimumAvailableQty` 触发；NEGATIVE_AVAILABLE 按 `< 0` 独立触发。PENDING_COST 同时扫描仍有余量的普通待成本批次和逐瓶 `PENDING_COST`。ORDER_SHORTAGE 对 QUANTITY 要求存在活动占用且 available 为负，对 SERIALIZED 比较需求与已分配/已出库瓶数，不创建假瓶。TRANSFER_OVERDUE 只处理已调出/部分实收、超过配置时长且仍有未收/未差异结清数量的调拨。
- 库存事实提交后由既有 `InventoryPostCommitTask` 调用仓库+商品协调器；库存/订单/成本补录/调拨/盘点记账失败仍由原事务回滚，Todo 失败只进入既有补偿任务，不会重放库存事实。预警阈值修改立即协调单个库存对，调拨逾期时长修改立即协调全部库存对；盘点提交、审批生效、驳回和冲销在业务事务完成后立即协调 STOCKTAKE Todo。scheduler 仅作幂等补偿，不是唯一触发路径。
- 库存模块通过既有 `TODO_REMINDERS_RECONCILER` 注入令牌调用 Todo，避免 Inventory 与 Todo/BusinessData 的运行时循环依赖。controller、订单服务和调度器仍不直接更新 WarehouseProductStock。
- Todo 的 title/content/sourceSnapshot 只保存仓库安全编号/名称、商品名称、盘点单号和处理提示；不保存或返回 onHand/reserved/available/shortage、采购成本、库存金额、物流码或瓶码。个人待办 DTO 继续不返回原始 `sourceSnapshot`。sales 即使拥有通用“我的待办”权限，也没有库存规则收件记录，不能由 DTO 推断库存数量。
- 本次没有新增库存预警查询/导出 API，也没有扩大老板到 `ProductActualCost`、扣单、提成或旅行社成本权限；公开二维码、普通订单/售后 DTO、AI 和既有导出没有接入库存告警内部字段。

回滚边界：在新枚举值、活动键、调拨时长或游标表尚未被新应用写入前，可回滚应用并保留数据库超集；一旦已有 `INVENTORY_ALERT/STOCKTAKE` Todo 或活动告警，不能直接缩回 enum/删除列和表，应先停用新协调器、确认不存在新枚举业务数据，再单独制定 contract migration。告警和 Todo 是可重建派生事实，库存 Movement/余额事实不因待办回滚而改变。

### 0.10 仍未完成/保持禁止

- QUANTITY 的七条 SalesOrder 写路径、售后 RESEND/EXCHANGE 独立履约命令、顾客实际退货/分次收货/返库/冲销和售后安全进度 DTO 已接入；财务负向 AFTER_SALES 销售订单继续禁止触发库存。售后 Receipt Flutter 页面、扫码交互和异常人工处理 UI 仍留到第 14 条。
- 逐瓶 `RESERVED/OUTBOUND/UNAVAILABLE`、Assignment、库管配瓶、FIFO、逐瓶调拨和 ALLOCATED 分类预览已完成；历史分类 apply、物理仓人工确认、旧 ALLOCATED contract 删除和生产切换仍明确禁止。
- QUANTITY 销售出库已按有效且成本完整的批次做服务端 FIFO 分配，无批次覆盖部分写为 uncovered；完整的批次分配独立事实表、历史负库存补批与更丰富的销售出库成本覆盖报表仍待后续完善。
- 本次盘点严格按“仓库 + 商品”记录差异，QUANTITY 盘亏不会凭空猜测具体损失批次；如业务要求盘点同时校正每个 `InventoryBatch.remainingQty`，后续必须增加批次级实盘/差异分摊事实和对应冲销，不能用当前商品级差异静默覆盖批次快照。
- QUANTITY 调拨业务单、部分/多次收货、不可售实收、差异/冲销、逐瓶状态联动、Todo 调拨逾期预警及流水口径调拨 Excel 已完成；Flutter 调拨页面仍未完成。
- LOW_STOCK、NEGATIVE_AVAILABLE、PENDING_COST、ORDER_SHORTAGE、TRANSFER_OVERDUE 和盘点审批 Todo 已接入，包含恢复、重开、角色范围、升级/补录分页和超过 200 条的游标补偿。生产最低库存阈值、调拨逾期时长和预警 SLA 仍只属于上线配置；本次不发送短信/微信，也未开发专用库存预警管理页。
- 修复仅有管理员预览，没有自动或实际覆盖余额；实际 repair 必须等维护锁、显式管理员命令和单独审计设计完成。
- 仓库 CRUD/停用守卫、角色化查询、十类库存报表与角色化 Excel、三类入库、批次采购成本补录、售后实际收货、盘点审批及其待办已完成；库存报表/盘点 Flutter 与扫码交互，以及既有订单/售后所有历史字段的 actor 级 DTO 全面收紧仍未完成。
- 九个 inventory/after-sales migration（底座、记账、入库成本、调拨、订单预警、逐瓶统一、售后收货、盘点和 Todo 库存预警）均未对任何数据库执行；真实 MySQL migration、售后并发实收、逐瓶抢占、盘点活动键并发、事务隔离/死锁重试、默认仓与订单并发和 metadata lock 演练仍需明确隔离测试库、目标版本和备份后进行。

### 0.10 第 08 条验证结果

- `npx prisma format`、`npx prisma validate`：通过；`npx prisma generate` 在受限沙箱内第一次因无法写 `node_modules/.prisma` 返回 EPERM，获准在沙箱外按原命令重跑后成功生成 Prisma Client。
- 本步订单库存、库存记账/查询、售后/角色、公开 DTO/二维码/导出/AI/日志和 Schema smoke 定向回归全部通过：库存组合 35/35、售后/角色 29/29、公开投影与导出组合 56/56、现有 BusinessData/物流组合 34/34、Schema smoke 18/18。覆盖七条订单写路径、销售混合字段编辑、稳定行键差额、换仓、PACKED 幂等、取消/退款、负库存、历史订单、AFTER_SALES 排除、并发单次出库、全事务回滚、预警/Todo 补偿和字段级防泄露。
- `npm run build`：通过。
- 后端全量 `npm test`：541 项中 525 通过、14 失败、2 跳过。相对第 06 条基线新增 3 项且全部通过，失败和跳过数量未扩大。2 个跳过项是真实 MySQL 库存并发/不可变触发器与默认仓并发集成测试，按设计要求需要隔离测试库环境变量；14 个失败仍集中在本步未修改的提成/售后退款快照、导游积分、对账聚合、品鉴、旅行团附件和导出旧用例。
- `flutter analyze`：通过；`flutter test`：355 通过、4 失败，失败为本步未修改的附件大小期望、导游管理页面、品鉴明细请求字段和旅行社商品规则旧用例。本步未开发或修改 Flutter。
- 未连接、读取或写入生产数据库，也未对任何数据库执行 inventory migration。真实 MySQL 写入型验证继续留到确认隔离测试库、备份和目标版本之后。
- 本次第 08 条定向结果：Prisma format/validate/generate 通过；最终库存/逐瓶/订单/Schema/Word/DTO 定向组合 55/55 通过；真实 MySQL 同瓶并发 1 项因未提供并确认隔离测试库而明确 skip；`npm run build` 通过。后端全量 `npm test` 为 552 项中 535 通过、14 失败、3 跳过；相对第 07 条基线新增 11 项，其中 10 项通过、1 项按隔离库门禁跳过，既有 14 个失败未扩大，仍集中在提成/售后退款快照、导游积分、对账聚合、品鉴、旅行团附件与导出旧用例。Flutter 未修改，按第 14 条统一改造。

### 0.11 第 09 条验证结果

- `npx prisma format`、`npx prisma validate`：通过。`npx prisma generate` 在受限沙箱内第一次因 `node_modules/.prisma/client/schema.prisma` 文件权限返回 EPERM，经明确授权在沙箱外按同一命令重跑后成功生成 Prisma Client 6.19.3。
- 第 09 条专用 `after-sales-inventory-receipts.test.js` 5/5 通过；原售后 `after-sales-orders.test.js` 21/21 通过；Schema smoke 20/20 通过。组合回归中的本次售后收货、库存核心/查询、逐瓶、普通订单接入和 Schema 用例均通过。
- 售后、库存、订单、佣金组合回归共 130 项，121 通过、9 失败。9 项均属于第 08 条已经记录的旧提成/售后退款快照基线，未由本次收货事实引入；售后收货、库存和订单用例在该组合中全部通过。
- `npm run build`：通过。
- 后端全量 `npm test`：558 项中 541 通过、14 失败、3 跳过；相对第 08 条 552/535/14/3 基线新增 6 项且全部通过，失败与跳过数量未扩大。14 个旧失败仍集中在提成/售后退款快照、导游积分、对账聚合、品鉴、旅行团附件和导出；3 个跳过项为需要显式确认隔离 MySQL 的库存并发/不可变流水、默认仓并发和同瓶抢占。
- 本步未修改 Flutter，按第 14 条统一改造，未重复运行 Flutter 测试。未连接、读取或写入生产数据库，也没有在任何数据库执行第 09 条 migration；真实 MySQL 售后并发超收和 DDL 演练仍列为上线前验证。

### 0.12 第 10 条验证结果

- `npx prisma format`、`npx prisma validate`：通过。`npx prisma generate` 首次在受限沙箱内因 `node_modules/.prisma/client/schema.prisma` 写权限返回 EPERM，经明确授权在沙箱外按同一命令重跑后成功生成 Prisma Client 6.19.3。
- 新增 `server/api/test/inventory-stocktake.test.js`：9/9 通过，覆盖活动盘点唯一键与并发、创建/提交/审批幂等、同 key 不同内容冲突、盘盈盘亏、不可售差异、零差异、原因、角色矩阵、版本/lastMovementId 过期、事务回滚、驳回、普通和逐瓶冲销、逐瓶缺失/未知扫描、finance 逐瓶字段裁剪和 OperationLog。
- 新增 `server/api/test/inventory-stocktake.mysql.test.js`：只有同时提供 `INVENTORY_TEST_DATABASE_URL` 与 `INVENTORY_TEST_DATABASE_CONFIRMED=1` 才在明确隔离库写入验证同仓同商品并发活动键单赢家；当前未提供隔离库，按设计 skip，没有连接或写入任何数据库。
- `server/api/test/prisma-schema-smoke.test.js` 已扩展 Stocktake/Line/SerializedScan、状态枚举、可空唯一活动键、四组幂等信封、CHECK、Restrict/SetNull 外键和纯 expand/零历史写入检查；本次单跑 21/21 通过。
- 定向组合回归 `inventory-stocktake + schema smoke + inventory-query-api` 最终 43/43 通过；其中盘点领域用例 9/9、Schema smoke 21/21、库存查询/API 契约 13/13。此前扩大的库存记账、逐瓶和售后定向组合也均无业务回归。
- 后端全量 `npm test`：569 项中 551 通过、14 失败、4 跳过；相对第 09 条 558/541/14/3 基线新增 11 项，其中 10 项通过、1 项按隔离 MySQL 门禁跳过，既有 14 个失败未扩大。4 个跳过项分别是库存并发/不可变流水、默认仓并发、同瓶抢占和活动盘点唯一键的真实 MySQL 验证。
- `npm run build`：通过。本步未开发或修改 Flutter，未重复运行 `flutter analyze/flutter test`；未连接、读取或写入生产数据库，也未执行 migration。

### 0.13 第 11 条验证结果

- `npx prisma format`、`npx prisma validate`：通过。`npx prisma generate` 在受限沙箱内因无法写 `node_modules/.prisma/client/schema.prisma` 返回 EPERM，经明确授权在沙箱外按同一命令重跑后成功生成 Prisma Client 6.19.3。
- `server/api/test/todo-reminders.test.js` 10/10 通过：覆盖五类仓库商品告警同时触发、每类型单活动事实、重复协调零新增、恢复自动完成、再次触发复用并重开、收件人状态重置、warehouse/finance/boss/admin/super_admin 角色范围、sales 零收件、持久化内容和个人 DTO 防泄露、205 个库存对跨轮游标扫描及旧高位告警最终恢复、scheduler 重复执行无提醒风暴，以及提交后投影器去重。
- `server/api/test/inventory-query-api.test.js` 13/13、`inventory-stocktake.test.js` 9/9、`sales-order-inventory-integration.test.js` 2/2 通过；合计 Todo/阈值/盘点/订单即时触发组合 34/34。特别验证了预警阈值修改立即协调单个库存对、调拨逾期配置修改全量协调、盘点草稿不提醒而提交/生效同步 Todo，以及订单库存提交后补偿任务真实接通 Todo 注入令牌。
- `server/api/test/prisma-schema-smoke.test.js` 22/22 通过：覆盖新 Todo source enum、InventoryAlert 可空唯一活动键、正数/可空调拨逾期 CHECK、持久化游标表、唯一索引，以及 migration 无业务 INSERT/UPDATE/DELETE。
- `npm run build`：通过。
- 后端全量 `npm test`：574 项中 556 通过、14 失败、4 跳过；相对第 10 条 569/551/14/4 基线新增 5 项且全部通过，既有失败与跳过数量未扩大。14 个失败仍是提成/售后退款快照、导游积分、对账、品鉴、旅行团附件和导出旧用例；4 个跳过项仍需明确隔离 MySQL 才能执行库存并发/不可变流水、默认仓并发、同瓶抢占和活动盘点唯一键验证。
- `flutter analyze`：通过，无问题。`flutter test`：355 通过、4 失败；失败仍为附件大小期望、导游管理按钮、品鉴商品快照字段和旅行社商品规则旧用例，与第 10 条记录一致。本步未修改 Flutter。
- 未连接、读取或写入生产数据库，也没有在任何数据库执行第 11 条 migration。真实 MySQL enum metadata lock、`active_key` 唯一索引和游标表 DDL 仍须在明确隔离测试库、目标 MySQL 版本和备份后演练。

### 0.14 第 12 条已完成：流水口径库存报表与角色化流式 Excel

本次不修改 Prisma Schema 或 migration，不开发 Flutter，也没有连接或写入任何数据库。新增独立 `InventoryReportService`，继续复用 `InventoryQueryPrismaRepository` 的显式 Prisma `select`，页面查询契约和 Excel 从同一组服务器端 `columns + rows` 字段定义生成：

- 新增 `GET /api/inventory/reports/:reportType` 与 `GET /api/inventory/reports/:reportType/export.xlsx`。支持十个稳定报表代码：`warehouse-balances`、`period-summary`、`movements`、`sales-outbound`、`purchase-inbound`、`batch-balances`、`alerts`、`stocktake-variances`、`transfers`、`inventory-valuation`。
- 余额、期间、销售、采购、批次和金额报表均从不可变 `InventoryMovement` 的四类 delta 净额重建；原流水和 `REVERSAL` 反向流水共同参与净额，销售/采购汇总通过 `reversalOf.movementType` 归回原业务类型，不把已冲销原事实直接丢弃。`WarehouseProductStock`、`InventoryBatch.remainingQty` 仅用于当前快照一致性校验，不覆盖流水计算值。
- 期间报表使用 Asia/Shanghai 自然日边界，返回期初现存、期间入/出库、期初在途、进入/离开在途、期末现存和期末在途。仓库行和全公司行使用同一公式；公司总量固定为各仓 `onHand + inTransit`，部分调拨收货前后不会凭空减少或重复增加。
- 调拨报表不读取 `serializedUnitIds`。实收、不可售实收和差异按全部 receipt/receipt reversal 事实净额重建，剩余在途为 `outbound - received - difference`；调拨行同时返回由流水重建的公司总量和中文在途提示。
- QUANTITY 金额只使用有效流水对应的批次当前采购成本状态和单价；SERIALIZED 金额只使用流水对应逐瓶记录的采购成本；在途金额只使用带有效批次/逐瓶/流水成本的覆盖部分。没有任何报表查询、补值或修改 `ProductActualCost`、订单成本快照、毛利、扣单、提成或旅行社成本。
- 负库存、无批次出库、待补成本或缺少逐瓶成本时不补造金额。成本角色收到 `coverageStatus/coveredQty/uncoveredQty/inventoryAmountCents` 和中文提示；完全无覆盖且仍有正库存、或库存为负时金额返回 `null`，不会用 `0` 冒充完整估值。
- `warehouse` 只获得数量和操作字段；Prisma 查询阶段不选择 `InventoryMovement.purchaseUnitCostCents`、批次成本状态/单价或逐瓶采购成本，响应与 Excel 也不含单价、金额及成本覆盖推导字段。`super_admin/admin/finance/boss` 可读本库存模块成本；`inventory-valuation` 对 warehouse 直接返回 `INVENTORY_COST_REPORT_FORBIDDEN`；sales、after_sales、taster、front_desk 继续由后端返回 `PERMISSION_DENIED`。
- API 每行严格按服务器返回的 `columns` 投影，Excel 直接复用同一列键和中文标题，不存在先生成含成本文件再隐藏列。导出使用 ExcelJS streaming writer，数据库事实每批最多读取 500 条，导出每页 500 行，最多 100,000 行；字符串做公式注入防护。
- 导出在开始写响应流前先写 `inventory.report.export` OperationLog。日志只保存报表代码、安全筛选、行数和当前角色实际列键，不保存底层库存对象、瓶码、成本明细或未投影字段；非法筛选错误不回显请求值。

第 12 条接口字段边界：

| 报表 | warehouse | super_admin/admin/finance/boss |
| --- | --- | --- |
| 余额/期间 | 仓库与公司数量、可售、短缺、在途、快照校验 | 余额另含库存采购成本覆盖与金额 |
| 流水 | 单据、仓库、商品、四类 delta、批次业务编号、原因 | 另含流水采购单价、覆盖和金额 |
| 销售/采购汇总 | 数量 | 另含覆盖数量、覆盖状态和金额 |
| 批次剩余 | 供应商、采购单号、生产批次/日期、流水与快照数量 | 另含批次单价、覆盖和金额 |
| 预警/盘点/调拨 | 数量与业务状态；不返回瓶码 | 本步这些报表不额外传播逐瓶 ID 或底层成本对象 |
| 财务库存金额 | 后端 403 | 流水重建数量、已覆盖/未覆盖数量和可证明金额 |

验证结果：

- `server/api/test/inventory-reports.test.js` 5/5 通过：覆盖十类报表、Asia/Shanghai 日期边界、期初/期末、负库存、部分调拨实收和公司在途守恒、完整/部分/零成本覆盖、角色字段集合、warehouse 成本报表拒绝、恶意成本/瓶码注入后的 API/Excel/OperationLog 防泄露，以及 1,205 条流水的 500 条分页聚合和流式导出。
- `server/api/test/inventory-query-api.test.js` 13/13 通过，包含新页面查询和 Excel 路由契约；本步报表与库存核心、盘点、Todo、订单库存、销售 Excel、OperationLog、AI、异常响应、公开销售单和售后组合回归共 126/126 通过。
- `npx prisma format`、`npx prisma validate` 通过。`npx prisma generate` 首次在受限沙箱内因无法写 `node_modules/.prisma/client/schema.prisma` 返回 EPERM，经明确授权在沙箱外按同一命令重跑后成功生成 Prisma Client 6.19.3。
- `npx prisma format`、`npx prisma validate`、`npx prisma generate` 与 `npm run build` 均通过；本次没有执行 migration，也没有连接、创建或修改任何数据库数据。
- 完整后端全量回归共 579 项：561 通过、14 失败、4 个需要明确隔离 MySQL 测试库的用例跳过。新增报表测试未产生失败；14 个失败与改动前基线的数量和用例一致，集中在既有佣金/售后统计、导游积分、旅行团附件及导出，不能视为本步通过，后续仍需独立修复。

### 0.15 第 13 条已完成：Flutter 仓库管理模块

本次不修改 Prisma Schema、migration 或后端业务代码，仅在 Flutter 客户端接入已完成的库存 API，整合现有 `warehouse_packing` 与 `moutai_inventory` 入口：

- 新增 `lib/core/business/inventory_api.dart`：库存 API 封装 + requestHash 算法（与后端 `inventory-command.policy.ts` 完全对齐：NFKC+trim → 删 null 键 → 删 requestHash/requestId/documentScope → 键排序 canonicalJson → SHA-256 小写 hex）+ 数据模型（StockRecord/InboundDocument/Transfer/Stocktake/Alert/Movement/Report 等）+ 角色绑定缓存（`InventoryApi.clearCache`）。
- 新增 `lib/features/warehouse_management/warehouse_management_page.dart`：主页面 + 库存总览 + 角色守卫 + `DefaultTabController`/`TabBarView` 切换 11 个子页面；新增 `inventory_workspace_tabs.dart`：9 个业务子页面（商品库存/入库/调拨/不可售/盘点/盘点审批/预警/流水/报表）。
- 角色差异化：warehouse 显示日常库存操作；finance 显示成本维护和金额报表；boss 以只读为主并显示盘点审批；sales/front_desk/taster/after_sales 不显示入口也不请求库存 API。
- 成本防泄露：`StockRecord.fromJson(canReadCost: false)` 即使响应含成本字段也解析为 null；角色切换时 `clearCache()` + 重建 `InventoryApi`；逐瓶成本不含 boss。
- 整数瓶数校验 `parseBottleQuantity` 只允许正整数；批次/采购单号/物流码按文本处理保留前导零；冲销/调拨/盘点审批等操作用 `confirmInventoryAction` 二次确认；Windows 用 `DataTable` + 双栏，手机用卡片 + 底部操作区。
- 修改 `packages/shared/lib/src/catalogs.dart`（5 个角色 roleMenuIds + sharedMenuEntries）、`lib/app/destinations.dart`（destination + 后端菜单映射 + 角色裁剪）、`lib/app/page_factory.dart`（注册页面）、`lib/core/auth/role_access.dart`（8 个库存权限函数）、`pubspec.yaml`（新增 crypto 依赖）。

验证结果：`flutter analyze`（`dart analyze`）0 issues；`flutter test test/warehouse_management_test.dart` 48/48 通过；全量 `flutter test` 403 通过、4 失败（pre-existing，经确认与仓库管理无关）。测试覆盖 requestHash 算法、角色菜单和页面守卫、页面加载/筛选/空态/错误态、整数数量和前导零、成本列及缓存防泄露、角色切换无残留、手机/Windows 布局、盘点审批角色、报表权限、快捷入口导航。

### 0.16 第 15 条已完成：库存启用、历史切割和 dry-run 脚本

本次不修改 Prisma Schema 或 migration，只在本地测试数据验证，不连接云端。新增独立的上线切换脚本，全部默认 dry-run，apply 需严格前置条件：

- 新增 `server/api/scripts/inventory-cutover.ts`：CLI 入口，支持 10 个子命令、参数解析（`--apply/--env/--backup-confirm/--maintenance-freeze/--manifest-hash/--warehouses-json/--product-modes-json/--opening-items-json/--go-live-at/--run-id`）、统一输出格式。
- 新增 `server/api/scripts/inventory-cutover-lib.ts`：核心库，包含 10 个子命令实现 + 安全框架 + 复用现有 `classifyAllocatedUnit` 分类逻辑。
- 10 个子命令：
  - `inventory-preflight`：只读检查 migration/enum/孤儿/重复商品规范名/订单组合/逐瓶完整性。
  - `inventory-warehouse-bootstrap`：预览并创建仓库及唯一默认仓库（参数或版本化配置提供，不硬编码）。
  - `inventory-product-mode-plan`：只处理显式商品 ID、expectedCurrentMode=NONE→QUANTITY，茅台保持 SERIALIZED，走专用 `ProductInventoryModeChange` 命令不通过通用 Product PATCH。
  - `inventory-serialized-warehouse-plan`：给历史 SerializedInventoryUnit 规划仓库，分类 ALLOCATED（有效未打包 shipping→CANDIDATE_RESERVED、shipping+PACKED→CANDIDATE_OUTBOUND、self_pickup/CANCELLED/REFUNDED/缺订单/混合配送/资料不全→CONFLICT）。
  - `inventory-opening-import-plan`：期初库存由人工输入逐项提供，apply 生成正式期初单据和流水，不直接 UPDATE stock。
  - `inventory-open-orders-cutover`：goLiveAt+冻结窗口边界，只对启用时仍有效未出库 shipping 明细生成一次性占用，使用稳定 inventoryLineKey，排除已打包/自带/取消/退款/AFTER_SALES。
  - `inventory-open-after-sales-plan`：列出未完成售后和旧 warehouseConfirmed，不推断实际收到数量/收货仓/返库。
  - `inventory-rebuild-verify`：余额/批次/流水/逐瓶/Assignment 交叉校验和冲突报告，默认只读。
  - `inventory-cutover-rollback-report`：列出本 run 创建的配置/关联/草稿/POSTED 事实，草稿可撤销，POSTED 只输出冲销/补偿计划，不删除 POSTED 事实。
- 安全框架：默认 dry-run 零写入；apply 需要环境确认（禁止 production）、备份确认、维护写入冻结、manifest hash 与 dry-run 一致；每步输出 runId/inputHash/planned/created/reused/skipped/conflict/warning；可重复执行第二次不重复创建；冲突不写半批数据；禁止打印密码/令牌/连接串；不自动连生产或云端；POSTED 流水后不得 down migration。
- 修改 `server/api/package.json`：注册 `cutover:inventory` 命令。

验证结果：`test/inventory-cutover.test.js` 53/53 通过，覆盖空库、已有默认仓、部分商品已切换、expectedCurrentMode 冲突、逐瓶缺仓、各类 ALLOCATED、开放邮寄订单、AFTER_SALES 财务订单、开放售后、历史已打包/自提/取消/退款订单、第二次执行幂等、dry-run 零写入、manifest hash 不一致拒绝、维护冻结缺失拒绝、apply 事务、rebuild 校验稳定、rollback report 不删除 POSTED 事实。本次没有连接或写入任何数据库，只在 Mock Prisma 上验证。

## 1. 结论

当前系统只有“茅台逐瓶记录 + 订单直接选码”的局部库存能力，不具备第 11 阶段所需的多仓库存底座。

核心结论如下：

1. `Product.inventoryTrackingMode` 当前确实只有 `NONE`、`SERIALIZED`，没有 `QUANTITY`。更高风险的是：现有通用商品 PATCH 已允许 admin/finance 在 `NONE` 与 `SERIALIZED` 间直接切换，没有余额、逐瓶记录、历史订单、开账单据、预期旧值、并发和幂等检查。
2. 当前没有 `Warehouse`、仓库商品余额、普通库存批次、库存单据、不可变流水、订单占用、调拨、盘点、库存预警或余额重建模型。
3. `SalesOrder` 没有履约仓库和库存应用边界；配送方式在 `SalesOrderItem`，打包状态在订单头。创建、销售一次编辑、通用 PATCH、财务 PATCH、状态 PATCH、打包 PATCH 及库管别名路径都可能改变库存事件的前提，不能只接一个 controller。
4. 当前已有逐商品 `AfterSalesOrderItem`，但它表达的是售后/退款计算明细，不是仓库实际收货事实；缺少应退数量、分次实际收到数量、实际收货仓库、可售/不可售状态、批次/逐瓶明细和收货幂等记录。
5. `SerializedInventoryUnit` 没有仓库，也没有 `RESERVED/OUTBOUND/UNAVAILABLE`。`ALLOCATED` 只表示与订单绑定，打包、取消、退款均不会自动改变该状态，不能直接把所有历史 `ALLOCATED` 猜成已占用或已出库。
6. 当前公开二维码采用显式白名单，现状安全；销售订单/售后内部 DTO、OperationLog 原始 JSON、未来 Todo/Excel/AI 扩展则存在库存、瓶码或成本越权传播风险。
7. 项目已有大量 Prisma 事务和少量条件更新，但没有库存级幂等键、通用乐观锁、不可变库存流水或余额重建。HTTP `requestId` 只是关联/审计 ID，不是业务幂等键。
8. 上线必须采用“加表和可空字段 → 影子记账/校验 → dry-run 分类 → 明确切换”的 expand/contract 路线。不能在 migration 中猜默认仓、批量把商品改成 `QUANTITY`、从历史销售反推期初库存，或依据 `packingStatus` 猜逐瓶物理状态。

结论：可以在仓库名称、默认仓库和阈值尚未确认时开始本地 Schema 与领域服务开发；这些值仅是上线配置。进入订单联动前，必须先确定稳定库存行键、幂等来源键和历史切割规则。

## 2. 复核范围与既有口径

### 2.1 已核文件

- `server/api/prisma/schema.prisma` 全文。
- `server/api/prisma/migrations` 下基线全部 40 个 migration，以及第 02/03/05/06 条新增的 4 个 inventory migration。
- `server/api/src` 中商品、订单、库管、售后、逐瓶库存、OperationLog、Todo、AI、公开销售单、认证菜单等相关实现。
- `server/api/test` 中商品、茅台、订单、售后、打包、Todo、导出、日志、AI、公开销售单和 Schema 测试。
- `apps/mobile_desktop/lib` 与 `apps/mobile_desktop/test` 中商品、订单、茅台、库管、售后、菜单、DTO、Todo、AI、二维码页面和测试。
- `docs/39` 至 `docs/43` 及 `docs/44`。为判断后续提示词是否需要修订，另只读复核了 `docs/45_第11阶段逐次开发提示词.md`。

### 2.2 必须保留的第 10 阶段边界

- 三类成本继续分离：`ProductActualCost`、`SalesDeductionRule`、`AgencyDeductionRule` 不得被库存采购批次成本替代；见 `docs/39...md:26-39`。
- 历史订单成本只读订单明细快照，不得用当前 `ProductActualCost` 回算；见 `docs/39...md:89-107`、`docs/40...md:45-60`。
- 第 10 阶段逐瓶实现的现有口径是 `NONE/SERIALIZED` 与 `PENDING_COST/AVAILABLE/ALLOCATED/VOID`；见 `docs/39...md:180-208`、`docs/40...md:91-123`。
- 老板旅行团利润权限是“团级汇总的受限例外”，不包含商品级成本或规则快照；见 `docs/43...md:7-21`。第 11 阶段即使允许老板看库存采购成本，也不能顺带扩大现有商品实际成本、扣单、提成和旅行社成本权限。

## 3. 当前数据库事实

### 3.1 商品跟踪模式及切换风险

| 事实 | 证据 | 差距/风险 |
| --- | --- | --- |
| 枚举只有 `NONE`、`SERIALIZED` | `server/api/prisma/schema.prisma:399-403`；`20260723000200_moutai_serialized_inventory/migration.sql:1-7` | 缺 `QUANTITY` |
| Product 保存该模式，默认 `NONE` | `schema.prisma:415-439` | 没有启用时间、模式版本或切换审计字段 |
| migration 按规范化名称创建/更新“茅台”为 `serialized` | 同 migration `:9-38` | 这是既有一次性兼容，不应成为普通商品切换模板 |
| admin/finance 可在通用商品 PATCH 中直接修改模式 | `products.nest.service.ts:8-9,128-169,449-459`；`products.test.js:105-122` | 无余额、逐瓶、订单、开账、预期旧值、事务和幂等守卫；更新与 OperationLog 也不在同一事务 |
| Flutter 商品编辑器没有提交模式字段 | `product_management_page.dart:570-675` | 只是 UI 未暴露，不能视为后端安全控制 |

建议：

- 枚举扩为 `NONE | QUANTITY | SERIALIZED`，但普通通用 PATCH 不再承担有历史事实后的模式切换。
- 增加专用 `activateInventoryTracking` 命令，至少接收 `productId`、`expectedCurrentMode`、`targetMode`、`effectiveAt`、规范化非空 `sourceKey`、`idempotencyKey`、`requestHash`、开账单据/校验结果，并与日志同事务。
- `NONE -> QUANTITY` 只有在目标仓已明确、开账数据已准备且同一事务/受控切换完成时才允许生效；允许先建表、建仓和准备草稿，不需要先知道生产仓库名称。
- 产生任何有效库存流水后，不允许通过普通 CRUD 改回 `NONE`。`QUANTITY <-> SERIALIZED` 也禁止在线直接互转，必须走专项迁移和逐项冲突报告。
- `Product.unit` 当前也可直接修改（`products.nest.service.ts:143-155`）。有库存事实后应禁止直接改计量单位；本阶段固定整数“瓶”，未来单位换算需新版本模型，不能重写历史数量。

### 3.2 已有与缺失模型

`schema.prisma:16-1486` 的全部 enum/model 中，库存相关只有：

- `InventoryTrackingMode`。
- `SerializedInventoryStatus`。
- `Product.inventoryTrackingMode`。
- `SerializedInventoryUnit`。
- `SalesOrder` 的打包/库管备注字段。
- `AfterSalesOrder` 的仓库确认人、确认时间和备注。

下列第 11 阶段实体全部不存在：

| 能力 | 当前模型 | 结论 |
| --- | --- | --- |
| 仓库主数据 | 无 `Warehouse` | 缺失 |
| 仓库商品余额 | 无仓库+商品余额表 | 缺失 |
| 普通商品批次/FIFO | 只有逐瓶的生产批次字符串，无 `InventoryBatch` | 缺失 |
| 库存单据/单据行 | 无 | 缺失 |
| 不可变库存流水 | 无 | 缺失 |
| 订单占用/释放 | 逐瓶表上直接写订单外键，不是通用占用 | 缺失 |
| 调拨/在途/实收差异 | 无 | 缺失 |
| 盘点/审批 | 无 | 缺失 |
| 阈值/库存预警 | 无 | 缺失 |
| 余额重建/校验 | 无流水，无法重建 | 缺失 |
| 库存业务幂等命令 | 无 | 缺失 |

全部 migration 也未创建上述实体。名称含 warehouse 的历史 migration 仅增加订单打包字段或售后头部确认字段：

- `20260629000400_sales_order_phase4_schema`。
- `20260717000200_after_sales_warehouse_refund_proofs`。
- `20260726000200_sales_order_packing_mark`。

另有两个以 `20260717000200_` 开头的 migration 目录。Prisma 仍会按完整目录名识别，但相同时间前缀容易造成部署记录和人工排查混淆；第 11 阶段应使用全局唯一、严格递增的新 migration 名称。

## 4. 订单履约现状与所有写路径

### 4.1 当前表达

- `SalesOrderDeliveryType` 为 `SELF_PICKUP/SHIPPING`，字段位于每个 `SalesOrderItem.deliveryType`；见 `schema.prisma:586-591,1026-1049`。
- `SalesOrderPackingStatus` 为 `PENDING/PACKING/PACKED/ABNORMAL`，字段位于订单头；见 `schema.prisma:593-600,921-1023`。
- `SalesOrder` 没有 `fulfillmentWarehouseId`、库存启用/应用时间、库存版本、出库时间/人、取消时间/人或幂等键。
- 新订单只要有邮寄明细即默认 `PENDING`，否则默认 `PACKED`；见 `business-data.nest.service.ts:6028-6086`。因此历史自提单的 `PACKED` 是创建默认值，不足以证明真实出库。
- 同一订单允许混合 `shipping/self_pickup`；订单只有一个打包状态，库存事件必须按明细配送方式处理。

### 4.2 必须统一接入库存领域服务的路径

| 路径 | Controller/Service 位置 | 当前行为 | 第 11 阶段要求 |
| --- | --- | --- | --- |
| `POST /api/sales-orders` | `sales-orders.nest.controller.ts:36-44`；service `:1675-1847` | 事务创建订单并同步逐瓶 `ALLOCATED` | 分配唯一启用默认仓；shipping 占用，self-pickup 出库；同事务、幂等 |
| `PATCH /:id/sales-edit` | controller `:108-125`；service `:1850-2075` | 销售一次编辑；可同时改 items、status、财务和打包字段 | 必须限制已出库行；按稳定行键计算 retained/added/removed；禁止绕过库存状态机 |
| `PATCH /:id` | controller `:175-183`；service `:2078` 起 | admin/finance 可替换 items 和改 status | 同上；不能 deleteMany 后凭新行 ID 误判为全释放/全占用 |
| `PATCH /:id/finance` | controller `:127-135`；service `:2300-2380` | 财务字段中也允许 `status` | 取消/退款等状态变化必须调用库存命令；非库存财务字段不应重放库存事件 |
| `PATCH /:id/status` | controller `:165-173`；service `:2445-2531` | 只更新状态、汇总、佣金和 Todo | 未出库取消释放；已出库取消/退款不返库 |
| `PATCH /:id/packing` | controller `:155-163`；service `:2383-2442` | 只更新打包/物流字段和日志 | 首次进入 `PACKED` 才消费占用并出库；重复保存幂等 |
| `PATCH /api/warehouse/orders/:id/packing` | `warehouse-orders.nest.controller.ts:25-42`；service `:3735-3774` | 最终转调同一 packing service | 必须保持同一库存事件入口，不能另写一套 |
| 售后生成的 `SalesOrder` | service `:2700-2729,6401-6457` | 生成 `orderType=AFTER_SALES`、`packingStatus=PACKED`、明细 `SELF_PICKUP` 的财务负向订单 | 必须明确排除普通销售出库钩子；该单不是客户取货事实 |

特别风险：

- `SALES_ORDER_SALES_EDIT_FIELDS` 当前包含 `status`、全部财务字段和全部打包字段；见 service `:543-558`。后续若只改 packing/status 专用方法，销售一次编辑仍可能绕过。
- 通用更新使用 `items.deleteMany + create`；见 service `:1947-1977`，admin/finance 更新也采用同类方式。解析器会优先按客户端提交的 `item.id` 匹配旧行，否则按数组位置回用旧 ID，仍匹配不到才使用客户端 ID/新 UUID；见 `:7277-7345,7350-7364,7460,7499`。因此该 ID 是重建过程中的兼容标识，不是服务端保证不变、不可伪造的库存行键，不能直接作为占用幂等键。
- 当前逐瓶同步在删除明细后释放 removed unit，再重新绑定；见 `:7521-7598`。未来 `OUTBOUND` 瓶绝不能被该逻辑恢复为 `AVAILABLE`。

建议给订单增加：

- `fulfillmentWarehouseId String?`，FK `Warehouse`，历史订单可空；新库存订单必须非空。
- `inventoryAppliedAt DateTime?`、`inventoryPolicyVersion Int?`，明确历史订单与启用后订单的边界。
- `inventoryVersion Int @default(0)` 或通用 `version`，用于订单库存状态条件更新。
- `packedAt/packedById`、`cancelledAt/cancelledById/cancelReason`，只记录生命周期事实，不替代库存流水。
- `SalesOrderItem.inventoryLineKey String? @unique`：新库存明细的稳定服务端行键，只能由服务端生成，创建后不可由客户端写入或修改。编辑应按它 upsert/diff，而不是依赖会重建或可由请求携带的行 ID。
- 明细可保存 `inventoryAppliedAt` 或 `inventoryLifecycleStatus` 作为查询快照，但真相仍来自占用/流水；`available/shortage` 不写入订单。

## 5. 售后现状

### 5.1 已有内容

- `AfterSalesOrderItem` 已按售后单关联原 `SalesOrderItem` 和 `Product`，保存商品快照、`quantity`、原单价、小计等；见 `schema.prisma:1124-1147`。
- 创建售后时会验证原订单明细归属和累计退款数量，并在 Serializable 事务内创建售后单、售后明细和财务负向订单；见 `business-data.nest.service.ts:2605-2788`。
- `AfterSalesOrder` 只有头部 `warehouseConfirmedById/At/Note`；见 `schema.prisma:1054-1121`。
- `PATCH /after-sales-orders/:id/warehouse-confirm` 只接受备注；见 controller `:105-120`、service 常量 `:583-587` 和方法 `:3014` 起。

### 5.2 缺失语义

现有 `AfterSalesOrderItem.quantity` 是财务/售后受影响数量，不能安全解释为“应退数量”，更不能解释为“实际收到数量”。当前缺少：

- 每行是否要求退货及 `expectedReturnQty`。
- 可分次、多次收货的事实单。
- 每次实际收到数量和累计收货上限。
- 实际收货仓库。
- `SALEABLE/UNAVAILABLE/EXCEPTION` 商品状态。
- 普通商品批次或逐瓶 `unitId`。
- 收货幂等键、确认人/时间、冲销关系。
- 茅台收到非原瓶、未知瓶码或原瓶已出库状态冲突的异常处理。

建议保留现有 `AfterSalesOrderItem` 以兼容财务历史，并新增：

1. `AfterSalesOrderItem.expectedReturnQty Int @default(0)`、`returnRequired Boolean`；历史记录保持 0/false，绝不由退款数量猜造。
2. `AfterSalesReceipt`：`afterSalesOrderId`、`warehouseId`、`status`、规范化非空 `sourceKey @unique`、`idempotencyKey @unique`、`requestHash`、`confirmedById/At`、`reversalOfId @unique`、备注和审计。
3. `AfterSalesReceiptLine`：`receiptId`、`afterSalesOrderItemId`、`receivedQty`、`condition`、可选 `inventoryBatchId`、异常原因；`@@unique([receiptId,lineNo])`。
4. `AfterSalesReceiptSerializedUnit`：`receiptLineId`、`serializedInventoryUnitId?`、扫描物流码快照、匹配状态；同一有效收货事实中的逐瓶 ID 必须唯一。

实际返库只由已生效 `AfterSalesReceipt` 触发。退款确认、`SalesOrder.status`、`AfterSalesStatus` 或旧的头部仓库确认均不得直接增加库存。

回滚边界：新增表和字段可空/默认 0，可安全兼容历史读取；一旦收货流水已生效，不能通过删表或清空字段回滚，只能冲销收货单和库存流水。

## 6. 现有茅台逐瓶库存

### 6.1 当前事实

- 状态只有 `PENDING_COST/AVAILABLE/ALLOCATED/VOID`；见 `schema.prisma:406-412`。
- 单瓶保存商品、订单/订单明细绑定、生产资料、物流码、采购成本、订单成本快照和纠错审计，但没有仓库/通用批次；见 `schema.prisma:446-489`。
- 物流码规范值唯一，商品/状态、订单、生产字段有索引；见 migration `20260723000200...:42-80`。
- `productId` 为 `Restrict`；订单和订单明细删除为 `SetNull`；见同 migration `:84-112`。
- 管理角色为 admin/finance/warehouse；成本角色仅 super_admin/admin/finance；sales 可调用可售列表；见 `serialized-inventory.nest.service.ts:15-23,42-89,544-591`。
- warehouse 新建固定 `PENDING_COST`，不能读写成本；finance/admin 补成本后可用。DOCX 对 admin/finance/warehouse 开放且不包含成本；见该 service `:133-244,246-329`。
- 销售订单必须自己选足与数量相等的 unit IDs，缺瓶会阻止保存；见 `business-data.nest.service.ts:7272-7499`。
- 订单事务内用条件 `updateMany` 把 `AVAILABLE` 改为 `ALLOCATED`，removed 恢复 `AVAILABLE`；见 `:7521-7598`。这是现有唯一接近库存并发条件更新的实现。
- Flutter 销售表单会打开逐瓶 picker 并提交 `serializedUnitIds`；见 `order_form_page.dart:314-409,1144-1162`、`serialized_inventory_picker_dialog.dart:90-211`。
- 库管打包页只能展示销售已选瓶码，不能配瓶；见 `warehouse_packing_page.dart:167-176,1072-1090`。

### 6.2 兼容迁移建议

扩展 `SerializedInventoryStatus` 时采用 expand/contract：

1. 先增加 `RESERVED/OUTBOUND/UNAVAILABLE`，暂时保留 `ALLOCATED`。
2. 新代码停止写 `ALLOCATED`；新订单由库存分配记录写 `RESERVED`，实际出库写 `OUTBOUND`。
3. dry-run 按订单状态、配送、打包、订单/明细关联完整性分类历史 `ALLOCATED`。不明确者保持 legacy 状态并列冲突。
4. 只有 `ALLOCATED` 数量为 0、交叉校验通过且回滚窗口结束后，才考虑后续 migration 删除旧枚举值。

给 `SerializedInventoryUnit` 增加：

- `warehouseId String?`：Schema 首次迁移可空；切换后新建必须有启用仓库。
- `inventoryBatchId String?`：可选关联通用批次，保留已有生产字段快照。
- `lastMovementId String?`、`outboundAt DateTime?` 等查询快照可选；不可替代流水。
- `version Int @default(0)`，逐瓶状态和仓库变更使用预期状态/版本条件更新。

建议新增 `SerializedInventoryAssignment`，而不是继续覆盖单瓶订单外键来表达全部历史：

- `reservationId`、`unitId`、`status RESERVED/OUTBOUND/RELEASED`、成本快照、各状态时间和操作者。
- `sourceKey @unique` 防重复。
- `activeUnitKey String? @unique`：有效占用时写 unit ID，释放/出库后置空，以规避 MySQL “含 NULL 组合唯一键不能可靠防重”的问题。
- 现有 `salesOrderId/salesOrderItemId/orderCostSnapshotCents` 暂保留为兼容快照；只有明确记录才回填 Assignment。

销售侧必须停止列举可售瓶和提交 unit IDs；shipping 由库管配瓶，self-pickup 由服务端稳定 FIFO 自动尝试分配。不足只产生待配数量/预警，不制造虚假瓶码或虚假成本。库管无成本、财务不能直接改数量/仓库状态。

当前测试 `moutai-serialized-inventory.test.js` 覆盖 Schema、角色成本隔离、DOCX、订单逐瓶成本及错误分支，但使用内存 delegate，`updateMany` 固定返回 1（`:474-520`）；仓库内没有真实并发争抢同一瓶的集成测试。`docs/42...md:187` 虽列了并发验收，当前自动化证据不足，必须补真实 MySQL/隔离库并发测试。

## 7. 建议目标库存 Schema

### 7.1 枚举

建议至少包含：

- `InventoryTrackingMode`: `NONE | QUANTITY | SERIALIZED`。
- `InventoryDocumentType`: `OPENING | PURCHASE_RECEIPT | CUSTOMER_RETURN | STOCK_GAIN | OTHER_IN | SALES_OUTBOUND | STOCK_LOSS | OTHER_OUT | TRANSFER_OUT | TRANSFER_IN | UNAVAILABLE_ADJUSTMENT | REVERSAL`。
- `InventoryDocumentStatus`: `DRAFT | POSTED | REVERSED`。
- `InventoryMovementType`: 至少区分 `OPENING_IN | PURCHASE_IN | CUSTOMER_RETURN_IN | RESERVE | RELEASE | SALES_OUT | TRANSFER_OUT | TRANSFER_IN | STOCK_GAIN | STOCK_LOSS | UNAVAILABLE_IN | UNAVAILABLE_OUT | REVERSAL`。
- `InventoryReservationStatus`: `OPEN | PARTIAL | RESERVED | CONSUMED | RELEASED | CANCELLED`。
- `InventoryCondition`: `SALEABLE | UNAVAILABLE`。
- `InventoryCostStatus`: `PENDING | COMPLETE`。
- `InventoryTransferStatus`: `DRAFT | OUTBOUND | PARTIALLY_RECEIVED | RECEIVED | CANCELLED | REVERSED`。
- `StocktakeStatus`: `DRAFT | SUBMITTED | APPROVED | REJECTED | POSTED | REVERSED`。
- `InventoryAlertType`: `LOW_STOCK | NEGATIVE_AVAILABLE | PENDING_COST | ORDER_SHORTAGE | TRANSFER_OVERDUE | STOCKTAKE_APPROVAL`。
- `InventoryAlertStatus`: `ACTIVE | RESOLVED | CANCELLED`。
- `SerializedInventoryStatus`: 扩展为 `PENDING_COST | AVAILABLE | RESERVED | OUTBOUND | UNAVAILABLE | VOID`，迁移期保留 `ALLOCATED`。

数据库 SQL 中继续映射为小写 enum 值，与现有 Prisma `@map` 风格一致。

### 7.2 仓库和配置

`Warehouse` 建议字段：

- `id`、`code`、`normalizedCode`、`name`、`normalizedName`、`address`、`managerUserId?`。
- `isActive`、`isDefault`、`activeDefaultKey String? @unique`。
- `createdById/updatedById/createdAt/updatedAt`。

约束与索引：

- `normalizedCode @unique`、`normalizedName @unique`。
- 启用默认仓写固定 `activeDefaultKey='ACTIVE_DEFAULT'`，其他记录为 NULL；配合 CHECK 保证 key 与 `isActive/isDefault` 一致，从数据库层保证最多一个启用默认仓。
- 若目标 MySQL 版本不适合该 CHECK，使用单行 `InventoryConfiguration.defaultWarehouseId` FK + 事务锁，不得只靠前端。
- `managerUserId` 对 User 为 `SetNull`；被流水、余额、批次或单据引用的仓库一律 `Restrict`，停用代替删除。

`InventoryConfiguration` 建议为单行配置：

- `id` 固定业务键、`goLiveAt?`、`policyVersion`、`maintenanceMode`、审计字段。
- 仓库名称、默认仓库 ID 和阈值是部署配置；本地可使用 fixture，不写死生产值。

### 7.3 余额

`WarehouseProductStock`：

- `warehouseId`、`productId`。
- `onHandQty`（允许负数）、`reservedQty`、`unavailableQty`、`inTransitQty`。
- `version`、`lastMovementId?`、`rebuiltAt?`、`updatedAt`。
- `@@unique([warehouseId,productId])`。
- CHECK：`reservedQty >= 0`、`unavailableQty >= 0`、`inTransitQty >= 0`。
- `availableQty = onHandQty - reservedQty - unavailableQty` 和 `shortageQty = max(0,-availableQty)` 由服务端计算，不重复持久化两个易漂移字段。
- 索引：`[productId,warehouseId]`、`[warehouseId,updatedAt]`；低库存筛选可在读模型/报表表中优化，先不要用可漂移冗余列充当真相。

余额是可重建快照。任何 API、controller、订单 service 或脚本都不能绕过库存领域服务直接更新该表。

### 7.4 批次与 FIFO

`InventoryBatch`：

- `warehouseId`、`productId`、`sourceDocumentLineId`。
- `supplierName`、`purchaseOrderNo`、`productionBatch`、`productionDate`，均按字符串/日期保存，批次和采购单号不得数值化。
- `receivedQty`、`remainingQty`、`unavailableQty`。
- `purchaseUnitCostCents?`、`costStatus`、`costCompletedById/At`。
- `fifoAt`、审计字段、`version`。
- 非空 `sourceLineKey @unique`；不要把可空采购单号/批次号的组合唯一键当幂等保证。
- 索引：`[warehouseId,productId,costStatus,fifoAt,id]`、`[purchaseOrderNo]`、`[productionBatch]`、`[productionDate]`。
- FK 对仓库、商品、来源行均 `Restrict`。

批次消耗应由 `InventoryMovement.batchId` 和可选 `InventoryBatchAllocation` 保留事实。`remainingQty` 只是条件更新和查询快照，可从有效批次流水重建。负库存中暂时无批次覆盖的数量必须明确记为 uncovered，不能读 `ProductActualCost` 伪造。

### 7.5 单据、流水和幂等

`InventoryDocument`：

- `documentNo @unique`、`type`、`status`。
- `warehouseId?`、`fromWarehouseId?`、`toWarehouseId?`。
- `sourceType`、`sourceId?`、`sourceKey @unique`、`requestHash`。
- `businessAt`、`postedById/At`、`reversedById/At`、`reversalOfDocumentId? @unique`、原因和审计。

`InventoryDocumentLine`：

- `documentId`、`lineNo`、`productId`、`batchId?`、`quantity`（必须大于 0）、`condition`、必要商品/批次快照。
- `@@unique([documentId,lineNo])`。

`InventoryMovement`：

- `sourceKey String @unique`，必须非空且由稳定业务事件生成。
- `documentLineId`、`warehouseId`、`productId`、`batchId?`、`serializedUnitId?`。
- `movementType`。
- `onHandDelta`、`reservedDelta`、`unavailableDelta`、`inTransitDelta`。
- `occurredAt`、`operatorUserId?`、`reason`、必要成本快照。
- `reversalOfMovementId? @unique`。
- 索引：`[warehouseId,productId,occurredAt,id]`、`[productId,occurredAt]`、`[documentLineId]`、`[serializedUnitId,occurredAt]`。
- FK 均 `Restrict`；禁止业务 UPDATE/DELETE，纠错只写反向流水。

不要使用包含可空 `batchId/serializedUnitId/sourceLineId` 的复合唯一键作为唯一幂等防线：MySQL 允许多条含 NULL 的“重复”唯一键。使用规范化的非空 `sourceKey`。

`InventoryCommandReceipt`：

- 规范化非空 `idempotencyKey @unique`、`commandType`、规范化请求内容计算的 `requestHash`、`status`、`resultDocumentId?`、`actorUserId?`、时间。
- 同 key+同 hash 返回已有结果；同 key+不同 hash 返回稳定冲突错误。
- HTTP `requestId` 可记录在此表用于追踪，但不能替代业务幂等键。

统一外键策略：

- Warehouse/Product/Batch/Document/Movement/Reservation/Transfer/Stocktake 等业务事实之间使用 `Restrict`，禁止级联删除库存事实。
- User 审计关联使用 `SetNull`，并保留不可变操作者名称/角色快照以便账号删除或停用后审计。
- SalesOrder/SalesOrderItem/AfterSalesOrder 到库存事实不使用 Cascade；需要删除/重建订单行时，历史流水仍保留 source key 和业务快照。
- `lastMovementId`、出/入库单据 ID、冲销来源 ID 应建立索引；一对一冲销关系使用 `@unique`，防止同一事实被冲销两次。

### 7.6 订单占用

`InventoryReservation`：

- `sourceKey @unique`、`salesOrderId`、`salesOrderItemId?`、`inventoryLineKey`。
- `warehouseId`、`productId`。
- `requestedQty`、`reservedQty`、`assignedQty`、`outboundQty`。
- `status`、`version`、创建/释放/消费时间和操作者。
- `@@unique([salesOrderId,inventoryLineKey])`。
- 索引：`[warehouseId,productId,status]`、`[salesOrderId,status]`。

数量商品允许 `requestedQty > reservedQty` 并形成 shortage；serialized 不足只保留未配数量。占用、释放、出库均写单独稳定事件，不能靠覆盖 reservation 数值抹掉历史。

### 7.7 调拨

建议新增 `InventoryTransfer` 与 `InventoryTransferLine`，再分别关联调出、调入库存单据：

- Header：`transferNo @unique`、来源仓、目标仓、状态、outbound/received 审计、出/入单据 ID、备注。
- Line：商品、计划数量、调出数量、累计实收数量、差异数量、批次/逐瓶要求。
- `@@unique([transferId,lineNo])`，来源仓不得等于目标仓。
- 每次收货必须有 `InventoryTransferReceipt`/Line，保存规范化非空 `sourceKey @unique`、`idempotencyKey @unique`、`requestHash`，支持部分/多次收货和同 key 异内容稳定冲突。
- 调出减少来源 `onHand`、增加在途；调入减少在途、增加目标 `onHand`。公司总量报表必须把在途计入，不能调出时消失、调入时重复。

### 7.8 盘点

`Stocktake`：

- 一张只对应 `warehouseId + productId`。
- `status`、`activeKey String? @unique`，同仓同商品只有一个活动盘点。
- `snapshotStockVersion`、`snapshotLastMovementId`、账面 onHand/unavailable、实盘 onHand/unavailable、差异。
- 原因、提交/审批/生效/驳回/冲销人和时间。
- 审批生效前再次核对快照版本/lastMovementId，期间有流水则拒绝旧差异覆盖。

serialized 另设 `StocktakeSerializedScan`，保存扫描码、匹配 unit、发现状态；逐瓶盘点不能只改汇总数量或创建假瓶。

### 7.9 预警与 Todo

`StockAlertConfig`：

- `warehouseId + productId @unique`、`minimumAvailableQty`、`enabled`、审计字段。

`InventoryAlert`：

- `alertKey @unique`（仓库+商品+类型的规范化非空键）、`type`、`status`。
- `warehouseId`、`productId?`、`sourceEntityType/Id?`、首次/最后发现/解决时间。
- 内部指标快照可保存，但对 Todo 和无成本角色必须投影。

现有 `TodoSourceType` 只有 `TRAVEL_GROUP/SALES_ORDER/AFTER_SALES_ORDER`；见 `schema.prisma:30-36`、`todo-rule.engine.ts:6-18`。建议增加 `INVENTORY_ALERT` 和 `STOCKTAKE`，由稳定 alert/stocktake ID 去重。现有 BusinessTodo 已有 `@@unique([ruleCode,sourceType,sourceId])`，可复用去重机制。

现有 Todo 内容只存业务编号，用户只能读自己的 recipient；见 `todo-reminders.service.ts:31-63,350-436`。库存 Todo 也应只写“待处理/低库存/待补成本”等必要文本，销售不得成为收件人，不能在 `sourceSnapshot/content` 中放全仓数量、采购成本或瓶码。

现有维护周期每分钟运行：先取最多 200 条最久未检测的活动 Todo，再为每类来源取最近更新的 200 条；升级和收件人补齐也各只取 200 条。全量 `backfillExistingData` 已使用游标分页，但日常维护没有跨周期游标；见 `todo-reminders.scheduler.ts:12-18`、service `:280-332,442-506`。库存预警数量上升后应使用事件触发 + 带持久游标/公平队列的调度补偿，不能让固定窗口外记录长期饥饿。

## 8. 权限、DTO、日志、导出和 UI 影响

### 8.1 当前边界

| 面 | 当前事实 | 第 11 阶段要求 |
| --- | --- | --- |
| 菜单 | 后端只有“库管发货”和“茅台”，无通用仓库管理；`roles.js:61-90,155-210` | 新 inventory 入口按 admin/warehouse/finance/boss 分区；sales 无入口且后端 403 |
| Flutter | `destinations.dart:116-139,180-203,345-348` 映射商品、茅台、库管打包、售后 | 合并/衔接仓库管理，仍保留必要深链兼容 |
| 订单 DTO | 所有可读角色除 taster 特殊裁剪外共用 DTO；含逐瓶 ID、物流码、生产资料；`business-data.nest.service.ts:8442-8458,8639-8785,8878-8908` | sales 不得看到瓶清单、仓库数量/短缺；warehouse 只看履约需要；按 actor 投影 |
| 售后 DTO | `toAfterSalesOrderDto` 对关联原单和售后生成单直接调用未按 actor 裁剪的 `toSalesOrderDto`；`:8490-8594` | after_sales 只看退货进度；warehouse 不看财务规则/成本；不能复用原始 DTO |
| 逐瓶成本 | service 只对 super_admin/admin/finance 返回 `purchaseCostCents`；warehouse 不含成本 | 保留；boss 只在库存模块获得采购成本，不能扩大到 ProductActualCost 等接口 |
| OperationLog | 读/导出仅 admin/super_admin；`operation-log.nest.controller.ts:21-104` | 保持严格后端权限；库存日志生成时先使用角色安全 DTO |
| 日志清洗 | sanitizer 清理密码、token、电话和地址，但 `cost/purchaseCost/inventoryQty/logisticsCode` 不属于敏感分类；`audit-data-sanitizer.js:362-418` | 不可依赖 sanitizer 自动删库存/成本；写入和读取都需字段投影 |
| 销售 Excel | admin/finance，列为订单、商品摘要、金额、打包和物流，无库存/成本；service `:375-410,1467-1490` | 库存导出必须独立、按角色从源头选择列；warehouse 文件从不生成成本列 |
| 茅台 DOCX | admin/finance/warehouse；生产资料和物流码，无成本 | 保持回归；只有履约需要者可导出 |
| AI | 允许 super_admin/admin/boss/finance/after_sales；warehouse/sales 禁用；`ai-policy.service.ts:26-68,226-243` | 第一版不新增库存 AI 工具；未来必须按角色单独汇总 |
| AI DTO | 工具输出显式挑选订单商品数量/金额，不包含逐瓶或库存；`ai-tools.service.ts:1428-1553` | 保持白名单，禁止把新增 Prisma/业务 DTO 原样送模型 |
| 公开二维码 | `buildPublicSalesSheetDto` 显式只取订单、客户、商品数量、配送和物流；`sales-sheet.dto.helper.ts:202-250,380-407` | 保持显式白名单；注入仓库/库存/成本/瓶码的负向测试必须继续通过 |

当前直接泄露风险最高的是内部订单/售后 DTO，不是公开二维码：

- sales 目前可通过可售逐瓶接口和订单 DTO获得瓶码，这是第 10 阶段设计，但与第 11 阶段“销售只填商品和数量”冲突。
- boss、warehouse、after_sales 等订单可读角色也会收到相同逐瓶详情。
- `AfterSalesOrder` DTO 还返回 `sourceAgencyDeductionCents`、扣减/返点率和规则 ID；在新增库存成本后不能继续用一份全量 DTO 面向全部售后可读角色。
- OperationLog 当前只有管理员可读，但存储 before/after/request JSON 可能保留库存数量、瓶码和成本；将来不得为了库存审批轻率开放 boss/warehouse 全量日志。

### 8.2 目标角色矩阵

| 角色 | 数量/仓库 | 采购成本/库存金额 | 写数量 | 审批盘点 | 订单瓶码 |
| --- | --- | --- | --- | --- | --- |
| super_admin/admin | 全部 | 全部 | 全部受控业务动作 | 是 | 按需 |
| warehouse | 有权限仓库数量、占用、短缺、批次非成本字段 | 否 | 入库、调拨、配瓶、收货、盘点提交 | 否 | 履约所需 |
| finance | 数量只读 | 可维护批次/逐瓶成本、看库存金额 | 不可直接改数量 | 否 | 非必要不返回 |
| boss | 库存模块只读全局 | 仅库存采购成本/金额 | 否 | 是 | 非必要不返回 |
| sales | 不返回库存数量、仓库余量、短缺数 | 否 | 只提交订单商品和数量 | 否 | 否 |
| after_sales | 只看售后退货进度和自身业务必要仓库名 | 否 | 不直接记库存 | 否 | 异常处理所需最小字段 |
| front_desk/taster | 无 | 无 | 无 | 无 | 无 |

## 9. 事务、幂等、并发和重建现状

### 9.1 已有能力

- 订单创建/更新/打包/状态、售后等主要业务使用 Prisma `$transaction`；例如订单 `business-data.nest.service.ts:1679,1863,2324,2408,2468`。
- 售后创建明确使用 `Serializable`；见 `:2628-2788`。
- 销售一次编辑用条件 `updateMany` 抢一次修改机会；见 `:9394-9428`。
- 逐瓶分配用状态/订单条件 `updateMany`；见 `:7574-7595`。
- 部分 seed/backfill 有事务或条件更新，但实现风格不统一。`stage10-product-seed.js` 默认直接写入事务，没有 dry-run；`backfill-sales-order-customers.js` 默认 dry-run；当前 `backfill-after-sales-independent-orders.ts:19-194` 也是调用即写、CLI 无 `--dry-run/--apply` 开关。库存切换脚本不得照搬这两个默认写入模板。

### 9.2 缺口

- 没有客户端/业务 `idempotencyKey`。API exception 的 `requestId` 和 OperationLog `requestId` 只用于追踪。
- 没有库存来源唯一键、请求 hash、冲突语义或重复结果返回。
- 没有通用 balance version/条件更新；未来跨余额、批次、逐瓶、单据、流水的写入不能只靠默认隔离级别。
- `SerializedInventoryUnit` 条件更新没有真实数据库并发测试。
- 没有库存流水，因此没有余额重建、差异报告、修复预览或对账校验。
- Todo/佣金的“幂等”是各自业务唯一键，不可直接当库存记账保证。

### 9.3 当前自动化测试能证明和不能证明的内容

- `server/api/test/products.test.js:14-201` 证明 admin/finance 商品管理及模式字段 PATCH 可用，但没有模式切换库存守卫测试。
- `server/api/test/moutai-serialized-inventory.test.js:38-472` 证明当前逐瓶 Schema、成本角色、DOCX 和订单成本快照；不能证明真实 MySQL 并发占瓶、出库或多仓一致性。
- `server/api/test/business-data.test.js:610-887,2122-3629` 与 `sales-order-logistics-update.test.js:11-313` 证明当前订单写路径和打包/物流规则；没有占用、出库、取消释放或重复 PACKED 幂等流水测试。
- `server/api/test/after-sales-orders.test.js:189-313,966-1043,1504-1620` 证明售后财务明细、事务回滚和头部仓库确认；没有实际收货数量、仓库、商品状态或返库测试。
- `server/api/test/todo-reminders.test.js:33-298` 证明现有规则去重、收件人隔离和调度；没有库存来源、超过固定扫描窗口或敏感库存字段测试。
- `server/api/test/sales-order-export.test.js`、`operation-logs-audit.test.js`、`ai-tools-service.test.js`、`public-sales-sheets.test.js` 和 `sales-sheet-dto.helper.test.js` 证明各自当前白名单/权限，不会自动覆盖未来新增库存字段，必须新增恶意注入回归。
- Flutter 的 `order_form_page_test.dart:180-229` 仍断言销售选码；`warehouse_packing_page_test.dart:78-200` 只断言打包字段；`after_sales_form_page_test.dart:418-439` 只断言头部仓库确认。这三组测试都需要在对应阶段改成第 11 阶段流程，而不能简单删除。

目标事务顺序：

1. 事务内抢占 `InventoryCommandReceipt.idempotencyKey` 并核对 `requestHash`。
2. 读取/锁定或用 `version` 条件更新涉及的余额、批次、占用、逐瓶记录。
3. 创建/生效单据与不可变流水。
4. 原子更新余额和批次快照，校验 reserved/unavailable/inTransit 不为负。
5. 写角色安全 OperationLog。
6. 提交后触发 Todo/读模型刷新；若 Todo 失败，由 outbox/补偿调度恢复，不能回滚或重复库存事实。

余额重建：

- 提供只读 `rebuild-check`，按仓库+商品汇总所有有效 movement deltas，与 stock、batch remaining、serialized 状态交叉核对。
- 修复必须是显式管理员命令，先预览差异、记录校验和并在维护锁下执行；不能由普通查询自动覆盖。
- 修复余额快照不改流水；若流水本身错误，先写冲销/更正流水。

## 10. 分批 migration 与回滚边界

| 批次 | 迁移内容 | 数据兼容 | 可回滚边界 |
| --- | --- | --- | --- |
| M1 枚举扩展 | `InventoryTrackingMode` 增 `QUANTITY`；serialized 状态增新值但保留 `ALLOCATED` | 不修改任何 Product/Unit 行 | 尚无新枚举值数据时旧代码可回；写入后不得降 enum，最多回滚应用并保持 DB 超集 |
| M2 底座加表 | Warehouse、Config、Stock、Batch、Document/Line、Movement、CommandReceipt、Reservation、Transfer | 初始为空；不猜仓名/默认仓/阈值 | 未写业务事实可删；一旦 POSTED movement 存在，只能停功能，不能 drop |
| M3 可空关联 | SalesOrder fulfillment warehouse/库存边界/version；SalesOrderItem 稳定行键；Unit warehouse/batch/version | 历史保持 NULL，读取兼容 | 尚未回填可回；回填和记账后不能简单删除 |
| M4 售后/盘点/预警 | Receipt/Line、Stocktake、Alert/Config、Todo source enum | 历史售后不伪造收货；旧 Todo 保持 | 已有实际收货/盘点流水后只能业务冲销 |
| M5 影子记账 | 订单/入库服务只调用库存领域命令，由库存领域服务在隔离的 shadow run 中生成 movement/余额快照；旧业务表仍是主读 | 对比不切流；禁止 controller、订单 service 或脚本直接双写余额 | 可关闭 feature flag；保留影子数据并按 run/version 隔离 |
| M6 切换数据 | 建仓、显式商品模式、逐瓶仓库分类、开放订单占用 | 只处理 dry-run 已确认的 ID | 切换前备份；已生效库存事实不做 down migration，只能冻结、冲销或恢复整库备份 |
| M7 Contract | `ALLOCATED` 清零后才移除旧值/旧销售选码写路径 | 需零冲突报告和完整回归 | 属不可逆收缩，必须过回滚观察窗口后另发 |

MySQL 注意：

- 修改 enum 可能持有 metadata lock，应在隔离库用接近生产数据量演练并设置维护窗口。
- M1/M2 采用 DB-first，旧应用必须能忽略新增表/列；应用切换不能先于 enum 扩展。
- 所有新增 FK 前先跑 orphan/长度/字符集检查。历史事实表使用 `Restrict`，人员审计 FK 使用 `SetNull`。
- Prisma Schema 不能表达的 CHECK/触发器应在 migration SQL 明确，并由 schema smoke test 校验；不能只有 TypeScript 校验。

## 11. 上线 dry-run 脚本清单

所有脚本必须默认 dry-run，只有显式 `--apply`、目标环境确认、输入 manifest 校验和和备份确认后写入。每个脚本输出 `planned/created/reused/skipped/conflict/warning`、稳定记录 ID、run ID 和输入 hash；不得输出连接串、密码、token 或客户隐私。

### 11.1 `inventory-preflight`

- 检查 migration 版本、MySQL 版本、enum、孤儿外键、重复商品规范名、商品单位、现有模式。
- 统计所有订单按 `orderType/status/packingStatus/deliveryType` 的组合。
- 统计逐瓶各状态、订单绑定、资料完整性、成本、重复/空物流码。
- 检查现有 `ALLOCATED` 对应订单/明细是否存在。
- 只报告，不写库。

### 11.2 `inventory-warehouse-bootstrap`

- 仓库 code/name/address/负责人由参数或版本化配置传入。
- 校验只有一个启用默认仓，不硬编码生产名称。
- apply 使用 sourceKey/upsert，第二次不重复。

### 11.3 `inventory-product-mode-plan`

- 只接受显式 product IDs 和 `expectedCurrentMode=NONE`。
- 报告历史订单行数、现有逐瓶/库存事实、单位冲突。
- 模式切换与开账准备分离；不得一次把所有普通商品改为 `QUANTITY`。
- 茅台保持 `SERIALIZED`。

### 11.4 `inventory-serialized-warehouse-plan`

- 给现有 Unit 规划仓库，但有绑定、资料不全、状态不明确者只列冲突。
- `PENDING_COST/AVAILABLE/VOID` 可在人工确认物理仓后赋仓。
- `ALLOCATED` 分类：
  - 有效、未打包 shipping：仅“候选 RESERVED”。
  - shipping+PACKED：仅“候选 OUTBOUND”，仍需确认，因为旧代码打包不改逐瓶状态。
  - self-pickup+PACKED：不能据默认值猜已出库。
  - CANCELLED/REFUNDED 仍 ALLOCATED：不能自动释放或出库。
  - 缺订单/明细或同订单混合配送：冲突。
- 不明确数据保持 legacy，不进入新可售池。

### 11.5 `inventory-opening-import-plan`

- 期初数量仍来自人工盘点/页面导入，不从历史销售倒推。
- 校验整数、商品模式、仓库、批次文本、成本权限、重复 sourceKey。
- apply 生成正式期初单据/流水；不直接 UPDATE stock。

### 11.6 `inventory-open-orders-cutover`

- 以明确 `goLiveAt` 和维护写入冻结窗口为边界。
- 只对启用时仍有效、未出库的 shipping 明细创建一次占用。
- 启用前已打包、自提、取消、退款订单保持 LEGACY，不补扣。
- 明确排除 `SalesOrder.orderType=AFTER_SALES` 的财务负向订单。
- 混合配送按行处理；使用稳定 `inventoryLineKey`。
- 逐瓶不足进入待配，不生成假 unit。
- 统计在脚本扫描和 apply 之间发生变化的订单为并发冲突，整批/单订单事务回滚。

### 11.7 `inventory-open-after-sales-plan`

- 列出所有未完成售后及旧 warehouseConfirmed 记录。
- 旧确认只保留历史，不推断实际收货数量或返库。
- 对需要退货的开放单生成待人工补录计划，不自动创建 Receipt。

### 11.8 `inventory-rebuild-verify`

- 从 movement 重算 stock、batch 和 serialized 交叉数量。
- 输出每个仓库+商品的 expected/actual/delta、成本覆盖和冲突。
- 默认只读；repair 必须另一个显式命令、维护锁和审计。

### 11.9 `inventory-cutover-rollback-report`

- 列出切换 run 创建的配置、关联、草稿和已生效事实。
- 草稿/未使用关联可撤销；已 POSTED 单据只给出冲销计划。
- 一旦生产切流并继续发生业务，回滚边界是“关闭新入口 + 保留新表 + 补偿流水”或恢复整库备份，不是删除 migration。

## 12. 分阶段实现顺序与测试门槛

### 阶段 A：Schema expand 与安全开关

实现：M1/M2/M3 的纯加法 Schema、唯一默认仓机制、稳定行键、幂等命令表、feature flag；不接订单。

测试：

- `prisma format/validate/generate`。
- 从上一阶段完整 migration 基线部署到空库。
- 生产快照脱敏副本 migration 演练。
- enum/索引/FK/CHECK/唯一默认仓并发测试。
- 旧 API 和 Flutter 全回归。

### 阶段 B：库存记账核心与重建

实现：Document/Line、Movement、Stock、Batch、Reservation、CommandReceipt；入库、占用、释放、出库、不可售、冲销内部命令。

测试：

- 每种 delta 组合和负库存。
- reserved/unavailable/inTransit 不为负。
- 同幂等键同内容、同 key 冲突内容。
- 两事务并发不丢更新，version 冲突可重试。
- 任一步失败时单据/流水/余额/日志全部回滚。
- movement 重建 stock/batch 一致；随机事件序列/property test。

### 阶段 C：仓库、入库、调拨、成本权限

实现：仓库 CRUD/停用守卫、期初/采购/其他入库、成本补录、调拨/部分收货/不可售。

测试：

- 完整角色矩阵与响应字段集合测试。
- warehouse 请求/响应/错误/日志/Excel 均无成本。
- finance 不可直接改数量。
- 多仓、部分调入、在途公司总量、冲销、前导零。
- `ProductActualCost` 和历史订单成本快照不变。

### 阶段 D：普通商品订单联动

实现：覆盖第 4.2 节全部写路径；服务端默认仓；shipping 占用、self-pickup 出库、PACKED 消费、取消释放、已出库编辑禁止。

测试：

- create、sales-edit、通用 PATCH、finance/status、packing、warehouse alias 每条路径。
- 混合配送、换仓、数量增减/移除、重复 PACKED、重复取消。
- 负库存和销售端不返回缺货数量。
- `orderType=AFTER_SALES` 不触发销售出库。
- 佣金/积分/旅行团汇总事务回归。
- 公开二维码和销售 Excel 注入库存字段仍不泄露。

### 阶段 E：逐瓶多仓和库管配瓶

实现：状态 expand、Assignment、多仓、库管配瓶、self-pickup FIFO、逐瓶调拨和通用流水适配；销售旧 picker 停用。

测试：

- 真实 MySQL 两订单抢同一瓶只有一个成功。
- warehouseId/status/version 条件更新。
- 待成本、可售、占用、出库、不可售、释放、调拨、冲销。
- 单瓶状态、Assignment、movement、stock 四方一致。
- sales 不调用 `/serialized-inventory/available`，订单载荷无 unit IDs。
- warehouse 无成本；原 DOCX 和前导零测试回归。

### 阶段 F：售后、盘点和预警

实现：实际收货 Receipt、逐瓶退回异常、盘点审批、InventoryAlert 与 Todo。

测试：

- 只退款不返库；部分/多次/重复/并发收货不超量。
- 可售/不可售、原瓶/陌生瓶/异常待处理。
- 盘点期间发生流水时审批失败；重复审批幂等。
- Todo 触发、恢复、重开、调度补偿、角色收件和固定扫描上限。
- Todo DTO 不含数量/成本/瓶码。

### 阶段 G：报表、Excel、Flutter 和切换

实现：流水口径报表、成本覆盖、角色化 Excel、仓库/订单/售后 Flutter、全部 dry-run 与切换。

测试：

- 期间期初/入/出/在途/期末、负库存、完整/部分/零成本覆盖。
- API 与 Excel 字段集合严格一致。
- public/AI/OperationLog/错误详情全角色防泄露。
- Flutter 页面守卫、网络请求、缓存切角色、手机/Windows widget。
- dry-run 零写入、apply 第二次零重复、冲突整批不半写。
- 全量后端、Flutter 和隔离库迁移演练。

## 13. 只作为上线配置的人工确认项

以下内容不阻止本地 Schema、领域服务、测试 fixture 和 UI 骨架开发：

- 生产仓库名称、code、地址和负责人。
- 哪一个生产仓库为唯一启用默认仓。
- 各仓各商品最低库存阈值。
- 调拨逾期时长、预警 SLA。
- `goLiveAt`、维护窗口和具体 cutover run。
- 历史逐瓶的物理仓库归属及冲突记录人工结论。

本地开发应使用显式 fixture，例如 `WH_TEST_A/WH_TEST_B`，不得把 fixture 名称带入生产 migration 或 seed。

## 14. 高风险清单

### P0

1. **商品模式可被通用 PATCH 无守卫切换。** 在加入 `QUANTITY` 前必须先封装专用状态机，否则任意模式变更会让订单、余额和逐瓶事实失配。
2. **订单明细更新会 delete/recreate，缺少服务端稳定库存行键。** 当前 ID 还可能来自客户端提交或位置回用；直接按 `SalesOrderItem.id` 做占用幂等会导致重复占用、错误释放或伪造关联。
3. **订单库存事件有多条旁路。** sales-edit、通用 PATCH、finance PATCH、status PATCH、packing PATCH 和 warehouse alias 必须统一到领域命令。
4. **售后生成的 AFTER_SALES 财务订单是 PACKED + SELF_PICKUP。** 若按普通 SalesOrder 自动出库，会产生虚假二次扣库。
5. **历史 `ALLOCATED` 物理含义不确定。** 当前打包/取消/退款不更新逐瓶状态，禁止批量猜测映射。
6. **没有业务幂等与不可变流水。** 在此之前不能把库存余额接入生产订单写路径。

### P1

7. **销售和多种内部角色当前能收到逐瓶详情。** 第 11 阶段销售选码移除时必须同时收紧订单/售后 DTO，不能只删 Flutter picker。
8. **OperationLog sanitizer 不会自动屏蔽成本、库存数量或瓶码。** 新库存日志和导出必须使用字段白名单。
9. **现有逐瓶并发只有实现意图，没有真实数据库自动化证据。**
10. **历史自提单默认 PACKED，不能当已出库证据。**
11. **老板库存成本是新的局部权限。** 必须与现有旅行团团级利润例外、ProductActualCost 和规则成本权限隔离。

## 15. 对后续提示词的调整建议

当前 `docs/45_第11阶段逐次开发提示词.md` 已纳入本次复核的大部分 P0 要求：专用模式状态机、非空 `sourceKey/idempotencyKey/requestHash`、稳定 `inventoryLineKey`、在途口径、全部订单写路径、`AFTER_SALES` 排除、`ALLOCATED` expand/contract、真实 MySQL 并发、售后 Receipt、Todo 超 200 条无饥饿测试，以及带 manifest hash/维护冻结的 dry-run。因此不建议再做结构性重写。

仍建议在执行相应条目时做以下小幅收紧；本次按要求不修改 `docs/45`：

1. 第 02/07 条明确 `inventoryLineKey` 只能由服务端生成且不可由客户端修改。当前 `SalesOrderItem.id` 不只是 delete/recreate 后可能变化，还可能来自客户端提交或数组位置回用，不能作为可信库存键。
2. 第 06/09/10 条在各自 Receipt、盘点提交/生效模型中显式列出规范化非空 `sourceKey`，不要只依赖总前置约束；每个自动 movement 也必须有独立稳定来源键。
3. 第 09 条的 `AfterSalesReceipt` 字段清单补上 `sourceKey @unique`；第 06 条的 `InventoryTransferReceipt` 同时列出 `sourceKey/idempotencyKey/requestHash`。
4. 第 05/15 条明确禁止复用当前默认写库的 `stage10-product-seed.js` 和 `backfill-after-sales-independent-orders.ts` 作为切换脚本模板。库存脚本必须默认零写入，只有显式 `--apply` 才允许写隔离测试库或经确认的目标库。
5. “影子记账/双写”统一表述为“业务服务只调用库存领域命令，库存领域服务内部生成按 run/version 隔离的影子事实”；禁止订单 service 或脚本直接双写余额。

建议按现有顺序继续第 02 条“纯加法 Schema 底座”，但在上述细化落实前，不进入订单库存联动、历史逐瓶状态转换或生产切换。
