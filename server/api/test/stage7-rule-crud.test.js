const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertErrorContract,
  assertOperationLogContract,
  createUser,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

test('contract: stage7 rule CRUD enforces role permissions', async () => {
  await withPhase1Server(async (baseUrl) => {
    const missingToken = await requestJson(baseUrl, '/api/commission-rules');
    assertErrorContract(missingToken, 401, 'AUTH_TOKEN_REQUIRED');

    const admin = await login(baseUrl);
    await createUser(baseUrl, admin.token, {
      name: 'Stage7 Test Finance',
      username: 'stage7-rule-finance',
      password: 'Password123',
      role: 'finance',
    });
    await createUser(baseUrl, admin.token, {
      name: 'Stage7 Test Boss',
      username: 'stage7-rule-boss',
      password: 'Password123',
      role: 'boss',
    });
    await createUser(baseUrl, admin.token, {
      name: 'Stage7 Test Sales',
      username: 'stage7-rule-sales',
      password: 'Password123',
      role: 'sales',
    });
    await createUser(baseUrl, admin.token, {
      name: 'Stage7 Test Warehouse',
      username: 'stage7-rule-warehouse',
      password: 'Password123',
      role: 'warehouse',
    });
    await createUser(baseUrl, admin.token, {
      name: 'Stage7 Test After Sales',
      username: 'stage7-rule-after-sales',
      password: 'Password123',
      role: 'after_sales',
    });
    await createUser(baseUrl, admin.token, {
      name: 'Stage7 Test Front Desk',
      username: 'stage7-rule-front-desk',
      password: 'Password123',
      role: 'front_desk',
    });
    await createUser(baseUrl, admin.token, {
      name: 'Stage7 Test Taster',
      username: 'stage7-rule-taster',
      password: 'Password123',
      role: 'taster',
    });

    const finance = await login(
      baseUrl,
      'stage7-rule-finance',
      'Password123',
    );
    const boss = await login(baseUrl, 'stage7-rule-boss', 'Password123');
    const sales = await login(baseUrl, 'stage7-rule-sales', 'Password123');
    const warehouse = await login(
      baseUrl,
      'stage7-rule-warehouse',
      'Password123',
    );
    const afterSales = await login(
      baseUrl,
      'stage7-rule-after-sales',
      'Password123',
    );
    const frontDesk = await login(
      baseUrl,
      'stage7-rule-front-desk',
      'Password123',
    );
    const taster = await login(baseUrl, 'stage7-rule-taster', 'Password123');

    const created = await requestJson(baseUrl, '/api/commission-rules', {
      method: 'POST',
      token: admin.token,
      body: {
        ruleName: 'stage7 test sales commission rule',
        targetType: 'sales_commission',
        rate: '0.0200',
        effectiveFrom: '2026-07-01',
        notes: 'stage7 test permission create',
      },
    });
    assert.equal(created.response.status, 201);
    assertCommissionRuleContract(
      created.body.data.commissionRule,
      created.body.data.recalculation,
    );
    assert.equal(created.body.data.commissionRule.targetType, 'sales_commission');
    assert.equal(created.body.data.commissionRule.rate, '0.0200');

    const financeCreated = await requestJson(baseUrl, '/api/commission-rules', {
      method: 'POST',
      token: finance.token,
      body: {
        ruleName: 'stage7 test outreach commission rule',
        targetType: 'outreach_commission',
        rate: '0.0080',
        effectiveFrom: '2026-07-01',
        notes: 'stage7 test finance create',
      },
    });
    assert.equal(financeCreated.response.status, 201);

    const bossList = await requestJson(baseUrl, '/api/commission-rules', {
      token: boss.token,
    });
    assert.equal(bossList.response.status, 200);
    assert.equal(bossList.body.data.commissionRules.length, 2);

    const generalRuleReadRoutes = [
      '/api/commission-rules',
      '/api/agency-rebate-rules',
    ];
    const deductionRuleReadRoutes = [
      '/api/sales-deduction-rules',
      '/api/agency-deduction-rules',
    ];
    const readAllowed = [admin, finance, boss];
    const readDenied = [sales, warehouse, afterSales, frontDesk, taster];
    for (const route of generalRuleReadRoutes) {
      for (const session of readAllowed) {
        const allowed = await requestJson(baseUrl, route, {
          token: session.token,
        });
        assert.equal(allowed.response.status, 200);
      }
      for (const session of readDenied) {
        const denied = await requestJson(baseUrl, route, {
          token: session.token,
        });
        assertErrorContract(denied, 403, 'PERMISSION_DENIED');
      }
    }
    for (const route of deductionRuleReadRoutes) {
      for (const session of [admin, finance]) {
        const allowed = await requestJson(baseUrl, route, {
          token: session.token,
        });
        assert.equal(allowed.response.status, 200);
      }
      for (const session of [boss, ...readDenied]) {
        const denied = await requestJson(baseUrl, route, {
          token: session.token,
        });
        assertErrorContract(denied, 403, 'PERMISSION_DENIED');
      }
    }

    const bossPatch = await requestJson(
      baseUrl,
      `/api/commission-rules/${created.body.data.commissionRule.id}`,
      {
        method: 'PATCH',
        token: boss.token,
        body: {
          notes: 'stage7 test boss should not update',
        },
      },
    );
    assertErrorContract(bossPatch, 403, 'PERMISSION_DENIED');

    const writeDenied = [boss, sales, warehouse, afterSales, frontDesk, taster];
    const ruleWriteRoutes = [
      {
        route: '/api/commission-rules',
        body: {
          ruleName: 'stage7 test denied commission rule',
          targetType: 'leader_commission',
          rate: '0.0010',
          effectiveFrom: '2040-01-01',
        },
      },
      {
        route: '/api/sales-deduction-rules',
        body: {
          productName: 'Stage7 Test Denied Sales Wine',
          deductionCostCents: 100,
          effectiveFrom: '2040-01-01',
        },
      },
      {
        route: '/api/agency-deduction-rules',
        body: {
          agencyName: 'Stage7 Test Denied Deduction Agency',
          productName: 'Stage7 Test Denied Agency Wine',
          deductionCostCents: 100,
          effectiveFrom: '2040-01-01',
        },
      },
      {
        route: '/api/agency-rebate-rules',
        body: {
          agencyName: 'Stage7 Test Denied Rebate Agency',
          dailyRebateRate: '0.0100',
          monthlyRebateRate: '0.0100',
          totalRebateRate: '0.0200',
          effectiveFrom: '2040-01-01',
        },
      },
    ];
    for (const session of writeDenied) {
      for (const ruleCase of ruleWriteRoutes) {
        const deniedCreate = await requestJson(baseUrl, ruleCase.route, {
          method: 'POST',
          token: session.token,
          body: ruleCase.body,
        });
        assertErrorContract(deniedCreate, 403, 'PERMISSION_DENIED');

        const deniedPatch = await requestJson(
          baseUrl,
          `${ruleCase.route}/stage7-denied-rule-id`,
          {
            method: 'PATCH',
            token: session.token,
            body: {
              notes: 'stage7 test denied patch',
            },
          },
        );
        assertErrorContract(deniedPatch, 403, 'PERMISSION_DENIED');
      }
    }

    const batchImportWriteRoutes = [
      {
        route: '/api/sales-deduction-rules/batch-import',
        body: {
          rules: [
            {
              productName: 'Stage7 Test Denied Batch Sales Wine',
              deductionCostCents: 100,
              effectiveFrom: '2040-01-01',
            },
          ],
        },
      },
      {
        route: '/api/agency-deduction-rules/batch-import',
        body: {
          rules: [
            {
              agencyName: 'Stage7 Test Denied Batch Deduction Agency',
              productName: 'Stage7 Test Denied Batch Agency Wine',
              deductionCostCents: 100,
              effectiveFrom: '2040-01-01',
            },
          ],
        },
      },
      {
        route: '/api/agency-rebate-rules/batch-import',
        body: {
          rules: [
            {
              agencyName: 'Stage7 Test Denied Batch Rebate Agency',
              dailyRebateRate: '0.0100',
              monthlyRebateRate: '0.0100',
              totalRebateRate: '0.0200',
              effectiveFrom: '2040-01-01',
            },
          ],
        },
      },
    ];
    for (const session of writeDenied) {
      for (const batchCase of batchImportWriteRoutes) {
        const denied = await requestJson(baseUrl, batchCase.route, {
          method: 'POST',
          token: session.token,
          body: batchCase.body,
        });
        assertErrorContract(denied, 403, 'PERMISSION_DENIED');
      }
    }

    const financePatch = await requestJson(baseUrl, '/api/commission-rules', {
      method: 'PATCH',
      token: finance.token,
      body: {
        id: created.body.data.commissionRule.id,
        notes: 'stage7 test finance collection patch',
      },
    });
    assert.equal(financePatch.response.status, 200);
    assert.equal(
      financePatch.body.data.commissionRule.notes,
      'stage7 test finance collection patch',
    );
  });
});

