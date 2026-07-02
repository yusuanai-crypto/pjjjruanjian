const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const prismaDir = path.resolve(__dirname, '..', 'prisma');
const migrationsDir = path.join(prismaDir, 'migrations');

function readPrismaFile(relativePath) {
  return fs.readFileSync(path.join(prismaDir, relativePath), 'utf8');
}

function readMigration(name) {
  return fs.readFileSync(
    path.join(migrationsDir, name, 'migration.sql'),
    'utf8',
  );
}

test('smoke: Prisma schema exposes phase 2 business models and scope fields', () => {
  const schema = readPrismaFile('schema.prisma');

  for (const model of [
    'TravelAgency',
    'Guide',
    'TravelGroup',
    'TravelGroupTastingItem',
    'GuideCarriedGroup',
    'PendingTravelGroup',
    'Customer',
    'SalesOrder',
    'SalesOrderItem',
    'DailyReconciliation',
    'ReconciliationPaymentMethod',
    'StrikeBonusAward',
  ]) {
    assert.match(schema, new RegExp(`model ${model} \\{`));
  }

  for (const field of [
    'tasterId',
    'salesUserId',
    'financeMark',
    'markedById',
    'markedAt',
    'refundsCents',
    'guideId',
    'tasterSummary',
    'tasterSummaryAt',
    'postMarkEditedAt',
    'postMarkEditedById',
    'customerId',
    'salesFormNo',
    'logisticsMethod',
    'packingStatus',
    'packageCount',
    'warehouseRemark',
    'logisticsNo',
    'logisticsFeeCents',
    'invoiceRequired',
    'invoiceIssued',
    'financeRemark',
    'subtotalCents',
    'notes',
    'sortOrder',
    'qrCodeToken',
    'qrCodeGeneratedAt',
    'qrCodeExpiresAt',
  ]) {
    assert.match(schema, new RegExp(`\\b${field}\\b`));
  }

  assert.match(
    schema,
    /qrCodeToken\s+String\?\s+@unique\s+@map\("qr_code_token"\)\s+@db\.VarChar\(80\)/,
  );
  assert.match(
    schema,
    /qrCodeGeneratedAt\s+DateTime\?\s+@map\("qr_code_generated_at"\)\s+@db\.DateTime\(0\)/,
  );
  assert.match(
    schema,
    /qrCodeExpiresAt\s+DateTime\?\s+@map\("qr_code_expires_at"\)\s+@db\.DateTime\(0\)/,
  );
  assert.match(schema, /@@index\(\[qrCodeExpiresAt\]\)/);

  assert.match(schema, /enum SalesOrderPackingStatus \{/);
});

test('smoke: phase 2 Prisma migrations create and evolve business tables', () => {
  assert.equal(
    fs.existsSync(
      path.join(
        migrationsDir,
        '20260623000100_business_data_mysql',
        'migration.sql',
      ),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(migrationsDir, '20260629000300_add_customers', 'migration.sql'),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(
        migrationsDir,
        '20260629000400_sales_order_phase4_schema',
        'migration.sql',
      ),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(
        migrationsDir,
        '20260701000100_sales_order_qr_code_fields',
        'migration.sql',
      ),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(
        migrationsDir,
        '20260624000100_business_data_role_scopes',
        'migration.sql',
      ),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(
        migrationsDir,
        '20260624000200_business_data_finance_marks',
        'migration.sql',
      ),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(migrationsDir, '20260627000100_add_guides', 'migration.sql'),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(
        migrationsDir,
        '20260627000200_travel_group_phase3_schema',
        'migration.sql',
      ),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(
        migrationsDir,
        '20260629000100_add_travel_agencies',
        'migration.sql',
      ),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(
        migrationsDir,
        '20260629000200_make_guide_travel_agency_optional',
        'migration.sql',
      ),
    ),
    true,
  );

  const businessDataMigration = readMigration(
    '20260623000100_business_data_mysql',
  );
  for (const table of [
    'travel_groups',
    'guide_carried_groups',
    'pending_travel_groups',
    'sales_orders',
    'sales_order_items',
    'daily_reconciliations',
    'reconciliation_payment_methods',
    'strike_bonus_awards',
  ]) {
    assert.match(
      businessDataMigration,
      new RegExp(`CREATE TABLE \`${table}\``),
    );
  }

  const roleScopesMigration = readMigration(
    '20260624000100_business_data_role_scopes',
  );
  assert.match(roleScopesMigration, /ADD COLUMN `taster_id`/);
  assert.match(roleScopesMigration, /ADD COLUMN `sales_user_id`/);
  assert.match(roleScopesMigration, /sales_orders_sales_user_id_fkey/);

  const financeMarksMigration = readMigration(
    '20260624000200_business_data_finance_marks',
  );
  assert.match(financeMarksMigration, /ADD COLUMN `finance_mark`/);
  assert.match(financeMarksMigration, /ADD COLUMN `marked_by`/);
  assert.match(financeMarksMigration, /ADD COLUMN `marked_at`/);
  assert.match(financeMarksMigration, /sales_orders_marked_by_fkey/);

  const guidesMigration = readMigration('20260627000100_add_guides');
  assert.match(guidesMigration, /CREATE TABLE `guides`/);
  assert.match(guidesMigration, /UNIQUE INDEX `guides_phone_key`/);
  assert.match(guidesMigration, /INDEX `guides_name_idx`/);
  assert.match(guidesMigration, /INDEX `guides_travel_agency_idx`/);
  assert.match(guidesMigration, /INDEX `guides_is_active_idx`/);

  const phase3SchemaMigration = readMigration(
    '20260627000200_travel_group_phase3_schema',
  );
  assert.match(phase3SchemaMigration, /ADD COLUMN `guide_id`/);
  assert.match(phase3SchemaMigration, /ADD COLUMN `taster_summary`/);
  assert.match(phase3SchemaMigration, /ADD COLUMN `taster_summary_at`/);
  assert.match(phase3SchemaMigration, /ADD COLUMN `post_mark_edited_at`/);
  assert.match(phase3SchemaMigration, /ADD COLUMN `post_mark_edited_by_id`/);
  assert.match(
    phase3SchemaMigration,
    /CREATE TABLE `travel_group_tasting_items`/,
  );
  assert.match(phase3SchemaMigration, /travel_groups_guide_id_fkey/);
  assert.match(
    phase3SchemaMigration,
    /travel_group_tasting_items_travel_group_id_fkey/,
  );

  const travelAgenciesMigration = readMigration(
    '20260629000100_add_travel_agencies',
  );
  assert.match(travelAgenciesMigration, /CREATE TABLE `travel_agencies`/);
  assert.match(travelAgenciesMigration, /`contact_name` VARCHAR\(80\) NULL/);
  assert.match(travelAgenciesMigration, /`contact_phone` VARCHAR\(30\) NULL/);
  assert.match(
    travelAgenciesMigration,
    /UNIQUE INDEX `travel_agencies_name_key`/,
  );
  assert.match(
    travelAgenciesMigration,
    /INDEX `travel_agencies_contact_phone_idx`/,
  );

  const guideAgencyOptionalMigration = readMigration(
    '20260629000200_make_guide_travel_agency_optional',
  );
  assert.match(
    guideAgencyOptionalMigration,
    /MODIFY `travel_agency` VARCHAR\(120\) NULL/,
  );

  const customersMigration = readMigration('20260629000300_add_customers');
  assert.match(customersMigration, /CREATE TABLE `customers`/);
  assert.match(customersMigration, /`phone` VARCHAR\(30\) NULL/);
  assert.match(customersMigration, /INDEX `customers_name_idx`/);
  assert.match(customersMigration, /INDEX `customers_phone_idx`/);
  assert.match(customersMigration, /INDEX `customers_finance_mark_idx`/);
  assert.match(customersMigration, /INDEX `customers_created_by_id_idx`/);
  assert.match(customersMigration, /INDEX `customers_updated_at_idx`/);
  assert.doesNotMatch(customersMigration, /UNIQUE INDEX `customers_phone/);
  assert.match(customersMigration, /customers_marked_by_fkey/);

  const salesOrderPhase4Migration = readMigration(
    '20260629000400_sales_order_phase4_schema',
  );
  assert.match(salesOrderPhase4Migration, /ADD COLUMN `customer_id`/);
  assert.match(salesOrderPhase4Migration, /ADD COLUMN `sales_form_no`/);
  assert.match(salesOrderPhase4Migration, /ADD COLUMN `packing_status`/);
  assert.match(salesOrderPhase4Migration, /DEFAULT 'packed'/);
  assert.match(salesOrderPhase4Migration, /ADD COLUMN `logistics_no`/);
  assert.match(salesOrderPhase4Migration, /ADD COLUMN `invoice_required`/);
  assert.match(salesOrderPhase4Migration, /ADD COLUMN `finance_remark`/);
  assert.match(salesOrderPhase4Migration, /ADD COLUMN `subtotal_cents`/);
  assert.match(salesOrderPhase4Migration, /ADD COLUMN `notes`/);
  assert.match(salesOrderPhase4Migration, /ADD COLUMN `sort_order`/);
  assert.match(
    salesOrderPhase4Migration,
    /`subtotal_cents` = `quantity` \* `unit_price_cents`/,
  );
  assert.match(salesOrderPhase4Migration, /`packing_status` = 'pending'/);
  assert.match(salesOrderPhase4Migration, /sales_orders_customer_id_idx/);
  assert.match(salesOrderPhase4Migration, /sales_orders_packing_status_idx/);
  assert.match(salesOrderPhase4Migration, /sales_orders_logistics_no_idx/);
  assert.match(
    salesOrderPhase4Migration,
    /sales_order_items_sales_order_id_sort_order_idx/,
  );
  assert.match(salesOrderPhase4Migration, /sales_orders_customer_id_fkey/);

  const salesOrderQrCodeMigration = readMigration(
    '20260701000100_sales_order_qr_code_fields',
  );
  assert.match(
    salesOrderQrCodeMigration,
    /ADD COLUMN `qr_code_token` VARCHAR\(80\) NULL/,
  );
  assert.match(
    salesOrderQrCodeMigration,
    /ADD COLUMN `qr_code_generated_at` DATETIME\(0\) NULL/,
  );
  assert.match(
    salesOrderQrCodeMigration,
    /ADD COLUMN `qr_code_expires_at` DATETIME\(0\) NULL/,
  );
  assert.doesNotMatch(
    salesOrderQrCodeMigration,
    /`qr_code_token` VARCHAR\(80\) NOT NULL/,
  );
  assert.match(
    salesOrderQrCodeMigration,
    /UNIQUE INDEX `sales_orders_qr_code_token_key`/,
  );
  assert.match(
    salesOrderQrCodeMigration,
    /INDEX `sales_orders_qr_code_expires_at_idx`/,
  );
});
