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
      assert.match(result.html, /待客人通知/);
      assert.equal(result.html.includes('SF-PUBLIC-001'), false);
      assert.match(result.html, /13812340000/);
      assert.match(result.html, /GuizhouZunyiRenhuaiTest Road 1/);
      assert.match(result.html, /Product A/);
      assert.match(result.html, /@media print/);
      assert.match(result.html, /顺丰速运/);
      assert.match(result.html, /SF123456789/);
      assert.match(result.html, /运输中/);
      assert.match(result.html, /贵州省遵义市/);
      assert.match(result.html, /茅台集团茅乡酱酒体验馆/);
      assert.match(result.html, /177-8530-5984/);
      for (const forbidden of [
        '收款明细',
        '暂无收款明细',
        '收款方式',
        '收款金额',
        '收款属性',
        '确认状态',
        '收钱吧',
        '货到付款',
        '即时收款',
        '代收营业款',
        '无需确认',
        '代收款（待确认）',
        '799.00',
        '200.00',
        'payment-table',
        'payment-row',
        'DIRECT_RECEIPT',
        'COLLECT_ON_DELIVERY',
        'agencyCollectionConfirmed',
        '999.00',
        'Test Agency',
        'Seller Alpha',
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
      assert.match(result.html, /Road &lt;b&gt;1&lt;\/b&gt; &amp; Lane/);
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
  assert.equal(
    response.headers.get('x-robots-tag'),
    'noindex, nofollow, noarchive',
  );
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
        shippingDateMode: 'PENDING_CUSTOMER_NOTICE',
        shippingDate: null,
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
    shippingDateMode: 'SCHEDULED',
    shippingDate: '2026-07-02T00:00:00.000Z',
    salesFormNo: 'SF-PUBLIC',
    totalAmountCents: 99900,
    cashOnDeliveryAmountCents: 20000,
    logisticsMethod: '顺丰速运',
    logisticsProviderCode: 'shunfeng',
    packingStatus: 'PACKED',
    packageCount: 1,
    warehouseRemark: 'SECRET_WAREHOUSE_REMARK',
    logisticsNo: 'SF123456789',
    trackingState: 'in_transit',
    trackingStateLabel: '运输中',
    trackingLatestLocation: '贵州省遵义市',
    trackingLatestDescription: '快件已发往贵阳市',
    trackingEventAt: '2026-07-01T11:00:00.000Z',
    trackingCheckedAt: new Date().toISOString(),
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
    paymentDetails: [
      {
        id: 'payment-public-direct',
        paymentMethodId: 'payment-method-direct',
        paymentMethodNameSnapshot: '收钱吧',
        paymentMethodCategorySnapshot: 'DIRECT_RECEIPT',
        amountCents: 79900,
        sortOrder: 0,
      },
      {
        id: 'payment-public-cod',
        paymentMethodId: 'payment-method-cod',
        paymentMethodNameSnapshot: '货到付款',
        paymentMethodCategorySnapshot: 'COLLECT_ON_DELIVERY',
        amountCents: 20000,
        sortOrder: 1,
        collectionConfirmed: false,
      },
    ],
    ...overrides,
  };
}
