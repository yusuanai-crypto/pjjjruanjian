#!/usr/bin/env node
'use strict';

require('dotenv/config');

const crypto = require('node:crypto');

const CUSTOMER_BACKFILL_NAMESPACE = '2e76f785-8df5-4f64-a07a-5dfadf025031';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const report = await backfillSalesOrderCustomers(prisma, options);
    printReport(report);
    if (report.errors.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

function parseArgs(args) {
  const options = {
    apply: false,
    dryRun: true,
    help: false,
  };

  for (const arg of args) {
    switch (arg) {
      case '--apply':
        options.apply = true;
        options.dryRun = false;
        break;
      case '--dry-run':
        options.apply = false;
        options.dryRun = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  npm.cmd run backfill:sales-order-customers
  npm.cmd run backfill:sales-order-customers -- --apply

Options:
  --dry-run  Read current orders/customers and print counts only. This is the default.
  --apply    Create missing customers and link old sales orders in one transaction.
  --help     Show this help.
`);
}

async function backfillSalesOrderCustomers(prisma, options = {}) {
  const runOptions = {
    apply: Boolean(options.apply),
    dryRun: !options.apply,
  };

  if (!runOptions.apply) {
    return collectAndBackfill(prisma, runOptions);
  }

  return prisma.$transaction(async (tx) => collectAndBackfill(tx, runOptions), {
    maxWait: 10000,
    timeout: 120000,
  });
}

async function collectAndBackfill(prisma, options) {
  const startedAt = new Date();
  const report = createReport(options);
  const orders = await prisma.salesOrder.findMany({
    where: {
      customerId: null,
    },
    select: {
      id: true,
      customerId: true,
      customerName: true,
      customerPhone: true,
      province: true,
      city: true,
      district: true,
      address: true,
      createdById: true,
      updatedById: true,
      salesUserId: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [
      {
        createdAt: 'asc',
      },
      {
        id: 'asc',
      },
    ],
  });
  report.ordersScanned = orders.length;

  const groups = buildBackfillGroups(orders, report);
  report.groupsPrepared = groups.length;

  const customers = await prisma.customer.findMany({
    select: {
      id: true,
      name: true,
      phone: true,
      province: true,
      city: true,
      district: true,
      address: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [
      {
        createdAt: 'asc',
      },
      {
        id: 'asc',
      },
    ],
  });
  const customerLookup = buildCustomerLookup(customers);

  for (const group of groups) {
    const customer = await resolveCustomerForGroup(
      prisma,
      group,
      customerLookup,
      startedAt,
      options,
      report,
    );
    if (!customer) {
      continue;
    }

    for (const order of group.orders) {
      report.ordersToLink += 1;
      if (options.dryRun) {
        continue;
      }
      const result = await prisma.salesOrder.updateMany({
        where: {
          id: order.id,
          customerId: null,
        },
        data: {
          customerId: customer.id,
        },
      });
      report.ordersLinked += Number(result?.count || 0);
      if (!result?.count) {
        report.ordersSkippedAlreadyLinked += 1;
      }
    }
  }

  return report;
}

function createReport(options) {
  return {
    dryRun: Boolean(options.dryRun),
    ordersScanned: 0,
    ordersToLink: 0,
    ordersLinked: 0,
    ordersSkippedAlreadyLinked: 0,
    groupsPrepared: 0,
    groupsSkippedMissingName: 0,
    groupsSkippedMissingAddress: 0,
    groupsSkippedAmbiguousCustomer: 0,
    customersToCreate: 0,
    customersCreated: 0,
    customersReused: 0,
    warnings: [],
    errors: [],
  };
}

function buildBackfillGroups(orders, report = createReport({ dryRun: true })) {
  const groupsByKey = new Map();

  for (const order of orders) {
    if (order.customerId) {
      report.ordersSkippedAlreadyLinked += 1;
      continue;
    }

    const name = normalizeText(order.customerName);
    if (!name) {
      report.groupsSkippedMissingName += 1;
      continue;
    }

    const phone = normalizePhone(order.customerPhone);
    const addressKey = buildAddressKey(order);
    let keyType = 'phone';
    let key = null;

    if (phone) {
      key = `phone:${phone}|name:${normalizeKeyPart(name)}`;
    } else if (addressKey) {
      keyType = 'address';
      key = `address:${addressKey}|name:${normalizeKeyPart(name)}`;
    } else {
      report.groupsSkippedMissingAddress += 1;
      continue;
    }

    let group = groupsByKey.get(key);
    if (!group) {
      group = {
        key,
        keyType,
        safeKeyHash: hashForReport(key),
        customerId: deterministicCustomerId(key),
        orders: [],
      };
      groupsByKey.set(key, group);
    }
    group.orders.push(order);
  }

  return Array.from(groupsByKey.values()).map((group) => ({
    ...group,
    customerData: buildCustomerDataForGroup(group),
  }));
}

function buildCustomerLookup(customers) {
  const byId = new Map();
  const byBackfillKey = new Map();

  for (const customer of customers) {
    byId.set(customer.id, customer);
    const key = buildCustomerKey(customer);
    if (!key) {
      continue;
    }
    const list = byBackfillKey.get(key) || [];
    list.push(customer);
    byBackfillKey.set(key, list);
  }

  return {
    byId,
    byBackfillKey,
  };
}

async function resolveCustomerForGroup(
  prisma,
  group,
  customerLookup,
  startedAt,
  options,
  report,
) {
  const deterministicExisting = customerLookup.byId.get(group.customerId);
  if (deterministicExisting) {
    report.customersReused += 1;
    return deterministicExisting;
  }

  const existingCandidates = customerLookup.byBackfillKey.get(group.key) || [];
  if (existingCandidates.length === 1) {
    report.customersReused += 1;
    return existingCandidates[0];
  }

  if (existingCandidates.length > 1) {
    report.groupsSkippedAmbiguousCustomer += 1;
    report.warnings.push(
      `Skipped one customer group because multiple existing customers match key ${group.safeKeyHash}.`,
    );
    return null;
  }

  report.customersToCreate += 1;
  if (options.dryRun) {
    return {
      id: group.customerId,
      ...group.customerData,
    };
  }

  const created = await prisma.customer.create({
    data: {
      id: group.customerId,
      ...group.customerData,
      financeMark: false,
      markedById: null,
      markedAt: null,
      notes: null,
      updatedAt: startedAt,
    },
  });
  customerLookup.byId.set(created.id, created);
  const list = customerLookup.byBackfillKey.get(group.key) || [];
  list.push(created);
  customerLookup.byBackfillKey.set(group.key, list);
  report.customersCreated += 1;
  return created;
}

function buildCustomerDataForGroup(group) {
  const sortedByCreated = [...group.orders].sort(compareOrderDatesAsc);
  const sortedByUpdatedDesc = [...group.orders].sort(compareOrderDatesDesc);
  const firstOrder = sortedByCreated[0];
  const sourceOrder =
    sortedByUpdatedDesc.find((order) => buildAddressKey(order)) ||
    sortedByUpdatedDesc[0];

  return {
    name: normalizeText(firstOrder.customerName),
    phone: normalizePhone(firstOrder.customerPhone) || null,
    province: nullableTrim(sourceOrder.province),
    city: nullableTrim(sourceOrder.city),
    district: nullableTrim(sourceOrder.district),
    address: nullableTrim(sourceOrder.address),
    createdById:
      nullableTrim(firstOrder.createdById) ||
      nullableTrim(firstOrder.salesUserId) ||
      null,
    updatedById:
      nullableTrim(sourceOrder.updatedById) ||
      nullableTrim(sourceOrder.salesUserId) ||
      nullableTrim(sourceOrder.createdById) ||
      null,
    createdAt: asDate(firstOrder.createdAt) || new Date(),
  };
}

function buildCustomerKey(customer) {
  const name = normalizeText(customer.name);
  if (!name) {
    return null;
  }

  const phone = normalizePhone(customer.phone);
  if (phone) {
    return `phone:${phone}|name:${normalizeKeyPart(name)}`;
  }

  const addressKey = buildAddressKey(customer);
  if (!addressKey) {
    return null;
  }
  return `address:${addressKey}|name:${normalizeKeyPart(name)}`;
}

function buildAddressKey(row) {
  return normalizeKeyPart(
    [
      normalizeText(row.province),
      normalizeText(row.city),
      normalizeText(row.district),
      normalizeText(row.address),
    ]
      .filter(Boolean)
      .join('|'),
  );
}

function deterministicCustomerId(key) {
  return uuidV5(key, CUSTOMER_BACKFILL_NAMESPACE);
}

function uuidV5(name, namespace) {
  const namespaceBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = crypto
    .createHash('sha1')
    .update(namespaceBytes)
    .update(name)
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

function hashForReport(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function normalizeText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim().replace(/\s+/g, ' ');
}

function normalizeKeyPart(value) {
  return normalizeText(value).toLocaleLowerCase('zh-CN');
}

function normalizePhone(value) {
  const text = normalizeText(value);
  if (!text) {
    return '';
  }
  return text.replace(/[\s\-()（）]/g, '');
}

function nullableTrim(value) {
  const text = normalizeText(value);
  return text || null;
}

function asDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function compareOrderDatesAsc(left, right) {
  return compareDates(left.createdAt, right.createdAt) || String(left.id).localeCompare(String(right.id));
}

function compareOrderDatesDesc(left, right) {
  return compareDates(right.updatedAt || right.createdAt, left.updatedAt || left.createdAt) ||
    String(left.id).localeCompare(String(right.id));
}

function compareDates(left, right) {
  const leftTime = asDate(left)?.getTime() || 0;
  const rightTime = asDate(right)?.getTime() || 0;
  return leftTime - rightTime;
}

function printReport(report) {
  console.log(
    report.dryRun
      ? 'DRY RUN - no database writes'
      : 'APPLY MODE - database writes executed',
  );
  console.log(
    [
      `ordersScanned=${report.ordersScanned}`,
      `ordersToLink=${report.ordersToLink}`,
      `ordersLinked=${report.ordersLinked}`,
      `customersToCreate=${report.customersToCreate}`,
      `customersCreated=${report.customersCreated}`,
      `customersReused=${report.customersReused}`,
    ].join(', '),
  );
  console.log(
    [
      `groupsPrepared=${report.groupsPrepared}`,
      `groupsSkippedMissingName=${report.groupsSkippedMissingName}`,
      `groupsSkippedMissingAddress=${report.groupsSkippedMissingAddress}`,
      `groupsSkippedAmbiguousCustomer=${report.groupsSkippedAmbiguousCustomer}`,
      `ordersSkippedAlreadyLinked=${report.ordersSkippedAlreadyLinked}`,
    ].join(', '),
  );
  for (const warning of report.warnings) {
    console.log(`WARN ${warning}`);
  }
  for (const error of report.errors) {
    console.log(`ERROR ${error}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  backfillSalesOrderCustomers,
  buildBackfillGroups,
  buildCustomerKey,
  deterministicCustomerId,
  normalizePhone,
  normalizeText,
  parseArgs,
};
