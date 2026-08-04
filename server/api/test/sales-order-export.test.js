const assert = require('node:assert/strict');
const test = require('node:test');

const ExcelJS = require('exceljs');

const {
  assertErrorContract,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SHOUQIANBA_ID = '00000000-0000-4000-8000-000000000001';
const CASH_ID = '00000000-0000-4000-8000-000000000004';
const COD_ID = '00000000-0000-4000-8000-000000000005';
const TRANSFER_ID = '00000000-0000-4000-8000-000000000006';

const EXPECTED_HEADERS = [
  '系统单号',
  '销售单号',
  '订单日期',
  '发货日期',
  '客户姓名',
  '客户电话',
  '地址',
  '旅行团号',
  '旅行社',
  '销售人员',
  '酒品明细',
  '配送摘要',
  '订单总额',
  '是否走个人',
  '走个人金额',
  '正常金额',
  '收款方式',
  '收款金额',
  '收款属性',
  '确认状态',
  '确认人',
  '确认时间',
  '订单状态',
  '客户标记',
  '订单标记',
  '打包状态',
  '物流方式',
  '物流单号',
  '运费',
  '是否需要开票',
  '是否已开票',
  '创建时间',
  '更新时间',
];
EXPECTED_HEADERS.splice(1, 0, '\u8ba2\u5355\u7c7b\u578b');
EXPECTED_HEADERS.splice(
  14,
  0,
  '\u4e0a\u5355\u91d1\u989d',
  '\u5df2\u652f\u4ed8\u91d1\u989d',
  '\u672a\u652f\u4ed8\u91d1\u989d',
  '\u652f\u4ed8\u65b9\u5f0f\u6c47\u603b',
  '\u63d0\u6210\u5bf9\u8c61\u6c47\u603b',
  '\u63d0\u6210\u6bd4\u4f8b\u6c47\u603b',
  '\u6709\u6548\u63d0\u6210\u603b\u989d',
  '\u63d0\u6210\u72b6\u6001',
);
EXPECTED_HEADERS.splice(
  EXPECTED_HEADERS.length - 1,
  0,
  '\u521b\u5efa\u4eba',
  '\u4f5c\u5e9f/\u9000\u6b3e\u72b6\u6001',
);

test('GET /api/sales-orders/export.xlsx allows personal-split viewers except read-hidden roles', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const finance = await login(baseUrl, 'finance-export', 'Password123');
      const boss = await login(baseUrl, 'boss-export', 'Password123');
      const afterSales = await login(
        baseUrl,
        'after-sales-export',
        'Password123',
      );
      const sales = await login(baseUrl, 'sales-export', 'Password123');

      const adminDownload = await requestBinary(
        baseUrl,
        '/api/sales-orders/export.xlsx?query=Alpha',
        {
          token: admin.token,
        },
      );
      assert.equal(adminDownload.response.status, 200);
      assert.match(
        adminDownload.response.headers.get('content-type'),
        new RegExp(XLSX_CONTENT_TYPE.replace(/\./g, '\\.')),
      );
      assert.match(
        adminDownload.response.headers.get('content-disposition'),
        /^attachment; filename="sales-orders-\d{8}-\d{6}\.xlsx"$/,
      );
      assert.equal(adminDownload.buffer[0], 0x50);
      assert.equal(adminDownload.buffer[1], 0x4b);

      const financeDownload = await requestBinary(
        baseUrl,
        '/api/sales-orders/export.xlsx?query=Alpha',
        {
          token: finance.token,
        },
      );
      assert.equal(financeDownload.response.status, 200);
      for (const token of [boss.token, afterSales.token]) {
        const download = await requestBinary(
          baseUrl,
          '/api/sales-orders/export.xlsx?query=Alpha',
          { token },
        );
        assert.equal(download.response.status, 200);
      }

      const salesDenied = await requestJson(
        baseUrl,
        '/api/sales-orders/export.xlsx',
        {
          token: sales.token,
        },
      );
      assertErrorContract(salesDenied, 403, 'PERMISSION_DENIED');
    },
    {
      prisma: buildSalesOrderExportPrismaOptions(),
    },
  );
});

