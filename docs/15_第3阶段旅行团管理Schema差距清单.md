# 第 3 阶段旅行团管理 Schema 差距清单

对照范围：

- 业务口径文档：`docs/13_第3阶段旅行团管理开发文档.md`
- 当前 Prisma schema：`server/api/prisma/schema.prisma`
- 本文只记录 schema 差距和迁移判断，不修改 `schema.prisma`，不编写 migration。

## 1. 总体结论

第 3 阶段应继续以 `TravelGroup` / `travel_groups` 作为旅行团主表和主接口承载。当前主表已经覆盖团号、到店日期、旅行社、车牌号、导游姓名/电话快照、人数、品鉴馆号、品鉴师姓名/ID、进店/离店时间、团型、备注、金额/积分、财务标记、创建/更新人和时间等基础字段。

核心差距集中在三处：

1. 缺少独立导游库 `guides`，也缺少 `travel_groups.guide_id` 外键关联。
2. 缺少品鉴师总结字段 `taster_summary`、`taster_summary_at`。
3. 品酒内容当前只有 `wine_details` 文本字段，缺少结构化明细表 `travel_group_tasting_items`。

`groupNo` 当前已经有唯一约束，满足“最终不重复”的数据库兜底要求，但还不等于已经满足“系统按 `TGyyyyMMddNNN` 自动生成团号”。自动生成仍需要后端事务生成、按 `visitDate` 取当日流水，并处理唯一冲突重试。

`PendingTravelGroup` 和 `GuideCarriedGroup` 当前应保留以兼容既有页面、接口、seed 和测试，但第 3 阶段不建议继续作为旅行团管理主路径。新口径应以 `travel_groups` 为唯一主数据源，待处理状态由规则计算，导游带团类数据如仍需保留，应后续明确是否并入旅行团主表或降级为历史兼容入口。

## 2. TravelGroup 已有字段

当前 `TravelGroup` 对应表 `travel_groups`，已有字段如下。

| 当前 Prisma 字段 | 数据库字段 | 当前类型/约束 | 第 3 阶段口径判断 |
| --- | --- | --- | --- |
| `id` | `id` | `Char(36)`，主键，UUID 默认值 | 已满足 |
| `groupNo` | `group_no` | `VarChar(80)`，`@unique` | 唯一约束已满足；生成规则未落地 |
| `visitDate` | `visit_date` | `Date`，必填 | 已满足 |
| `travelAgency` | `travel_agency` | `VarChar(120)`，可空 | 字段已有；新建口径应必填，旧数据需允许为空 |
| `licensePlate` | `license_plate` | `VarChar(40)`，可空 | 字段已有；新建口径应必填 |
| `guideName` | `guide_name` | `VarChar(80)`，可空 | 快照字段已有；新建应由导游库写入 |
| `guidePhone` | `guide_phone` | `VarChar(30)`，可空 | 快照字段已有；新建应由导游库写入 |
| `guestCount` | `guest_count` | `Int`，默认 `0` | 字段已有；新建口径应校验正整数，旧数据 `0` 进入异常/待处理 |
| `tastingRoomNo` | `tasting_room_no` | `VarChar(40)`，可空 | 字段已有；新建口径应必填 |
| `tasterName` | `taster_name` | `VarChar(80)`，可空 | 快照字段已有；新建应由 `tasterId` 对应用户写入 |
| `arrivalTime` | `arrival_time` | `VarChar(30)`，可空 | 字段已有；文档建议必填，先由后端校验承接 |
| `groupType` | `group_type` | `VarChar(60)`，可空 | 字段已有；文档固定枚举，建议先应用层校验，暂不急改 DB enum |
| `wineDetails` | `wine_details` | `Text`，可空 | 旧兼容字段；不满足明细结构主路径 |
| `departureTime` | `departure_time` | `VarChar(30)`，可空 | 已满足；不作为待处理必备规则 |
| `remarks` | `remarks` | `Text`，可空 | 已满足 |
| `status` | `status` | `TravelGroupStatus`，默认 `UNMARKED` | 历史状态字段可保留；与新 `pendingStatus` 计算口径不是同一概念 |
| `salesAmountCents` 等金额字段 | 多个金额字段 | `Int`，默认 `0` | 当前订单/财务汇总依赖，保留 |
| `points` 等积分字段 | 多个积分字段 | `Int`，默认 `0` | 当前阶段可保留 |
| `guideInfoSent` | `guide_info_sent` | `Boolean`，默认 `false` | 历史字段，非第 3 阶段核心口径，保留 |
| `travelAgencyInfoSent` | `travel_agency_info_sent` | `Boolean`，默认 `false` | 历史字段，非第 3 阶段核心口径，保留 |
| `financeMark` | `finance_mark` | `Boolean`，默认 `false` | 已满足 |
| `markedById` | `marked_by` | `Char(36)`，可空，关联 `users.id` | 字段已有；Prisma 字段名与文档一致，DB 列名是历史 `marked_by` |
| `markedAt` | `marked_at` | `DateTime(0)`，可空 | 已满足 |
| `tasterId` | `taster_id` | `Char(36)`，可空，关联 `users.id` | 字段已有；新建口径应必填且用户角色必须是 `TASTER` |
| `createdById` | `created_by_id` | `Char(36)`，可空 | 已满足；可选是否补 User relation |
| `updatedById` | `updated_by_id` | `Char(36)`，可空 | 已满足；可选是否补 User relation |
| `createdAt` | `created_at` | `DateTime(0)`，默认当前时间 | 已满足 |
| `updatedAt` | `updated_at` | `DateTime(0)`，`@updatedAt` | 已满足 |

