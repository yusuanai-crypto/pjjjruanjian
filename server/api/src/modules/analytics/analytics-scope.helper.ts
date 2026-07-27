export interface AnalyticsDateRangeScope {
  dateFrom?: string | Date | null;
  dateTo?: string | Date | null;
}

export interface AnalyticsSalesOrderScopeOptions {
  onlyShowMarkedRecords?: boolean;
  dateRange?: AnalyticsDateRangeScope | null;
  baseWhere?: Record<string, any> | null;
}

export interface AnalyticsTravelGroupScopeOptions {
  onlyShowMarkedRecords?: boolean;
  dateRange?: AnalyticsDateRangeScope | null;
  baseWhere?: Record<string, any> | null;
}

export interface AnalyticsAfterSalesOrderScopeOptions {
  onlyShowMarkedRecords?: boolean;
  dateRange?: AnalyticsDateRangeScope | null;
  baseWhere?: Record<string, any> | null;
}

export function buildAnalyticsQueryScopes(options: {
  onlyShowMarkedRecords?: boolean;
  salesOrderDateRange?: AnalyticsDateRangeScope | null;
  travelGroupDateRange?: AnalyticsDateRangeScope | null;
  afterSalesOrderDateRange?: AnalyticsDateRangeScope | null;
} = {}) {
  return {
    salesOrderWhere: buildAnalyticsSalesOrderWhere({
      onlyShowMarkedRecords: options.onlyShowMarkedRecords,
      dateRange: options.salesOrderDateRange,
    }),
    travelGroupWhere: buildAnalyticsTravelGroupWhere({
      onlyShowMarkedRecords: options.onlyShowMarkedRecords,
      dateRange: options.travelGroupDateRange,
    }),
    afterSalesOrderWhere: buildAnalyticsAfterSalesOrderWhere({
      onlyShowMarkedRecords: options.onlyShowMarkedRecords,
      dateRange: options.afterSalesOrderDateRange,
    }),
  };
}

export function buildAnalyticsSalesOrderWhere(
  options: AnalyticsSalesOrderScopeOptions = {},
) {
  return andWhere(
    options.baseWhere,
    {
      orderType: {
        not: 'AFTER_SALES',
      },
    },
    buildDateFieldWhere('orderDate', options.dateRange, false),
    buildGlobalSalesOrderMarkScope(options.onlyShowMarkedRecords),
  );
}

export function buildAnalyticsTravelGroupWhere(
  options: AnalyticsTravelGroupScopeOptions = {},
) {
  return andWhere(
    options.baseWhere,
    buildDateFieldWhere('visitDate', options.dateRange, false),
    buildGlobalTravelGroupMarkScope(options.onlyShowMarkedRecords),
  );
}

export function buildAnalyticsAfterSalesOrderWhere(
  options: AnalyticsAfterSalesOrderScopeOptions = {},
) {
  return andWhere(
    options.baseWhere,
    buildDateFieldWhere('createdAt', options.dateRange, true),
    buildGlobalAfterSalesOrderMarkScope(options.onlyShowMarkedRecords),
  );
}

export function buildGlobalCustomerMarkScope(onlyShowMarkedRecords?: boolean) {
  return onlyShowMarkedRecords ? { financeMark: true } : null;
}

export function buildGlobalTravelGroupMarkScope(
  onlyShowMarkedRecords?: boolean,
) {
  return onlyShowMarkedRecords ? { financeMark: true } : null;
}

export function buildGlobalSalesOrderMarkScope(
  onlyShowMarkedRecords?: boolean,
) {
  return onlyShowMarkedRecords ? { financeMark: true } : null;
}

export function buildGlobalAfterSalesOrderMarkScope(
  onlyShowMarkedRecords?: boolean,
) {
  const salesOrderScope = buildGlobalSalesOrderMarkScope(
    onlyShowMarkedRecords,
  );
  if (!salesOrderScope) {
    return null;
  }
  return {
    salesOrder: {
      is: salesOrderScope,
    },
  };
}

export function andWhere(...clauses: Array<Record<string, any> | null | undefined>) {
  const active = clauses.filter(
    (clause) => clause && Object.keys(clause).length > 0,
  ) as Array<Record<string, any>>;
  if (active.length === 0) {
    return {};
  }
  if (active.length === 1) {
    return active[0];
  }
  return {
    AND: active,
  };
}

function buildDateFieldWhere(
  fieldName: string,
  dateRange: AnalyticsDateRangeScope | null | undefined,
  includeFullDateToDay: boolean,
) {
  if (!dateRange) {
    return null;
  }
  const range: Record<string, Date> = {};
  if (dateRange.dateFrom) {
    range.gte = toDateBound(
      dateRange.dateFrom,
      false,
      includeFullDateToDay,
    );
  }
  if (dateRange.dateTo) {
    range.lte = toDateBound(
      dateRange.dateTo,
      includeFullDateToDay,
      includeFullDateToDay,
    );
  }
  if (Object.keys(range).length === 0) {
    return null;
  }
  return {
    [fieldName]: range,
  };
}

function toDateBound(
  value: string | Date,
  endOfDay: boolean,
  useShanghaiTimezone: boolean,
) {
  if (value instanceof Date) {
    return value;
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const timezoneSuffix = useShanghaiTimezone ? '+08:00' : 'Z';
    return new Date(
      `${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}${timezoneSuffix}`,
    );
  }
  return new Date(text);
}
