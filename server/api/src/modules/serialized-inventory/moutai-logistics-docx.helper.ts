import * as crypto from 'node:crypto';
import JSZip = require('jszip');

import { createHttpError } from '../../common/errors';

export const MOUTAI_LOGISTICS_TEMPLATE_SHA256 =
  'fff3188e073183db78bb70859718900a1662036e1ca29d89742f9009992ee5aa';
export const MOUTAI_LOGISTICS_TEMPLATE_VERSION =
  `sha256:${MOUTAI_LOGISTICS_TEMPLATE_SHA256}`;

const BODY_PATTERN = /<w:body>([\s\S]*?)<\/w:body>/;
const FINAL_SECTION_PATTERN = /(<w:sectPr[\s\S]*?<\/w:sectPr>)\s*$/;
const PAGE_BREAK =
  '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

const FIELD_LABELS = {
  moutaiName: '商品名称：',
  factoryDate: '出厂日期：',
  productionBatch: '生产批次：',
  batchSerialNo: '批次序号：',
  logisticsCode: '物流码：',
} as const;

export interface MoutaiLogisticsDocxUnit {
  moutaiName: string;
  factoryDate: Date | string;
  productionBatch: string;
  batchSerialNo: string;
  logisticsCode: string;
}

export function assertMoutaiTemplateIntegrity(template: Buffer) {
  const digest = crypto.createHash('sha256').update(template).digest('hex');
  if (digest !== MOUTAI_LOGISTICS_TEMPLATE_SHA256) {
    throw createHttpError(
      500,
      'MOUTAI_LOGISTICS_TEMPLATE_INVALID',
      '茅台物流单模板损坏或版本不匹配，请联系管理员。',
    );
  }
}

export async function buildMoutaiLogisticsDocx(
  template: Buffer,
  units: MoutaiLogisticsDocxUnit[],
) {
  assertMoutaiTemplateIntegrity(template);
  if (!Array.isArray(units) || units.length === 0) {
    throw createHttpError(
      400,
      'SERIALIZED_INVENTORY_SELECTION_REQUIRED',
      '请至少选择一瓶茅台。',
    );
  }

  const zip = await JSZip.loadAsync(template);
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) {
    throw templateStructureError();
  }
  const documentXml = await documentFile.async('string');
  const bodyMatch = documentXml.match(BODY_PATTERN);
  if (!bodyMatch) {
    throw templateStructureError();
  }
  const sectionMatch = bodyMatch[1].match(FINAL_SECTION_PATTERN);
  if (!sectionMatch) {
    throw templateStructureError();
  }

  const templatePage = bodyMatch[1]
    .slice(0, bodyMatch[1].length - sectionMatch[0].length)
    .trim();
  assertRequiredLabels(templatePage);

  const pages = units.map((unit) =>
    fillTemplatePage(templatePage, {
      moutaiName: requiredText(unit.moutaiName, 'moutaiName'),
      factoryDate: formatFactoryDate(unit.factoryDate),
      productionBatch: requiredText(
        unit.productionBatch,
        'productionBatch',
      ),
      batchSerialNo: requiredText(unit.batchSerialNo, 'batchSerialNo'),
      logisticsCode: requiredText(unit.logisticsCode, 'logisticsCode'),
    }),
  );
  const nextBody = `${pages.join(PAGE_BREAK)}${sectionMatch[1]}`;
  const nextDocumentXml = documentXml.replace(
    BODY_PATTERN,
    `<w:body>${nextBody}</w:body>`,
  );

  assertGeneratedDocumentStructure(nextDocumentXml, units.length);
  zip.file('word/document.xml', nextDocumentXml);
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

export function formatMoutaiLogisticsFileName(
  count: number,
  now = new Date(),
) {
  const year = now.getFullYear().toString().padStart(4, '0');
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  return `茅台物流单_${year}${month}${day}_共${count}瓶.docx`;
}

function fillTemplatePage(
  templatePage: string,
  values: Record<keyof typeof FIELD_LABELS, string>,
) {
  let page = templatePage;
  for (const [key, label] of Object.entries(FIELD_LABELS) as Array<
    [keyof typeof FIELD_LABELS, string]
  >) {
    const encodedLabel = escapeRegExp(label);
    const textPattern = new RegExp(
      `<w:t(?:\\s+[^>]*)?>${encodedLabel}<\\/w:t>`,
    );
    page = page.replace(
      textPattern,
      `<w:t xml:space="preserve">${escapeXml(label + values[key])}</w:t>`,
    );
  }
  return page;
}

function assertRequiredLabels(templatePage: string) {
  for (const label of Object.values(FIELD_LABELS)) {
    if (!templatePage.includes(`>${label}</w:t>`)) {
      throw templateStructureError();
    }
  }
}

function assertGeneratedDocumentStructure(xml: string, pageCount: number) {
  const sectionCount = (xml.match(/<w:sectPr(?:\s|>)/g) || []).length;
  const pageBreakCount = (
    xml.match(/<w:br\s+w:type="page"\s*\/>/g) || []
  ).length;
  if (sectionCount !== 1 || pageBreakCount !== pageCount - 1) {
    throw templateStructureError();
  }
}

function formatFactoryDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw createHttpError(
      400,
      'SERIALIZED_INVENTORY_DATA_INCOMPLETE',
      '出厂日期无效，无法导出物流单。',
    );
  }
  const year = date.getUTCFullYear().toString().padStart(4, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  return `${year}年${month}月${day}日`;
}

function requiredText(value: unknown, fieldName: string) {
  const text = String(value ?? '').trim();
  if (!text) {
    throw createHttpError(
      400,
      'SERIALIZED_INVENTORY_DATA_INCOMPLETE',
      `库存资料不完整：${fieldName} 缺失，无法导出物流单。`,
    );
  }
  return text;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function templateStructureError() {
  return createHttpError(
    500,
    'MOUTAI_LOGISTICS_TEMPLATE_INVALID',
    '茅台物流单模板结构异常，请联系管理员。',
  );
}
