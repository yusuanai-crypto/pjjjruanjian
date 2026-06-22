const CHECKLIST_ITEMS = [
  {
    id: 'roles-permissions',
    category: 'permissions',
    title: '确认员工角色和权限',
    description: '确认前台、销售、品鉴师、财务、库管、售后、老板、管理员的可见范围和可修改范围。',
    requiredEvidence: ['角色权限表', '关键操作权限说明'],
    sourceDocs: ['docs/01_PRD.md', 'docs/02_功能模块拆分.md'],
  },
  {
    id: 'taster-data-scope',
    category: 'permissions',
    title: '确认品鉴师数据范围',
    description: '确认品鉴师只能查看自己接待的旅行团和自己的提成，并确认未出单旅行团必须填写接待总结。',
    requiredEvidence: ['品鉴师数据范围说明', '未出单旅行团总结规则'],
    sourceDocs: ['docs/01_PRD.md', 'docs/06_开发阶段计划.md'],
  },
  {
    id: 'travel-group-fields',
    category: 'fields',
    title: '确认旅行团字段',
    description: '确认团号、日期、旅行社、车牌号、导游库、人数、品鉴馆馆号、品鉴师、团型等字段。',
    requiredEvidence: ['旅行团字段表', '导游基础资料字段表', '必填和可选字段说明'],
    sourceDocs: ['docs/01_PRD.md', 'docs/05_数据库初步设计.md'],
  },
  {
    id: 'order-fields',
    category: 'fields',
    title: '确认订单字段',
    description: '确认客户、订单、订单明细、配送选择、物流、开票、状态等字段。',
    requiredEvidence: ['订单字段表', '订单状态说明'],
    sourceDocs: ['docs/01_PRD.md', 'docs/05_数据库初步设计.md'],
  },
  {
    id: 'marking-rules',
    category: 'business-rules',
    title: '确认旅行团和客户标记信息规则',
    description: '确认标记信息默认 0，财务可改为 1，关键修改记录操作日志。',
    requiredEvidence: ['标记信息规则说明'],
    sourceDocs: ['docs/01_PRD.md', 'docs/05_数据库初步设计.md'],
  },
  {
    id: 'global-mark-switch',
    category: 'business-rules',
    title: '确认全局只查询已标记信息开关',
    description: '确认老板和前台可开启，开启后不可自行恢复，管理员可恢复。',
    requiredEvidence: ['全局开关权限说明', '恢复流程说明'],
    sourceDocs: ['docs/01_PRD.md', 'docs/05_数据库初步设计.md'],
  },
  {
    id: 'qr-sales-slip-template',
    category: 'ui-prototype',
    title: '确认二维码销售单展示样式',
    description: '确认销售单二维码页面展示字段、拍照留存信息和访问规则。',
    requiredEvidence: ['二维码销售单页面草图或字段表'],
    sourceDocs: ['docs/01_PRD.md', 'docs/06_开发阶段计划.md'],
  },
  {
    id: 'after-sales-flow',
    category: 'business-rules',
    title: '确认售后流程',
    description: '确认售后单创建、问题记录、退款金额和售后状态流转。',
    requiredEvidence: ['售后流程说明', '售后状态表'],
    sourceDocs: ['docs/01_PRD.md', 'docs/02_功能模块拆分.md'],
  },
  {
    id: 'commission-point-rules',
    category: 'business-rules',
    title: '收集提成和积分规则',
    description: '收集旅行社返点、扣酒成本、销售扣单成本、销售/外联/组长提成、品鉴师手工提成规则，并确认财务确认按钮口径。',
    requiredEvidence: ['提成规则表', '积分规则表', '规则来源 Excel', '财务确认按钮说明'],
    sourceDocs: ['docs/01_PRD.md', 'docs/05_数据库初步设计.md'],
  },
  {
    id: 'finance-confirmation-buttons',
    category: 'business-rules',
    title: '确认财务提成和扣酒成本确认按钮',
    description: '确认财务可对品鉴师提成和旅行社扣酒成本点击确认，确认后记录确认人、确认时间；金额修改后需要重新确认。',
    requiredEvidence: ['品鉴师提成确认流程', '旅行社扣酒成本确认流程'],
    sourceDocs: ['docs/01_PRD.md', 'docs/05_数据库初步设计.md', 'docs/06_开发阶段计划.md'],
  },
  {
    id: 'infrastructure-accounts',
    category: 'infrastructure',
    title: '准备云服务器和苹果开发者账号',
    description: '确认云服务器、域名、HTTPS、苹果开发者账号和 TestFlight 准备情况。',
    requiredEvidence: ['云服务器信息', '苹果开发者账号状态'],
    sourceDocs: ['docs/03_技术选型建议.md', 'docs/06_开发阶段计划.md'],
  },
];

const ITEM_CATEGORIES = [...new Set(CHECKLIST_ITEMS.map((item) => item.category))];
const ITEM_STATUSES = ['pending', 'in_review', 'confirmed', 'blocked'];

module.exports = {
  CHECKLIST_ITEMS,
  ITEM_CATEGORIES,
  ITEM_STATUSES,
};
