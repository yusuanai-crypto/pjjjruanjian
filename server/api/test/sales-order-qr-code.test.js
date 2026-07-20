const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  assertErrorContract,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

const DAY_MS = 24 * 60 * 60 * 1000;

test('POST /api/sales-orders/:id/qr-code generates first QR code for admin and writes sanitized log', async (t) => {
  setPublicSalesSheetBaseUrl(t, 'https://qr.example.test/base/');
  setPublicSalesSheetDefaultTtl(t, undefined);

  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);

      const result = await requestJson(
        baseUrl,
        '/api/sales-orders/order_qr_new/qr-code',
        {
          method: 'POST',
          token: admin.token,
          body: {},
        },
      );

      assert.equal(result.response.status, 201);
      const { salesSheet, qrCode } = result.body.data;
      assert.equal(salesSheet.order.id, 'order_qr_new');
      assert.equal(qrCode.token, salesSheet.qrCode.token);
      assert.match(qrCode.token, /^[A-Za-z0-9_-]{32}$/);
      assert.equal(
        qrCode.url,
        `https://qr.example.test/base/api/public/sales-sheets/${qrCode.token}`,
      );
      const publicPage = await fetch(
        `${baseUrl}/api/public/sales-sheets/${qrCode.token}`,
      );
      const publicHtml = await publicPage.text();
      assert.equal(publicPage.status, 200);
      assert.match(
        publicPage.headers.get('content-type') || '',
        /text\/html/,
      );
      assert.match(publicHtml, /^<!doctype html>/i);
      assert.match(publicHtml, /SO-QR-NEW/);
      assert.equal(
        new Date(qrCode.expiresAt).getTime() -
          new Date(qrCode.generatedAt).getTime(),
        30 * DAY_MS,
      );

      const preview = await requestJson(
        baseUrl,
        '/api/sales-orders/order_qr_new/sales-sheet',
        {
          token: admin.token,
        },
      );
      assert.equal(preview.response.status, 200);
      assert.equal(preview.body.data.salesSheet.qrCode.active, true);
      assert.equal(preview.body.data.salesSheet.qrCode.token, null);
      assert.equal(preview.body.data.salesSheet.qrCode.url, null);

      const logs = await requestJson(
        baseUrl,
        '/api/operation-logs?action=sales_orders.qr_code.generate',
        {
          token: admin.token,
        },
      );
      assert.equal(logs.response.status, 200);
      assert.equal(logs.body.data.logs.length, 1);
      const log = logs.body.data.logs[0];
      assert.equal(log.entityId, 'order_qr_new');
      assert.deepEqual(Object.keys(log.beforeData).sort(), [
        'id',
        'orderNo',
        'qrCode',
        'salesUserId',
      ]);
      assert.deepEqual(Object.keys(log.afterData).sort(), [
        'id',
        'orderNo',
        'qrCode',
        'salesUserId',
      ]);
      assert.equal(log.beforeData.qrCode.tokenPresent, false);
      assert.equal(log.afterData.qrCode.tokenPresent, true);
      assert.match(log.afterData.qrCode.tokenFingerprint, /^[a-f0-9]{16}$/);
      assert.equal(JSON.stringify(log).includes(qrCode.token), false);
      assert.equal('customerName' in log.afterData, false);
      assert.equal('customerPhone' in log.afterData, false);
      assert.equal('items' in log.afterData, false);
    },
    {
      prisma: buildQrCodePrismaOptions(),
    },
  );
});

