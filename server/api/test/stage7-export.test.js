const assert = require('node:assert/strict');
const test = require('node:test');

const ExcelJS = require('exceljs');

const {
  assertErrorContract,
  assertOperationLogContract,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const COMMISSION_HEADERS = [
  '日期',
  '订单号',
  '旅行团',
  '客户',
  '销售',
  '外联',
  '组长',
  '品鉴师',
  '旅行社',
  'targetType',
  '订单类型',
  '对象类型',
  '提成对象',
  '来源类型',
  '原始金额',
  '已确认退款',
  '基础金额',
  '扣减成本',
  '比例',
  '提成金额',
  '原提成金额',
  '冲减金额',
  '归属日期',
  '调整记录',
  '积分金额',
  '确认状态',
  '确认人',
  '确认时间',
  '计算说明',
];

const SUMMARY_HEADERS = [
  '团号',
  '日期',
  '旅行社',
  '导游',
  '车牌',
  '人数',
  '品鉴师',
  '销售额',
  '货到付款',
  '已付定金',
  '扣酒成本',
  '扣酒确认状态',
  '上单金额',
  '积分/日返积分',
  '已返积分',
  '未返积分',
  '月返积分',
  '已返月返积分',
  '未返月返积分',
  '备注',
  '导游信息是否发送',
  '旅行社信息是否发送',
];

const SELECTED_SUMMARY_HEADERS = [
  '团号',
  '日期',
  '旅行社',
  '导游',
  '车牌',
  '人数',
  '品鉴师',
  '销售额',
  '已确认退款',
  '有效销售额',
  '货到付款',
  '已付定金',
  '扣酒成本',
  '上单金额',
  '积分/日返积分',
  '已返积分',
  '未返积分',
  '日返状态',
  '月返积分',
  '已返月返积分',
  '未返月返积分',
  '月返状态',
  '售后影响',
  '导游信息是否发送',
  '旅行社信息是否发送',
  '状态',
  '备注',
];

test('GET /api/commission-records/export exports filtered stage7 commission details and logs safely', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);

    const download = await requestBinary(
      baseUrl,
      '/api/commission-records/export?targetType=sales_commission&query=SO-STAGE7-EXPORT-MARKED&token=secret-token&password=Password123',
      {
        token: admin.token,
      },
    );
    assert.equal(download.response.status, 200);
    assert.match(
      download.response.headers.get('content-type'),
      new RegExp(XLSX_CONTENT_TYPE.replace(/\./g, '\\.')),
    );
    assert.match(
      download.response.headers.get('content-disposition'),
      /^attachment; filename="commission-records-\d{8}-\d{6}\.xlsx"$/,
    );
    assert.equal(download.buffer[0], 0x50);
    assert.equal(download.buffer[1], 0x4b);

    const worksheet = await loadWorksheet(download.buffer, '提成积分明细');
    assert.deepEqual(readHeaders(worksheet), COMMISSION_HEADERS);
    assert.equal(worksheet.actualRowCount, 2);

    const row = readRowObject(worksheet, 2);
    assert.equal(row['日期'], '2026-07-01');
    assert.equal(row['订单号'], 'SO-STAGE7-EXPORT-MARKED');
    assert.equal(row['旅行团'], 'TG-STAGE7-EXPORT-MARKED');
    assert.equal(row['客户'], 'Stage7 Export Marked Customer');
    assert.equal(row['销售'], 'Stage7 Export Sales');
    assert.equal(row['外联'], 'Stage7 Export Outreach');
    assert.equal(row['组长'], 'Stage7 Export Leader');
    assert.equal(row['品鉴师'], 'Stage7 Export Taster');
    assert.equal(row['旅行社'], 'Stage7 Export Agency');
    assert.equal(row['targetType'], 'sales_commission');
    assert.equal(row['原始金额'], 1000);
    assert.equal(row['已确认退款'], 100);
    assert.equal(row['基础金额'], 900);
    assert.equal(row['扣减成本'], 0);
    assert.equal(row['比例'], '0.0200');
    assert.equal(row['提成金额'], 18);
    assert.equal(row['积分金额'], 0);
    assert.equal(row['确认状态'], '是');
    assert.equal(row['确认人'], 'Stage7 Export Finance');
    assert.equal(row['计算说明'], 'stage7 export sales commission smoke');

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=commission_records.export',
      {
        token: admin.token,
      },
    );
    assert.equal(logs.response.status, 200);
    const log = logs.body.data.logs.find(
      (item) => item.action === 'commission_records.export',
    );
    assert.ok(log);
    assertStage7ExportLog(log, {
      action: 'commission_records.export',
      entityType: 'commission_record',
      entityId: 'commission_records.export',
      userId: admin.user.id,
    });
    assert.equal(log.beforeData, null);
    assert.equal(log.afterData.rowCount, 1);
    assert.equal(log.afterData.filters.targetType, 'sales_commission');
    const logText = JSON.stringify(log.afterData);
    assert.equal(logText.includes('secret-token'), false);
    assert.equal(logText.includes('Password123'), false);
  }, {
    prisma: buildStage7ExportPrisma(),
  });
});