test('GET /api/sales-orders/export.xlsx reuses sales order filters and exports documented core fields', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const path =
        '/api/sales-orders/export.xlsx?query=Alpha&status=valid&dateFrom=2026-07-01&dateTo=2026-07-02';

      const list = await requestJson(
        baseUrl,
        '/api/sales-orders?query=Alpha&status=valid&dateFrom=2026-07-01&dateTo=2026-07-02',
        {
          token: admin.token,
        },
      );
      assert.equal(list.response.status, 200);
      assert.deepEqual(
        list.body.data.salesOrders.map((order) => order.orderNo),
        ['SO-EXPORT-ALPHA'],
      );

      const download = await requestBinary(baseUrl, path, {
        token: admin.token,
      });
      assert.equal(download.response.status, 200);

      const worksheet = await loadSalesOrdersWorksheet(download.buffer);
      const headers = readHeaders(worksheet);
      assert.deepEqual(headers, EXPECTED_HEADERS);
      assert.equal(
        headers.filter((header) => header === '上单金额').length,
        1,
      );
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(download.buffer);
      assert.ok(workbook.getWorksheet('\u63d0\u6210\u660e\u7ec6'));
      assert.equal(headers.includes('货到付款金额'), false);
      assert.equal(worksheet.actualRowCount, 6);

      const row = readRowObject(worksheet, 2);
      assert.equal(row['系统单号'], 'SO-EXPORT-ALPHA');
      assert.equal(row['销售单号'], 'SF-EXPORT-ALPHA');
      assert.equal(row['订单日期'], '2026-07-01');
      assert.equal(row['发货日期'], '待客人通知');
      assert.equal(row['客户姓名'], 'Alpha Customer');
      assert.equal(row['客户电话'], '13800001111');
      assert.equal(row['地址'], '贵州省贵阳市观山湖区测试路 1 号');
      assert.equal(row['旅行团号'], 'TG-EXPORT-001');
      assert.equal(row['旅行社'], 'Export Travel Agency');
      assert.equal(row['销售人员'], 'Export Sales');
      assert.equal(row['酒品明细'], 'Alpha Wine x 2；Gift Box x 1');
      assert.equal(row['配送摘要'], '混合配送');
      assert.equal(row['订单总额'], 998);
      const effectiveAmountCents = 99800;
      const salesDeductionAmountCents = 10000 * 2 + 5000 * 1;
      const expectedEntryAmountYuan =
        Math.max(0, effectiveAmountCents - salesDeductionAmountCents) / 100;
      assert.equal(row['上单金额'], expectedEntryAmountYuan);
      assert.notEqual(row['上单金额'], row['订单总额']);
      assert.equal(typeof row['上单金额'], 'number');
      assert.equal(worksheet.getCell('O2').numFmt, '0.00');
      assert.equal(row['是否走个人'], '是');
      assert.equal(row['走个人金额'], 300);
      assert.equal(row['正常金额'], 698);
      assert.equal(row['收款方式'], '收钱吧');
      assert.equal(row['收款金额'], 798);
      assert.equal(row['收款属性'], '即时收款');
      assert.equal(row['确认状态'], '无需确认');
      assert.equal(row['确认人'], '');
      assert.equal(row['确认时间'], '');
      assert.equal(row['订单状态'], '有效');
      assert.equal(row['客户标记'], '已标记');
      assert.equal(row['订单标记'], '已标记');
      assert.equal(row['打包状态'], '已打包');
      assert.equal(row['物流方式'], '顺丰');
      assert.equal(row['物流单号'], 'SF123456789');
      assert.equal(row['运费'], 18);
      assert.equal(row['是否需要开票'], '是');
      assert.equal(row['是否已开票'], '否');
      assert.equal(row['创建时间'], '2026-07-01T09:00:00.000Z');
      assert.equal(row['更新时间'], '2026-07-01T10:00:00.000Z');
      for (const cell of [
        'N2',
        'O2',
        'P2',
        'Q2',
        'U2',
        'X2',
        'Y2',
        'AA2',
        'AL2',
      ]) {
        assert.equal(worksheet.getCell(cell).numFmt, '0.00', cell);
      }

      const collectionRow = readRowObject(worksheet, 3);
      assert.equal(collectionRow['系统单号'], 'SO-EXPORT-ALPHA');
      assert.equal(collectionRow['收款方式'], '货到付款');
      assert.equal(collectionRow['收款金额'], 200);
      assert.equal(collectionRow['收款属性'], '代收营业款');
      assert.equal(collectionRow['确认状态'], '已确认到账');
      assert.equal(collectionRow['确认人'], 'Export Finance');
      assert.equal(
        collectionRow['确认时间'],
        '2026-07-01T11:00:00.000Z',
      );

      const expandedEntryAmounts = readDataRows(worksheet).map(
        (dataRow) => dataRow['上单金额'],
      );
      assert.equal(expandedEntryAmounts.length, 5);
      assert.deepEqual(
        [...new Set(expandedEntryAmounts)],
        [expectedEntryAmountYuan],
      );

      const negativeRow = readRowObject(worksheet, 4);
      assert.equal(negativeRow['收款方式'], '现金');
      assert.equal(negativeRow['收款金额'], -1);
      assert.equal(typeof negativeRow['收款金额'], 'number');
      assert.equal(worksheet.getCell('AA4').numFmt, '0.00');

      const zeroRow = readRowObject(worksheet, 6);
      assert.equal(zeroRow['收款方式'], '现金');
      assert.equal(zeroRow['收款金额'], 0);
      assert.equal(typeof zeroRow['收款金额'], 'number');
      assert.equal(worksheet.getCell('AA6').numFmt, '0.00');
    },
    {
      prisma: buildSalesOrderExportPrismaOptions(),
    },
  );
});

