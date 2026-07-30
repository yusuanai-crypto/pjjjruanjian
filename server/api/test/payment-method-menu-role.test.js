const assert = require('node:assert/strict');
const test = require('node:test');

const { getRoleMenus } = require('../src/modules/auth/roles');

test('payment method management menu is limited to finance and administrators', () => {
  for (const role of ['super_admin', 'admin', 'finance']) {
    const menu = getRoleMenus(role).find(
      (item) => item.id === 'payment_method_management',
    );
    assert.ok(menu, `${role} should receive the menu`);
    assert.equal(menu.title, '收款方式管理');
    assert.equal(menu.phase, 6);
  }

  for (const role of [
    'boss',
    'front_desk',
    'sales',
    'warehouse',
    'after_sales',
    'taster',
  ]) {
    assert.equal(
      getRoleMenus(role).some(
        (item) => item.id === 'payment_method_management',
      ),
      false,
      `${role} should not receive the menu`,
    );
  }
});