test('GET /api/travel-group-finance-summaries/export exports filtered stage7 rebate summaries and logs safely', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);

    const download = await requestBinary(
      baseUrl,
      '/api/travel-group-finance-summaries/export?query=SUMMARY-MARKED&dateFrom=2026-07-01&dateTo=2026-07-01&token=secret-token',
      {
        token: admin.token,
      },
    );
    assert.equal(download.response.status, 200);
    assert.match(
      download.response.headers.get('content-type'),
      new RegExp(XLSX_CONTENT_TYPE.replace(/\./g, '\\.')),
    );
    assert.match(
      download.response.headers.get('content-disposition'),
      /^attachment; filename="travel-group-finance-summaries-\d{8}-\d{6}\.xlsx"$/,
    );

    const worksheet = await loadWorksheet(download.buffer, '返积分汇总');
    assert.deepEqual(readHeaders(worksheet), SUMMARY_HEADERS);
    assert.equal(worksheet.actualRowCount, 2);

    const row = readRowObject(worksheet, 2);
    assert.equal(row['团号'], 'TG-STAGE7-SUMMARY-MARKED');
    assert.equal(row['日期'], '2026-07-01');
    assert.equal(row['旅行社'], 'Stage7 Export Agency');
    assert.equal(row['导游'], 'Stage7 Export Guide');
    assert.equal(row['车牌'], '贵A-EXPORT');
    assert.equal(row['人数'], 18);
    assert.equal(row['品鉴师'], 'Stage7 Export Taster');
    assert.equal(row['销售额'], 1000);
    assert.equal(row['货到付款'], 200);
    assert.equal(row['已付定金'], 800);
    assert.equal(row['扣酒成本'], 120);
    assert.equal(row['扣酒确认状态'], '否');
    assert.equal(row['上单金额'], 880);
    assert.equal(row['积分/日返积分'], 30);
    assert.equal(row['已返积分'], '是');
    assert.equal(row['未返积分'], 0);
    assert.equal(row['月返积分'], 20);
    assert.equal(row['已返月返积分'], '否');
    assert.equal(row['未返月返积分'], 20);
    assert.equal(row['备注'], 'stage7 export summary smoke note');
    assert.equal(row['导游信息是否发送'], '是');
    assert.equal(row['旅行社信息是否发送'], '否');

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=travel_group_finance_summaries.export',
      {
        token: admin.token,
      },
    );
    assert.equal(logs.response.status, 200);
    const log = logs.body.data.logs.find(
      (item) => item.action === 'travel_group_finance_summaries.export',
    );
    assert.ok(log);
    assertStage7ExportLog(log, {
      action: 'travel_group_finance_summaries.export',
      entityType: 'travel_group_finance_summary',
      entityId: 'travel_group_finance_summaries.export',
      userId: admin.user.id,
    });
    assert.equal(log.beforeData, null);
    assert.equal(log.afterData.rowCount, 1);
    assert.equal(log.afterData.filters.query, 'SUMMARY-MARKED');
    assert.equal(JSON.stringify(log.afterData).includes('secret-token'), false);
  }, {
    prisma: buildStage7ExportPrisma(),
  });
});