## 3. TravelGroup 缺失字段和口径差异

### 必须补的字段

| 建议 Prisma 字段 | 建议数据库字段 | 建议类型 | 是否可空 | 说明 |
| --- | --- | --- | --- | --- |
| `guideId` | `guide_id` | `Char(36)` | 旧数据先可空 | 关联 `guides.id`。新建旅行团必须传启用导游，历史数据允许暂空。 |
| `tasterSummary` | `taster_summary` | `Text` | 可空 | 品鉴师总结。无订单且未填写时进入 `pending_taster`。 |
| `tasterSummaryAt` | `taster_summary_at` | `DateTime(0)` | 可空 | 总结提交/更新时间，系统写入。 |

### 建议补但可后置的字段

| 建议 Prisma 字段 | 建议数据库字段 | 建议类型 | 说明 |
| --- | --- | --- | --- |
| `postMarkEditedAt` | `post_mark_edited_at` | `DateTime(0)` | 用于显示“财务标记后发生过修改”。也可先从 `operation_logs` 动态判断。 |
| `postMarkEditedById` | `post_mark_edited_by_id` | `Char(36)` | 最近一次财务标记后修改人。可后置。 |

### 已有但 DB 约束偏宽的字段

这些字段在文档中对“新建记录”是必填，但当前 schema 为可空或默认 `0`。为了兼容旧测试数据，不建议第一版 migration 直接改成 `NOT NULL`。

- `travelAgency`
- `licensePlate`
- `guideName`
- `guidePhone`
- `guestCount`
- `tastingRoomNo`
- `tasterId`
- `tasterName`
- `arrivalTime`
- `groupType`

兼容策略：数据库先保持可空/默认值，新增和修改接口按第 3 阶段口径做严格校验；旧数据通过待处理规则或异常规则暴露。

## 4. 新增 guides 表判断

需要新增 `guides` 表。理由：

- 文档明确“导游库必须落地”，旅行团录入必须从导游库选择导游。
- 当前 schema 只有 `guideName`、`guidePhone` 快照字段，没有可复用、可停用、可搜索的导游主数据。
- 没有 `guide_id` 时，无法稳定支持按导游筛选、去重、停用导游、新建旅行团选择启用导游等规则。

建议模型：

| Prisma 字段 | 数据库字段 | 建议类型/约束 |
| --- | --- | --- |
| `id` | `id` | `Char(36)`，主键，UUID 默认值 |
| `name` | `name` | `VarChar(80)`，必填 |
| `phone` | `phone` | `VarChar(30)`，必填，建议唯一 |
| `travelAgency` | `travel_agency` | `VarChar(120)`，必填 |
| `remarks` | `remarks` | `Text`，可空 |
| `isActive` | `is_active` | `Boolean`，默认 `true` |
| `createdAt` | `created_at` | `DateTime(0)`，默认当前时间 |
| `updatedAt` | `updated_at` | `DateTime(0)`，`@updatedAt` |

建议关系：

- `Guide` 通过 `TravelGroup.guideId` 被旅行团引用。
- `TravelGroup` 继续保留 `guideName`、`guidePhone`、`travelAgency` 快照，导游资料变更不反向改历史团。

## 5. 新增 travel_group_tasting_items 表判断

需要新增 `travel_group_tasting_items` 明细表。理由：

- 文档明确“品酒种类/瓶数必须做明细，不放在备注里”。
- 当前 `wineDetails` 是一段文本，无法可靠支持数量校验、排序、结构化查询、整组替换和操作日志差异记录。
- 第 3 阶段可以不接商品库，但仍需要结构化保存酒品名称、数量和单位。

