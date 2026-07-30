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

const EXPECTED_HEADERS = [
  '团号',
  '日期',
  '旅行社',
  '客源地',
  '年龄描述',
  '车牌号',
  '导游',
  '导游电话',
  '大人人数',
  '小孩人数',
  '人数',
  '品鉴馆馆号',
  '品鉴师',
  '对接品鉴师',
  '预计进店时间',
  '进店时间',
  '离店时间',
  '团型',
  '是否提及飞天',
  '前站出单情况',
  '重点客户信息',
  '重点客户照片数',
  '客人信息附件数',
  '品酒种类和瓶数',
  '是否出单',
  '订单总额',
  '财务标记',
  '品鉴师总结',
  '备注',
  '创建时间',
  '更新时间',
];

test('GET /api/travel-groups/export.xlsx allows admin and finance only and returns xlsx headers', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const finance = await login(baseUrl, 'finance-group-export', 'Password123');
      const sales = await login(baseUrl, 'sales-group-export', 'Password123');

      const adminDownload = await requestBinary(
        baseUrl,
        '/api/travel-groups/export.xlsx?keyword=Alpha',
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
        /^attachment; filename="travel-groups-\d{8}-\d{6}\.xlsx"$/,
      );
      assert.equal(adminDownload.buffer[0], 0x50);
      assert.equal(adminDownload.buffer[1], 0x4b);

      const financeDownload = await requestBinary(
        baseUrl,
        '/api/travel-groups/export.xlsx?keyword=Alpha',
        {
          token: finance.token,
        },
      );
      assert.equal(financeDownload.response.status, 200);

      const salesDenied = await requestJson(
        baseUrl,
        '/api/travel-groups/export.xlsx',
        {
          token: sales.token,
        },
      );
      assertErrorContract(salesDenied, 403, 'PERMISSION_DENIED');
    },
    {
      prisma: buildTravelGroupExportPrismaOptions(),
    },
  );
});

test('GET /api/travel-groups supports license plate keyword search without weakening filters or role scopes', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const taster = await login(
        baseUrl,
        'taster-group-search',
        'Password123',
      );

      const fullMatch = await requestJson(
        baseUrl,
        `/api/travel-groups?keyword=${encodeURIComponent('贵A12345')}`,
        { token: admin.token },
      );
      assert.equal(fullMatch.response.status, 200);
      assert.deepEqual(
        fullMatch.body.data.travelGroups.map((group) => group.groupNo),
        ['TG-EXPORT-ALPHA'],
      );

      const paddedMatch = await requestJson(
        baseUrl,
        `/api/travel-groups?keyword=${encodeURIComponent('  贵A12345  ')}`,
        { token: admin.token },
      );
      assert.equal(paddedMatch.response.status, 200);
      assert.deepEqual(
        paddedMatch.body.data.travelGroups.map((group) => group.groupNo),
        ['TG-EXPORT-ALPHA'],
      );

      const partialMatch = await requestJson(
        baseUrl,
        `/api/travel-groups?keyword=${encodeURIComponent('A123')}`,
        { token: admin.token },
      );
      assert.equal(partialMatch.response.status, 200);
      assert.deepEqual(
        partialMatch.body.data.travelGroups.map((group) => group.groupNo),
        ['TG-EXPORT-ALPHA'],
      );

      const noMatch = await requestJson(
        baseUrl,
        `/api/travel-groups?keyword=${encodeURIComponent('贵C00000')}`,
        { token: admin.token },
      );
      assert.equal(noMatch.response.status, 200);
      assert.deepEqual(noMatch.body.data.travelGroups, []);

      const existingKeywordMatch = await requestJson(
        baseUrl,
        `/api/travel-groups?keyword=${encodeURIComponent(
          'Alpha Travel Agency',
        )}`,
        { token: admin.token },
      );
      assert.equal(existingKeywordMatch.response.status, 200);
      assert.deepEqual(
        existingKeywordMatch.body.data.travelGroups.map(
          (group) => group.groupNo,
        ),
        ['TG-EXPORT-ALPHA'],
      );

      const combinedQuery =
        `keyword=${encodeURIComponent('A123')}` +
        '&travelAgency=Alpha%20Travel%20Agency' +
        '&dateFrom=2026-07-01&dateTo=2026-07-01' +
        '&groupType=vip&financeMark=true';
      const combinedMatch = await requestJson(
        baseUrl,
        `/api/travel-groups?${combinedQuery}`,
        { token: admin.token },
      );
      assert.equal(combinedMatch.response.status, 200);
      assert.deepEqual(
        combinedMatch.body.data.travelGroups.map((group) => group.groupNo),
        ['TG-EXPORT-ALPHA'],
      );

      const scopedMatch = await requestJson(
        baseUrl,
        `/api/travel-groups?keyword=${encodeURIComponent('12345')}`,
        { token: taster.token },
      );
      assert.equal(scopedMatch.response.status, 200);
      assert.deepEqual(
        scopedMatch.body.data.travelGroups.map((group) => group.groupNo),
        ['TG-EXPORT-ALPHA'],
      );

      const download = await requestBinary(
        baseUrl,
        `/api/travel-groups/export.xlsx?${combinedQuery}`,
        { token: admin.token },
      );
      assert.equal(download.response.status, 200);
      const worksheet = await loadTravelGroupsWorksheet(download.buffer);
      assert.deepEqual(
        readDataRows(worksheet).map((row) => row['团号']),
        ['TG-EXPORT-ALPHA'],
      );
    },
    {
      prisma: buildTravelGroupSearchPrismaOptions(),
    },
  );
});

