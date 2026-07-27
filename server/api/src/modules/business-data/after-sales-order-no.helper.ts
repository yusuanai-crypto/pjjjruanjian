export type AfterSalesNoDelegate = {
  findMany(args: {
    where: {
      afterSalesNo: {
        startsWith: string;
      };
    };
    select: {
      afterSalesNo: true;
    };
    orderBy?: {
      afterSalesNo: 'asc' | 'desc';
    };
  }): Promise<Array<{ afterSalesNo: string | null }>>;
};

export type GeneratedAfterSalesNoWriter<T> = (
  afterSalesNo: string,
  attempt: number,
) => Promise<T>;

export type AfterSalesSalesOrderNoDelegate = {
  findMany(args: {
    where: {
      orderNo: {
        startsWith: string;
      };
    };
    select: {
      orderNo: true;
    };
    orderBy?: {
      orderNo: 'asc' | 'desc';
    };
  }): Promise<Array<{ orderNo: string | null }>>;
};

const AFTER_SALES_NO_PREFIX = 'AS';
const AFTER_SALES_NO_SERIAL_WIDTH = 3;

export async function generateAfterSalesNo(
  delegate: AfterSalesNoDelegate,
  createdAt: string | Date = new Date(),
  salesOrderDelegate?: AfterSalesSalesOrderNoDelegate,
) {
  const prefix = buildAfterSalesNoPrefix(createdAt);
  const [existingOrders, existingSalesOrders] = await Promise.all([
    delegate.findMany({
      where: {
        afterSalesNo: {
          startsWith: prefix,
        },
      },
      select: {
        afterSalesNo: true,
      },
      orderBy: {
        afterSalesNo: 'desc',
      },
    }),
    salesOrderDelegate
      ? salesOrderDelegate.findMany({
          where: {
            orderNo: {
              startsWith: prefix,
            },
          },
          select: {
            orderNo: true,
          },
          orderBy: {
            orderNo: 'desc',
          },
        })
      : Promise.resolve([]),
  ]);
  const existingNumbers = [
    ...existingOrders.map((order) => order.afterSalesNo),
    ...existingSalesOrders.map((order) => order.orderNo),
  ];
  const maxSerial = existingNumbers.reduce((max, orderNo) => {
    const serial = parseAfterSalesNoSerial(orderNo, prefix);
    return serial === null ? max : Math.max(max, serial);
  }, 0);
  return `${prefix}${String(maxSerial + 1).padStart(
    AFTER_SALES_NO_SERIAL_WIDTH,
    '0',
  )}`;
}

export async function withGeneratedAfterSalesNo<T>(
  delegate: AfterSalesNoDelegate,
  createdAt: string | Date | undefined,
  writer: GeneratedAfterSalesNoWriter<T>,
  salesOrderDelegate?: AfterSalesSalesOrderNoDelegate,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= 1; attempt += 1) {
    const afterSalesNo = await generateAfterSalesNo(
      delegate,
      createdAt,
      salesOrderDelegate,
    );
    try {
      return await writer(afterSalesNo, attempt);
    } catch (error) {
      lastError = error;
      if (attempt === 0 && isUniqueConstraintError(error)) {
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export function buildAfterSalesNoPrefix(createdAt: string | Date = new Date()) {
  return `${AFTER_SALES_NO_PREFIX}${formatCreatedDatePart(createdAt)}`;
}

function formatCreatedDatePart(createdAt: string | Date) {
  if (typeof createdAt === 'string') {
    const trimmed = createdAt.trim();
    const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (dateOnlyMatch) {
      return `${dateOnlyMatch[1]}${dateOnlyMatch[2]}${dateOnlyMatch[3]}`;
    }
    return formatDateObject(new Date(trimmed));
  }
  return formatDateObject(createdAt);
}

function formatDateObject(date: Date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('createdAt must be a valid date.');
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = new Map(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.get('year')}${values.get('month')}${values.get('day')}`;
}

function parseAfterSalesNoSerial(afterSalesNo: string | null, prefix: string) {
  if (!afterSalesNo || !afterSalesNo.startsWith(prefix)) {
    return null;
  }
  const suffix = afterSalesNo.slice(prefix.length);
  if (!/^\d+$/.test(suffix)) {
    return null;
  }
  return Number(suffix);
}

function isUniqueConstraintError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = (error as any).code;
  if (code !== 'P2002') {
    return false;
  }
  const target = (error as any).meta?.target;
  if (Array.isArray(target)) {
    return (
      target.includes('afterSalesNo') ||
      target.includes('after_sales_no') ||
      target.includes('after_sales_orders_after_sales_no_key') ||
      target.includes('orderNo') ||
      target.includes('order_no') ||
      target.includes('sales_orders_order_no_key')
    );
  }
  return (
    typeof target === 'string' &&
    (target.includes('afterSalesNo') ||
      target.includes('after_sales_no') ||
      target.includes('after_sales_orders_after_sales_no_key') ||
      target.includes('orderNo') ||
      target.includes('order_no') ||
      target.includes('sales_orders_order_no_key'))
  );
}