建议模型：

| Prisma 字段 | 数据库字段 | 建议类型/约束 |
| --- | --- | --- |
| `id` | `id` | `Char(36)`，主键，UUID 默认值 |
| `travelGroupId` | `travel_group_id` | `Char(36)`，必填，关联 `travel_groups.id` |
| `productName` | `product_name` | `VarChar(160)`，必填 |
| `quantity` | `quantity` | `Int`，必填，默认不建议为 `0` |
| `unit` | `unit` | `VarChar(20)`，必填，默认“瓶” |
| `note` | `note` | `Text`，可空 |
| `sortOrder` | `sort_order` | `Int`，必填，默认 `0` |
| `createdAt` | `created_at` | `DateTime(0)`，默认当前时间 |
| `updatedAt` | `updated_at` | `DateTime(0)`，`@updatedAt` |

建议关系和删除策略：

- `TravelGroup.tastingItems` 一对多。
- 明细表外键 `travel_group_id` 关联 `travel_groups.id`。
- 如果系统不提供删除旅行团能力，删除策略影响不大；如未来允许删除旅行团，建议 `onDelete: Cascade`，避免孤儿明细。
- `quantity > 0` 建议先由后端校验承接。MySQL CHECK 兼容性和 Prisma 表达能力需单独确认，不作为第一版阻塞项。

兼容策略：

- 保留 `TravelGroup.wineDetails`，旧客户端和旧数据仍可读。
- 新接口以 `tastingItems` 为主路径。
- 如旧 `wineDetails` 内容结构简单，可在数据修复脚本中迁移为一条或多条明细；无法解析时保留原文，不强行拆分。

## 6. 索引和约束差距

### 当前已有

`TravelGroup` 当前已有：

- `groupNo` 唯一约束。
- `visitDate` 索引。
- `travelAgency` 索引。
- `guideName` 索引。
- `tasterName` 索引。
- `tasterId` 索引。
- `financeMark` 索引。
- `markedById` 索引。
- `status` 索引。

### 建议新增

| 表 | 索引/约束 | 原因 |
| --- | --- | --- |
| `guides` | `phone` 唯一约束 | 文档默认手机号作为主要去重依据。 |
| `guides` | `phone` 索引 | 按手机号搜索和去重。若使用唯一约束，唯一索引已覆盖。 |
| `guides` | `name` 索引 | 支持导游搜索。 |
| `guides` | `travel_agency` 索引 | 支持按常用旅行社筛选。 |
| `guides` | `is_active` 索引 | 新建旅行团只选择启用导游。 |
| `travel_groups` | `guide_id` 索引 | 支持按导游筛选和外键查询。 |
| `travel_groups` | `group_type` 索引 | 文档查询参数包含 `groupType`，当前缺索引。 |
| `travel_group_tasting_items` | `travel_group_id` 索引 | 支持查询旅行团详情时加载明细。 |
| `travel_group_tasting_items` | `(travel_group_id, sort_order)` 组合索引 | 支持按旅行团稳定排序展示明细。 |

### 团号唯一约束判断

当前 `groupNo @unique` 能保证数据库层不出现重复团号，这一点满足文档“数据库必须有唯一约束”的要求。

但系统自动生成团号还缺后端行为：

- 新建接口不应再接收前端 `groupNo`。
- 后端应按 `visitDate` 查询当天最大流水，生成 `TGyyyyMMddNNN`。
- 生成和插入应放在同一事务中。
- 并发冲突时由唯一约束兜底，捕获冲突后重算并重试。
- 旧数据中已有 `GZ-0622-018`、`PD-0623-001`、`DG-0622-001` 等非 `TGyyyyMMddNNN` 团号，不影响唯一性，但会影响按新格式取最大流水的逻辑；生成器必须只匹配 `TG${yyyyMMdd}%`。

## 7. 迁移风险

### 旧测试数据风险

当前 seed 和测试大量依赖旧口径：

- `seed.ts` 直接 upsert `TravelGroup`，团号为 `GZ-0622-018`，品酒内容写入 `wineDetails`。
- `seed.ts` 仍创建 `GuideCarriedGroup` 和 `PendingTravelGroup` 示例数据。
- `business-data.test.js` 创建旅行团时手动传 `groupNo`，并只传 `guideName`、`guidePhone`，没有 `guideId`。
- 现有测试也会直接创建 `/api/pending-travel-groups` 记录。

因此第一版 schema 迁移如果直接加非空字段或移除旧表/旧字段，会破坏现有测试和测试环境数据。

### 数据库约束风险