test('GET /api/travel-groups/export.xlsx reuses filters and exports documented core fields', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const query =
        'keyword=Alpha&travelAgency=Alpha%20Travel%20Agency&dateFrom=2026-07-01&dateTo=2026-07-02&groupType=vip&financeMark=true';

      const list = await requestJson(baseUrl, `/api/travel-groups?${query}`, {
        token: admin.token,
      });
      assert.equal(list.response.status, 200);
      assert.deepEqual(
        list.body.data.travelGroups.map((group) => group.groupNo),
        ['TG-EXPORT-ALPHA'],
      );
      assert.equal(
        list.body.data.travelGroups[0].orderSummary.totalAmountCents,
        30000,
      );

      const download = await requestBinary(
        baseUrl,
        `/api/travel-groups/export.xlsx?${query}`,
        {
          token: admin.token,
        },
      );
      assert.equal(download.response.status, 200);

      const worksheet = await loadTravelGroupsWorksheet(download.buffer);
      assert.deepEqual(readHeaders(worksheet), EXPECTED_HEADERS);
      assert.equal(worksheet.actualRowCount, 2);

      const row = readRowObject(worksheet, 2);
      assert.equal(row['团号'], 'TG-EXPORT-ALPHA');
      assert.equal(row['日期'], '2026-07-01');
      assert.equal(row['旅行社'], 'Alpha Travel Agency');
      assert.equal(row['客源地'], '华东');
      assert.equal(row['年龄描述'], '35-55岁');
      assert.equal(row['车牌号'], '贵A12345');
      assert.equal(row['导游'], 'Alpha Guide');
      assert.equal(row['导游电话'], '13900001111');
      assert.equal(row['大人人数'], 15);
      assert.equal(row['小孩人数'], 3);
      assert.equal(row['人数'], 18);
      assert.equal(row['品鉴馆馆号'], 'A101');
      assert.equal(row['品鉴师'], 'Alpha Taster');
      assert.equal(row['对接品鉴师'], 'Alpha Liaison Taster');
      assert.equal(row['预计进店时间'], '09:15');
      assert.equal(row['进店时间'], '09:30');
      assert.equal(row['离店时间'], '11:00');
      assert.equal(row['团型'], 'vip');
      assert.equal(row['是否提及飞天'], '否');
      assert.equal(row['前站出单情况'], '均单');
      assert.equal(row['重点客户信息'], 'Alpha VIP customer');
      assert.equal(row['重点客户照片数'], 2);
      assert.equal(row['客人信息附件数'], 1);
      assert.equal(row['品酒种类和瓶数'], '茅台迎宾 2 瓶；红缨子 1 瓶');
      assert.equal(row['是否出单'], '是');
      assert.equal(row['订单总额'], 300);
      assert.equal(row['财务标记'], '已标记');
      assert.equal(row['品鉴师总结'], 'Alpha summary');
      assert.equal(row['备注'], 'Alpha remarks');
      assert.equal(row['创建时间'], '2026-07-01T08:00:00.000Z');
      assert.equal(row['更新时间'], '2026-07-01T12:00:00.000Z');
      assert.equal(
        worksheet.getColumn(EXPECTED_HEADERS.indexOf('订单总额') + 1).numFmt,
        '0.00',
      );
      assert.equal(JSON.stringify(row).includes('D:\\private'), false);
    },
    {
      prisma: buildTravelGroupExportPrismaOptions(),
    },
  );
});