test('POST /api/sales-orders/:id/qr-code rejects non-public scan base URLs', async () => {
  const previous = process.env.PUBLIC_SALES_SHEET_BASE_URL;
  try {
    delete process.env.PUBLIC_SALES_SHEET_BASE_URL;
    await withPhase1Server(
      async (baseUrl) => {
        const admin = await login(baseUrl);
        const result = await requestJson(
          baseUrl,
          '/api/sales-orders/order_qr_new/qr-code',
          {
            method: 'POST',
            token: admin.token,
            headers: {
              host: 'spoofed.example.test',
              'x-forwarded-host': 'spoofed.example.test',
              'x-forwarded-proto': 'https',
            },
          },
        );
        assertErrorContract(
          result,
          400,
          'PUBLIC_SALES_SHEET_BASE_URL_UNSAFE',
        );
      },
      {
        prisma: buildQrCodePrismaOptions(),
      },
    );

    process.env.PUBLIC_SALES_SHEET_BASE_URL = 'https://192.168.1.20';
    await withPhase1Server(
      async (baseUrl) => {
        const admin = await login(baseUrl);
        const result = await requestJson(
          baseUrl,
          '/api/sales-orders/order_qr_new/qr-code',
          {
            method: 'POST',
            token: admin.token,
          },
        );
        assertErrorContract(
          result,
          400,
          'PUBLIC_SALES_SHEET_BASE_URL_UNSAFE',
        );
      },
      {
        prisma: buildQrCodePrismaOptions(),
      },
    );
  } finally {
    if (previous === undefined) {
      delete process.env.PUBLIC_SALES_SHEET_BASE_URL;
    } else {
      process.env.PUBLIC_SALES_SHEET_BASE_URL = previous;
    }
  }
});

test('POST /api/sales-orders/:id/qr-code requires explicit regeneration when a code is active', async (t) => {
  setPublicSalesSheetBaseUrl(t, 'https://qr.example.test');

  await withPhase1Server(
    async (baseUrl) => {
      const sales = await login(baseUrl, 'sales-alpha-qr', 'Password123');

      const result = await requestJson(
        baseUrl,
        '/api/sales-orders/order_qr_reuse/qr-code',
        {
          method: 'POST',
          token: sales.token,
        },
      );

      assertErrorContract(result, 409, 'QR_CODE_ALREADY_ACTIVE');

      const admin = await login(baseUrl);
      const generateLogs = await requestJson(
        baseUrl,
        '/api/operation-logs?action=sales_orders.qr_code.generate',
        {
          token: admin.token,
        },
      );
      const regenerateLogs = await requestJson(
        baseUrl,
        '/api/operation-logs?action=sales_orders.qr_code.regenerate',
        {
          token: admin.token,
        },
      );
      assert.equal(generateLogs.response.status, 200);
      assert.equal(regenerateLogs.response.status, 200);
      assert.equal(generateLogs.body.data.logs.length, 0);
      assert.equal(regenerateLogs.body.data.logs.length, 0);
    },
    {
      prisma: buildQrCodePrismaOptions(),
    },
  );
});

test('POST /api/sales-orders/:id/qr-code regenerates an existing QR code for sales', async (t) => {
  setPublicSalesSheetBaseUrl(t, 'https://qr.example.test');

  await withPhase1Server(
    async (baseUrl) => {
      const sales = await login(baseUrl, 'sales-alpha-qr', 'Password123');

      const result = await requestJson(
        baseUrl,
        '/api/sales-orders/order_qr_regenerate/qr-code',
        {
          method: 'POST',
          token: sales.token,
          body: {
            regenerate: true,
            expiresInDays: 1,
          },
        },
      );

      assert.equal(result.response.status, 201);
      const qrCode = result.body.data.qrCode;
      assert.match(qrCode.token, /^[A-Za-z0-9_-]{32}$/);
      assert.notEqual(qrCode.token, 'old-qr-token-00000001');
      assert.equal(
        new Date(qrCode.expiresAt).getTime() -
          new Date(qrCode.generatedAt).getTime(),
        DAY_MS,
      );

      const admin = await login(baseUrl);
      const logs = await requestJson(
        baseUrl,
        '/api/operation-logs?action=sales_orders.qr_code.regenerate',
        {
          token: admin.token,
        },
      );
      assert.equal(logs.response.status, 200);
      assert.equal(logs.body.data.logs.length, 1);
      const log = logs.body.data.logs[0];
      assert.equal(log.beforeData.qrCode.tokenPresent, true);
      assert.equal(log.afterData.qrCode.tokenPresent, true);
      assert.notEqual(
        log.beforeData.qrCode.tokenFingerprint,
        log.afterData.qrCode.tokenFingerprint,
      );
      assert.equal(JSON.stringify(log).includes(qrCode.token), false);

      const oldPage = await fetch(
        `${baseUrl}/api/public/sales-sheets/old-qr-token-00000001`,
      );
      assert.equal(oldPage.status, 404);
      const newPage = await fetch(
        `${baseUrl}/api/public/sales-sheets/${qrCode.token}`,
      );
      assert.equal(newPage.status, 200);
    },
    {
      prisma: buildQrCodePrismaOptions(),
    },
  );
});