test('contract: stage7 rule CRUD validates fields', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const costProduct = await createRuleTestProduct(
      baseUrl,
      admin.token,
      'stage7 test wine',
    );
    const invalidRangeProduct = await createRuleTestProduct(
      baseUrl,
      admin.token,
      'stage7 test wine invalid range',
    );
    const trimmedProductFixture = await createRuleTestProduct(
      baseUrl,
      admin.token,
      '  Stage7 Smoke Trimmed Wine  ',
    );

    const negativeRate = await requestJson(baseUrl, '/api/commission-rules', {
      method: 'POST',
      token: admin.token,
      body: {
        ruleName: 'stage7 test negative rate',
        targetType: 'sales_commission',
        rate: '-0.0100',
        effectiveFrom: '2026-07-01',
      },
    });
    assertErrorContract(negativeRate, 400, 'VALIDATION_FAILED');

    const negativeCost = await requestJson(
      baseUrl,
      '/api/sales-deduction-rules',
      {
        method: 'POST',
        token: admin.token,
        body: {
          productId: costProduct.id,
          deductionCostCents: -1,
          effectiveFrom: '2026-07-01',
        },
      },
    );
    assertErrorContract(negativeCost, 400, 'VALIDATION_FAILED');

    const invalidRange = await requestJson(
      baseUrl,
      '/api/sales-deduction-rules',
      {
        method: 'POST',
        token: admin.token,
        body: {
          productId: invalidRangeProduct.id,
          deductionCostCents: 100,
          effectiveFrom: '2026-08-01',
          effectiveTo: '2026-07-31',
        },
      },
    );
    assertErrorContract(invalidRange, 400, 'VALIDATION_FAILED');

    const missingAgency = await requestJson(
      baseUrl,
      '/api/agency-rebate-rules',
      {
        method: 'POST',
        token: admin.token,
        body: {
          dailyRebateRate: '0.0300',
          monthlyRebateRate: '0.0200',
          effectiveFrom: '2026-07-01',
          notes: 'stage7 test missing agency',
        },
      },
    );
    assertErrorContract(missingAgency, 400, 'AGENCY_ID_REQUIRED');

    const blankProduct = await requestJson(
      baseUrl,
      '/api/agency-deduction-rules',
      {
        method: 'POST',
        token: admin.token,
        body: {
          agencyName: 'Stage7 Test Agency',
          deductionCostCents: 100,
          effectiveFrom: '2026-07-01',
        },
      },
    );
    assertErrorContract(blankProduct, 400, 'VALIDATION_FAILED');

    const effectiveRateWithoutProduct = await requestJson(
      baseUrl,
      '/api/agency-deduction-rules',
      {
        method: 'POST',
        token: admin.token,
        body: {
          agencyName: 'Stage7 Test Effective Rate Agency',
          calculationMode: 'effective_sales_rate',
          effectiveFrom: '2026-07-01',
        },
      },
    );
    assert.equal(effectiveRateWithoutProduct.response.status, 201);
    assert.equal(
      effectiveRateWithoutProduct.body.data.agencyDeductionRule.calculationMode,
      'effective_sales_rate',
    );
    assert.equal(
      effectiveRateWithoutProduct.body.data.agencyDeductionRule.deductionRate,
      '0.3000',
    );
    assert.equal(
      effectiveRateWithoutProduct.body.data.agencyDeductionRule.productId,
      null,
    );

    const trimmedProduct = await requestJson(
      baseUrl,
      '/api/sales-deduction-rules',
      {
        method: 'POST',
        token: admin.token,
        body: {
          productId: trimmedProductFixture.id,
          deductionCostCents: 100,
          effectiveFrom: '2026-07-01',
        },
      },
    );
    assert.equal(trimmedProduct.response.status, 201);
    assert.equal(
      trimmedProduct.body.data.salesDeductionRule.productName,
      'Stage7 Smoke Trimmed Wine',
    );
  });
});

