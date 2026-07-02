const assert = require('node:assert/strict');
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
      assert.match(result.html, /SF-PUBLIC-001/);
      assert.match(result.html, /138\*\*\*\*0000/);
      assert.match(result.html, /999\.00/);
      assert.match(result.html, /200\.00/);
      assert.match(result.html, /Product A/);
      assert.match(result.html, /Test Agency/);
      assert.match(result.html, /Seller Alpha/);
    },
    {
      prisma: buildPublicSalesSheetPrismaOptions(),
    },
  );
});

test('GET /api/public/sales-sheets/:token returns friendly page when token is missing', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const result = await requestHtml(
        baseUrl,
        '/api/public/sales-sheets/unknown-token',
      );

      assert.equal(result.response.status, 404);
      assert.match(result.html, /^<!doctype html>/i);
      assert.match(result.html, /销售单不存在/);
      assert.equal(result.html.trim().startsWith('{'), false);
    },
    {
      prisma: buildPublicSalesSheetPrismaOptions(),
    },
  );
});

test('GET /api/public/sales-sheets/:token returns friendly expired page', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const result = await requestHtml(
        baseUrl,
        '/api/public/sales-sheets/public-token-expired',
      );

      assert.equal(result.response.status, 410);
      assert.match(result.html, /^<!doctype html>/i);
      assert.match(result.html, /二维码已过期/);
      assert.equal(result.html.includes('SO-PUBLIC-EXPIRED'), false);
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
        '/api/public/sales-sheets/public-token-unsafe',
      );

      assert.equal(result.response.status, 200);
      assert.equal(result.html.includes('<script>alert'), false);
      assert.equal(result.html.includes('<img src=x'), false);
      assert.equal(result.html.includes('<strong>'), false);
      assert.match(result.html, /Alice &lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
      assert.match(result.html, /Road &lt;b&gt;1&lt;\/b&gt; &amp; Lane/);
      assert.match(result.html, /Product &lt;script&gt;bad\(\)&lt;\/script&gt;/);
      assert.match(result.html, /Please &lt;strong&gt;check&lt;\/strong&gt; &amp; keep/);

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
        qrCodeToken: 'public-token-success',
        qrCodeGeneratedAt: '2026-07-01T10:00:00.000Z',
        qrCodeExpiresAt: null,
      }),
      buildPublicSalesSheetOrder({
        id: 'order_public_expired',
        orderNo: 'SO-PUBLIC-EXPIRED',
        qrCodeToken: 'public-token-expired',
        qrCodeGeneratedAt: '2026-07-01T10:00:00.000Z',
        qrCodeExpiresAt: '2000-01-01T00:00:00.000Z',
      }),
      buildPublicSalesSheetOrder({
        id: 'order_public_unsafe',
        orderNo: 'SO-PUBLIC-UNSAFE',
        qrCodeToken: 'public-token-unsafe',
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
    qrCodeToken: 'public-token-success',
    qrCodeGeneratedAt: '2026-07-01T10:00:00.000Z',
    qrCodeExpiresAt: null,
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