test('DELETE /api/sales-orders/:id/qr-code immediately revokes the bearer capability', async (t) => {
  setPublicSalesSheetBaseUrl(t, 'https://qr.example.test');

  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const generated = await requestJson(
        baseUrl,
        '/api/sales-orders/order_qr_new/qr-code',
        {
          method: 'POST',
          token: admin.token,
        },
      );
      assert.equal(generated.response.status, 201);
      const rawToken = generated.body.data.qrCode.token;

      const before = await fetch(
        `${baseUrl}/api/public/sales-sheets/${rawToken}`,
      );
      assert.equal(before.status, 200);

      const revoked = await requestJson(
        baseUrl,
        '/api/sales-orders/order_qr_new/qr-code',
        {
          method: 'DELETE',
          token: admin.token,
        },
      );
      assert.equal(revoked.response.status, 200);
      assert.equal(revoked.body.data.qrCode.active, false);
      assert.equal(revoked.body.data.qrCode.token, null);
      assert.equal(revoked.body.data.qrCode.url, null);

      const after = await fetch(
        `${baseUrl}/api/public/sales-sheets/${rawToken}`,
      );
      assert.equal(after.status, 404);

      const logs = await requestJson(
        baseUrl,
        '/api/operation-logs?action=sales_orders.qr_code.revoke',
        { token: admin.token },
      );
      assert.equal(logs.response.status, 200);
      assert.equal(logs.body.data.logs.length, 1);
      assert.equal(JSON.stringify(logs.body.data.logs[0]).includes(rawToken), false);
    },
    {
      prisma: buildQrCodePrismaOptions(),
    },
  );
});