test('GET /api/travel-group-finance-summaries/export includes no-order travel groups with zero amounts', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const download = await requestBinary(
      baseUrl,
      '/api/travel-group-finance-summaries/export'
        + '?query=SUMMARY-ZERO&dateFrom=2026-07-03&dateTo=2026-07-03',
      {
        token: admin.token,
      },
    );

    assert.equal(download.response.status, 200);
    const worksheet = await loadWorksheet(download.buffer, '返积分汇总');
    assert.equal(worksheet.actualRowCount, 2);
    const row = readRowObject(worksheet, 2);
    assert.equal(row['团号'], 'TG-STAGE7-SUMMARY-ZERO');
    assert.equal(row['日期'], '2026-07-03');
    assert.equal(row['旅行社'], 'Stage7 Zero Agency');
    assert.equal(row['导游'], 'Stage7 Zero Guide');
    assert.equal(row['车牌'], '贵A-ZERO');
    assert.equal(row['人数'], 30);
    assert.equal(row['品鉴师'], 'Stage7 Zero Taster');
    for (const header of [
      '销售额',
      '货到付款',
      '已付定金',
      '扣酒成本',
      '上单金额',
      '积分/日返积分',
      '未返积分',
      '月返积分',
      '未返月返积分',
    ]) {
      assert.equal(row[header], 0, header);
    }
    assert.equal(row['扣酒确认状态'], '否');
    assert.equal(row['已返积分'], '否');
    assert.equal(row['已返月返积分'], '否');
  }, {
    prisma: buildStage7ExportPrisma(),
  });
});

