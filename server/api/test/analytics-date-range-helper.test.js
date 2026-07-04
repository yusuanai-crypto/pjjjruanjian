const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ANALYTICS_TIMEZONE,
  normalizeAnalyticsDateRange,
} = require('../src/modules/analytics/analytics-date-range.helper');

test('unit: analytics date range defaults to this_month in Asia/Shanghai', () => {
  assert.deepEqual(
    normalizeAnalyticsDateRange({}, { now: instant('2026-07-04T08:00:00Z') }),
    {
      preset: 'this_month',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-04',
      timezone: ANALYTICS_TIMEZONE,
    },
  );
});

test('unit: analytics date range supports every named preset', () => {
  const now = instant('2026-07-04T08:00:00Z');
  const cases = [
    ['today', '2026-07-04', '2026-07-04'],
    ['yesterday', '2026-07-03', '2026-07-03'],
    ['last_10_days', '2026-06-25', '2026-07-04'],
    ['this_month', '2026-07-01', '2026-07-04'],
    ['last_month', '2026-06-01', '2026-06-30'],
    ['this_year', '2026-01-01', '2026-07-04'],
  ];

  for (const [preset, dateFrom, dateTo] of cases) {
    assert.deepEqual(normalizeAnalyticsDateRange({ preset }, { now }), {
      preset,
      dateFrom,
      dateTo,
      timezone: ANALYTICS_TIMEZONE,
    });
  }
});

test('unit: analytics date range treats date input without preset as custom', () => {
  assert.deepEqual(
    normalizeAnalyticsDateRange({
      dateFrom: '2026-02-03',
      dateTo: '2026-02-10',
    }),
    {
      preset: 'custom',
      dateFrom: '2026-02-03',
      dateTo: '2026-02-10',
      timezone: ANALYTICS_TIMEZONE,
    },
  );
});

test('unit: analytics custom date range preserves inclusive boundaries', () => {
  assert.deepEqual(
    normalizeAnalyticsDateRange({
      preset: 'custom',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-04',
    }),
    {
      preset: 'custom',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-04',
      timezone: ANALYTICS_TIMEZONE,
    },
  );
});

test('unit: analytics date range uses Asia/Shanghai calendar day', () => {
  assert.deepEqual(
    normalizeAnalyticsDateRange(
      { preset: 'today' },
      { now: instant('2026-07-03T16:00:00Z') },
    ),
    {
      preset: 'today',
      dateFrom: '2026-07-04',
      dateTo: '2026-07-04',
      timezone: ANALYTICS_TIMEZONE,
    },
  );
});

test('unit: analytics date range handles leap year boundaries', () => {
  const now = instant('2024-03-01T04:00:00Z');

  assert.deepEqual(normalizeAnalyticsDateRange({ preset: 'yesterday' }, { now }), {
    preset: 'yesterday',
    dateFrom: '2024-02-29',
    dateTo: '2024-02-29',
    timezone: ANALYTICS_TIMEZONE,
  });
  assert.deepEqual(
    normalizeAnalyticsDateRange({ preset: 'last_month' }, { now }),
    {
      preset: 'last_month',
      dateFrom: '2024-02-01',
      dateTo: '2024-02-29',
      timezone: ANALYTICS_TIMEZONE,
    },
  );
});

test('unit: analytics date range handles cross-month last_10_days', () => {
  assert.deepEqual(
    normalizeAnalyticsDateRange(
      { preset: 'last_10_days' },
      { now: instant('2026-03-01T04:00:00Z') },
    ),
    {
      preset: 'last_10_days',
      dateFrom: '2026-02-20',
      dateTo: '2026-03-01',
      timezone: ANALYTICS_TIMEZONE,
    },
  );
});

test('unit: analytics date range handles cross-year presets', () => {
  const now = instant('2026-01-01T04:00:00Z');

  assert.deepEqual(normalizeAnalyticsDateRange({ preset: 'yesterday' }, { now }), {
    preset: 'yesterday',
    dateFrom: '2025-12-31',
    dateTo: '2025-12-31',
    timezone: ANALYTICS_TIMEZONE,
  });
  assert.deepEqual(
    normalizeAnalyticsDateRange({ preset: 'last_10_days' }, { now }),
    {
      preset: 'last_10_days',
      dateFrom: '2025-12-23',
      dateTo: '2026-01-01',
      timezone: ANALYTICS_TIMEZONE,
    },
  );
  assert.deepEqual(
    normalizeAnalyticsDateRange({ preset: 'last_month' }, { now }),
    {
      preset: 'last_month',
      dateFrom: '2025-12-01',
      dateTo: '2025-12-31',
      timezone: ANALYTICS_TIMEZONE,
    },
  );
  assert.deepEqual(
    normalizeAnalyticsDateRange({ preset: 'this_year' }, { now }),
    {
      preset: 'this_year',
      dateFrom: '2026-01-01',
      dateTo: '2026-01-01',
      timezone: ANALYTICS_TIMEZONE,
    },
  );
});

test('unit: analytics date range rejects invalid dates and ranges', () => {
  assertValidationError(() =>
    normalizeAnalyticsDateRange({
      preset: 'custom',
      dateFrom: '2026-02-30',
      dateTo: '2026-03-01',
    }),
  );
  assertValidationError(() =>
    normalizeAnalyticsDateRange({
      preset: 'custom',
      dateFrom: '2026-2-03',
      dateTo: '2026-03-01',
    }),
  );
  assertValidationError(() =>
    normalizeAnalyticsDateRange({
      preset: 'custom',
      dateFrom: '2026-07-05',
      dateTo: '2026-07-04',
    }),
  );
  assertValidationError(() =>
    normalizeAnalyticsDateRange({
      preset: 'custom',
      dateFrom: '2026-07-01',
    }),
  );
  assertValidationError(() =>
    normalizeAnalyticsDateRange({
      preset: 'not_a_preset',
    }),
  );
});

function instant(value) {
  return new Date(value);
}

function assertValidationError(fn) {
  assert.throws(fn, (error) => {
    assert.equal(error.statusCode, 400);
    assert.equal(error.code, 'VALIDATION_FAILED');
    return true;
  });
}
