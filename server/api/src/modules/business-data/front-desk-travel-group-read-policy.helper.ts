import {
  formatDatabaseDate,
  formatShanghaiBusinessDate,
  RECONCILIATION_TIMEZONE,
} from './reconciliation-calculation.helper';

export const FRONT_DESK_TRAVEL_GROUP_TIMEZONE = RECONCILIATION_TIMEZONE;

export function isFrontDeskActor(actor: any) {
  return String(actor?.role || '').toLowerCase() === 'front_desk';
}

export function getShanghaiTodayDatabaseDate(now = new Date()) {
  const shanghaiToday = formatShanghaiBusinessDate(now);
  if (!shanghaiToday) {
    throw new Error('Unable to calculate the current Shanghai natural day.');
  }
  return new Date(`${shanghaiToday}T00:00:00.000Z`);
}

export function buildShanghaiTodayDatabaseRange(now = new Date()) {
  const start = getShanghaiTodayDatabaseDate(now);
  return {
    start,
    end: new Date(start.getTime() + 24 * 60 * 60 * 1000),
  };
}

export function buildFrontDeskTravelGroupReadScope(
  actor: any,
  now = new Date(),
) {
  if (!isFrontDeskActor(actor)) {
    return null;
  }
  return {
    visitDate: {
      gte: getShanghaiTodayDatabaseDate(now),
    },
  };
}

export function isTravelGroupOnOrAfterShanghaiToday(
  group: any,
  now = new Date(),
) {
  const visitDate = formatDatabaseDate(group?.visitDate);
  const shanghaiToday = formatShanghaiBusinessDate(now);
  return Boolean(
    visitDate && shanghaiToday && visitDate >= shanghaiToday,
  );
}

export function canFrontDeskReadTravelGroup(
  actor: any,
  group: any,
  now = new Date(),
) {
  return (
    !isFrontDeskActor(actor) ||
    isTravelGroupOnOrAfterShanghaiToday(group, now)
  );
}