test('POST /api/travel-group-finance-summaries/export exports only normalized selected IDs with points-table money and safe logs', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const download = await requestBinary(
      baseUrl,
      '/api/travel-group-finance-summaries/export',
      {
        method: 'POST',
        token: admin.token,
        body: {
          travelGroupIds: [
            ' tg-stage7-summary-marked ',
            'tg-stage7-summary-marked',
            'tg-stage7-summary-zero',
          ],
        },
      },
    );

    assert.equal(download.response.status, 200);
    assert.match(
      download.response.headers.get('content-type'),
      new RegExp(XLSX_CONTENT_TYPE.replace(/\./g, '\\.')),
    );
    assert.match(
      download.response.headers.get('content-disposition'),
      /^attachment; filename="points-table-selected-\d{8}-\d{6}\.xlsx"$/,
    );
    assert.equal(
      Number(download.response.headers.get('content-length')),
      download.buffer.length,
    );

    const worksheet = await loadWorksheet(
      download.buffer,
      '积分表所选信息',
    );
    assert.deepEqual(readHeaders(worksheet), SELECTED_SUMMARY_HEADERS);
    assert.equal(worksheet.actualRowCount, 3);
    const rows = readDataRows(worksheet);
    assert.deepEqual(
      rows.map((row) => row['团号']),
      ['TG-STAGE7-SUMMARY-ZERO', 'TG-STAGE7-SUMMARY-MARKED'],
    );

    const row = rows.find(
      (item) => item['团号'] === 'TG-STAGE7-SUMMARY-MARKED',
    );
    assert.ok(row);
    assert.equal(row['销售额'], 10);
    assert.equal(row['已确认退款'], 1);
    assert.equal(row['有效销售额'], 9);
    assert.equal(row['货到付款'], 2);
    assert.equal(row['已付定金'], 8);
    assert.equal(row['扣酒成本'], 1.2);
    assert.equal(row['上单金额'], 8.8);
    assert.equal(row['积分/日返积分'], 0.3);
    assert.equal(row['已返积分'], 0.3);
    assert.equal(row['未返积分'], 0);
    assert.equal(row['日返状态'], '是');
    assert.equal(row['月返积分'], 0.2);
    assert.equal(row['已返月返积分'], 0);
    assert.equal(row['未返月返积分'], 0.2);
    assert.equal(row['月返状态'], '否');
    assert.equal(row['售后影响'], '退款待确认 ¥0.25');
    assert.equal(row['状态'], '退款待确认');
    assert.equal(typeof row['销售额'], 'number');

    const salesColumn = SELECTED_SUMMARY_HEADERS.indexOf('销售额') + 1;
    assert.equal(worksheet.getCell(2, salesColumn).numFmt, '0.00');
    assert.equal(worksheet.views[0].state, 'frozen');
    assert.equal(worksheet.views[0].ySplit, 1);
    assert.ok(worksheet.autoFilter);
    assert.equal(worksheet.getCell(1, 1).font.bold, true);
    assert.equal(worksheet.getCell(2, 1).alignment.wrapText, true);

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=travel_group_finance_summaries.export_selected',
      {
        token: admin.token,
      },
    );
    assert.equal(logs.response.status, 200);
    const log = logs.body.data.logs.find(
      (item) =>
        item.action ===
        'travel_group_finance_summaries.export_selected',
    );
    assert.ok(log);
    assertStage7ExportLog(log, {
      action: 'travel_group_finance_summaries.export_selected',
      entityType: 'travel_group_finance_summary',
      entityId: 'travel_group_finance_summaries.export_selected',
      userId: admin.user.id,
    });
    assert.deepEqual(log.afterData, {
      mode: 'selected',
      selectionCount: 2,
      rowCount: 2,
    });
    const serialized = JSON.stringify(log.afterData);
    assert.equal(serialized.includes('tg-stage7-summary-marked'), false);
    assert.equal(
      /Password123|secret-token|phone|address|sourceSnapshot/i.test(
        serialized,
      ),
      false,
    );
  }, {
    prisma: buildStage7ExportPrisma(),
  });
});

test('POST selected summary export rejects invalid ID collections', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const invalidBodies = [
      { travelGroupIds: [] },
      { travelGroupIds: [' ', ''] },
      { travelGroupIds: 'tg-stage7-summary-marked' },
      {
        travelGroupIds: Array.from(
          { length: 201 },
          (_, index) => `group-${index + 1}`,
        ),
      },
    ];
    for (const body of invalidBodies) {
      const result = await requestJson(
        baseUrl,
        '/api/travel-group-finance-summaries/export',
        {
          method: 'POST',
          token: admin.token,
          body,
        },
      );
      assertErrorContract(result, 400, 'VALIDATION_FAILED');
    }
  }, {
    prisma: buildStage7ExportPrisma(),
  });
});