test('contract: stage7 rule CRUD rejects overlapping enabled ranges', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const overlapProduct = await createRuleTestProduct(
      baseUrl,
      admin.token,
      'Stage7 Test Overlap Wine',
    );
    const agencyProduct = await createRuleTestProduct(
      baseUrl,
      admin.token,
      'Stage7 Test Agency Wine',
    );

    const firstSalesDeduction = await requestJson(
      baseUrl,
      '/api/sales-deduction-rules',
      {
        method: 'POST',
        token: admin.token,
        body: {
          productId: overlapProduct.id,
          deductionCostCents: 100,
          effectiveFrom: '2026-01-01',
          effectiveTo: '2026-06-30',
        },
      },
    );
    assert.equal(firstSalesDeduction.response.status, 201);

    const overlapSalesDeduction = await requestJson(
      baseUrl,
      '/api/sales-deduction-rules',
      {
        method: 'POST',
        token: admin.token,
        body: {
          productId: overlapProduct.id,
          deductionCostCents: 120,
          effectiveFrom: '2026-06-01',
          effectiveTo: '2026-12-31',
        },
      },
    );
    assertErrorContract(overlapSalesDeduction, 400, 'RULE_EFFECTIVE_RANGE_OVERLAP');

    const inactiveOverlap = await requestJson(
      baseUrl,
      '/api/sales-deduction-rules',
      {
        method: 'POST',
        token: admin.token,
        body: {
          productId: overlapProduct.id,
          deductionCostCents: 130,
          effectiveFrom: '2026-06-01',
          effectiveTo: '2026-12-31',
          isActive: false,
        },
      },
    );
    assert.equal(inactiveOverlap.response.status, 201);

    const adjacentSalesDeduction = await requestJson(
      baseUrl,
      '/api/sales-deduction-rules',
      {
        method: 'POST',
        token: admin.token,
        body: {
          productId: overlapProduct.id,
          deductionCostCents: 140,
          effectiveFrom: '2026-07-01',
          effectiveTo: '2026-12-31',
        },
      },
    );
    assert.equal(adjacentSalesDeduction.response.status, 201);

    const firstAgencyDeduction = await requestJson(
      baseUrl,
      '/api/agency-deduction-rules',
      {
        method: 'POST',
        token: admin.token,
        body: {
          agencyName: 'Stage7 Test Overlap Agency',
          productId: agencyProduct.id,
          deductionCostCents: 100,
          effectiveFrom: '2026-01-01',
        },
      },
    );
    assert.equal(firstAgencyDeduction.response.status, 201);

    const overlapAgencyDeduction = await requestJson(
      baseUrl,
      '/api/agency-deduction-rules',
      {
        method: 'POST',
        token: admin.token,
        body: {
          agencyName: 'Stage7 Test Overlap Agency',
          productId: agencyProduct.id,
          deductionCostCents: 110,
          effectiveFrom: '2026-02-01',
        },
      },
    );
    assertErrorContract(overlapAgencyDeduction, 400, 'RULE_EFFECTIVE_RANGE_OVERLAP');

    const firstCommissionRule = await requestJson(
      baseUrl,
      '/api/commission-rules',
      {
        method: 'POST',
        token: admin.token,
        body: {
          ruleName: 'stage7 test leader overlap rule',
          targetType: 'leader_commission',
          rate: '0.0024',
          effectiveFrom: '2027-01-01',
        },
      },
    );
    assert.equal(firstCommissionRule.response.status, 201);

    const overlapCommissionRule = await requestJson(
      baseUrl,
      '/api/commission-rules',
      {
        method: 'POST',
        token: admin.token,
        body: {
          ruleName: 'stage7 test leader overlap rejected',
          targetType: 'leader_commission',
          rate: '0.0030',
          effectiveFrom: '2027-06-01',
        },
      },
    );
    assertErrorContract(overlapCommissionRule, 400, 'RULE_EFFECTIVE_RANGE_OVERLAP');
  });
});