test('GET /api/travel-groups/export.xlsx applies computed pendingStatus filtering', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const download = await requestBinary(
        baseUrl,
        '/api/travel-groups/export.xlsx?keyword=Pending&pendingStatus=pending_taster',
        {
          token: admin.token,
        },
      );
      assert.equal(download.response.status, 200);

      const worksheet = await loadTravelGroupsWorksheet(download.buffer);
      assert.deepEqual(
        readDataRows(worksheet).map((row) => row['团号']),
        ['TG-EXPORT-PENDING'],
      );
      assert.equal(readRowObject(worksheet, 2)['是否出单'], '否');
      assert.equal(readRowObject(worksheet, 2)['订单总额'], 0);
    },
    {
      prisma: buildTravelGroupExportPrismaOptions(),
    },
  );
});

test('GET /api/travel-groups/export.xlsx obeys global marked-record filtering', async () => {
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
        '/api/travel-groups/export.xlsx?keyword=Global',
        {
          token: admin.token,
        },
      );
      assert.equal(download.response.status, 200);

      const worksheet = await loadTravelGroupsWorksheet(download.buffer);
      assert.deepEqual(
        readDataRows(worksheet)
          .map((row) => row['团号'])
          .sort(),
        ['TG-GLOBAL-MARKED'],
      );
    },
    {
      prisma: buildTravelGroupExportPrismaOptions(),
    },
  );
});

