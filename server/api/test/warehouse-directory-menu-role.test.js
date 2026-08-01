const assert = require('node:assert/strict');
const test = require('node:test');

const { getRoleMenus } = require('../src/modules/auth/roles');

test('warehouse directory menu follows the inventory read role matrix', () => {
  for (const role of [
    'super_admin',
    'admin',
    'boss',
    'finance',
    'warehouse',
  ]) {
    const menu = getRoleMenus(role).find(
      (item) => item.id === 'warehouse_directory',
    );
    assert.ok(menu, `${role} should receive the warehouse directory menu`);
    assert.equal(menu.title, '仓库管理');
    assert.equal(menu.phase, 11);
  }

  for (const role of ['front_desk', 'sales', 'after_sales', 'taster']) {
    assert.equal(
      getRoleMenus(role).some((item) => item.id === 'warehouse_directory'),
      false,
      `${role} should not receive the warehouse directory menu`,
    );
  }
});

test('inventory and warehouse directory remain separate backend menus', () => {
  const adminMenus = getRoleMenus('super_admin');
  const inventory = adminMenus.find(
    (item) => item.id === 'warehouse_management',
  );
  const directory = adminMenus.find(
    (item) => item.id === 'warehouse_directory',
  );

  assert.equal(inventory?.title, '库存管理');
  assert.equal(directory?.title, '仓库管理');
  assert.notEqual(inventory?.id, directory?.id);
});
