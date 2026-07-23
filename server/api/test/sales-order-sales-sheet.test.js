const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  assertErrorContract,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

test('GET /api/sales-orders/:id/sales-sheet returns no-token sales sheet for admin without writing logs', async (t) => {
  setPublicSalesSheetBaseUrl(t, undefined);

  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const beforeLogs = await requestJson(baseUrl, '/api/operation-logs', {
        token: admin.token,
      });
      assert.equal(beforeLogs.response.status, 200);

      const result = await requestJson(
        baseUrl,
        '/api/sales-orders/order_sheet_alpha_no_token/sales-sheet',
        {
          token: admin.token,
        },
      );

      assert.equal(result.response.status, 200);
      const salesSheet = result.body.data.salesSheet;
      assert.equal(salesSheet.visibility, 'internal');
      assert.equal(salesSheet.companyName, '贵州酱酒馆');
      assert.equal(salesSheet.venueName, '茅台集团茅乡酱酒体验馆');
      assert.equal(salesSheet.afterSalesPhone, '177-8530-5984');
      assert.equal(salesSheet.order.id, 'order_sheet_alpha_no_token');
      assert.equal(salesSheet.order.orderNo, 'SO-SHEET-NO-TOKEN');
      assert.equal(salesSheet.customer.phone, '13812340000');
      assert.equal(salesSheet.customer.phoneMasked, '138****0000');
      assert.equal(salesSheet.public.customer.phone, '13812340000');
      assert.equal(
        salesSheet.public.customer.fullAddress,
        '贵州省遵义市仁怀市茅台镇测试路 1 号',
      );
      assert.equal(salesSheet.logistics.providerCode, 'shunfeng');
      assert.equal(salesSheet.logistics.providerName, '顺丰速运');
      assert.equal(salesSheet.logistics.logisticsNo, 'SF123456789');
      assert.equal(
        salesSheet.logistics.trackingMessage,
        '物流查询服务暂未配置',
      );
      assert.equal(salesSheet.salesUser.name, '销售甲');
      assert.equal(salesSheet.items.length, 2);
      assert.equal(salesSheet.qrCode, null);
      assert.equal(salesSheet.public.qrCode, null);

      const afterLogs = await requestJson(baseUrl, '/api/operation-logs', {
        token: admin.token,
      });
      assert.equal(afterLogs.response.status, 200);
      assert.equal(
        afterLogs.body.data.logs.length,
        beforeLogs.body.data.logs.length,
      );
    },
    {
      prisma: buildSalesSheetPrismaOptions(),
    },
  );
});

test('GET /api/sales-orders/:id/sales-sheet returns active QR metadata without exposing its bearer value', async (t) => {
  setPublicSalesSheetBaseUrl(t, 'https://sheet.example.test/root/');

  await withPhase1Server(
    async (baseUrl) => {
      const sales = await login(baseUrl, 'sales-alpha-sheet', 'Password123');

      const result = await requestJson(
        baseUrl,
        '/api/sales-orders/order_sheet_alpha_token/sales-sheet',
        {
          token: sales.token,
        },
      );

      assert.equal(result.response.status, 200);
      const salesSheet = result.body.data.salesSheet;
      assert.equal(salesSheet.order.id, 'order_sheet_alpha_token');
      assert.equal(salesSheet.qrCode.active, true);
      assert.equal(salesSheet.qrCode.token, null);
      assert.equal(salesSheet.qrCode.url, null);
      assert.equal(
        salesSheet.qrCode.generatedAt,
        '2026-07-01T10:00:00.000Z',
      );
      assert.equal(
        salesSheet.qrCode.expiresAt,
        '2026-08-01T10:00:00.000Z',
      );
      assert.equal(salesSheet.public.qrCode.generatedAt, salesSheet.qrCode.generatedAt);
      assert.equal(salesSheet.public.qrCode.expiresAt, salesSheet.qrCode.expiresAt);
      assert.equal('token' in salesSheet.public.qrCode, false);
      assert.equal('url' in salesSheet.public.qrCode, false);
    },
    {
      prisma: buildSalesSheetPrismaOptions(),
    },
  );
});

test('GET /api/sales-orders/:id/sales-sheet never derives a public URL from request headers and keeps sales data scope', async (t) => {
  setPublicSalesSheetBaseUrl(t, undefined);

  await withPhase1Server(
    async (baseUrl) => {
      const sales = await login(baseUrl, 'sales-alpha-sheet', 'Password123');

      const fallback = await requestJson(
        baseUrl,
        '/api/sales-orders/order_sheet_alpha_token/sales-sheet',
        {
          token: sales.token,
          headers: {
            'x-forwarded-proto': 'https',
            'x-forwarded-host': 'scan.example.test',
          },
        },
      );

      assert.equal(fallback.response.status, 200);
      assert.equal(fallback.body.data.salesSheet.qrCode.url, null);

      const forbidden = await requestJson(
        baseUrl,
        '/api/sales-orders/order_sheet_beta_token/sales-sheet',
        {
          token: sales.token,
        },
      );
      assertErrorContract(forbidden, 404, 'SALES_ORDER_NOT_FOUND');
    },
    {
      prisma: buildSalesSheetPrismaOptions(),
    },
  );
});