test('GET /api/sales-orders/export.xlsx floors entry amount at zero', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const download = await requestBinary(
        baseUrl,
        '/api/sales-orders/export.xlsx?query=Floor',
        { token: admin.token },
      );
      assert.equal(download.response.status, 200);

      const worksheet = await loadSalesOrdersWorksheet(download.buffer);
      assert.equal(worksheet.actualRowCount, 2);
      const row = readRowObject(worksheet, 2);
      assert.equal(row['系统单号'], 'SO-EXPORT-FLOOR');
      assert.equal(row['订单总额'], 50);
      assert.equal(row['上单金额'], 0);
      assert.equal(typeof row['上单金额'], 'number');
      assert.equal(worksheet.getCell('O2').numFmt, '0.00');
    },
    {
      prisma: buildSalesOrderExportPrismaOptions(),
    },
  );
});

test('shipping date ranges exclude pending-customer-notice orders', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const withoutRange = await requestJson(
        baseUrl,
        '/api/sales-orders?query=SO-EXPORT-ALPHA&status=valid',
        { token: admin.token },
      );
      assert.deepEqual(
        withoutRange.body.data.salesOrders.map((order) => order.orderNo),
        ['SO-EXPORT-ALPHA'],
      );
      assert.equal(
        withoutRange.body.data.salesOrders[0].shippingDateMode,
        'pending_customer_notice',
      );

      const withRange = await requestJson(
        baseUrl,
        '/api/sales-orders?query=SO-EXPORT-ALPHA&status=valid&shippingDateFrom=2026-07-01&shippingDateTo=2026-07-31',
        { token: admin.token },
      );
      assert.deepEqual(withRange.body.data.salesOrders, []);
    },
    {
      prisma: buildSalesOrderExportPrismaOptions(),
    },
  );
});