test('GET /api/travel-groups/export.xlsx rejects exports over the row limit', async () => {
  await withPhase1Server(
    async (baseUrl) => {
      const admin = await login(baseUrl);
      const result = await requestJson(
        baseUrl,
        '/api/travel-groups/export.xlsx',
        {
          token: admin.token,
        },
      );

      assertErrorContract(result, 400, 'EXPORT_LIMIT_EXCEEDED');
      assert.match(result.body.error.message, /5000/);
    },
    {
      prisma: {
        travelGroups: Array.from({ length: 5001 }, (_, index) => ({
          id: `tg_limit_${index}`,
          groupNo: `TG-LIMIT-${String(index).padStart(5, '0')}`,
          visitDate: '2026-07-01T00:00:00.000Z',
          travelAgency: `Limit Agency ${index}`,
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-01T00:00:00.000Z',
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

async function loadTravelGroupsWorksheet(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.getWorksheet('旅行团');
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

function buildTravelGroupExportPrismaOptions() {
  return {
    users: [
      {
        id: 'usr_finance_group_export',
        name: 'Group Export Finance',
        username: 'finance-group-export',
        password: 'Password123',
        role: 'finance',
      },
      {
        id: 'usr_sales_group_export',
        name: 'Group Export Sales',
        username: 'sales-group-export',
        password: 'Password123',
        role: 'sales',
      },
    ],
    travelGroups: [
      {
        id: 'tg_export_alpha',
        groupNo: 'TG-EXPORT-ALPHA',
        visitDate: '2026-07-01T00:00:00.000Z',
        travelAgency: 'Alpha Travel Agency',
        sourceRegion: '华东',
        ageInfo: '35-55岁',
        licensePlate: '贵A12345',
        guideName: 'Alpha Guide',
        guidePhone: '13900001111',
        adultCount: 15,
        childCount: 3,
        guestCount: 18,
        tastingRoomNo: 'A101',
        tasterName: 'Alpha Taster',
        liaisonTasterName: 'Alpha Liaison Taster',
        expectedArrivalTime: '09:15',
        arrivalTime: '09:30',
        departureTime: '11:00',
        groupType: 'vip',
        mentionedFeitian: false,
        previousStopOrderStatus: '均单',
        keyCustomerInfo: 'Alpha VIP customer',
        keyCustomerPhotos: [
          { name: 'vip-a.jpg', physicalPath: 'D:\\private\\vip-a.jpg' },
          { name: 'vip-b.jpg', physicalPath: 'D:\\private\\vip-b.jpg' },
        ],
        guestInfoAttachments: [
          { name: 'guest.xlsx', physicalPath: 'D:\\private\\guest.xlsx' },
        ],
        wineDetails: '茅台迎宾 2 瓶；红缨子 1 瓶',
        remarks: 'Alpha remarks',
        tasterSummary: 'Alpha summary',
        cigaretteFeeCents: 100,
        financeMark: true,
        createdAt: '2026-07-01T08:00:00.000Z',
        updatedAt: '2026-07-01T12:00:00.000Z',
      },
      {
        id: 'tg_export_beta',
        groupNo: 'TG-EXPORT-BETA',
        visitDate: '2026-07-01T00:00:00.000Z',
        travelAgency: 'Beta Travel Agency',
        groupType: 'vip',
        cigaretteFeeCents: 100,
        financeMark: true,
      },
      {
        id: 'tg_export_pending',
        groupNo: 'TG-EXPORT-PENDING',
        visitDate: '2026-07-02T00:00:00.000Z',
        travelAgency: 'Pending Travel Agency',
        guideName: 'Pending Guide',
        guidePhone: '13900002222',
        guestCount: 8,
        tastingRoomNo: 'B201',
        tasterName: 'Pending Taster',
        groupType: 'pending',
        cigaretteFeeCents: 100,
        financeMark: true,
      },
      {
        id: 'tg_global_marked',
        groupNo: 'TG-GLOBAL-MARKED',
        visitDate: '2026-07-01T00:00:00.000Z',
        travelAgency: 'Global Marked Agency',
        cigaretteFeeCents: 100,
        financeMark: true,
      },
      {
        id: 'tg_global_unmarked',
        groupNo: 'TG-GLOBAL-UNMARKED',
        visitDate: '2026-07-01T00:00:00.000Z',
        travelAgency: 'Global Unmarked Agency',
        cigaretteFeeCents: 100,
        financeMark: false,
      },
    ],
    salesOrders: [
      {
        id: 'order_group_valid',
        orderNo: 'SO-GROUP-VALID',
        travelGroupId: 'tg_export_alpha',
        status: 'VALID',
        totalAmountCents: 10000,
        cashOnDeliveryAmountCents: 2000,
        orderDate: '2026-07-01T00:00:00.000Z',
      },
      {
        id: 'order_group_partial_refund',
        orderNo: 'SO-GROUP-PARTIAL',
        travelGroupId: 'tg_export_alpha',
        status: 'PARTIAL_REFUND',
        totalAmountCents: 20000,
        cashOnDeliveryAmountCents: 3000,
        orderDate: '2026-07-01T00:00:00.000Z',
      },
      {
        id: 'order_group_cancelled',
        orderNo: 'SO-GROUP-CANCELLED',
        travelGroupId: 'tg_export_alpha',
        status: 'CANCELLED',
        totalAmountCents: 990000,
        orderDate: '2026-07-01T00:00:00.000Z',
      },
      {
        id: 'order_group_refunded',
        orderNo: 'SO-GROUP-REFUNDED',
        travelGroupId: 'tg_export_alpha',
        status: 'REFUNDED',
        totalAmountCents: 880000,
        orderDate: '2026-07-01T00:00:00.000Z',
      },
    ],
  };
}

function buildTravelGroupSearchPrismaOptions() {
  const options = buildTravelGroupExportPrismaOptions();
  options.users.push({
    id: 'usr_taster_group_search',
    name: 'Group Search Taster',
    username: 'taster-group-search',
    password: 'Password123',
    role: 'taster',
  });
  options.travelGroups[0].tasterId = 'usr_taster_group_search';
  options.travelGroups[1].licensePlate = '贵B12345';
  options.travelGroups[1].tasterId = 'usr_other_group_search_taster';
  return options;
}