test('POST /api/sales-orders/:id/qr-code rejects invalid expiration, sales overreach, and read-only roles', async (t) => {
  setPublicSalesSheetBaseUrl(t, 'https://qr.example.test');

  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const invalid = await requestJson(
        baseUrl,
        '/api/sales-orders/order_qr_new/qr-code',
        {
          method: 'POST',
          token: admin.token,
          body: {
            expiresInDays: 91,
          },
        },
      );
      assertErrorContract(invalid, 400, 'VALIDATION_FAILED');

      const sales = await login(baseUrl, 'sales-alpha-qr', 'Password123');
      const overreach = await requestJson(
        baseUrl,
        '/api/sales-orders/order_qr_beta/qr-code',
        {
          method: 'POST',
          token: sales.token,
        },
      );
      assertErrorContract(overreach, 404, 'SALES_ORDER_NOT_FOUND');

      for (const username of [
        'finance-qr',
        'boss-qr',
        'after-sales-qr',
      ]) {
        const session = await login(baseUrl, username, 'Password123');
        const denied = await requestJson(
          baseUrl,
          '/api/sales-orders/order_qr_new/qr-code',
          {
            method: 'POST',
            token: session.token,
          },
        );
        assertErrorContract(denied, 403, 'PERMISSION_DENIED');
      }
    },
    {
      prisma: buildQrCodePrismaOptions(),
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

function setPublicSalesSheetDefaultTtl(t, value) {
  const previous = process.env.PUBLIC_SALES_SHEET_DEFAULT_TTL_DAYS;
  if (value === undefined) {
    delete process.env.PUBLIC_SALES_SHEET_DEFAULT_TTL_DAYS;
  } else {
    process.env.PUBLIC_SALES_SHEET_DEFAULT_TTL_DAYS = value;
  }
  t.after(() => {
    if (previous === undefined) {
      delete process.env.PUBLIC_SALES_SHEET_DEFAULT_TTL_DAYS;
    } else {
      process.env.PUBLIC_SALES_SHEET_DEFAULT_TTL_DAYS = previous;
    }
  });
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function buildQrCodePrismaOptions() {
  return {
    users: [
      buildUser('usr_sales_alpha_qr', 'sales-alpha-qr', 'sales'),
      buildUser('usr_sales_beta_qr', 'sales-beta-qr', 'sales'),
      buildUser('usr_finance_qr', 'finance-qr', 'finance'),
      buildUser('usr_boss_qr', 'boss-qr', 'boss'),
      buildUser('usr_after_sales_qr', 'after-sales-qr', 'after_sales'),
    ],
    customers: [
      {
        id: 'cust_qr_alpha',
        name: 'Alice Customer',
        phone: '13812340000',
        province: 'Guizhou',
        city: 'Zunyi',
        district: 'Renhuai',
        address: 'Test Road 1',
        financeMark: true,
      },
    ],
    travelGroups: [
      {
        id: 'tg_qr_alpha',
        groupNo: 'TG-QR-001',
        visitDate: '2026-07-01T00:00:00.000Z',
        travelAgency: 'Test Agency',
        guideName: 'Guide Alpha',
        guidePhone: '13900000000',
        tastingRoomNo: 'A101',
        tasterName: 'Taster Alpha',
        financeMark: true,
      },
    ],
    salesOrders: [
      buildQrCodeOrder({
        id: 'order_qr_new',
        orderNo: 'SO-QR-NEW',
      }),
      buildQrCodeOrder({
        id: 'order_qr_reuse',
        orderNo: 'SO-QR-REUSE',
        qrCodeTokenHash: tokenHash('existing-qr-token-00001'),
        qrCodeGeneratedAt: '2026-07-01T10:00:00.000Z',
        qrCodeExpiresAt: '2099-08-01T10:00:00.000Z',
      }),
      buildQrCodeOrder({
        id: 'order_qr_regenerate',
        orderNo: 'SO-QR-REGEN',
        qrCodeTokenHash: tokenHash('old-qr-token-00000001'),
        qrCodeGeneratedAt: '2026-07-01T10:00:00.000Z',
        qrCodeExpiresAt: '2026-08-01T10:00:00.000Z',
      }),
      buildQrCodeOrder({
        id: 'order_qr_beta',
        orderNo: 'SO-QR-BETA',
        salesUserId: 'usr_sales_beta_qr',
        createdById: 'usr_sales_beta_qr',
      }),
    ],
  };
}

function buildUser(id, username, role) {
  return {
    id,
    name: username,
    username,
    password: 'Password123',
    role,
  };
}

function buildQrCodeOrder(overrides = {}) {
  return {
    orderType: 'TRAVEL_GROUP',
    travelGroupId: 'tg_qr_alpha',
    customerId: 'cust_qr_alpha',
    customerName: 'Alice Customer',
    customerPhone: '13812340000',
    province: 'Guizhou',
    city: 'Zunyi',
    district: 'Renhuai',
    address: 'Test Road 1',
    orderDate: '2026-07-01T00:00:00.000Z',
    salesFormNo: 'SF-QR',
    totalAmountCents: 10000,
    cashOnDeliveryAmountCents: 2000,
    logisticsMethod: 'SF Express',
    packingStatus: 'PACKED',
    packageCount: 1,
    logisticsNo: 'SF123456789',
    logisticsFeeCents: 1200,
    invoiceRequired: false,
    invoiceIssued: false,
    remark: 'Customer visible note',
    status: 'VALID',
    financeMark: true,
    salesUserId: 'usr_sales_alpha_qr',
    createdById: 'usr_sales_alpha_qr',
    items: [
      {
        productName: 'Product A',
        quantity: 1,
        unitPriceCents: 10000,
        subtotalCents: 10000,
        deliveryType: 'SHIPPING',
        sortOrder: 1,
      },
    ],
    ...overrides,
  };
}
