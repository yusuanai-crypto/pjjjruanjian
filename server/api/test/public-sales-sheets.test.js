const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const { withPhase1Server } = require('./helpers/phase1-api');

test('GET /api/public/sales-sheets/:token returns mobile-friendly HTML without login', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const result = await requestHtml(
        baseUrl,
        '/api/public/sales-sheets/public-token-success',
      );

      assert.equal(result.response.status, 200);
      assert.match(
        result.response.headers.get('content-type') || '',
        /text\/html/,
      );
      assert.match(result.html, /^<!doctype html>/i);
      assert.equal(result.html.trim().startsWith('{'), false);
      assert.match(result.html, /销售单/);
      assert.match(result.html, /SO-PUBLIC-001/);
      assert.equal(result.html.includes('SF-PUBLIC-001'), false);
      assert.match(result.html, /138\*\*\*\*0000/);
      assert.match(result.html, /Product A/);
      assert.match(result.html, /G\*+ Z\*+ R\*+ T\*\*\*/);
      for (const forbidden of [
        '999.00',
        '200.00',
        'Test Agency',
        'Seller Alpha',
        'SF123456789',
        'SF Express',
        'Test Road 1',
        'Customer visible note',
      ]) {
        assert.equal(result.html.includes(forbidden), false, forbidden);
      }
      assertSecurityHeaders(result.response);
      assert.equal(/<(script|img|link)\b/i.test(result.html), false);
    },
    {
      prisma: buildPublicSalesSheetPrismaOptions(),
    },
  );
});

test('GET /api/public/sales-sheets/:token returns the same safe page for invalid, expired, and revoked tokens', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const results = [];
      for (const token of [
        'unknown-token',
        'public-token-expired',
        'public-token-revoked',
      ]) {
        const result = await requestHtml(
          baseUrl,
          `/api/public/sales-sheets/${token}`,
        );
        assert.equal(result.response.status, 404);
        assert.match(result.html, /^<!doctype html>/i);
        assert.match(result.html, /销售单暂不可用/);
        assert.equal(result.html.trim().startsWith('{'), false);
        assert.equal(result.html.includes('SO-PUBLIC-EXPIRED'), false);
        assert.equal(result.html.includes('SO-PUBLIC-REVOKED'), false);
        assertSecurityHeaders(result.response);
        results.push(result.html);
      }
      assert.equal(new Set(results).size, 1);
    },
    {
      prisma: buildPublicSalesSheetPrismaOptions(),
    },
  );
});

test('GET /api/public/sales-sheets/:token escapes HTML and does not leak internal fields', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const result = await requestHtml(
        baseUrl,
        '/api/public/sales-sheets/public-token-unsafe-1',
      );

      assert.equal(result.response.status, 200);
      assert.equal(result.html.includes('<script>alert'), false);
      assert.equal(result.html.includes('<img src=x'), false);
      assert.equal(result.html.includes('<strong>'), false);
      assert.match(result.html, /Alice &lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
      assert.match(result.html, /Product &lt;script&gt;bad\(\)&lt;\/script&gt;/);
      assert.equal(result.html.includes('Road &lt;b&gt;1'), false);
      assert.equal(result.html.includes('Please &lt;strong&gt;check'), false);
      assertSecurityHeaders(result.response);

      for (const forbidden of [
        'SECRET_FINANCE_REMARK',
        'SECRET_WAREHOUSE_REMARK',
        'financeMark',
        'financeRemark',
        'warehouseRemark',
        'operation_logs',
        'order_public_unsafe',
        'cust_public_alpha',
        'usr_sales_public',
        'commission',
        'points',
        'liquorCostDeduction',
      ]) {
        assert.equal(result.html.includes(forbidden), false, forbidden);
      }
    },
    {
      prisma: buildPublicSalesSheetPrismaOptions(),
    },
  );
});

async function requestHtml(baseUrl, pathName) {
  const response = await fetch(`${baseUrl}${pathName}`);
  return {
    response,
    html: await response.text(),
  };
}

