const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildAnalyticsAfterSalesOrderWhere,
  buildAnalyticsQueryScopes,
  buildAnalyticsSalesOrderWhere,
  buildAnalyticsTravelGroupWhere,
  buildGlobalAfterSalesOrderMarkScope,
  buildGlobalSalesOrderMarkScope,
  buildGlobalTravelGroupMarkScope,
} = require('../src/modules/analytics/analytics-scope.helper');

test('unit: analytics scope helper leaves queries open when global mark is disabled', () => {
  assert.deepEqual(
    buildAnalyticsSalesOrderWhere({ onlyShowMarkedRecords: false }),
    {},
  );
  assert.deepEqual(
    buildAnalyticsTravelGroupWhere({ onlyShowMarkedRecords: false }),
    {},
  );
  assert.deepEqual(
    buildAnalyticsAfterSalesOrderWhere({ onlyShowMarkedRecords: false }),
    {},
  );
});

test('unit: analytics scope helper builds canonical global mark scopes', () => {
  assert.deepEqual(buildGlobalTravelGroupMarkScope(true), {
    financeMark: true,
  });
  assert.deepEqual(buildGlobalSalesOrderMarkScope(true), {
    customer: {
      is: {
        financeMark: true,
      },
    },
    OR: [
      { travelGroupId: null },
      {
        travelGroup: {
          is: {
            financeMark: true,
          },
        },
      },
    ],
  });
  assert.deepEqual(buildGlobalAfterSalesOrderMarkScope(true), {
    salesOrder: {
      is: buildGlobalSalesOrderMarkScope(true),
    },
  });
});

test('unit: analytics scope helper composes date ranges and base where clauses', () => {
  const dateRange = { dateFrom: '2026-07-01', dateTo: '2026-07-04' };

  assert.deepEqual(
    buildAnalyticsSalesOrderWhere({
      onlyShowMarkedRecords: true,
      dateRange,
      baseWhere: { status: { in: ['VALID', 'PARTIAL_REFUND'] } },
    }),
    {
      AND: [
        { status: { in: ['VALID', 'PARTIAL_REFUND'] } },
        {
          orderDate: {
            gte: instant('2026-07-01T00:00:00.000Z'),
            lte: instant('2026-07-04T00:00:00.000Z'),
          },
        },
        buildGlobalSalesOrderMarkScope(true),
      ],
    },
  );

  assert.deepEqual(
    buildAnalyticsTravelGroupWhere({
      onlyShowMarkedRecords: true,
      dateRange,
    }),
    {
      AND: [
        {
          visitDate: {
            gte: instant('2026-07-01T00:00:00.000Z'),
            lte: instant('2026-07-04T00:00:00.000Z'),
          },
        },
        buildGlobalTravelGroupMarkScope(true),
      ],
    },
  );

  assert.deepEqual(
    buildAnalyticsAfterSalesOrderWhere({
      onlyShowMarkedRecords: true,
      dateRange,
      baseWhere: { financeConfirmed: true },
    }),
    {
      AND: [
        { financeConfirmed: true },
        {
          createdAt: {
            gte: instant('2026-07-01T00:00:00.000Z'),
            lte: instant('2026-07-04T23:59:59.999Z'),
          },
        },
        buildGlobalAfterSalesOrderMarkScope(true),
      ],
    },
  );
});

test('unit: analytics sales order scope filters unmarked customers and groups', () => {
  const where = buildAnalyticsSalesOrderWhere({
    onlyShowMarkedRecords: true,
  });

  assert.equal(
    matchesWhere(
      {
        travelGroupId: 'group-marked',
        financeMark: false,
        customer: { financeMark: true },
        travelGroup: { financeMark: true },
      },
      where,
    ),
    true,
  );
  assert.equal(
    matchesWhere(
      {
        travelGroupId: null,
        financeMark: false,
        customer: { financeMark: true },
        travelGroup: null,
      },
      where,
    ),
    true,
  );
  assert.equal(
    matchesWhere(
      {
        travelGroupId: 'group-marked',
        financeMark: true,
        customer: { financeMark: false },
        travelGroup: { financeMark: true },
      },
      where,
    ),
    false,
  );
  assert.equal(
    matchesWhere(
      {
        travelGroupId: 'group-unmarked',
        financeMark: true,
        customer: { financeMark: true },
        travelGroup: { financeMark: false },
      },
      where,
    ),
    false,
  );
});

