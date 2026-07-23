const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const JSZip = require('jszip');

const {
  buildMoutaiLogisticsDocx,
  MOUTAI_LOGISTICS_TEMPLATE_SHA256,
} = require('../src/modules/serialized-inventory/moutai-logistics-docx.helper');
const {
  SerializedInventoryNestService,
} = require('../src/modules/serialized-inventory/serialized-inventory.nest.service');
const {
  SerializedInventoryNestController,
} = require('../src/modules/serialized-inventory/serialized-inventory.nest.controller');
const {
  serializedInventoryOrderTestHooks,
} = require('../src/modules/business-data/business-data.nest.service');

const templatePath = path.join(
  __dirname,
  '..',
  'assets',
  'templates',
  'moutai-logistics-sheet.docx',
);
const prismaSchemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
const migrationPath = path.join(
  __dirname,
  '..',
  'prisma',
  'migrations',
  '20260723000200_moutai_serialized_inventory',
  'migration.sql',
);

test('schema: serialized inventory fields, statuses, indexes and migration compatibility are versioned', () => {
  const schema = fs.readFileSync(prismaSchemaPath, 'utf8');
  const migration = fs.readFileSync(migrationPath, 'utf8');
  for (const expected of [
    'enum InventoryTrackingMode',
    'SERIALIZED',
    'enum SerializedInventoryStatus',
    'PENDING_COST',
    'model SerializedInventoryUnit',
    'moutaiName',
    'normalizedMoutaiName',
    'factoryDate',
    'productionBatch',
    'batchSerialNo',
    'logisticsCode',
    'normalizedLogisticsCode',
    'purchaseCostCents',
    'orderCostSnapshotCents',
  ]) {
    assert.equal(schema.includes(expected), true, expected);
  }
  assert.match(schema, /normalizedLogisticsCode\s+String\?\s+@unique/);
  assert.match(schema, /factoryDate\s+DateTime\?.*@db\.Date/);
  assert.match(migration, /`normalized_logistics_code` VARCHAR\(160\) NULL/);
  assert.match(
    migration,
    /UNIQUE INDEX `serialized_inventory_units_normalized_code_key`/,
  );
  assert.equal(migration.includes('CURRENT_DATE'), false);
});

test('unit: versioned Word template remains byte-identical to the supplied SHA-256', () => {
  const digest = require('node:crypto')
    .createHash('sha256')
    .update(fs.readFileSync(templatePath))
    .digest('hex');
  assert.equal(digest, MOUTAI_LOGISTICS_TEMPLATE_SHA256);
});

test('unit: DOCX export clones one page per bottle, preserves order and a single final sectPr', async () => {
  const template = fs.readFileSync(templatePath);
  const units = [
    {
      moutaiName: '飞天茅台',
      factoryDate: '2026-01-02',
      productionBatch: '00123',
      batchSerialNo: '000456',
      logisticsCode: '000000789',
    },
    {
      moutaiName: '2024年甲辰龙年生肖茅台酒',
      factoryDate: '2026-02-03',
      productionBatch: '00009',
      batchSerialNo: '000010',
      logisticsCode: '000000011',
    },
  ];
  const buffer = await buildMoutaiLogisticsDocx(template, units);
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml').async('string');

  assert.equal((documentXml.match(/<w:sectPr(?:\s|>)/g) || []).length, 1);
  assert.equal(
    (documentXml.match(/<w:br\s+w:type="page"\s*\/>/g) || []).length,
    1,
  );
  assert.ok(documentXml.indexOf('飞天茅台') < documentXml.indexOf('2024年甲辰'));
  for (const value of [
    '2026年01月02日',
    '00123',
    '000456',
    '000000789',
    '2026年02月03日',
    '00009',
    '000010',
    '000000011',
  ]) {
    assert.equal(documentXml.includes(value), true, value);
  }
  for (const forbidden of [
    'purchaseCostCents',
    'unit-1',
    'AVAILABLE',
    'PENDING_COST',
  ]) {
    assert.equal(documentXml.includes(forbidden), false);
  }
});

