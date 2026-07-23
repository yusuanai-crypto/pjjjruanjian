const fs = require('node:fs/promises');
const path = require('node:path');

const {
  buildMoutaiLogisticsDocx,
} = require('../src/modules/serialized-inventory/moutai-logistics-docx.helper');

const templatePath = path.join(
  __dirname,
  '..',
  'assets',
  'templates',
  'moutai-logistics-sheet.docx',
);
const outputDirectory = path.join(
  __dirname,
  '..',
  '.tmp-moutai-docx-qa',
  'samples',
);

const feitian = {
  moutaiName: '飞天茅台',
  factoryDate: '2024-05-06',
  productionBatch: '202405',
  batchSerialNo: '123456',
  logisticsCode: '9876543210',
};
const dragon = {
  moutaiName: '2024年甲辰龙年生肖茅台酒',
  factoryDate: '2024-01-18',
  productionBatch: '202401',
  batchSerialNo: '000888',
  logisticsCode: '000000000888',
};
const leadingZeros = {
  moutaiName: '飞天茅台',
  factoryDate: '2023-12-31',
  productionBatch: '000001',
  batchSerialNo: '000002',
  logisticsCode: '000000000003',
};

async function main() {
  const template = await fs.readFile(templatePath);
  await fs.mkdir(outputDirectory, { recursive: true });
  const samples = [
    ['01_单瓶飞天茅台.docx', [feitian]],
    ['02_两瓶合并导出.docx', [feitian, dragon]],
    ['03_长名称生肖茅台.docx', [dragon]],
    ['04_前导零字段.docx', [leadingZeros]],
  ];
  for (const [fileName, units] of samples) {
    const buffer = await buildMoutaiLogisticsDocx(template, units);
    await fs.writeFile(path.join(outputDirectory, fileName), buffer);
  }
  process.stdout.write(`${outputDirectory}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
