export type SalesOrderNoDelegate = {
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

export type GeneratedSalesOrderNoWriter<T> = (orderNo: string, attempt: number) => Promise<T>;

const SALES_ORDER_NO_PREFIX = 'SO';
const SALES_ORDER_NO_SERIAL_WIDTH = 3;

export async function generateSalesOrderNo(delegate: SalesOrderNoDelegate, orderDate: string | Date) {
  const prefix = buildSalesOrderNoPrefix(orderDate);
  const existingOrders = await delegate.findMany({
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
  });
  const maxSerial = existingOrders.reduce((max, order) => {
    const serial = parseSalesOrderNoSerial(order.orderNo, prefix);
    return serial === null ? max : Math.max(max, serial);
  }, 0);
  return `${prefix}${String(maxSerial + 1).padStart(SALES_ORDER_NO_SERIAL_WIDTH, '0')}`;
}

export const generateOrderNo = generateSalesOrderNo;

export async function withGeneratedSalesOrderNo<T>(
  delegate: SalesOrderNoDelegate,
  orderDate: string | Date,
  writer: GeneratedSalesOrderNoWriter<T>,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= 1; attempt += 1) {
    const orderNo = await generateSalesOrderNo(delegate, orderDate);
    try {
      return await writer(orderNo, attempt);
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

export function buildSalesOrderNoPrefix(orderDate: string | Date) {
  return `${SALES_ORDER_NO_PREFIX}${formatOrderDatePart(orderDate)}`;
}

function formatOrderDatePart(orderDate: string | Date) {
  if (typeof orderDate === 'string') {
    const trimmed = orderDate.trim();
    const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (dateOnlyMatch) {
      return `${dateOnlyMatch[1]}${dateOnlyMatch[2]}${dateOnlyMatch[3]}`;
    }
    return formatDateObject(new Date(trimmed));
  }
  return formatDateObject(orderDate);
}

function formatDateObject(date: Date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('orderDate must be a valid date.');
  }
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function parseSalesOrderNoSerial(orderNo: string | null, prefix: string) {
  if (!orderNo || !orderNo.startsWith(prefix)) {
    return null;
  }
  const suffix = orderNo.slice(prefix.length);
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
    return target.includes('orderNo') || target.includes('order_no');
  }
  return typeof target === 'string' && (target.includes('orderNo') || target.includes('order_no'));
}
