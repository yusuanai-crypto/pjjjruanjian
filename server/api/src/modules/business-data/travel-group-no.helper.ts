export type TravelGroupNoDelegate = {
  findMany(args: {
    where: {
      groupNo: {
        startsWith: string;
      };
    };
    select: {
      groupNo: true;
    };
    orderBy?: {
      groupNo: 'asc' | 'desc';
    };
  }): Promise<Array<{ groupNo: string | null }>>;
};

export type GeneratedTravelGroupNoWriter<T> = (groupNo: string, attempt: number) => Promise<T>;

const GROUP_NO_PREFIX = 'TG';
const GROUP_NO_SERIAL_WIDTH = 3;

export async function generateTravelGroupNo(delegate: TravelGroupNoDelegate, visitDate: string | Date) {
  const prefix = buildTravelGroupNoPrefix(visitDate);
  const existingGroups = await delegate.findMany({
    where: {
      groupNo: {
        startsWith: prefix,
      },
    },
    select: {
      groupNo: true,
    },
    orderBy: {
      groupNo: 'desc',
    },
  });
  const maxSerial = existingGroups.reduce((max, group) => {
    const serial = parseGroupNoSerial(group.groupNo, prefix);
    return serial === null ? max : Math.max(max, serial);
  }, 0);
  return `${prefix}${String(maxSerial + 1).padStart(GROUP_NO_SERIAL_WIDTH, '0')}`;
}

export async function withGeneratedTravelGroupNo<T>(
  delegate: TravelGroupNoDelegate,
  visitDate: string | Date,
  writer: GeneratedTravelGroupNoWriter<T>,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= 1; attempt += 1) {
    const groupNo = await generateTravelGroupNo(delegate, visitDate);
    try {
      return await writer(groupNo, attempt);
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

export function buildTravelGroupNoPrefix(visitDate: string | Date) {
  return `${GROUP_NO_PREFIX}${formatVisitDatePart(visitDate)}`;
}

function formatVisitDatePart(visitDate: string | Date) {
  if (typeof visitDate === 'string') {
    const trimmed = visitDate.trim();
    const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (dateOnlyMatch) {
      return `${dateOnlyMatch[1]}${dateOnlyMatch[2]}${dateOnlyMatch[3]}`;
    }
    return formatDateObject(new Date(trimmed));
  }
  return formatDateObject(visitDate);
}

function formatDateObject(date: Date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('visitDate must be a valid date.');
  }
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function parseGroupNoSerial(groupNo: string | null, prefix: string) {
  if (!groupNo || !groupNo.startsWith(prefix)) {
    return null;
  }
  const suffix = groupNo.slice(prefix.length);
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
    return target.includes('groupNo') || target.includes('group_no');
  }
  return typeof target === 'string' && (target.includes('groupNo') || target.includes('group_no'));
}
