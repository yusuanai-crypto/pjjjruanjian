const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertErrorContract,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

test('contract: deduction rule writes require productId and persist trusted product snapshots', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const product = await createProduct(baseUrl, admin.token, 'Trusted Rule Product');

    const nameOnly = await requestJson(baseUrl, '/api/sales-deduction-rules', {
      method: 'POST',
      token: admin.token,
      body: {
        productName: product.name,
        deductionCostCents: 1200,
        effectiveFrom: '2026-07-01',
      },
    });
    assertErrorContract(nameOnly, 400, 'VALIDATION_FAILED');

    const spoofedName = await requestJson(baseUrl, '/api/sales-deduction-rules', {
      method: 'POST',
      token: admin.token,
      body: {
        productId: product.id,
        productName: 'Client Spoofed Name',
        deductionCostCents: 1200,
        effectiveFrom: '2026-07-01',
      },
    });
    assertErrorContract(spoofedName, 400, 'VALIDATION_FAILED');

    const created = await requestJson(baseUrl, '/api/sales-deduction-rules', {
      method: 'POST',
      token: admin.token,
      body: {
        productId: product.id,
        deductionCostCents: 1200,
        effectiveFrom: '2026-07-01',
        notes: 'trusted create',
      },
    });
    assert.equal(created.response.status, 201);
    const rule = created.body.data.salesDeductionRule;
    assert.equal(rule.productId, product.id);
    assert.equal(rule.productName, 'Trusted Rule Product');

    const missingProductOnEdit = await requestJson(
      baseUrl,
      `/api/sales-deduction-rules/${rule.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: { notes: 'missing product id' },
      },
    );
    assertErrorContract(missingProductOnEdit, 400, 'VALIDATION_FAILED');

    const renamed = await requestJson(baseUrl, `/api/products/${product.id}`, {
      method: 'PATCH',
      token: admin.token,
      body: { name: 'Trusted Rule Product Renamed' },
    });
    assert.equal(renamed.response.status, 200);

    const updated = await requestJson(
      baseUrl,
      `/api/sales-deduction-rules/${rule.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          productId: product.id,
          notes: 'trusted edit',
        },
      },
    );
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.data.salesDeductionRule.productId, product.id);
    assert.equal(
      updated.body.data.salesDeductionRule.productName,
      'Trusted Rule Product Renamed',
    );

    const disabledProduct = await requestJson(
      baseUrl,
      `/api/products/${product.id}/status`,
      {
        method: 'PATCH',
        token: admin.token,
        body: { isActive: false },
      },
    );
    assert.equal(disabledProduct.response.status, 200);

    const inactiveCreate = await requestJson(baseUrl, '/api/sales-deduction-rules', {
      method: 'POST',
      token: admin.token,
      body: {
        productId: product.id,
        deductionCostCents: 1300,
        effectiveFrom: '2027-01-01',
        isActive: false,
      },
    });
    assertErrorContract(inactiveCreate, 400, 'PRODUCT_INACTIVE');

    const existingInactiveProductEdit = await requestJson(
      baseUrl,
      `/api/sales-deduction-rules/${rule.id}`,
      {
        method: 'PATCH',
        token: admin.token,
        body: {
          productId: product.id,
          isActive: false,
        },
      },
    );
    assert.equal(existingInactiveProductEdit.response.status, 200);

    const listed = await requestJson(
      baseUrl,
      `/api/sales-deduction-rules?productId=${encodeURIComponent(product.id)}`,
      { token: admin.token },
    );
    assert.equal(listed.response.status, 200);
    assert.equal(listed.body.data.salesDeductionRules.length, 1);
    assert.equal(listed.body.data.salesDeductionRules[0].productName, 'Trusted Rule Product Renamed');
  });
});

test('contract: agency deduction overlap dimension is agency plus product plus date', async () => {
  await withPhase1Server(async (baseUrl) => {
    const admin = await login(baseUrl);
    const firstProduct = await createProduct(baseUrl, admin.token, 'Agency Cost Product A');
    const secondProduct = await createProduct(baseUrl, admin.token, 'Agency Cost Product B');
    const agencyResult = await requestJson(baseUrl, '/api/travel-agencies', {
      method: 'POST',
      token: admin.token,
      body: { name: 'Product Rule Agency' },
    });
    assert.equal(agencyResult.response.status, 201);
    const agency = agencyResult.body.data.travelAgency;

    const first = await createAgencyRule(baseUrl, admin.token, {
      agencyId: agency.id,
      agencyName: agency.name,
      productId: firstProduct.id,
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
    });
    assert.equal(first.response.status, 201);
    assert.equal(first.body.data.agencyDeductionRule.productName, firstProduct.name);

    const overlap = await createAgencyRule(baseUrl, admin.token, {
      agencyId: agency.id,
      agencyName: agency.name,
      productId: firstProduct.id,
      effectiveFrom: '2026-06-01',
    });
    assertErrorContract(overlap, 400, 'RULE_EFFECTIVE_RANGE_OVERLAP');

    const otherProduct = await createAgencyRule(baseUrl, admin.token, {
      agencyId: agency.id,
      agencyName: agency.name,
      productId: secondProduct.id,
      effectiveFrom: '2026-06-01',
    });
    assert.equal(otherProduct.response.status, 201);

    const adjacent = await createAgencyRule(baseUrl, admin.token, {
      agencyId: agency.id,
      agencyName: agency.name,
      productId: firstProduct.id,
      effectiveFrom: '2027-01-01',
    });
    assert.equal(adjacent.response.status, 201);
  });
});

async function createProduct(baseUrl, token, name) {
  const result = await requestJson(baseUrl, '/api/products', {
    method: 'POST',
    token,
    body: { name, unit: 'bottle' },
  });
  assert.equal(result.response.status, 201);
  return result.body.data.product;
}

function createAgencyRule(baseUrl, token, overrides) {
  return requestJson(baseUrl, '/api/agency-deduction-rules', {
    method: 'POST',
    token,
    body: {
      agencyId: overrides.agencyId,
      agencyName: overrides.agencyName,
      productId: overrides.productId,
      deductionCostCents: 2500,
      effectiveFrom: overrides.effectiveFrom,
      ...(overrides.effectiveTo ? { effectiveTo: overrides.effectiveTo } : {}),
    },
  });
}