test('unit: DOCX export writes XML-special Chinese values safely and changes only document.xml', async () => {
  const template = fs.readFileSync(templatePath);
  const buffer = await buildMoutaiLogisticsDocx(template, [
    {
      moutaiName: '2024龙年生肖茅台 & <珍藏> "甲"',
      factoryDate: '2024-12-31',
      productionBatch: '00&A',
      batchSerialNo: '01<02',
      logisticsCode: '0000"ABC"',
    },
  ]);
  const originalZip = await JSZip.loadAsync(template);
  const outputZip = await JSZip.loadAsync(buffer);
  assert.deepEqual(Object.keys(outputZip.files), Object.keys(originalZip.files));
  for (const fileName of Object.keys(originalZip.files)) {
    if (fileName === 'word/document.xml' || originalZip.files[fileName].dir) {
      continue;
    }
    assert.deepEqual(
      await outputZip.file(fileName).async('nodebuffer'),
      await originalZip.file(fileName).async('nodebuffer'),
      fileName,
    );
  }
  const xml = await outputZip.file('word/document.xml').async('string');
  assert.match(xml, /&amp;/);
  assert.match(xml, /&lt;珍藏&gt;/);
  assert.doesNotThrow(() => {
    const tags = xml.match(/<[^>]+>/g);
    assert.ok(tags.length > 0);
  });
});

