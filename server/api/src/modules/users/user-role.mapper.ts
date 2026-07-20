import type { UserRole } from '@prisma/client';

export const ORDINARY_EMPLOYEE_ROLES = [
  'boss',
  'front_desk',
  'sales',
  'finance',
  'warehouse',
  'after_sales',
  'taster',
] as const;

export const PRISMA_ROLE_BY_APP_ROLE: Record<string, UserRole> = {
  super_admin: 'SUPER_ADMIN',
  admin: 'ADMIN',
  boss: 'BOSS',
  front_desk: 'FRONT_DESK',
  sales: 'SALES',
  finance: 'FINANCE',
  warehouse: 'WAREHOUSE',
  after_sales: 'AFTER_SALES',
  taster: 'TASTER',
};

export const APP_ROLE_BY_PRISMA_ROLE = Object.fromEntries(
  Object.entries(PRISMA_ROLE_BY_APP_ROLE).map(([appRole, prismaRole]) => [prismaRole, appRole]),
);

export function toPrismaRole(role: string): UserRole {
  const prismaRole = PRISMA_ROLE_BY_APP_ROLE[role];
  if (!prismaRole) {
    throw new Error(`Unsupported user role: ${role}`);
  }
  return prismaRole;
}

export function toAppRole(role: string) {
  return APP_ROLE_BY_PRISMA_ROLE[role] || String(role).toLowerCase();
}

export function isSuperAdminRole(role: unknown) {
  return toAppRole(String(role || '')) === 'super_admin';
}

export function isAdminRole(role: unknown) {
  return toAppRole(String(role || '')) === 'admin';
}

export function isOrdinaryEmployeeRole(role: unknown) {
  return ORDINARY_EMPLOYEE_ROLES.includes(
    toAppRole(String(role || '')) as (typeof ORDINARY_EMPLOYEE_ROLES)[number],
  );
}

export function canManageTargetRole(
  actorRole: unknown,
  targetRole: unknown,
) {
  const actor = toAppRole(String(actorRole || ''));
  const target = toAppRole(String(targetRole || ''));
  if (
    !Object.prototype.hasOwnProperty.call(
      PRISMA_ROLE_BY_APP_ROLE,
      target,
    )
  ) {
    return false;
  }
  if (actor === 'super_admin') {
    return true;
  }
  return actor === 'admin' && isOrdinaryEmployeeRole(target);
}

export function canAssignRole(actorRole: unknown, targetRole: unknown) {
  const actor = toAppRole(String(actorRole || ''));
  const target = toAppRole(String(targetRole || ''));
  if (actor === 'super_admin') {
    return Object.prototype.hasOwnProperty.call(
      PRISMA_ROLE_BY_APP_ROLE,
      target,
    );
  }
  return actor === 'admin' && isOrdinaryEmployeeRole(target);
}