test('stage7 export endpoints enforce read roles', async () => {
  await withPhase1Server(async (baseUrl) => {
    const finance = await login(baseUrl, 'stage7-export-finance', 'Password123');
    const boss = await login(baseUrl, 'stage7-export-boss', 'Password123');
    const sales = await login(baseUrl, 'stage7-export-sales', 'Password123');
    const warehouse = await login(
      baseUrl,
      'stage7-export-warehouse',
      'Password123',
    );
    const afterSales = await login(
      baseUrl,
      'stage7-export-after-sales',
      'Password123',
    );
    const frontDesk = await login(
      baseUrl,
      'stage7-export-front-desk',
      'Password123',
    );
    const taster = await login(baseUrl, 'stage7-export-taster', 'Password123');

    const financeDownload = await requestBinary(
      baseUrl,
      '/api/commission-records/export?targetType=sales_commission',
      {
        token: finance.token,
      },
    );
    assert.equal(financeDownload.response.status, 200);

    const bossDownload = await requestBinary(
      baseUrl,
      '/api/travel-group-finance-summaries/export?query=SUMMARY',
      {
        token: boss.token,
      },
    );
    assert.equal(bossDownload.response.status, 200);

    const bossSelectedDownload = await requestBinary(
      baseUrl,
      '/api/travel-group-finance-summaries/export',
      {
        method: 'POST',
        token: boss.token,
        body: {
          travelGroupIds: ['tg-stage7-summary-marked'],
        },
      },
    );
    assert.equal(bossSelectedDownload.response.status, 200);

    for (const session of [sales, warehouse, afterSales, frontDesk, taster]) {
      const commissionDenied = await requestJson(
        baseUrl,
        '/api/commission-records/export',
        {
          token: session.token,
        },
      );
      assertErrorContract(commissionDenied, 403, 'PERMISSION_DENIED');

      const summaryDenied = await requestJson(
        baseUrl,
        '/api/travel-group-finance-summaries/export',
        {
          token: session.token,
        },
      );
      assertErrorContract(summaryDenied, 403, 'PERMISSION_DENIED');

      const selectedSummaryDenied = await requestJson(
        baseUrl,
        '/api/travel-group-finance-summaries/export',
        {
          method: 'POST',
          token: session.token,
          body: {
            travelGroupIds: ['tg-stage7-summary-marked'],
          },
        },
      );
      assertErrorContract(
        selectedSummaryDenied,
        403,
        'PERMISSION_DENIED',
      );
    }
  }, {
    prisma: buildStage7ExportPrisma(),
  });
});

test('stage7 export endpoints obey global mark filtering', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const boss = await login(baseUrl, 'stage7-export-boss', 'Password123');

    const openCommissionDownload = await requestBinary(
      baseUrl,
      '/api/commission-records/export?limit=20',
      {
        token: boss.token,
      },
    );
    assert.equal(openCommissionDownload.response.status, 200);
    const openCommissionWorksheet = await loadFirstWorksheet(
      openCommissionDownload.buffer,
    );
    assert.deepEqual(
      readColumnValues(openCommissionWorksheet, 2).sort(),
      [
        '',
        'SO-STAGE7-EXPORT-HIDDEN-CUSTOMER',
        'SO-STAGE7-EXPORT-HIDDEN-GROUP',
        'SO-STAGE7-EXPORT-MARKED',
        'SO-STAGE7-EXPORT-MARKED',
      ],
    );

    const openSummaryDownload = await requestBinary(
      baseUrl,
      '/api/travel-group-finance-summaries/export?limit=20',
      {
        token: boss.token,
      },
    );
    assert.equal(openSummaryDownload.response.status, 200);
    const openSummaryWorksheet = await loadFirstWorksheet(
      openSummaryDownload.buffer,
    );
    assert.deepEqual(
      readColumnValues(openSummaryWorksheet, 1).sort(),
      [
        'TG-STAGE7-EXPORT-MARKED',
        'TG-STAGE7-EXPORT-UNMARKED',
        'TG-STAGE7-SUMMARY-MARKED',
        'TG-STAGE7-SUMMARY-UNMARKED',
        'TG-STAGE7-SUMMARY-ZERO',
      ],
    );

    const enabled = await requestJson(
      baseUrl,
      '/api/settings/global-mark-query/enable',
      {
        method: 'POST',
        token: admin.token,
      },
    );
    assert.equal(enabled.response.status, 200);

    const commissionDownload = await requestBinary(
      baseUrl,
      '/api/commission-records/export?limit=20',
      {
        token: boss.token,
      },
    );
    assert.equal(commissionDownload.response.status, 200);
    const commissionRows = readDataRows(
      await loadWorksheet(commissionDownload.buffer, '提成积分明细'),
    );
    assert.deepEqual(
      commissionRows.map((row) => row['订单号']).sort(),
      [
        '',
        'SO-STAGE7-EXPORT-HIDDEN-GROUP',
        'SO-STAGE7-EXPORT-MARKED',
        'SO-STAGE7-EXPORT-MARKED',
      ],
    );

    const summaryDownload = await requestBinary(
      baseUrl,
      '/api/travel-group-finance-summaries/export?limit=20',
      {
        token: boss.token,
      },
    );
    assert.equal(summaryDownload.response.status, 200);
    const summaryRows = readDataRows(
      await loadWorksheet(summaryDownload.buffer, '返积分汇总'),
    );
    assert.deepEqual(
      summaryRows.map((row) => row['团号']).sort(),
      [
        'TG-STAGE7-EXPORT-MARKED',
        'TG-STAGE7-SUMMARY-MARKED',
        'TG-STAGE7-SUMMARY-ZERO',
      ],
    );

    const selectedSummaryDownload = await requestBinary(
      baseUrl,
      '/api/travel-group-finance-summaries/export',
      {
        method: 'POST',
        token: boss.token,
        body: {
          travelGroupIds: [
            'tg-stage7-summary-marked',
            'tg-stage7-summary-unmarked',
            'forged-travel-group-id',
          ],
        },
      },
    );
    assert.equal(selectedSummaryDownload.response.status, 200);
    const selectedSummaryRows = readDataRows(
      await loadWorksheet(
        selectedSummaryDownload.buffer,
        '积分表所选信息',
      ),
    );
    assert.deepEqual(
      selectedSummaryRows.map((row) => row['团号']),
      ['TG-STAGE7-SUMMARY-MARKED'],
    );
  }, {
    prisma: buildStage7ExportPrisma(),
  });
});

