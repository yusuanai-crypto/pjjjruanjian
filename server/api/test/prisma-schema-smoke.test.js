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

function readAllMigrationSql() {
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readMigration(entry.name))
    .join('\n');
}

function extractPrismaBlock(source, header) {
  const start = source.indexOf(header);
  assert.notEqual(start, -1, `${header} should exist in Prisma schema`);
  const end = source.indexOf('\n}', start);
  assert.notEqual(end, -1, `${header} should have a closing brace`);
  return source.slice(start, end + 2);
}

function assertBlockHasFields(block, fields) {
  for (const field of fields) {
    assert.match(block, new RegExp(`\\b${field}\\b`));
  }
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
    'AfterSalesOrder',
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
    'qrCodeTokenHash',
    'qrCodeGeneratedAt',
    'qrCodeExpiresAt',
    'qrCodeRevokedAt',
    'afterSalesNo',
    'issueType',
    'actionType',
    'refundAmountCents',
    'financeConfirmed',
    'financeConfirmedById',
    'financeConfirmedAt',
    'handledById',
    'handledAt',
    'completedAt',
  ]) {
    assert.match(schema, new RegExp(`\\b${field}\\b`));
  }

  assert.match(
    schema,
    /qrCodeTokenHash\s+String\?\s+@unique\s+@map\("qr_code_token_hash"\)\s+@db\.Char\(64\)/,
  );
  assert.match(
    schema,
    /qrCodeGeneratedAt\s+DateTime\?\s+@map\("qr_code_generated_at"\)\s+@db\.DateTime\(0\)/,
  );
  assert.match(
    schema,
    /qrCodeExpiresAt\s+DateTime\?\s+@map\("qr_code_expires_at"\)\s+@db\.DateTime\(0\)/,
  );
  assert.match(
    schema,
    /qrCodeRevokedAt\s+DateTime\?\s+@map\("qr_code_revoked_at"\)\s+@db\.DateTime\(0\)/,
  );
  assert.match(schema, /@@index\(\[qrCodeExpiresAt\]\)/);

  assert.match(schema, /enum SalesOrderPackingStatus \{/);
  assert.match(schema, /enum AfterSalesIssueType \{/);
  assert.match(schema, /enum AfterSalesActionType \{/);
  assert.match(schema, /enum AfterSalesStatus \{/);
  assert.match(
    schema,
    /afterSalesNo\s+String\s+@unique\s+@map\("after_sales_no"\)\s+@db\.VarChar\(80\)/,
  );
  assert.match(
    schema,
    /salesOrder\s+SalesOrder\s+@relation\(fields: \[salesOrderId\], references: \[id\], onDelete: Restrict\)/,
  );
  for (const index of [
    'salesOrderId',
    'customerId',
    'status',
    'issueType',
    'actionType',
    'financeConfirmed',
    'createdAt',
    'handledById',
  ]) {
    assert.match(schema, new RegExp(`@@index\\(\\[${index}\\]\\)`));
  }
  assert.match(schema, /@@index\(\[status, createdAt\]\)/);
  assert.match(schema, /@@index\(\[financeConfirmed, createdAt\]\)/);
  assert.doesNotMatch(
    schema,
    /\b(shippedAt|shippedById|shipped_at|shipped_by_id)\b/,
  );
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
        '20260702000100_after_sales_orders',
        'migration.sql',
      ),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(
        migrationsDir,
        '20260717000200_after_sales_warehouse_refund_proofs',
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

  const securePublicSalesSheetMigration = readMigration(
    '20260720000300_public_sales_sheet_capabilities',
  );
  assert.match(
    securePublicSalesSheetMigration,
    /ADD COLUMN `qr_code_token_hash` CHAR\(64\) NULL/,
  );
  assert.match(
    securePublicSalesSheetMigration,
    /ADD COLUMN `qr_code_revoked_at` DATETIME\(0\) NULL/,
  );
  assert.match(securePublicSalesSheetMigration, /SHA2\(`qr_code_token`, 256\)/);
  assert.match(
    securePublicSalesSheetMigration,
    /DROP COLUMN `qr_code_token`/,
  );
  assert.match(
    securePublicSalesSheetMigration,
    /sales_orders_qr_code_token_hash_key/,
  );

  const afterSalesOrdersMigration = readMigration(
    '20260702000100_after_sales_orders',
  );
  assert.match(
    afterSalesOrdersMigration,
    /CREATE TABLE `after_sales_orders`/,
  );
  assert.match(
    afterSalesOrdersMigration,
    /UNIQUE INDEX `after_sales_orders_after_sales_no_key`/,
  );
  for (const indexName of [
    'after_sales_orders_sales_order_id_idx',
    'after_sales_orders_customer_id_idx',
    'after_sales_orders_status_idx',
    'after_sales_orders_issue_type_idx',
    'after_sales_orders_action_type_idx',
    'after_sales_orders_finance_confirmed_idx',
    'after_sales_orders_created_at_idx',
    'after_sales_orders_handled_by_id_idx',
    'after_sales_orders_status_created_at_idx',
    'after_sales_orders_finance_confirmed_created_at_idx',
  ]) {
    assert.match(afterSalesOrdersMigration, new RegExp(indexName));
  }
  assert.match(
    afterSalesOrdersMigration,
    /after_sales_orders_sales_order_id_fkey/,
  );
  assert.match(
    afterSalesOrdersMigration,
    /FOREIGN KEY \(`sales_order_id`\) REFERENCES `sales_orders`\(`id`\) ON DELETE RESTRICT ON UPDATE CASCADE/,
  );
  assert.match(
    afterSalesOrdersMigration,
    /after_sales_orders_customer_id_fkey/,
  );
  assert.match(
    afterSalesOrdersMigration,
    /after_sales_orders_finance_confirmed_by_id_fkey/,
  );
  assert.match(
    afterSalesOrdersMigration,
    /after_sales_orders_handled_by_id_fkey/,
  );
  assert.match(
    afterSalesOrdersMigration,
    /after_sales_orders_created_by_id_fkey/,
  );
  assert.match(
    afterSalesOrdersMigration,
    /after_sales_orders_updated_by_id_fkey/,
  );
  const afterSalesProofMigration = readMigration(
    '20260717000200_after_sales_warehouse_refund_proofs',
  );
  for (const columnName of [
    'warehouse_confirmed_by_id',
    'warehouse_confirmed_at',
    'warehouse_confirm_note',
    'refund_proof_attachments',
  ]) {
    assert.match(afterSalesProofMigration, new RegExp(columnName));
  }
  for (const indexName of [
    'after_sales_orders_warehouse_confirmed_by_id_idx',
    'after_sales_orders_warehouse_confirmed_at_idx',
    'after_sales_orders_status_warehouse_confirmed_at_idx',
  ]) {
    assert.match(afterSalesProofMigration, new RegExp(indexName));
  }
  assert.match(
    afterSalesProofMigration,
    /after_sales_orders_warehouse_confirmed_by_id_fkey/,
  );
  assert.doesNotMatch(readAllMigrationSql(), /shipped_at|shipped_by_id/i);
});

test('smoke: Prisma schema exposes stage 7 commission models, enums, and relations', () => {
  const schema = readPrismaFile('schema.prisma');

  for (const model of [
    'AgencyDeductionRule',
    'AgencyRebateRule',
    'SalesDeductionRule',
    'CommissionRule',
    'CommissionRecord',
    'TravelGroupFinanceSummary',
  ]) {
    assert.match(schema, new RegExp(`model ${model} \\{`));
  }

  const commissionRuleTargetType = extractPrismaBlock(
    schema,
    'enum CommissionRuleTargetType {',
  );
  for (const enumValue of [
    'SALES_COMMISSION    @map("sales_commission")',
    'OUTREACH_COMMISSION @map("outreach_commission")',
    'LEADER_COMMISSION   @map("leader_commission")',
    '@@map("commission_rule_target_type")',
  ]) {
    assert.match(commissionRuleTargetType, new RegExp(escapeRegExp(enumValue)));
  }

  const commissionTargetType = extractPrismaBlock(
    schema,
    'enum CommissionTargetType {',
  );
  for (const enumValue of [
    'SALES_COMMISSION      @map("sales_commission")',
    'OUTREACH_COMMISSION   @map("outreach_commission")',
    'LEADER_COMMISSION     @map("leader_commission")',
    'TASTER_COMMISSION     @map("taster_commission")',
    'AGENCY_DAILY_REBATE   @map("agency_daily_rebate")',
    'AGENCY_MONTHLY_REBATE @map("agency_monthly_rebate")',
    '@@map("commission_target_type")',
  ]) {
    assert.match(commissionTargetType, new RegExp(escapeRegExp(enumValue)));
  }

  const user = extractPrismaBlock(schema, 'model User {');
  assertBlockHasFields(user, [
    'leaderId',
    'leader',
    'members',
    'outreachSalesOrders',
    'createdAgencyDeductionRules',
    'updatedAgencyDeductionRules',
    'createdAgencyRebateRules',
    'updatedAgencyRebateRules',
    'createdSalesDeductionRules',
    'updatedSalesDeductionRules',
    'createdCommissionRules',
    'updatedCommissionRules',
    'targetCommissionRecords',
    'confirmedCommissionRecords',
    'createdCommissionRecords',
    'updatedCommissionRecords',
    'confirmedTravelGroupSummaries',
    'updatedTravelGroupSummaries',
  ]);
  assert.match(
    user,
    /leader\s+User\?\s+@relation\("UserLeader", fields: \[leaderId\], references: \[id\], onDelete: SetNull\)/,
  );
  assert.match(user, /@@index\(\[leaderId\]\)/);

  const travelAgency = extractPrismaBlock(schema, 'model TravelAgency {');
  assertBlockHasFields(travelAgency, [
    'agencyDeductionRules',
    'agencyRebateRules',
    'commissionRecords',
  ]);

  const travelGroup = extractPrismaBlock(schema, 'model TravelGroup {');
  assertBlockHasFields(travelGroup, [
    'tasterId',
    'travelAgency',
    'financeMark',
    'points',
    'returnedPoints',
    'unreturnedPoints',
    'liquorCostDeductionCents',
    'orderAmountCents',
    'commissionRecords',
    'financeSummary',
  ]);

  const salesOrder = extractPrismaBlock(schema, 'model SalesOrder {');
  assertBlockHasFields(salesOrder, [
    'salesUserId',
    'outreachUserId',
    'travelGroupId',
    'totalAmountCents',
    'status',
    'items',
    'afterSalesOrders',
    'commissionRecords',
  ]);
  assert.match(
    salesOrder,
    /outreachUserId\s+String\?\s+@map\("outreach_user_id"\) @db\.Char\(36\)/,
  );
  assert.match(
    salesOrder,
    /outreachUser\s+User\?\s+@relation\("SalesOrderOutreachUser", fields: \[outreachUserId\], references: \[id\], onDelete: SetNull\)/,
  );
  assert.match(salesOrder, /@@index\(\[outreachUserId\]\)/);

  const afterSalesOrder = extractPrismaBlock(schema, 'model AfterSalesOrder {');
  assertBlockHasFields(afterSalesOrder, [
    'refundAmountCents',
    'financeConfirmed',
    'financeConfirmedById',
    'financeConfirmedAt',
    'commissionRecords',
  ]);

  const agencyDeductionRule = extractPrismaBlock(
    schema,
    'model AgencyDeductionRule {',
  );
  assertBlockHasFields(agencyDeductionRule, [
    'agencyId',
    'agencyName',
    'calculationMode',
    'deductionRate',
    'productName',
    'deductionCostCents',
    'effectiveFrom',
    'effectiveTo',
    'isActive',
    'createdById',
    'updatedById',
  ]);
  assert.match(
    agencyDeductionRule,
    /agency\s+TravelAgency\?\s+@relation\(fields: \[agencyId\], references: \[id\], onDelete: SetNull\)/,
  );
  assert.match(
    agencyDeductionRule,
    /@@index\(\[agencyId, productName, isActive, effectiveFrom\]/,
  );
  assert.match(
    agencyDeductionRule,
    /@@index\(\[agencyName, productName, isActive, effectiveFrom\]/,
  );
  assert.match(
    agencyDeductionRule,
    /@@index\(\[agencyId, calculationMode, isActive, effectiveFrom\]/,
  );
  assert.match(
    agencyDeductionRule,
    /@@index\(\[agencyName, calculationMode, isActive, effectiveFrom\]/,
  );
  assert.match(agencyDeductionRule, /@@map\("agency_deduction_rules"\)/);

  const agencyRebateRule = extractPrismaBlock(
    schema,
    'model AgencyRebateRule {',
  );
  assertBlockHasFields(agencyRebateRule, [
    'agencyId',
    'agencyName',
    'dailyRebateRate',
    'monthlyRebateRate',
    'totalRebateRate',
    'effectiveFrom',
    'effectiveTo',
    'isActive',
    'createdById',
    'updatedById',
    'commissionRecords',
  ]);
  assert.match(
    agencyRebateRule,
    /dailyRebateRate\s+Decimal\s+@default\(0\) @map\("daily_rebate_rate"\) @db\.Decimal\(10, 4\)/,
  );
  assert.match(
    agencyRebateRule,
    /monthlyRebateRate\s+Decimal\s+@default\(0\) @map\("monthly_rebate_rate"\) @db\.Decimal\(10, 4\)/,
  );
  assert.match(agencyRebateRule, /@@index\(\[agencyId, isActive, effectiveFrom\]\)/);
  assert.match(agencyRebateRule, /@@index\(\[agencyName, isActive, effectiveFrom\]\)/);
  assert.match(agencyRebateRule, /@@map\("agency_rebate_rules"\)/);

  const salesDeductionRule = extractPrismaBlock(
    schema,
    'model SalesDeductionRule {',
  );
  assertBlockHasFields(salesDeductionRule, [
    'productName',
    'deductionCostCents',
    'effectiveFrom',
    'effectiveTo',
    'isActive',
    'createdById',
    'updatedById',
  ]);
  assert.match(salesDeductionRule, /@@index\(\[productName, isActive, effectiveFrom\]\)/);
  assert.match(salesDeductionRule, /@@map\("sales_deduction_rules"\)/);

  const commissionRule = extractPrismaBlock(schema, 'model CommissionRule {');
  assertBlockHasFields(commissionRule, [
    'ruleName',
    'targetType',
    'rate',
    'effectiveFrom',
    'effectiveTo',
    'isActive',
    'createdById',
    'updatedById',
    'commissionRecords',
  ]);
  assert.match(
    commissionRule,
    /targetType\s+CommissionRuleTargetType\s+@map\("target_type"\)/,
  );
  assert.match(commissionRule, /@@index\(\[targetType, isActive, effectiveFrom\]\)/);
  assert.match(commissionRule, /@@map\("commission_rules"\)/);

  const commissionRecord = extractPrismaBlock(schema, 'model CommissionRecord {');
  assertBlockHasFields(commissionRecord, [
    'salesOrderId',
    'travelGroupId',
    'afterSalesOrderId',
    'commissionRuleId',
    'agencyRebateRuleId',
    'targetType',
    'targetUserId',
    'agencyId',
    'agencyName',
    'grossAmountCents',
    'confirmedRefundAmountCents',
    'baseAmountCents',
    'deductionAmountCents',
    'rateSnapshot',
    'amountCents',
    'pointsCents',
    'manualInput',
    'isConfirmed',
    'confirmedById',
    'confirmedAt',
    'calculationVersion',
    'calculationNote',
    'ruleSnapshot',
    'sourceSnapshot',
  ]);
  for (const relation of [
    'salesOrder',
    'travelGroup',
    'afterSalesOrder',
    'commissionRule',
    'agencyRebateRule',
    'targetUser',
    'agency',
    'confirmedBy',
  ]) {
    assert.match(
      commissionRecord,
      new RegExp(`${relation}\\s+\\w+\\??\\s+@relation`),
    );
  }
  assert.match(
    commissionRecord,
    /targetType\s+CommissionTargetType\s+@map\("target_type"\)/,
  );
  assert.match(
    commissionRecord,
    /rateSnapshot\s+Decimal\?\s+@map\("rate_snapshot"\) @db\.Decimal\(10, 4\)/,
  );
  assert.match(commissionRecord, /ruleSnapshot\s+Json\?\s+@map\("rule_snapshot"\)/);
  assert.match(commissionRecord, /sourceSnapshot\s+Json\?\s+@map\("source_snapshot"\)/);
  assert.match(commissionRecord, /@@index\(\[targetType, targetUserId, createdAt\]\)/);
  assert.match(commissionRecord, /@@index\(\[travelGroupId, targetType\]\)/);
  assert.match(commissionRecord, /@@map\("commission_records"\)/);

  const summary = extractPrismaBlock(
    schema,
    'model TravelGroupFinanceSummary {',
  );
  assertBlockHasFields(summary, [
    'travelGroupId',
    'totalSalesAmountCents',
    'totalCashOnDeliveryCents',
    'totalPaidDepositCents',
    'confirmedRefundAmountCents',
    'effectiveSalesAmountCents',
    'totalAgencyDeductionCents',
    'agencyDeductionConfirmed',
    'agencyDeductionConfirmedById',
    'agencyDeductionConfirmedAt',
    'totalAgencyNetAmountCents',
    'totalDailyRebateCents',
    'totalMonthlyRebateCents',
    'paidRebateCents',
    'unpaidRebateCents',
    'dailyRebatePaid',
    'dailyRebatePaidById',
    'dailyRebatePaidAt',
    'monthlyRebatePaid',
    'monthlyRebatePaidById',
    'monthlyRebatePaidAt',
    'guideInfoSent',
    'travelAgencyInfoSent',
    'calculationVersion',
    'sourceSnapshot',
    'updatedById',
  ]);
  assert.match(
    summary,
    /travelGroup\s+TravelGroup\s+@relation\(fields: \[travelGroupId\], references: \[id\], onDelete: Cascade\)/,
  );
  assert.match(summary, /travelGroupId\s+String\s+@unique/);
  assert.match(summary, /sourceSnapshot\s+Json\?\s+@map\("source_snapshot"\)/);
  assert.match(summary, /dailyRebatePaidBy\s+User\?\s+@relation/);
  assert.match(summary, /monthlyRebatePaidBy\s+User\?\s+@relation/);
  assert.match(summary, /@@index\(\[agencyDeductionConfirmed\]\)/);
  assert.match(summary, /@@index\(\[dailyRebatePaid\]\)/);
  assert.match(summary, /@@index\(\[monthlyRebatePaid\]\)/);
  assert.match(summary, /@@map\("travel_group_finance_summaries"\)/);
});

test('smoke: phase 7 Prisma migration creates commission tables and traceability columns', () => {
  assert.equal(
    fs.existsSync(
      path.join(
        migrationsDir,
        '20260703000100_stage7_commission_points_schema',
        'migration.sql',
      ),
    ),
    true,
  );

  const migration = readMigration(
    '20260703000100_stage7_commission_points_schema',
  );

  assert.match(
    migration,
    /ADD COLUMN `outreach_user_id` CHAR\(36\) NULL/,
  );
  assert.match(migration, /sales_orders_outreach_user_id_idx/);
  assert.match(migration, /sales_orders_outreach_user_id_fkey/);
  assert.match(
    migration,
    /FOREIGN KEY \(`outreach_user_id`\) REFERENCES `users`\(`id`\) ON DELETE SET NULL ON UPDATE CASCADE/,
  );
  assert.doesNotMatch(
    migration,
    /ADD COLUMN `outreach_user_id` CHAR\(36\) NOT NULL/,
  );

  for (const table of [
    'agency_deduction_rules',
    'agency_rebate_rules',
    'sales_deduction_rules',
    'commission_rules',
    'commission_records',
    'travel_group_finance_summaries',
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE \`${table}\``));
  }

  assert.match(
    migration,
    /`target_type` ENUM\('sales_commission', 'outreach_commission', 'leader_commission'\) NOT NULL/,
  );
  assert.match(
    migration,
    /`target_type` ENUM\('sales_commission', 'outreach_commission', 'leader_commission', 'taster_commission', 'agency_daily_rebate', 'agency_monthly_rebate'\) NOT NULL/,
  );

  for (const column of [
    'sales_order_id',
    'travel_group_id',
    'after_sales_order_id',
    'commission_rule_id',
    'agency_rebate_rule_id',
    'target_user_id',
    'agency_id',
    'agency_name',
    'gross_amount_cents',
    'confirmed_refund_amount_cents',
    'base_amount_cents',
    'deduction_amount_cents',
    'rate_snapshot',
    'amount_cents',
    'points_cents',
    'manual_input',
    'is_confirmed',
    'confirmed_by_id',
    'confirmed_at',
    'calculation_version',
    'calculation_note',
    'rule_snapshot',
    'source_snapshot',
  ]) {
    assert.match(migration, new RegExp(`\`${column}\``));
  }

  assert.match(migration, /`rule_snapshot` JSON NULL/);
  assert.match(migration, /`source_snapshot` JSON NULL/);
  assert.match(
    migration,
    /`rate_snapshot` DECIMAL\(10, 4\) NULL/,
  );

  for (const indexName of [
    'agency_deduction_rules_agency_product_active_from_idx',
    'agency_deduction_rules_name_product_active_from_idx',
    'agency_rebate_rules_agency_id_is_active_effective_from_idx',
    'agency_rebate_rules_agency_name_is_active_effective_from_idx',
    'sales_deduction_rules_product_name_is_active_effective_from_idx',
    'commission_rules_target_type_is_active_effective_from_idx',
    'commission_records_target_type_target_user_id_created_at_idx',
    'commission_records_travel_group_id_target_type_idx',
    'travel_group_finance_summaries_travel_group_id_key',
    'travel_group_finance_summaries_agency_deduction_confirmed_idx',
  ]) {
    assert.match(migration, new RegExp(indexName));
  }

  for (const foreignKey of [
    'agency_deduction_rules_agency_id_fkey',
    'agency_rebate_rules_agency_id_fkey',
    'commission_records_sales_order_id_fkey',
    'commission_records_travel_group_id_fkey',
    'commission_records_after_sales_order_id_fkey',
    'commission_records_commission_rule_id_fkey',
    'commission_records_agency_rebate_rule_id_fkey',
    'commission_records_target_user_id_fkey',
    'commission_records_agency_id_fkey',
    'commission_records_confirmed_by_id_fkey',
    'travel_group_finance_summaries_travel_group_id_fkey',
    'tg_fin_summaries_confirmed_by_id_fkey',
  ]) {
    assert.match(migration, new RegExp(foreignKey));
  }

  assert.match(
    migration,
    /FOREIGN KEY \(`travel_group_id`\) REFERENCES `travel_groups`\(`id`\) ON DELETE CASCADE ON UPDATE CASCADE/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \(`sales_order_id`\) REFERENCES `sales_orders`\(`id`\) ON DELETE SET NULL ON UPDATE CASCADE/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \(`after_sales_order_id`\) REFERENCES `after_sales_orders`\(`id`\) ON DELETE SET NULL ON UPDATE CASCADE/,
  );
});

test('smoke: agency deduction calculation mode migration preserves old product rules', () => {
  const migrationName = '20260717000100_agency_deduction_calculation_mode';
  assert.equal(
    fs.existsSync(path.join(migrationsDir, migrationName, 'migration.sql')),
    true,
  );
  const migration = readMigration(migrationName);

  assert.match(
    migration,
    /ADD COLUMN `calculation_mode` VARCHAR\(40\) NOT NULL DEFAULT 'manual_product_reference'/,
  );
  assert.match(
    migration,
    /ADD COLUMN `deduction_rate` DECIMAL\(10, 4\) NOT NULL DEFAULT 0\.3000/,
  );
  assert.match(
    migration,
    /SET `calculation_mode` = 'manual_product_reference'/,
  );
  assert.match(migration, /agency_deduction_rules_agency_mode_active_from_idx/);
  assert.match(migration, /agency_deduction_rules_name_mode_active_from_idx/);
});

test('smoke: TravelGroup exposes optional intake fields and liaison taster relation', () => {
  const schema = readPrismaFile('schema.prisma');
  const user = extractPrismaBlock(schema, 'model User {');
  const travelGroup = extractPrismaBlock(schema, 'model TravelGroup {');

  for (const field of [
    ['sourceRegion', 'String\\?', 'source_region', '@db\\.VarChar\\(120\\)'],
    ['ageInfo', 'String\\?', 'age_info', '@db\\.VarChar\\(120\\)'],
    ['mentionedFeitian', 'Boolean\\?', 'mentioned_feitian', ''],
    [
      'previousStopOrderStatus',
      'String\\?',
      'previous_stop_order_status',
      '@db\\.VarChar\\(255\\)',
    ],
    ['keyCustomerInfo', 'String\\?', 'key_customer_info', '@db\\.Text'],
    ['keyCustomerPhotos', 'Json\\?', 'key_customer_photos', ''],
    ['guestInfoAttachments', 'Json\\?', 'guest_info_attachments', ''],
    ['liaisonTasterId', 'String\\?', 'liaison_taster_id', '@db\\.Char\\(36\\)'],
    [
      'liaisonTasterName',
      'String\\?',
      'liaison_taster_name',
      '@db\\.VarChar\\(80\\)',
    ],
    [
      'expectedArrivalTime',
      'String\\?',
      'expected_arrival_time',
      '@db\\.VarChar\\(30\\)',
    ],
  ]) {
    assert.match(
      travelGroup,
      new RegExp(
        `${field[0]}\\s+${field[1]}\\s+@map\\("${field[2]}"\\)${
          field[3] ? `\\s+${field[3]}` : ''
        }`,
      ),
    );
  }

  assert.match(
    travelGroup,
    /liaisonTaster\s+User\?\s+@relation\("TravelGroupLiaisonTaster", fields: \[liaisonTasterId\], references: \[id\], onDelete: SetNull\)/,
  );
  assert.match(travelGroup, /@@index\(\[liaisonTasterId\]\)/);
  assert.match(
    user,
    /liaisonTasterTravelGroups\s+TravelGroup\[\]\s+@relation\("TravelGroupLiaisonTaster"\)/,
  );
});

test('smoke: travel group intake migration is additive and nullable', () => {
  const migrationName = '20260714000100_add_travel_group_intake_fields';
  assert.equal(
    fs.existsSync(path.join(migrationsDir, migrationName, 'migration.sql')),
    true,
  );

  const migration = readMigration(migrationName);
  for (const column of [
    ['source_region', 'VARCHAR\\(120\\)'],
    ['age_info', 'VARCHAR\\(120\\)'],
    ['mentioned_feitian', 'BOOLEAN'],
    ['previous_stop_order_status', 'VARCHAR\\(255\\)'],
    ['key_customer_info', 'TEXT'],
    ['key_customer_photos', 'JSON'],
    ['guest_info_attachments', 'JSON'],
    ['liaison_taster_id', 'CHAR\\(36\\)'],
    ['liaison_taster_name', 'VARCHAR\\(80\\)'],
    ['expected_arrival_time', 'VARCHAR\\(30\\)'],
  ]) {
    assert.match(
      migration,
      new RegExp('ADD COLUMN `' + column[0] + '` ' + column[1] + ' NULL'),
    );
  }

  assert.equal((migration.match(/ADD COLUMN/g) || []).length, 10);
  assert.match(migration, /travel_groups_liaison_taster_id_idx/);
  assert.match(migration, /travel_groups_liaison_taster_id_fkey/);
  assert.match(
    migration,
    /FOREIGN KEY \(`liaison_taster_id`\) REFERENCES `users`\(`id`\) ON DELETE SET NULL ON UPDATE CASCADE/,
  );
  assert.doesNotMatch(
    migration,
    /\bDROP\b|\bTRUNCATE\b|DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+`|CREATE\s+TABLE/i,
  );
});

test('smoke: order-level taster commissions have a duplicate-safe unique migration', () => {
  const schema = readPrismaFile('schema.prisma');
  const commissionRecord = extractPrismaBlock(
    schema,
    'model CommissionRecord {',
  );
  assert.match(
    commissionRecord,
    /@@unique\(\[salesOrderId, targetType, targetUserId, manualInput\], map: "commission_records_order_target_user_manual_key"\)/,
  );

  const migrationName =
    '20260724000300_order_taster_commission_uniqueness';
  assert.equal(
    fs.existsSync(path.join(migrationsDir, migrationName, 'migration.sql')),
    true,
  );
  const migration = readMigration(migrationName);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX `commission_records_order_target_user_manual_key`/,
  );
  assert.match(migration, /`legacy`\.`sales_order_id` IS NULL/);
  assert.match(migration, /`other_order`\.`id` IS NULL/);
  assert.match(migration, /`other_legacy`\.`id` IS NULL/);
  assert.doesNotMatch(migration, /\b(DELETE|DROP TABLE|TRUNCATE)\b/i);

  const preflight = fs.readFileSync(
    path.resolve(
      __dirname,
      '..',
      'scripts',
      'preflight-order-taster-commission-migration.sql',
    ),
    'utf8',
  );
  assert.match(preflight, /HAVING COUNT\(\*\) > 1/);
  assert.match(preflight, /effective_order_count/);
  assert.match(preflight, /candidate_sales_order_ids/);
  assert.doesNotMatch(preflight, /\b(UPDATE|DELETE|INSERT|ALTER)\b/i);
});

test('smoke: travel groups persist parking snapshots and nullable cigarette fees', () => {
  const schema = readPrismaFile('schema.prisma');
  const travelGroup = extractPrismaBlock(schema, 'model TravelGroup {');
  assert.match(
    travelGroup,
    /parkingFeeCents\s+Int\s+@default\(500\)\s+@map\("parking_fee_cents"\)/,
  );
  assert.match(
    travelGroup,
    /cigaretteFeeCents\s+Int\?\s+@map\("cigarette_fee_cents"\)/,
  );
  assert.doesNotMatch(
    travelGroup,
    /@@index\(\[(?:parkingFeeCents|cigaretteFeeCents)\]\)/,
  );

  const migrationName =
    '20260724000400_travel_group_parking_cigarette_fees';
  assert.equal(
    fs.existsSync(path.join(migrationsDir, migrationName, 'migration.sql')),
    true,
  );
  const migration = readMigration(migrationName);
  assert.match(
    migration,
    /`parking_fee_cents` INTEGER NOT NULL DEFAULT 500/,
  );
  assert.match(migration, /`cigarette_fee_cents` INTEGER NULL/);
  assert.doesNotMatch(migration, /cigarette_fee_cents[^;]*DEFAULT 0/i);
  assert.doesNotMatch(migration, /CREATE (?:UNIQUE )?INDEX/i);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