- `travel_groups.guide_id` 第一版必须允许为空，否则旧旅行团无法迁移。
- `taster_summary`、`taster_summary_at` 必须允许为空，否则旧团和新建未总结团无法保存。
- `travel_group_tasting_items` 新增后不能要求每个旧旅行团必须有明细。
- `guides.phone` 唯一约束可能被旧快照反推数据撞上；需要先对 `guidePhone` 做去重策略，再决定是否自动回填。
- `group_type` 暂不建议直接改成数据库 enum；当前历史数据可能已有非固定枚举值。

### API 和测试风险

- 后端当前 `createGroup` 会接收并保存前端传入的 `groupNo`。切到自动生成后，现有接口测试需要同步调整。
- 当前 `PendingTravelGroup` 是独立 CRUD 路径。切到规则计算后，相关菜单、测试和 Flutter 页面需要同步改成从 `travel_groups` 计算返回。
- 当前 `wineDetails` 在 DTO 中返回。新增 `tastingItems` 后，DTO 需要兼容返回旧字段，避免旧 Flutter 解析失败。

## 8. 兼容策略

1. 保留 `travel_groups` 主表，不重建、不迁移主键。
2. 第一版新增字段采用可空策略：`guide_id`、`taster_summary`、`taster_summary_at` 均允许旧数据为空。
3. 保留 `wine_details`，新增 `travel_group_tasting_items` 后，新数据以明细表为主，旧字段只做展示兼容。
4. 新建和修改接口负责严格校验第 3 阶段必填项，不急于把所有数据库字段改为 `NOT NULL`。
5. 从旧数据反推导游时，以 `guidePhone` 为主去重；没有手机号或手机号重复冲突的记录不自动绑定，只保留快照并进入待处理。
6. `PendingTravelGroup` 和 `GuideCarriedGroup` 暂不删除、不改名，先标记为历史兼容路径；第 3 阶段新待处理接口从 `travel_groups` 动态计算。
7. 团号生成器只识别新格式 `TGyyyyMMddNNN`，避免被旧 `GZ-*`、`PD-*`、`DG-*` 团号干扰。
8. schema migration 分批执行：先 `guides`，再 `travel_groups.guide_id` 和总结字段，再 `travel_group_tasting_items`，每步都可单独 deploy 和回归。

## 9. PendingTravelGroup 和 GuideCarriedGroup 主路径判断

### PendingTravelGroup

当前 `PendingTravelGroup` 是独立表 `pending_travel_groups`，字段结构基本复制旅行团主表，并已有用户关系、标记字段和独立接口。第 3 阶段文档明确“不把待处理旅行团做成人工维护表，先按规则自动计算”。

判断：

- 不应继续作为第 3 阶段待处理主路径。
- 表和接口可短期保留，避免旧菜单、测试和数据直接失效。
- 新 `GET /api/pending-travel-groups` 最终应从 `travel_groups` 计算 `pendingStatus` 和 `pendingReasons`。
- 原有创建/修改 `pending_travel_groups` 的能力应后续下线或隐藏，至少不应作为新业务验收路径。

### GuideCarriedGroup

当前 `GuideCarriedGroup` 是独立表 `guide_carried_groups`，字段结构也基本复制旅行团主表。第 3 阶段文档没有把它列为主业务对象，只要求“旅行团主记录继续使用 `TravelGroup`”和“导游库落地”。

判断：

- 不应作为第 3 阶段旅行团管理主路径。
- 如“导游自带团”属于一种团型或来源，更适合落在 `travel_groups.group_type` 或后续新增来源字段，而不是继续复制一套主表。
- 表可暂时保留兼容历史数据和现有入口，但新增的导游库、品酒明细、团号生成、待处理规则优先只围绕 `TravelGroup` 落地。

## 10. 后续 schema 变更建议顺序

1. 新增 `Guide` model，对应 `guides` 表，只新增表和索引，不改 `travel_groups`。
2. 补 seed：至少一个导游；如要回填旧旅行团，先做去重审计。
3. 给 `TravelGroup` 增加 `guideId` 关系字段，并保留 `guideName`、`guidePhone`、`travelAgency` 快照。
4. 给 `TravelGroup` 增加 `tasterSummary`、`tasterSummaryAt`。
5. 新增 `TravelGroupTastingItem` model，对应 `travel_group_tasting_items`。
6. 补 `travel_groups.guide_id`、`travel_groups.group_type` 查询索引。
7. 暂不删除 `wineDetails`、`PendingTravelGroup`、`GuideCarriedGroup`。
8. 暂不把历史可空字段改为 `NOT NULL`，待测试环境数据修复和新接口稳定后再收紧。
