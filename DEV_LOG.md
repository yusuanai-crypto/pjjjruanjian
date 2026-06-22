# DEV_LOG

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