function setPublicSalesSheetBaseUrl(t, value) {
  const previous = process.env.PUBLIC_SALES_SHEET_BASE_URL;
  if (value === undefined) {
    delete process.env.PUBLIC_SALES_SHEET_BASE_URL;
  } else {
    process.env.PUBLIC_SALES_SHEET_BASE_URL = value;
  }
  t.after(() => {
    if (previous === undefined) {
      delete process.env.PUBLIC_SALES_SHEET_BASE_URL;
    } else {
      process.env.PUBLIC_SALES_SHEET_BASE_URL = previous;
    }
  });
}

function buildSalesSheetPrismaOptions() {
  return {
    users: [
      {
        id: 'usr_sales_alpha',
        name: '销售甲',
        username: 'sales-alpha-sheet',
        password: 'Password123',
        role: 'sales',
      },
      {
        id: 'usr_sales_beta',
        name: '销售乙',
        username: 'sales-beta-sheet',
        password: 'Password123',
        role: 'sales',
      },
    ],
    customers: [
      {
        id: 'cust_sheet_alpha',
        name: '张三',
        phone: '13812340000',
        province: '贵州省',
        city: '遵义市',
        district: '仁怀市',
        address: '茅台镇测试路 1 号',
        financeMark: true,
      },
    ],
    travelGroups: [
      {
        id: 'tg_sheet_alpha',
        groupNo: 'TG-SHEET-001',
        visitDate: '2026-07-01T00:00:00.000Z',
        travelAgency: '测试旅行社',
        guideName: '导游甲',
        guidePhone: '13900000000',
        tastingRoomNo: 'A101',
        tasterName: '品鉴师甲',
        financeMark: true,
      },
    ],
    salesOrders: [
      buildSalesSheetOrder({
        id: 'order_sheet_alpha_no_token',
        orderNo: 'SO-SHEET-NO-TOKEN',
        salesFormNo: 'SF-NO-TOKEN',
      }),
      buildSalesSheetOrder({
        id: 'order_sheet_alpha_token',
        orderNo: 'SO-SHEET-TOKEN',
        salesFormNo: 'SF-TOKEN',
        qrCodeTokenHash: tokenHash('sheet-token-123'),
        qrCodeGeneratedAt: '2026-07-01T10:00:00.000Z',
        qrCodeExpiresAt: '2026-08-01T10:00:00.000Z',
      }),
      buildSalesSheetOrder({
        id: 'order_sheet_beta_token',
        orderNo: 'SO-SHEET-BETA',
        salesFormNo: 'SF-BETA',
        salesUserId: 'usr_sales_beta',
        createdById: 'usr_sales_beta',
        qrCodeTokenHash: tokenHash('sheet-token-beta'),
        qrCodeExpiresAt: '2026-08-01T10:00:00.000Z',
      }),
    ],
  };
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function buildSalesSheetOrder(overrides = {}) {
  return {
    orderType: 'TRAVEL_GROUP',
    travelGroupId: 'tg_sheet_alpha',
    customerId: 'cust_sheet_alpha',
    customerName: '张三',
    customerPhone: '13812340000',
    province: '贵州省',
    city: '遵义市',
    district: '仁怀市',
    address: '茅台镇测试路 1 号',
    orderDate: '2026-07-01T00:00:00.000Z',
    totalAmountCents: 99800,
    cashOnDeliveryAmountCents: 20000,
    logisticsMethod: '顺丰',
    logisticsProviderCode: 'shunfeng',
    packingStatus: 'PACKED',
    packageCount: 1,
    logisticsNo: 'SF123456789',
    logisticsFeeCents: 1800,
    invoiceRequired: true,
    invoiceIssued: false,
    financeRemark: '财务内部备注',
    warehouseRemark: '库管内部备注',
    remark: '客户可见备注',
    status: 'VALID',
    financeMark: true,
    salesUserId: 'usr_sales_alpha',
    createdById: 'usr_sales_alpha',
    items: [
      {
        productName: '酱香一号',
        quantity: 2,
        unitPriceCents: 39900,
        subtotalCents: 79800,
        deliveryType: 'SHIPPING',
        sortOrder: 1,
      },
      {
        productName: '礼盒',
        quantity: 1,
        unitPriceCents: 20000,
        subtotalCents: 20000,
        deliveryType: 'SELF_PICKUP',
        sortOrder: 2,
      },
    ],
    ...overrides,
  };
}
