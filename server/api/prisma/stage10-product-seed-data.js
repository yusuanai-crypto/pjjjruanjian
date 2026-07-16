'use strict';

// 商品库正式启用日配置位置：首次部署前只修改这里，并随代码版本提交。
const STAGE10_PRODUCT_CATALOG_GO_LIVE_DATE = '2026-07-11';
const STAGE10_PRODUCT_SOURCE_WORKBOOK = '商品实际成本.xlsx';

// 本数据已从仓库根目录“商品实际成本.xlsx”逐项核验。
// 服务和 seed 运行时均不读取 Excel；这里只保存核验后的版本化源值。
const STAGE10_PRODUCT_SOURCE_ROWS = Object.freeze([
  ['茅坛锦绣/瓶', '108'],
  ['茅乡名家名作/瓶', '119'],
  ['茅乡珍酿/瓶', '125'],
  ['茅乡品鉴/瓶', '95'],
  ['茅乡酱门尊品/瓶', '116'],
  ['茅乡金品/瓶', '90'],
  ['茅台醇/瓶', '62'],
  ['酒具/盒', '20'],
  ['高尔夫/瓶', '11'],
  ['小酱酒/瓶', '6.5'],
  ['画/幅', '90'],
  ['小多彩/瓶', '15'],
  ['茅乡贵宾A30尊品/瓶', '82'],
  ['茅坛匠心/瓶', '148'],
  ['贵州老窖/瓶', '80'],
  ['不老酒/瓶', '108'],
]);

function normalizeProductName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, '')
    .toLowerCase();
}

function yuanTextToCents(value) {
  const text = String(value ?? '').trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) {
    throw new Error(`Invalid product cost in yuan: ${text || '<empty>'}`);
  }
  const yuan = Number(match[1]);
  const fraction = String(match[2] || '').padEnd(2, '0');
  return yuan * 100 + Number(fraction || 0);
}

function splitProductNameAndUnit(value) {
  const text = String(value ?? '').trim();
  const parts = text.split('/');
  if (parts.length !== 2) {
    throw new Error(`Product source label must contain exactly one "/": ${text}`);
  }
  const name = parts[0].trim();
  const unit = parts[1].trim();
  if (!name || !unit) {
    throw new Error(`Product source label has an empty name or unit: ${text}`);
  }
  return { name, unit };
}

const STAGE10_INITIAL_PRODUCTS = Object.freeze(
  STAGE10_PRODUCT_SOURCE_ROWS.map(([sourceNameUnit, costYuan], index) => {
    const { name, unit } = splitProductNameAndUnit(sourceNameUnit);
    const sequence = String(index + 1).padStart(2, '0');
    return Object.freeze({
      id: `prd_stage10_${sequence}`,
      actualCostId: `pac_stage10_${sequence}`,
      sourceNameUnit,
      costYuan,
      name,
      normalizedName: normalizeProductName(name),
      unit,
      costCents: yuanTextToCents(costYuan),
    });
  }),
);

function validateStage10InitialProducts() {
  if (STAGE10_INITIAL_PRODUCTS.length !== 16) {
    throw new Error(
      `Stage 10 product seed must contain exactly 16 rows; got ${STAGE10_INITIAL_PRODUCTS.length}.`,
    );
  }
  const names = new Set();
  const ids = new Set();
  const costIds = new Set();
  for (const product of STAGE10_INITIAL_PRODUCTS) {
    if (!product.name || product.name !== product.name.trim()) {
      throw new Error(`Invalid product name: ${product.sourceNameUnit}`);
    }
    if (!product.unit || product.unit !== product.unit.trim()) {
      throw new Error(`Invalid product unit: ${product.sourceNameUnit}`);
    }
    if (!product.normalizedName || names.has(product.normalizedName)) {
      throw new Error(`Duplicate normalized product name: ${product.name}`);
    }
    if (!Number.isInteger(product.costCents) || product.costCents < 0) {
      throw new Error(`Invalid product costCents: ${product.name}`);
    }
    if (ids.has(product.id) || costIds.has(product.actualCostId)) {
      throw new Error(`Duplicate stage 10 seed id: ${product.name}`);
    }
    names.add(product.normalizedName);
    ids.add(product.id);
    costIds.add(product.actualCostId);
  }
  return true;
}

validateStage10InitialProducts();

module.exports = {
  STAGE10_INITIAL_PRODUCTS,
  STAGE10_PRODUCT_CATALOG_GO_LIVE_DATE,
  STAGE10_PRODUCT_SOURCE_ROWS,
  STAGE10_PRODUCT_SOURCE_WORKBOOK,
  normalizeProductName,
  splitProductNameAndUnit,
  validateStage10InitialProducts,
  yuanTextToCents,
};