test('GET /api/sales-orders/export.xlsx obeys global marked-record filtering', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const enable = await requestJson(
        baseUrl,
        '/api/settings/global-mark-query/enable',
        {
          method: 'POST',
          token: admin.token,
        },
      );
      assert.equal(enable.response.status, 200);

      const download = await requestBinary(
        baseUrl,
        '/api/sales-orders/export.xlsx?query=Global',
        {
          token: admin.token,
        },
      );
      assert.equal(download.response.status, 200);

      const worksheet = await loadSalesOrdersWorksheet(download.buffer);
      const orderNos = readDataRows(worksheet)
        .map((row) => row['系统单号'])
        .sort();
      assert.deepEqual(orderNos, [
        'SO-GLOBAL-STANDALONE',
        'SO-GLOBAL-UNMARKED-CUSTOMER',
        'SO-GLOBAL-UNMARKED-GROUP',
      ]);
    },
    {
      prisma: buildSalesOrderExportPrismaOptions(),
    },
  );
});

test('GET /api/sales-orders/export.xlsx rejects expanded payment rows over the row limit', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const result = await requestJson(baseUrl, '/api/sales-orders/export.xlsx', {
        token: admin.token,
      });

      assertErrorContract(result, 400, 'EXPORT_LIMIT_EXCEEDED');
      assert.match(result.body.error.message, /5000/);
    },
    {
      prisma: {
        salesOrders: Array.from({ length: 2501 }, (_, index) => ({
          id: `order_limit_${index}`,
          orderNo: `SO-LIMIT-${String(index).padStart(5, '0')}`,
          orderType: 'EXTERNAL',
          customerName: `Limit Customer ${index}`,
          orderDate: '2026-07-01T00:00:00.000Z',
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-01T00:00:00.000Z',
          paymentDetails: [
            {
              id: `payment_limit_${index}_a`,
              paymentMethodId: SHOUQIANBA_ID,
              paymentMethodNameSnapshot: '收钱吧',
              paymentMethodCategorySnapshot: 'DIRECT_RECEIPT',
              amountCents: 0,
              sortOrder: 0,
            },
            {
              id: `payment_limit_${index}_b`,
              paymentMethodId: CASH_ID,
              paymentMethodNameSnapshot: '现金',
              paymentMethodCategorySnapshot: 'DIRECT_RECEIPT',
              amountCents: 0,
              sortOrder: 1,
            },
          ],
        })),
      },
    },
  );
});

async function requestBinary(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: options.method || 'GET',
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    response,
    buffer,
  };
}

async function loadSalesOrdersWorksheet(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.getWorksheet('销售订单');
  assert.ok(worksheet);
  return worksheet;
}

function readHeaders(worksheet) {
  return worksheet.getRow(1).values.slice(1);
}

function readRowObject(worksheet, rowNumber) {
  const headers = readHeaders(worksheet);
  const row = worksheet.getRow(rowNumber);
  return Object.fromEntries(
    headers.map((header, index) => [header, row.getCell(index + 1).value]),
  );
}

function readDataRows(worksheet) {
  const rows = [];
  for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber += 1) {
    rows.push(readRowObject(worksheet, rowNumber));
  }
  return rows;
}