test('contract: stage7 rule CRUD writes operation logs with before and after', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const logAgency = await createRuleTestTravelAgency(
      baseUrl,
      admin.token,
      'Stage7 Smoke Log Agency',
    );

    const created = await requestJson(baseUrl, '/api/agency-rebate-rules', {
      method: 'POST',
      token: admin.token,
      body: {
        agencyId: logAgency.id,
        agencyName: '客户端伪造名称会被覆盖',
        dailyRebateRate: '0.0300',
        monthlyRebateRate: '0.0200',
        totalRebateRate: '0.0500',
        effectiveFrom: '2026-07-01',
        notes: 'stage7 smoke log create',
      },
    });
    assert.equal(created.response.status, 201);
    assertAgencyRebateRuleContract(created.body.data.agencyRebateRule);
    assert.equal(created.body.data.agencyRebateRule.agencyId, logAgency.id);
    assert.equal(
      created.body.data.agencyRebateRule.agencyName,
      'Stage7 Smoke Log Agency',
    );

    const updated = await requestJson(
      baseUrl,
      `/api/agency-rebate-rules/${created.body.data.agencyRebateRule.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          monthlyRebateRate: '0.0250',
          notes: 'stage7 smoke log updated',
        },
      },
    );
    assert.equal(updated.response.status, 200);

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=agency_rebate_rules.update',
      {
        token: admin.token,
      },
    );
    assert.equal(logs.response.status, 200);
    const log = logs.body.data.logs.find(
      (item) => item.entityId === created.body.data.agencyRebateRule.id,
    );
    assert.ok(log);
    assertOperationLogContract(log);
    assert.equal(log.action, 'agency_rebate_rules.update');
    assert.equal(log.entityType, 'agency_rebate_rule');
    assert.equal(log.beforeData.notes, 'stage7 smoke log create');
    assert.equal(log.beforeData.monthlyRebateRate, '0.0200');
    assert.equal(log.afterData.notes, 'stage7 smoke log updated');
    assert.equal(log.afterData.monthlyRebateRate, '0.0250');
  });
});

test('contract: stage7 rule CRUD writes create update and disable logs for every rule table', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const salesLogProduct = await createRuleTestProduct(
      baseUrl,
      admin.token,
      'Stage7 Smoke Log Inventory Sales Wine',
    );
    const agencyLogProduct = await createRuleTestProduct(
      baseUrl,
      admin.token,
      'Stage7 Smoke Log Inventory Agency Wine',
    );
    const rebateLogAgency = await createRuleTestTravelAgency(
      baseUrl,
      admin.token,
      'Stage7 Smoke Log Inventory Agency Rebate',
    );
    const cases = [
      {
        route: '/api/commission-rules',
        responseKey: 'commissionRule',
        logPrefix: 'commission_rules',
        entityType: 'commission_rule',
        createBody: {
          ruleName: 'stage7 smoke log inventory sales commission',
          targetType: 'sales_commission',
          rate: '0.0200',
          effectiveFrom: '2031-01-01',
          notes: 'stage7 smoke log inventory create commission',
        },
        updateBody: {
          notes: 'stage7 smoke log inventory update commission',
        },
      },
      {
        route: '/api/sales-deduction-rules',
        responseKey: 'salesDeductionRule',
        logPrefix: 'sales_deduction_rules',
        entityType: 'sales_deduction_rule',
        productId: salesLogProduct.id,
        createBody: {
          productId: salesLogProduct.id,
          deductionCostCents: 1200,
          effectiveFrom: '2031-01-01',
          notes: 'stage7 smoke log inventory create sales deduction',
        },
        updateBody: {
          notes: 'stage7 smoke log inventory update sales deduction',
        },
      },
      {
        route: '/api/agency-deduction-rules',
        responseKey: 'agencyDeductionRule',
        logPrefix: 'agency_deduction_rules',
        entityType: 'agency_deduction_rule',
        productId: agencyLogProduct.id,
        createBody: {
          agencyName: 'Stage7 Smoke Log Inventory Agency Deduction',
          productId: agencyLogProduct.id,
          deductionCostCents: 2200,
          effectiveFrom: '2031-01-01',
          notes: 'stage7 smoke log inventory create agency deduction',
        },
        updateBody: {
          notes: 'stage7 smoke log inventory update agency deduction',
        },
      },
      {
        route: '/api/agency-rebate-rules',
        responseKey: 'agencyRebateRule',
        logPrefix: 'agency_rebate_rules',
        entityType: 'agency_rebate_rule',
        createBody: {
          agencyId: rebateLogAgency.id,
          agencyName: 'untrusted client snapshot',
          dailyRebateRate: '0.0300',
          monthlyRebateRate: '0.0200',
          totalRebateRate: '0.0500',
          effectiveFrom: '2031-01-01',
          notes: 'stage7 smoke log inventory create agency rebate',
        },
        updateBody: {
          notes: 'stage7 smoke log inventory update agency rebate',
        },
      },
    ];

    for (const ruleCase of cases) {
      const created = await requestJson(baseUrl, ruleCase.route, {
        method: 'POST',
        token: admin.token,
        body: ruleCase.createBody,
      });
      assert.equal(created.response.status, 201);
      const rule = created.body.data[ruleCase.responseKey];

      const updated = await requestJson(baseUrl, `${ruleCase.route}/${rule.id}`, {
        method: 'PATCH',
        token: admin.token,
        body: {
          ...ruleCase.updateBody,
          ...(ruleCase.productId ? { productId: ruleCase.productId } : {}),
        },
      });
      assert.equal(updated.response.status, 200);

      const disabled = await requestJson(baseUrl, `${ruleCase.route}/${rule.id}`, {
        method: 'PATCH',
        token: admin.token,
        body: {
          ...(ruleCase.productId ? { productId: ruleCase.productId } : {}),
          isActive: false,
        },
      });
      assert.equal(disabled.response.status, 200);

      const createLog = await findOperationLog(
        baseUrl,
        admin.token,
        `${ruleCase.logPrefix}.create`,
        rule.id,
      );
      assertStage7WriteLog(createLog, {
        action: `${ruleCase.logPrefix}.create`,
        entityType: ruleCase.entityType,
        userId: admin.user.id,
      });
      assert.equal(createLog.beforeData, null);
      assert.equal(createLog.afterData.id, rule.id);
      assert.equal(createLog.afterData.isActive, true);

      const updateLog = await findOperationLog(
        baseUrl,
        admin.token,
        `${ruleCase.logPrefix}.update`,
        rule.id,
      );
      assertStage7WriteLog(updateLog, {
        action: `${ruleCase.logPrefix}.update`,
        entityType: ruleCase.entityType,
        userId: admin.user.id,
      });
      assert.equal(updateLog.beforeData.notes, ruleCase.createBody.notes);
      assert.equal(updateLog.afterData.notes, ruleCase.updateBody.notes);
      assert.equal(updateLog.afterData.isActive, true);

      const disableLog = await findOperationLog(
        baseUrl,
        admin.token,
        `${ruleCase.logPrefix}.disable`,
        rule.id,
      );
      assertStage7WriteLog(disableLog, {
        action: `${ruleCase.logPrefix}.disable`,
        entityType: ruleCase.entityType,
        userId: admin.user.id,
      });
      assert.equal(disableLog.beforeData.isActive, true);
      assert.equal(disableLog.afterData.isActive, false);
    }
  });
});

test('contract: stage7 rule batch import succeeds for structured JSON templates', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const batchProductA = await createRuleTestProduct(
      baseUrl,
      admin.token,
      'Stage7 Smoke Batch Wine A',
    );
    const batchProductB = await createRuleTestProduct(
      baseUrl,
      admin.token,
      'Stage7 Smoke Batch Wine B',
    );
    const batchAgencyA = await createRuleTestTravelAgency(
      baseUrl,
      admin.token,
      'Stage7 Smoke Batch Agency A',
    );
    const batchAgencyB = await createRuleTestTravelAgency(
      baseUrl,
      admin.token,
      'Stage7 Smoke Batch Agency B',
    );

    const salesImport = await requestJson(
      baseUrl,
      '/api/sales-deduction-rules/batch-import',
      {
        method: 'POST',
        token: admin.token,
        body: {
          rules: [
            {
              productId: batchProductA.id,
              deductionCostCents: 1000,
              effectiveFrom: '2026-07-01',
              notes: 'stage7 smoke sales batch import a',
            },
            {
              productId: batchProductB.id,
              deductionCostCents: 2000,
              effectiveFrom: '2026-07-01',
              notes: 'stage7 smoke sales batch import b',
            },
          ],
        },
      },
    );
    assert.equal(salesImport.response.status, 201);
    assertImportResultContract(salesImport.body.data.importResult, 2, 0);
    assert.equal(
      salesImport.body.data.importResult.results[0].rule.productName,
      'Stage7 Smoke Batch Wine A',
    );

    const agencyDeductionImport = await requestJson(
      baseUrl,
      '/api/agency-deduction-rules/batch-import',
      {
        method: 'POST',
        token: admin.token,
        body: {
          rules: [
            {
              agencyName: 'Stage7 Smoke Batch Agency A',
              productId: batchProductA.id,
              deductionCostCents: 3000,
              effectiveFrom: '2026-07-01',
              notes: 'stage7 smoke agency deduction batch import a',
            },
            {
              agencyName: 'Stage7 Smoke Batch Agency B',
              productId: batchProductB.id,
              deductionCostCents: 4000,
              effectiveFrom: '2026-07-01',
              notes: 'stage7 smoke agency deduction batch import b',
            },
            {
              agencyName: 'Stage7 Smoke Batch Agency Rate',
              calculationMode: 'effective_sales_rate',
              effectiveFrom: '2026-07-01',
              notes: 'stage7 smoke agency deduction effective rate import',
            },
          ],
        },
      },
    );
    assert.equal(agencyDeductionImport.response.status, 201);
    assertImportResultContract(
      agencyDeductionImport.body.data.importResult,
      3,
      0,
    );
    assert.equal(
      agencyDeductionImport.body.data.importResult.results[2].rule
        .calculationMode,
      'effective_sales_rate',
    );

    const agencyRebateImport = await requestJson(
      baseUrl,
      '/api/agency-rebate-rules/batch-import',
      {
        method: 'POST',
        token: admin.token,
        body: {
          rules: [
            {
              agencyId: batchAgencyA.id,
              agencyName: 'client value ignored a',
              dailyRebateRate: '0.0300',
              monthlyRebateRate: '0.0200',
              totalRebateRate: '0.0500',
              effectiveFrom: '2026-07-01',
              notes: 'stage7 smoke agency rebate batch import a',
            },
            {
              agencyId: batchAgencyB.id,
              agencyName: 'client value ignored b',
              dailyRebateRate: '0.0250',
              monthlyRebateRate: '0.0150',
              totalRebateRate: '0.0400',
              effectiveFrom: '2026-07-01',
              notes: 'stage7 smoke agency rebate batch import b',
            },
          ],
        },
      },
    );
    assert.equal(agencyRebateImport.response.status, 201);
    assertImportResultContract(agencyRebateImport.body.data.importResult, 2, 0);

    const logs = await requestJson(
      baseUrl,
      '/api/operation-logs?action=sales_deduction_rules.batch_import',
      {
        token: admin.token,
      },
    );
    assert.equal(logs.response.status, 200);
    const log = logs.body.data.logs.find(
      (item) => item.action === 'sales_deduction_rules.batch_import',
    );
    assert.ok(log);
    assertOperationLogContract(log);
    assert.equal(log.entityType, 'sales_deduction_rule');
    assert.equal(log.afterData.totalCount, 2);
    assert.equal(log.afterData.successCount, 2);
    assert.equal(log.afterData.failureCount, 0);
    assert.equal(Array.isArray(log.afterData.createdIdsSample), true);
    assert.equal('rules' in log.afterData, false);
    assert.equal('results' in log.afterData, false);
  });
});

test('contract: stage7 rule batch import reports partial failures per row', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const partialProductA = await createRuleTestProduct(
      baseUrl,
      admin.token,
      'Stage7 Test Partial Success A',
    );
    const partialFailureProduct = await createRuleTestProduct(
      baseUrl,
      admin.token,
      'Stage7 Test Partial Failure',
    );
    const partialProductB = await createRuleTestProduct(
      baseUrl,
      admin.token,
      'Stage7 Test Partial Success B',
    );

    const result = await requestJson(
      baseUrl,
      '/api/sales-deduction-rules/batch-import',
      {
        method: 'POST',
        token: admin.token,
        body: {
          rules: [
            {
              productId: partialProductA.id,
              deductionCostCents: 100,
              effectiveFrom: '2026-07-01',
              notes: 'stage7 test partial success a',
            },
            {
              productId: partialFailureProduct.id,
              deductionCostCents: -1,
              effectiveFrom: '2026-07-01',
              notes: 'stage7 test partial failure',
            },
            {
              productId: partialProductB.id,
              deductionCostCents: 200,
              effectiveFrom: '2026-07-01',
              notes: 'stage7 test partial success b',
            },
          ],
        },
      },
    );
    assert.equal(result.response.status, 201);
    assertImportResultContract(result.body.data.importResult, 2, 1);
    assert.equal(result.body.data.importResult.results[0].success, true);
    assert.equal(result.body.data.importResult.results[1].success, false);
    assert.equal(
      result.body.data.importResult.results[1].error.code,
      'VALIDATION_FAILED',
    );
    assert.match(
      result.body.data.importResult.results[1].error.message,
      /deductionCostCents/,
    );
    assert.equal(result.body.data.importResult.results[2].success, true);

    const list = await requestJson(
      baseUrl,
      '/api/sales-deduction-rules?keyword=Stage7 Test Partial Success',
      {
        token: admin.token,
      },
    );
    assert.equal(list.response.status, 200);
    assert.deepEqual(
      list.body.data.salesDeductionRules
        .map((rule) => rule.productName)
        .sort(),
      ['Stage7 Test Partial Success A', 'Stage7 Test Partial Success B'],
    );
  });
});

test('contract: agency rebate batch import validates agencyId per row and trusts master name', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const agency = await createRuleTestTravelAgency(
      baseUrl,
      admin.token,
      'Stage7 Batch Canonical Agency',
    );
    const result = await requestJson(
      baseUrl,
      '/api/agency-rebate-rules/batch-import',
      {
        method: 'POST',
        token: admin.token,
        body: {
          rules: [
            {
              dailyRebateRate: '0.0300',
              monthlyRebateRate: '0.0200',
              effectiveFrom: '2026-07-01',
            },
            {
              agencyId: 'missing-agency-id',
              dailyRebateRate: '0.0300',
              monthlyRebateRate: '0.0200',
              effectiveFrom: '2026-07-01',
            },
            {
              agencyId: agency.id,
              agencyName: '客户端伪造旅行社名称',
              dailyRebateRate: '0.0300',
              monthlyRebateRate: '0.0200',
              effectiveFrom: '2026-07-01',
            },
          ],
        },
      },
    );

    assert.equal(result.response.status, 201);
    const importResult = result.body.data.importResult;
    assertImportResultContract(importResult, 1, 2);
    assert.equal(importResult.results[0].rowNumber, 1);
    assert.equal(importResult.results[0].error.code, 'AGENCY_ID_REQUIRED');
    assert.match(importResult.results[0].error.message, /必须选择有效的旅行社主档/);
    assert.equal(importResult.results[1].rowNumber, 2);
    assert.equal(importResult.results[1].error.code, 'AGENCY_ID_INVALID');
    assert.equal(importResult.results[1].error.agencyId, 'missing-agency-id');
    assert.match(importResult.results[1].error.message, /旅行社 ID.*无效/);
    assert.equal(importResult.results[2].success, true);
    assert.equal(importResult.results[2].rule.agencyId, agency.id);
    assert.equal(
      importResult.results[2].rule.agencyName,
      'Stage7 Batch Canonical Agency',
    );
  });
});

test('contract: binding a legacy name rebate rule syncs canonical name and cannot bypass overlap', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const agency = {
      id: 'stage7-legacy-binding-agency-id',
      name: 'Stage7 Legacy Binding Agency',
    };

    const bound = await requestJson(
      baseUrl,
      '/api/agency-rebate-rules/legacy-name-rule-to-bind',
      {
        method: 'PATCH',
        token: admin.token,
        body: { agencyId: agency.id, agencyName: '伪造名称' },
      },
    );
    assert.equal(bound.response.status, 200);
    assert.equal(bound.body.data.agencyRebateRule.agencyId, agency.id);
    assert.equal(
      bound.body.data.agencyRebateRule.agencyName,
      'Stage7 Legacy Binding Agency',
    );

    const overlap = await requestJson(baseUrl, '/api/agency-rebate-rules', {
      method: 'POST',
      token: admin.token,
      body: {
        agencyId: agency.id,
        dailyRebateRate: '0.0200',
        monthlyRebateRate: '0.0100',
        effectiveFrom: '2027-06-01',
      },
    });
    assertErrorContract(overlap, 400, 'RULE_EFFECTIVE_RANGE_OVERLAP');
  }, {
    prisma: {
      travelAgencies: [
        {
          id: 'stage7-legacy-binding-agency-id',
          name: 'Stage7 Legacy Binding Agency',
        },
      ],
      agencyRebateRules: [
        {
          id: 'legacy-name-rule-to-bind',
          agencyId: null,
          agencyName: 'Stage7 Legacy Binding Agency',
          dailyRebateRate: '0.0300',
          monthlyRebateRate: '0.0200',
          totalRebateRate: '0.0500',
          effectiveFrom: '2026-01-01',
          effectiveTo: '2026-06-30',
          isActive: true,
        },
        {
          id: 'legacy-name-overlap',
          agencyId: null,
          agencyName: 'Stage7 Legacy Binding Agency',
          dailyRebateRate: '0.0400',
          monthlyRebateRate: '0.0100',
          totalRebateRate: '0.0500',
          effectiveFrom: '2027-01-01',
          effectiveTo: null,
          isActive: true,
        },
      ],
    },
  });
});

test('contract: stage7 rule batch import rejects overlapping rows and keeps successes', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const overlapAgency = await createRuleTestTravelAgency(
      baseUrl,
      admin.token,
      'Stage7 Test Batch Overlap Agency',
    );

    const result = await requestJson(
      baseUrl,
      '/api/agency-rebate-rules/batch-import',
      {
        method: 'POST',
        token: admin.token,
        body: {
          rules: [
            {
              agencyId: overlapAgency.id,
              dailyRebateRate: '0.0300',
              monthlyRebateRate: '0.0200',
              effectiveFrom: '2026-01-01',
              effectiveTo: '2026-12-31',
              notes: 'stage7 test batch overlap first',
            },
            {
              agencyId: overlapAgency.id,
              dailyRebateRate: '0.0250',
              monthlyRebateRate: '0.0150',
              effectiveFrom: '2026-06-01',
              effectiveTo: '2026-12-31',
              notes: 'stage7 test batch overlap second',
            },
          ],
        },
      },
    );
    assert.equal(result.response.status, 201);
    assertImportResultContract(result.body.data.importResult, 1, 1);
    assert.equal(result.body.data.importResult.results[0].success, true);
    assert.equal(result.body.data.importResult.results[1].success, false);
    assert.equal(
      result.body.data.importResult.results[1].error.code,
      'RULE_EFFECTIVE_RANGE_OVERLAP',
    );
  });
});

test('contract: stage7 rule batch import is denied to read-only boss role', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    await createUser(baseUrl, admin.token, {
      name: 'Stage7 Test Batch Boss',
      username: 'stage7-rule-batch-boss',
      password: 'Password123',
      role: 'boss',
    });
    const boss = await login(baseUrl, 'stage7-rule-batch-boss', 'Password123');

    const denied = await requestJson(
      baseUrl,
      '/api/agency-deduction-rules/batch-import',
      {
        method: 'POST',
        token: boss.token,
        body: {
          rules: [
            {
              agencyName: 'Stage7 Test Boss Import Agency',
              productName: 'Stage7 Test Boss Import Wine',
              deductionCostCents: 100,
              effectiveFrom: '2026-07-01',
            },
          ],
        },
      },
    );
    assertErrorContract(denied, 403, 'PERMISSION_DENIED');
  });
});

async function findOperationLog(baseUrl, token, action, entityId) {
  const logs = await requestJson(
    baseUrl,
    `/api/operation-logs?action=${encodeURIComponent(action)}`,
    {
      token,
    },
  );
  assert.equal(logs.response.status, 200);
  const log = logs.body.data.logs.find((item) => item.entityId === entityId);
  assert.ok(log, `${action} log for ${entityId} should exist`);
  return log;
}

async function createRuleTestProduct(baseUrl, token, name) {
  const result = await requestJson(baseUrl, '/api/products', {
    method: 'POST',
    token,
    body: {
      name,
      unit: 'bottle',
    },
  });
  assert.equal(result.response.status, 201);
  return result.body.data.product;
}

async function createRuleTestTravelAgency(baseUrl, token, name) {
  const result = await requestJson(baseUrl, '/api/travel-agencies', {
    method: 'POST',
    token,
    body: { name },
  });
  assert.equal(result.response.status, 201);
  return result.body.data.travelAgency;
}

function assertStage7WriteLog(log, expected) {
  assertOperationLogContract(log);
  assert.equal(log.action, expected.action);
  assert.equal(log.entityType, expected.entityType);
  assert.equal(log.userId, expected.userId);
  assert.equal(typeof log.entityId, 'string');
  assert.equal(typeof log.ipAddress, 'string');
  assert.ok(log.ipAddress.length > 0);
  const serialized = JSON.stringify(log);
  assert.equal(/Password123|secret-token|DATABASE_URL/i.test(serialized), false);
}

function assertCommissionRuleContract(rule, recalculation) {
  assert.deepEqual(Object.keys(rule).sort(), [
    'createdAt',
    'createdById',
    'effectiveFrom',
    'effectiveTo',
    'id',
    'isActive',
    'notes',
    'rate',
    'ruleName',
    'targetType',
    'updatedAt',
    'updatedById',
  ]);
  assert.equal(typeof rule.id, 'string');
  assert.equal(typeof rule.ruleName, 'string');
  assert.equal(typeof rule.targetType, 'string');
  assert.equal(typeof rule.rate, 'string');
  assert.equal(typeof rule.isActive, 'boolean');
  for (const field of [
    'source',
    'ruleIds',
    'orderCount',
    'successCount',
    'failureCount',
    'skippedCount',
    'generatedCount',
    'updatedCount',
    'unchangedCount',
    'warnings',
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(recalculation, field),
      true,
      `recalculation.${field}`,
    );
  }
}

function assertImportResultContract(result, successCount, failureCount) {
  assert.deepEqual(Object.keys(result).sort(), [
    'createdIdsSample',
    'failureCount',
    'failureSamples',
    'results',
    'successCount',
    'totalCount',
    'truncated',
  ]);
  assert.equal(result.successCount, successCount);
  assert.equal(result.failureCount, failureCount);
  assert.equal(result.totalCount, successCount + failureCount);
  assert.equal(Array.isArray(result.results), true);
  assert.equal(Array.isArray(result.createdIdsSample), true);
  assert.equal(Array.isArray(result.failureSamples), true);
  assert.equal(typeof result.truncated, 'object');
}

function assertAgencyRebateRuleContract(rule) {
  assert.deepEqual(Object.keys(rule).sort(), [
    'agencyId',
    'agencyName',
    'createdAt',
    'createdById',
    'dailyRebateRate',
    'effectiveFrom',
    'effectiveTo',
    'id',
    'isActive',
    'monthlyRebateRate',
    'notes',
    'totalRebateRate',
    'updatedAt',
    'updatedById',
  ]);
  assert.equal(typeof rule.id, 'string');
  assert.equal(typeof rule.dailyRebateRate, 'string');
  assert.equal(typeof rule.monthlyRebateRate, 'string');
  assert.equal(typeof rule.isActive, 'boolean');
}