async function requestBinary(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: options.method || 'GET',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    response,
    buffer,
  };
}

async function loadWorksheet(buffer, name) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.getWorksheet(name);
  assert.ok(worksheet);
  return worksheet;
}

async function loadFirstWorksheet(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  assert.ok(worksheet);
  return worksheet;
}

function readHeaders(worksheet) {
  return worksheet.getRow(1).values.slice(1);
}

function readColumnValues(worksheet, columnNumber) {
  const values = [];
  for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber += 1) {
    values.push(worksheet.getRow(rowNumber).getCell(columnNumber).value || '');
  }
  return values;
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

function assertStage7ExportLog(log, expected) {
  assertOperationLogContract(log);
  assert.equal(log.action, expected.action);
  assert.equal(log.entityType, expected.entityType);
  assert.equal(log.entityId, expected.entityId);
  assert.equal(log.userId, expected.userId);
  assert.equal(typeof log.ipAddress, 'string');
  assert.ok(log.ipAddress.length > 0);
  const serialized = JSON.stringify(log);
  assert.equal(/Password123|secret-token|DATABASE_URL/i.test(serialized), false);
}

function buildStage7ExportPrisma() {
  return {
    users: [
      user('usr-stage7-export-finance', 'stage7-export-finance', 'finance', {
        name: 'Stage7 Export Finance',
      }),
      user('usr-stage7-export-boss', 'stage7-export-boss', 'boss'),
      user('usr-stage7-export-leader', 'stage7-export-leader', 'sales', {
        name: 'Stage7 Export Leader',
      }),
      user('usr-stage7-export-sales', 'stage7-export-sales', 'sales', {
        name: 'Stage7 Export Sales',
        leaderId: 'usr-stage7-export-leader',
      }),
      user('usr-stage7-export-warehouse', 'stage7-export-warehouse', 'warehouse'),
      user(
        'usr-stage7-export-after-sales',
        'stage7-export-after-sales',
        'after_sales',
      ),
      user(
        'usr-stage7-export-front-desk',
        'stage7-export-front-desk',
        'front_desk',
      ),
      user('usr-stage7-export-outreach', 'stage7-export-outreach', 'sales', {
        name: 'Stage7 Export Outreach',
      }),
      user('usr-stage7-export-taster', 'stage7-export-taster', 'taster', {
        name: 'Stage7 Export Taster',
      }),
    ],
    customers: [
      {
        id: 'cust-stage7-export-marked',
        name: 'Stage7 Export Marked Customer',
        financeMark: true,
      },
      {
        id: 'cust-stage7-export-unmarked',
        name: 'Stage7 Export Unmarked Customer',
        financeMark: false,
      },
    ],
    travelGroups: [
      travelGroup({
        id: 'tg-stage7-export-marked',
        groupNo: 'TG-STAGE7-EXPORT-MARKED',
        visitDate: '2026-07-01',
        financeMark: true,
      }),
      travelGroup({
        id: 'tg-stage7-export-unmarked',
        groupNo: 'TG-STAGE7-EXPORT-UNMARKED',
        visitDate: '2026-07-02',
        financeMark: false,
      }),
      travelGroup({
        id: 'tg-stage7-summary-marked',
        groupNo: 'TG-STAGE7-SUMMARY-MARKED',
        visitDate: '2026-07-01',
        financeMark: true,
      }),
      travelGroup({
        id: 'tg-stage7-summary-unmarked',
        groupNo: 'TG-STAGE7-SUMMARY-UNMARKED',
        visitDate: '2026-07-02',
        financeMark: false,
      }),
      travelGroup({
        id: 'tg-stage7-summary-zero',
        groupNo: 'TG-STAGE7-SUMMARY-ZERO',
        visitDate: '2026-07-03',
        travelAgency: 'Stage7 Zero Agency',
        guideName: 'Stage7 Zero Guide',
        licensePlate: '贵A-ZERO',
        guestCount: 30,
        tasterName: 'Stage7 Zero Taster',
        financeMark: true,
      }),
    ],
    salesOrders: [
      salesOrder({
        id: 'so-stage7-export-marked',
        orderNo: 'SO-STAGE7-EXPORT-MARKED',
        customerId: 'cust-stage7-export-marked',
        customerName: 'Stage7 Export Marked Customer',
        travelGroupId: 'tg-stage7-export-marked',
        financeMark: true,
      }),
      salesOrder({
        id: 'so-stage7-export-hidden-customer',
        orderNo: 'SO-STAGE7-EXPORT-HIDDEN-CUSTOMER',
        customerId: 'cust-stage7-export-marked',
        customerName: 'Stage7 Export Unmarked Customer',
        travelGroupId: 'tg-stage7-export-marked',
        financeMark: false,
      }),
      salesOrder({
        id: 'so-stage7-export-hidden-group',
        orderNo: 'SO-STAGE7-EXPORT-HIDDEN-GROUP',
        customerId: 'cust-stage7-export-marked',
        customerName: 'Stage7 Export Marked Customer',
        travelGroupId: 'tg-stage7-export-unmarked',
        financeMark: true,
      }),
    ],
    commissionRecords: [
      commissionRecord({
        id: 'rec-stage7-export-sales',
        salesOrderId: 'so-stage7-export-marked',
        travelGroupId: 'tg-stage7-export-marked',
        targetType: 'SALES_COMMISSION',
        targetUserId: 'usr-stage7-export-sales',
        amountCents: 1800,
        isConfirmed: true,
        confirmedById: 'usr-stage7-export-finance',
        confirmedAt: '2026-07-03T10:00:00.000Z',
        calculationNote: 'stage7 export sales commission smoke',
      }),
      commissionRecord({
        id: 'rec-stage7-export-agency',
        salesOrderId: 'so-stage7-export-marked',
        travelGroupId: 'tg-stage7-export-marked',
        targetType: 'AGENCY_DAILY_REBATE',
        agencyName: 'Stage7 Export Agency',
        pointsCents: 2340,
        amountCents: 0,
        calculationNote: 'stage7 export agency rebate smoke',
      }),
      commissionRecord({
        id: 'rec-stage7-export-taster',
        travelGroupId: 'tg-stage7-export-marked',
        targetType: 'TASTER_COMMISSION',
        targetUserId: 'usr-stage7-export-taster',
        amountCents: 8000,
        manualInput: true,
        calculationNote: 'stage7 export taster smoke',
      }),
      commissionRecord({
        id: 'rec-stage7-export-hidden-customer',
        salesOrderId: 'so-stage7-export-hidden-customer',
        travelGroupId: 'tg-stage7-export-marked',
        targetType: 'SALES_COMMISSION',
        targetUserId: 'usr-stage7-export-sales',
      }),
      commissionRecord({
        id: 'rec-stage7-export-hidden-group',
        salesOrderId: 'so-stage7-export-hidden-group',
        travelGroupId: 'tg-stage7-export-unmarked',
        targetType: 'SALES_COMMISSION',
        targetUserId: 'usr-stage7-export-sales',
      }),
    ],
    travelGroupFinanceSummaries: [
      summaryRecord({
        id: 'summary-stage7-export-marked',
        travelGroupId: 'tg-stage7-summary-marked',
        sourceSnapshot: {
          afterSalesImpact: {
            afterSalesImpactStatus: 'refund_pending_confirmation',
            pendingAfterSalesRefundAmountCents: 2500,
          },
          token: 'secret-token',
          password: 'Password123',
        },
      }),
      summaryRecord({
        id: 'summary-stage7-export-unmarked',
        travelGroupId: 'tg-stage7-summary-unmarked',
        totalSalesAmountCents: 50000,
      }),
    ],
  };
}