function buildSalesOrderExportPrismaOptions() {
  return {
    users: [
      {
        id: 'usr_finance_export',
        name: 'Export Finance',
        username: 'finance-export',
        password: 'Password123',
        role: 'finance',
      },
      {
        id: 'usr_sales_export',
        name: 'Export Sales',
        username: 'sales-export',
        password: 'Password123',
        role: 'sales',
      },
      {
        id: 'usr_boss_export',
        name: 'Export Boss',
        username: 'boss-export',
        password: 'Password123',
        role: 'boss',
      },
      {
        id: 'usr_after_sales_export',
        name: 'Export After Sales',
        username: 'after-sales-export',
        password: 'Password123',
        role: 'after_sales',
      },
    ],
    customers: [
      {
        id: 'cust_export_alpha',
        name: 'Alpha Customer',
        phone: '13800001111',
        province: '贵州省',
        city: '贵阳市',
        district: '观山湖区',
        address: '测试路 1 号',
        financeMark: true,
      },
      {
        id: 'cust_export_beta',
        name: 'Beta Customer',
        phone: '13800002222',
        financeMark: true,
      },
      {
        id: 'cust_export_floor',
        name: 'Floor Customer',
        phone: '13800007777',
        financeMark: true,
      },
      {
        id: 'cust_global_standalone',
        name: 'Global Standalone',
        phone: '13800003333',
        financeMark: true,
      },
      {
        id: 'cust_global_unmarked',
        name: 'Global Unmarked Customer',
        phone: '13800004444',
        financeMark: false,
      },
      {
        id: 'cust_global_group',
        name: 'Global Group',
        phone: '13800005555',
        financeMark: true,
      },
      {
        id: 'cust_global_unmarked_group',
        name: 'Global Unmarked Group',
        phone: '13800006666',
        financeMark: true,
      },
    ],
    travelGroups: [
      {
        id: 'tg_export_alpha',
        groupNo: 'TG-EXPORT-001',
        visitDate: '2026-07-01T00:00:00.000Z',
        travelAgency: 'Export Travel Agency',
        guideName: 'Export Guide',
        tasterName: 'Export Taster',
        financeMark: true,
      },
      {
        id: 'tg_global_marked',
        groupNo: 'TG-GLOBAL-MARKED',
        visitDate: '2026-07-01T00:00:00.000Z',
        travelAgency: 'Global Marked Agency',
        financeMark: true,
      },
      {
        id: 'tg_global_unmarked',
        groupNo: 'TG-GLOBAL-UNMARKED',
        visitDate: '2026-07-01T00:00:00.000Z',
        travelAgency: 'Global Unmarked Agency',
        financeMark: false,
      },
    ],
    salesDeductionRules: [
      {
        id: 'sales-deduction-alpha-wine',
        productName: 'Alpha Wine',
        deductionCostCents: 10000,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        effectiveTo: null,
        isActive: true,
      },
      {
        id: 'sales-deduction-gift-box',
        productName: 'Gift Box',
        deductionCostCents: 5000,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        effectiveTo: null,
        isActive: true,
      },
      {
        id: 'sales-deduction-costly-wine',
        productName: 'Costly Wine',
        deductionCostCents: 3000,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        effectiveTo: null,
        isActive: true,
      },
    ],
    salesOrders: [
      buildExportOrder({
        id: 'order_export_alpha',
        orderNo: 'SO-EXPORT-ALPHA',
        salesFormNo: 'SF-EXPORT-ALPHA',
        travelGroupId: 'tg_export_alpha',
        customerId: 'cust_export_alpha',
        customerName: 'Alpha Customer',
        customerPhone: '13800001111',
        province: '贵州省',
        city: '贵阳市',
        district: '观山湖区',
        address: '测试路 1 号',
        totalAmountCents: 99800,
        shippingDateMode: 'PENDING_CUSTOMER_NOTICE',
        shippingDate: null,
        personalAmountCents: 30000,
        pointsDestination: 'GUIDE_PERSONAL',
        cashOnDeliveryAmountCents: 20000,
        logisticsMethod: '顺丰',
        logisticsNo: 'SF123456789',
        logisticsFeeCents: 1800,
        invoiceRequired: true,
        invoiceIssued: false,
        financeMark: true,
        salesUserId: 'usr_sales_export',
        createdById: 'usr_sales_export',
        createdAt: '2026-07-01T09:00:00.000Z',
        updatedAt: '2026-07-01T10:00:00.000Z',
        items: [
          {
            productName: 'Gift Box',
            quantity: 1,
            unitPriceCents: 20000,
            deliveryType: 'SELF_PICKUP',
            sortOrder: 2,
          },
          {
            productName: 'Alpha Wine',
            quantity: 2,
            unitPriceCents: 39900,
            deliveryType: 'SHIPPING',
            sortOrder: 1,
          },
        ],
        paymentDetails: [
          {
            id: 'payment-export-direct',
            paymentMethodId: SHOUQIANBA_ID,
            paymentMethodNameSnapshot: '收钱吧',
            paymentMethodCategorySnapshot: 'DIRECT_RECEIPT',
            amountCents: 79800,
            sortOrder: 0,
          },
          {
            id: 'payment-export-cod',
            paymentMethodId: COD_ID,
            paymentMethodNameSnapshot: '货到付款',
            paymentMethodCategorySnapshot: 'COLLECT_ON_DELIVERY',
            amountCents: 20000,
            sortOrder: 1,
            collectionConfirmed: true,
            collectionConfirmedAt: '2026-07-01T11:00:00.000Z',
            collectionConfirmedById: 'usr_finance_export',
          },
          {
            id: 'payment-export-negative',
            paymentMethodId: CASH_ID,
            paymentMethodNameSnapshot: '现金',
            paymentMethodCategorySnapshot: 'DIRECT_RECEIPT',
            amountCents: -100,
            sortOrder: 2,
          },
          {
            id: 'payment-export-adjustment',
            paymentMethodId: TRANSFER_ID,
            paymentMethodNameSnapshot: '转账',
            paymentMethodCategorySnapshot: 'DIRECT_RECEIPT',
            amountCents: 100,
            sortOrder: 3,
          },
          {
            id: 'payment-export-zero',
            paymentMethodId: CASH_ID,
            paymentMethodNameSnapshot: '现金',
            paymentMethodCategorySnapshot: 'DIRECT_RECEIPT',
            amountCents: 0,
            sortOrder: 4,
          },
        ],
      }),
      buildExportOrder({
        id: 'order_export_alpha_cancelled',
        orderNo: 'SO-EXPORT-ALPHA-CANCELLED',
        salesFormNo: 'SF-EXPORT-ALPHA-CANCELLED',
        customerId: 'cust_export_alpha',
        customerName: 'Alpha Customer',
        status: 'CANCELLED',
      }),
      buildExportOrder({
        id: 'order_export_beta',
        orderNo: 'SO-EXPORT-BETA',
        salesFormNo: 'SF-EXPORT-BETA',
        customerId: 'cust_export_beta',
        customerName: 'Beta Customer',
      }),
      buildExportOrder({
        id: 'order_export_floor',
        orderNo: 'SO-EXPORT-FLOOR',
        customerId: 'cust_export_floor',
        customerName: 'Floor Customer',
        totalAmountCents: 5000,
        items: [
          {
            productName: 'Costly Wine',
            quantity: 2,
            unitPriceCents: 2500,
            deliveryType: 'SHIPPING',
          },
        ],
      }),
      buildExportOrder({
        id: 'order_global_standalone',
        orderNo: 'SO-GLOBAL-STANDALONE',
        customerId: 'cust_global_standalone',
        customerName: 'Global Standalone',
        financeMark: true,
      }),
      buildExportOrder({
        id: 'order_global_unmarked_customer',
        orderNo: 'SO-GLOBAL-UNMARKED-CUSTOMER',
        customerId: 'cust_global_unmarked',
        customerName: 'Global Unmarked Customer',
        financeMark: true,
      }),
      buildExportOrder({
        id: 'order_global_group',
        orderNo: 'SO-GLOBAL-GROUP',
        travelGroupId: 'tg_global_marked',
        customerId: 'cust_global_group',
        customerName: 'Global Group',
        financeMark: false,
      }),
      buildExportOrder({
        id: 'order_global_unmarked_group',
        orderNo: 'SO-GLOBAL-UNMARKED-GROUP',
        travelGroupId: 'tg_global_unmarked',
        customerId: 'cust_global_unmarked_group',
        customerName: 'Global Unmarked Group',
        financeMark: true,
      }),
    ],
  };
}

function buildExportOrder(overrides = {}) {
  return {
    orderType: 'EXTERNAL',
    orderDate: '2026-07-01T00:00:00.000Z',
    shippingDateMode: 'SCHEDULED',
    shippingDate: '2026-07-02T00:00:00.000Z',
    packingStatus: 'PACKED',
    status: 'VALID',
    financeMark: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    items: [
      {
        productName: 'Seed Product',
        quantity: 1,
        unitPriceCents: 10000,
        deliveryType: 'SHIPPING',
      },
    ],
    ...overrides,
  };
}