test('unit: DOCX controller returns the required MIME type and UTF-8 safe filename', async () => {
  const output = Buffer.from('docx');
  const auth = {
    authenticateRequest: async () => ({ id: 'warehouse-1', role: 'warehouse' }),
  };
  const service = {
    exportMoutaiLogisticsDocx: async (actor, body) => {
      assert.equal(actor.role, 'warehouse');
      assert.deepEqual(body, { unitIds: ['unit-1'] });
      return {
        buffer: output,
        fileName: '茅台物流单_20260723_共1瓶.docx',
      };
    },
  };
  const headers = {};
  const response = {
    statusCode: null,
    body: null,
    status(value) {
      this.statusCode = value;
      return this;
    },
    type(value) {
      headers['Content-Type'] = value;
      return this;
    },
    setHeader(name, value) {
      headers[name] = value;
    },
    send(value) {
      this.body = value;
    },
  };
  const controller = new SerializedInventoryNestController(auth, service);
  await controller.exportMoutaiLogisticsDocx(
    { unitIds: ['unit-1'] },
    { headers: {}, socket: {} },
    response,
  );
  assert.equal(response.statusCode, 200);
  assert.equal(
    headers['Content-Type'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  assert.match(headers['Content-Disposition'], /filename\*=UTF-8''/);
  assert.match(headers['Content-Disposition'], /%E8%8C%85%E5%8F%B0/);
  assert.equal(headers['Content-Length'], output.length);
  assert.equal(response.body, output);
});

test('unit: warehouse creates PENDING_COST without cost exposure and finance completes AVAILABLE data', async () => {
  const fixture = createInventoryFixture();
  const service = new SerializedInventoryNestService(
    fixture.prisma,
    fixture.logs,
  );
  const warehouseResult = await service.createMany(
    { id: 'warehouse-1', role: 'warehouse' },
    {
      productId: 'product-moutai',
      defaults: {
        moutaiName: '飞天茅台',
        factoryDate: '2026-03-04',
        productionBatch: '00007',
      },
      units: [
        {
          logisticsCode: '000000001',
          batchSerialNo: '000002',
        },
      ],
    },
  );
  assert.equal(warehouseResult.units[0].status, 'pending_cost');
  assert.equal(
    Object.hasOwn(warehouseResult.units[0], 'purchaseCostCents'),
    false,
  );
  assert.equal(warehouseResult.units[0].productionBatch, '00007');
  assert.equal(warehouseResult.units[0].batchSerialNo, '000002');
  assert.equal(warehouseResult.units[0].logisticsCode, '000000001');

  const updated = await service.update(
    { id: 'finance-1', role: 'finance' },
    warehouseResult.units[0].id,
    { purchaseCostCents: 123456 },
  );
  assert.equal(updated.status, 'available');
  assert.equal(updated.purchaseCostCents, 123456);

  const warehouseView = await service.get(
    { id: 'warehouse-1', role: 'warehouse' },
    updated.id,
  );
  assert.equal(Object.hasOwn(warehouseView, 'purchaseCostCents'), false);

  const salesSelection = await service.listAvailable(
    { id: 'sales-1', role: 'sales' },
    { productId: 'product-moutai' },
  );
  assert.deepEqual(
    Object.keys(salesSelection.units[0]).sort(),
    [
      'batchSerialNo',
      'factoryDate',
      'id',
      'logisticsCode',
      'moutaiName',
      'productionBatch',
    ],
  );
  assert.equal(fixture.logEntries.length, 2);
});

test('unit: serialized inventory rejects duplicate codes, warehouse cost writes, incomplete and invalid export rows', async () => {
  const fixture = createInventoryFixture();
  const service = new SerializedInventoryNestService(
    fixture.prisma,
    fixture.logs,
  );
  await assert.rejects(
    () =>
      service.createMany(
        { id: 'warehouse-1', role: 'warehouse' },
        {
          productId: 'product-moutai',
          defaults: {
            moutaiName: '飞天茅台',
            factoryDate: '2026-03-04',
            productionBatch: 'A01',
            purchaseCostCents: 1,
          },
          units: [{ logisticsCode: 'X01', batchSerialNo: 'S01' }],
        },
      ),
    (error) => error.code === 'FIELD_PERMISSION_DENIED',
  );
  await assert.rejects(
    () =>
      service.createMany(
        { id: 'admin-1', role: 'admin' },
        {
          productId: 'product-moutai',
          defaults: {
            moutaiName: '飞天茅台',
            factoryDate: '2026-03-04',
            productionBatch: 'A01',
            purchaseCostCents: 100,
          },
          units: [
            { logisticsCode: ' X01 ', batchSerialNo: 'S01' },
            { logisticsCode: 'x01', batchSerialNo: 'S02' },
          ],
        },
      ),
    (error) => error.code === 'LOGISTICS_CODE_DUPLICATE',
  );

  fixture.units.push(
    inventoryUnit({ id: 'void-1', status: 'VOID' }),
    inventoryUnit({ id: 'incomplete-1', factoryDate: null }),
  );
  await assert.rejects(
    () =>
      service.exportMoutaiLogisticsDocx(
        { id: 'sales-1', role: 'sales' },
        { unitIds: ['void-1'] },
      ),
    (error) => error.code === 'PERMISSION_DENIED',
  );
  await assert.rejects(
    () =>
      service.exportMoutaiLogisticsDocx(
        { id: 'admin-1', role: 'admin' },
        { unitIds: ['void-1'] },
      ),
    (error) => error.code === 'SERIALIZED_INVENTORY_INVALID_STATUS',
  );
  await assert.rejects(
    () =>
      service.exportMoutaiLogisticsDocx(
        { id: 'admin-1', role: 'admin' },
        { unitIds: ['incomplete-1'] },
      ),
    (error) => error.code === 'SERIALIZED_INVENTORY_DATA_INCOMPLETE',
  );
  await assert.rejects(
    () =>
      service.exportMoutaiLogisticsDocx(
        { id: 'admin-1', role: 'admin' },
        { unitIds: ['incomplete-1', 'incomplete-1'] },
      ),
    (error) => error.code === 'SERIALIZED_INVENTORY_DUPLICATE_IDS',
  );
});

test('unit: order snapshot uses selected bottle names and exact per-code costs, rejecting mixed names and PENDING_COST', async () => {
  const hooks = serializedInventoryOrderTestHooks;
  const product = {
    id: 'product-moutai',
    name: '茅台',
    unit: '瓶',
    isActive: true,
    inventoryTrackingMode: 'SERIALIZED',
  };
  const units = [
    inventoryUnit({
      id: 'unit-a',
      purchaseCostCents: 100000,
      logisticsCode: '001',
    }),
    inventoryUnit({
      id: 'unit-b',
      purchaseCostCents: 120000,
      logisticsCode: '002',
    }),
  ];
  const prisma = {
    product: { findUnique: async () => product },
    serializedInventoryUnit: {
      findMany: async ({ where }) =>
        units.filter((unit) => where.id.in.includes(unit.id)),
    },
  };
  const inputs = hooks.buildSalesOrderItems([
    {
      productId: product.id,
      quantity: 2,
      subtotalCents: 500000,
      deliveryType: 'shipping',
      serializedUnitIds: ['unit-a', 'unit-b'],
    },
  ]);
  const [resolved] = await hooks.resolveSalesOrderItemSnapshots(
    prisma,
    inputs,
    new Date('2026-07-23T00:00:00Z'),
  );
  assert.equal(resolved.productName, '飞天茅台');
  assert.equal(resolved.actualUnitCostCents, null);
  assert.equal(resolved.actualCostSubtotalCents, 220000);
  assert.equal(resolved.grossProfitCents, 280000);
  assert.deepEqual(resolved.serializedUnitIds, ['unit-a', 'unit-b']);

  units[1].moutaiName = '2024龙年生肖茅台';
  units[1].normalizedMoutaiName = '2024龙年生肖茅台';
  await assert.rejects(
    () =>
      hooks.resolveSalesOrderItemSnapshots(
        prisma,
        inputs,
        new Date('2026-07-23T00:00:00Z'),
      ),
    (error) => error.code === 'SERIALIZED_INVENTORY_MIXED_NAMES',
  );
  units[1].moutaiName = '飞天茅台';
  units[1].normalizedMoutaiName = '飞天茅台';
  units[1].status = 'PENDING_COST';
  await assert.rejects(
    () =>
      hooks.resolveSalesOrderItemSnapshots(
        prisma,
        inputs,
        new Date('2026-07-23T00:00:00Z'),
      ),
    (error) => error.code === 'INVENTORY_UNIT_UNAVAILABLE',
  );
});

function createInventoryFixture() {
  const units = [];
  const logEntries = [];
  const product = {
    id: 'product-moutai',
    name: '茅台',
    unit: '瓶',
    isActive: true,
    inventoryTrackingMode: 'SERIALIZED',
  };
  const delegate = {
    findFirst: async ({ where }) =>
      units.find((unit) =>
        where.normalizedLogisticsCode.in.includes(
          unit.normalizedLogisticsCode,
        ),
      ) || null,
    create: async ({ data }) => {
      const unit = inventoryUnit({
        ...data,
        product,
        salesOrder: null,
      });
      units.push(unit);
      return unit;
    },
    findUnique: async ({ where }) =>
      units.find((unit) => unit.id === where.id) || null,
    findMany: async ({ where } = {}) => {
      if (where?.id?.in) {
        return units.filter((unit) => where.id.in.includes(unit.id));
      }
      return units;
    },
    count: async () => units.length,
    update: async ({ where, data }) => {
      const unit = units.find((candidate) => candidate.id === where.id);
      Object.assign(unit, data);
      return unit;
    },
    updateMany: async () => ({ count: 1 }),
  };
  const prisma = {
    product: { findUnique: async () => product },
    serializedInventoryUnit: delegate,
    $transaction: async (callback) => callback(prisma),
  };
  return {
    prisma,
    units,
    logs: {
      appendLog: async (entry) => {
        logEntries.push(entry);
      },
    },
    logEntries,
  };
}

function inventoryUnit(overrides = {}) {
  return {
    id: overrides.id || `unit-${Math.random()}`,
    productId: 'product-moutai',
    product: {
      id: 'product-moutai',
      name: '茅台',
      unit: '瓶',
    },
    salesOrderId: null,
    salesOrderItemId: null,
    salesOrder: null,
    moutaiName: '飞天茅台',
    normalizedMoutaiName: '飞天茅台',
    factoryDate: new Date('2026-03-04T00:00:00Z'),
    productionBatch: '00007',
    batchSerialNo: '000002',
    logisticsCode: '000000001',
    normalizedLogisticsCode: '000000001',
    purchaseCostCents: 100000,
    orderCostSnapshotCents: null,
    status: 'AVAILABLE',
    correctionReason: null,
    correctedById: null,
    correctedAt: null,
    createdById: 'creator',
    updatedById: 'updater',
    createdAt: new Date('2026-07-23T00:00:00Z'),
    updatedAt: new Date('2026-07-23T00:00:00Z'),
    ...overrides,
  };
}