function user(id, username, role, overrides = {}) {
  return {
    id,
    username,
    name: `Stage7 Export ${role}`,
    password: 'Password123',
    role,
    ...overrides,
  };
}

function travelGroup(overrides = {}) {
  return {
    travelAgency: 'Stage7 Export Agency',
    guideName: 'Stage7 Export Guide',
    licensePlate: '贵A-EXPORT',
    guestCount: 18,
    tasterId: 'usr-stage7-export-taster',
    tasterName: 'Stage7 Export Taster',
    guideInfoSent: false,
    travelAgencyInfoSent: false,
    ...overrides,
  };
}

function salesOrder(overrides = {}) {
  return {
    orderDate: '2026-07-01',
    totalAmountCents: 100000,
    status: 'VALID',
    salesUserId: 'usr-stage7-export-sales',
    outreachUserId: 'usr-stage7-export-outreach',
    ...overrides,
  };
}

function commissionRecord(overrides = {}) {
  return {
    grossAmountCents: 100000,
    confirmedRefundAmountCents: 10000,
    baseAmountCents: 90000,
    deductionAmountCents: 0,
    rateSnapshot: '0.0200',
    amountCents: 0,
    pointsCents: 0,
    manualInput: false,
    isConfirmed: false,
    calculationVersion: 'stage7_v1',
    calculationNote: 'stage7 export smoke',
    sourceSnapshot: {
      source: 'stage7 export test source',
      token: 'secret-token',
      password: 'Password123',
    },
    ...overrides,
  };
}

function summaryRecord(overrides = {}) {
  return {
    totalSalesAmountCents: 100000,
    totalCashOnDeliveryCents: 20000,
    totalPaidDepositCents: 80000,
    confirmedRefundAmountCents: 10000,
    effectiveSalesAmountCents: 90000,
    totalAgencyDeductionCents: 12000,
    agencyDeductionConfirmed: false,
    totalAgencyNetAmountCents: 88000,
    totalDailyRebateCents: 3000,
    totalMonthlyRebateCents: 2000,
    paidRebateCents: 3000,
    unpaidRebateCents: 2000,
    dailyRebatePaid: true,
    dailyRebatePaidById: 'usr-stage7-export-finance',
    dailyRebatePaidAt: '2026-07-01T12:00:00.000Z',
    monthlyRebatePaid: false,
    monthlyRebatePaidById: null,
    monthlyRebatePaidAt: null,
    notes: 'stage7 export summary smoke note',
    guideInfoSent: true,
    travelAgencyInfoSent: false,
    calculationVersion: 'stage7_v1',
    sourceSnapshot: {
      token: 'secret-token',
      password: 'Password123',
    },
    ...overrides,
  };
}