test('unit: analytics travel group scope filters only by travelGroup.financeMark', () => {
  const where = buildAnalyticsTravelGroupWhere({
    onlyShowMarkedRecords: true,
  });

  assert.equal(matchesWhere({ financeMark: true }, where), true);
  assert.equal(matchesWhere({ financeMark: false }, where), false);
});

test('unit: analytics after-sales scope filters through the linked sales order scope', () => {
  const where = buildAnalyticsAfterSalesOrderWhere({
    onlyShowMarkedRecords: true,
  });

  assert.equal(
    matchesWhere(
      {
        refundAmountCents: 100000,
        financeConfirmed: true,
        salesOrder: {
          travelGroupId: 'group-marked',
          financeMark: false,
          customer: { financeMark: true },
          travelGroup: { financeMark: true },
        },
      },
      where,
    ),
    true,
  );
  assert.equal(
    matchesWhere(
      {
        refundAmountCents: 100000,
        financeConfirmed: true,
        salesOrder: {
          travelGroupId: 'group-unmarked',
          financeMark: true,
          customer: { financeMark: true },
          travelGroup: { financeMark: false },
        },
      },
      where,
    ),
    false,
  );
  assert.equal(
    matchesWhere(
      {
        refundAmountCents: 100000,
        financeConfirmed: true,
        salesOrder: {
          travelGroupId: null,
          financeMark: true,
          customer: { financeMark: false },
          travelGroup: null,
        },
      },
      where,
    ),
    false,
  );
});

test('unit: analytics scope builder returns one reusable scope set for every analytics surface', () => {
  const options = {
    onlyShowMarkedRecords: true,
    salesOrderDateRange: { dateFrom: '2026-07-01', dateTo: '2026-07-04' },
    travelGroupDateRange: { dateFrom: '2026-07-01', dateTo: '2026-07-04' },
    afterSalesOrderDateRange: {
      dateFrom: '2026-07-01',
      dateTo: '2026-07-04',
    },
  };
  const scopes = buildAnalyticsQueryScopes(options);

  for (const _surface of [
    'overview',
    'ranking',
    'detail',
    'source',
    'trend',
    'export',
  ]) {
    assert.deepEqual(
      scopes.salesOrderWhere,
      buildAnalyticsSalesOrderWhere({
        onlyShowMarkedRecords: true,
        dateRange: options.salesOrderDateRange,
      }),
    );
    assert.deepEqual(
      scopes.travelGroupWhere,
      buildAnalyticsTravelGroupWhere({
        onlyShowMarkedRecords: true,
        dateRange: options.travelGroupDateRange,
      }),
    );
    assert.deepEqual(
      scopes.afterSalesOrderWhere,
      buildAnalyticsAfterSalesOrderWhere({
        onlyShowMarkedRecords: true,
        dateRange: options.afterSalesOrderDateRange,
      }),
    );
  }
});

function instant(value) {
  return new Date(value);
}

function matchesWhere(row, where) {
  if (!where || Object.keys(where).length === 0) {
    return true;
  }

  for (const [key, expected] of Object.entries(where)) {
    if (key === 'AND') {
      if (!expected.every((clause) => matchesWhere(row, clause))) {
        return false;
      }
      continue;
    }
    if (key === 'OR') {
      if (!expected.some((clause) => matchesWhere(row, clause))) {
        return false;
      }
      continue;
    }
    if (isRelationFilter(expected)) {
      const related = row[key];
      if (!related || !matchesWhere(related, expected.is)) {
        return false;
      }
      continue;
    }
    if (isScalarFilter(expected)) {
      if (!matchesScalar(row[key], expected)) {
        return false;
      }
      continue;
    }
    if (row[key] !== expected) {
      return false;
    }
  }

  return true;
}

function isRelationFilter(value) {
  return value && typeof value === 'object' && 'is' in value;
}

function isScalarFilter(value) {
  return (
    value &&
    typeof value === 'object' &&
    ('in' in value || 'gte' in value || 'lte' in value)
  );
}

function matchesScalar(actual, filter) {
  if ('in' in filter && !filter.in.includes(actual)) {
    return false;
  }
  if ('gte' in filter && toTime(actual) < toTime(filter.gte)) {
    return false;
  }
  if ('lte' in filter && toTime(actual) > toTime(filter.lte)) {
    return false;
  }
  return true;
}

function toTime(value) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}
