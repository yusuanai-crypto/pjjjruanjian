import type { UserRole } from '@prisma/client';

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