function assertSecurityHeaders(response) {
  assert.equal(response.headers.get('cache-control'), 'no-store, private');
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  const csp = response.headers.get('content-security-policy') || '';
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function buildPublicSalesSheetPrismaOptions() {
  return {
    users: [
      {
        id: 'usr_sales_public',
        name: 'Seller Alpha',
        username: 'seller-public',
        password: 'Password123',
        role: 'sales',
      },
    ],
    customers: [
      {
        id: 'cust_public_alpha',
        name: 'Public Customer',
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
        id: 'tg_public_alpha',
        groupNo: 'TG-PUBLIC-001',
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
      buildPublicSalesSheetOrder({
        id: 'order_public_success',
        orderNo: 'SO-PUBLIC-001',
        salesFormNo: 'SF-PUBLIC-001',
        qrCodeTokenHash: tokenHash('public-token-success'),
        qrCodeGeneratedAt: '2026-07-01T10:00:00.000Z',
        qrCodeExpiresAt: '2099-07-01T10:00:00.000Z',
      }),
      buildPublicSalesSheetOrder({
        id: 'order_public_expired',
        orderNo: 'SO-PUBLIC-EXPIRED',
        qrCodeTokenHash: tokenHash('public-token-expired'),
        qrCodeGeneratedAt: '2026-07-01T10:00:00.000Z',
        qrCodeExpiresAt: '2000-01-01T00:00:00.000Z',
      }),
      buildPublicSalesSheetOrder({
        id: 'order_public_revoked',
        orderNo: 'SO-PUBLIC-REVOKED',
        qrCodeTokenHash: tokenHash('public-token-revoked'),
        qrCodeGeneratedAt: '2026-07-01T10:00:00.000Z',
        qrCodeExpiresAt: '2099-07-01T10:00:00.000Z',
        qrCodeRevokedAt: '2026-07-02T00:00:00.000Z',
      }),
      buildPublicSalesSheetOrder({
        id: 'order_public_unsafe',
        orderNo: 'SO-PUBLIC-UNSAFE',
        qrCodeTokenHash: tokenHash('public-token-unsafe-1'),
        qrCodeExpiresAt: '2099-07-01T10:00:00.000Z',
        customerName: 'Alice <script>alert("x")</script>',
        address: 'Road <b>1</b> & Lane',
        remark: 'Please <strong>check</strong> & keep',
        financeRemark: 'SECRET_FINANCE_REMARK',
        warehouseRemark: 'SECRET_WAREHOUSE_REMARK',
        items: [
          {
            productName: 'Product <script>bad()</script>',
            quantity: 1,
            unitPriceCents: 99900,
            subtotalCents: 99900,
            deliveryType: 'SHIPPING',
            sortOrder: 1,
          },
        ],
      }),
    ],
  };
}

function buildPublicSalesSheetOrder(overrides = {}) {
  return {
    orderType: 'TRAVEL_GROUP',
    travelGroupId: 'tg_public_alpha',
    customerId: 'cust_public_alpha',
    customerName: 'Public Customer',
    customerPhone: '13812340000',
    province: 'Guizhou',
    city: 'Zunyi',
    district: 'Renhuai',
    address: 'Test Road 1',
    orderDate: '2026-07-01T00:00:00.000Z',
    salesFormNo: 'SF-PUBLIC',
    totalAmountCents: 99900,
    cashOnDeliveryAmountCents: 20000,
    logisticsMethod: 'SF Express',
    packingStatus: 'PACKED',
    packageCount: 1,
    warehouseRemark: 'SECRET_WAREHOUSE_REMARK',
    logisticsNo: 'SF123456789',
    logisticsFeeCents: 1200,
    invoiceRequired: true,
    invoiceIssued: false,
    financeRemark: 'SECRET_FINANCE_REMARK',
    remark: 'Customer visible note',
    status: 'VALID',
    financeMark: true,
    salesUserId: 'usr_sales_public',
    createdById: 'usr_sales_public',
    qrCodeTokenHash: tokenHash('public-token-success'),
    qrCodeGeneratedAt: '2026-07-01T10:00:00.000Z',
    qrCodeExpiresAt: '2099-07-01T10:00:00.000Z',
    qrCodeRevokedAt: null,
    items: [
      {
        productName: 'Product A',
        quantity: 1,
        unitPriceCents: 99900,
        subtotalCents: 99900,
        deliveryType: 'SHIPPING',
        sortOrder: 1,
      },
    ],
    ...overrides,
  };
}
