import { createHttpError } from '../../common/errors';

export const INVENTORY_READ_ROLES = new Set([
  'super_admin',
  'admin',
  'warehouse',
  'finance',
  'boss',
]);

export const INVENTORY_MANAGE_ROLES = new Set([
  'super_admin',
  'admin',
]);

export const INVENTORY_COST_READ_ROLES = new Set([
  'super_admin',
  'admin',
  'finance',
  'boss',
]);

export const INVENTORY_INBOUND_WRITE_ROLES = new Set([
  'super_admin',
  'admin',
  'warehouse',
]);

export const INVENTORY_COST_WRITE_ROLES = new Set([
  'super_admin',
  'admin',
  'finance',
]);

export const INVENTORY_QUANTITY_WRITE_ROLES = new Set([
  'super_admin',
  'admin',
  'warehouse',
]);

export const INVENTORY_STOCKTAKE_WRITE_ROLES = new Set([
  'super_admin',
  'admin',
  'warehouse',
]);

export const INVENTORY_STOCKTAKE_APPROVE_ROLES = new Set([
  'super_admin',
  'admin',
  'boss',
]);

export function normalizedInventoryRole(actor: any) {
  return typeof actor?.role === 'string'
    ? actor.role.trim().toLowerCase()
    : '';
}

export function requireInventoryRead(actor: any) {
  requireInventoryRole(actor, INVENTORY_READ_ROLES);
}

export function requireInventoryManage(actor: any) {
  requireInventoryRole(actor, INVENTORY_MANAGE_ROLES);
}

export function requireInventoryInboundWrite(actor: any) {
  requireInventoryRole(actor, INVENTORY_INBOUND_WRITE_ROLES);
}

export function requireInventoryCostWrite(actor: any) {
  requireInventoryRole(actor, INVENTORY_COST_WRITE_ROLES);
}

export function requireInventoryQuantityWrite(actor: any) {
  requireInventoryRole(actor, INVENTORY_QUANTITY_WRITE_ROLES);
}

export function requireInventoryStocktakeWrite(actor: any) {
  requireInventoryRole(actor, INVENTORY_STOCKTAKE_WRITE_ROLES);
}

export function requireInventoryStocktakeApprove(actor: any) {
  requireInventoryRole(actor, INVENTORY_STOCKTAKE_APPROVE_ROLES);
}

export function canReadInventoryCost(actor: any) {
  return INVENTORY_COST_READ_ROLES.has(normalizedInventoryRole(actor));
}

export function requireInventoryRole(
  actor: any,
  allowedRoles: Set<string>,
) {
  if (!allowedRoles.has(normalizedInventoryRole(actor))) {
    throw createHttpError(
      403,
      'PERMISSION_DENIED',
      'You do not have permission to access inventory data.',
    );
  }
}
