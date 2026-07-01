import 'dotenv/config';

const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../src/modules/auth/password');

const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin@123456';
  const demoPassword = process.env.SEED_DEMO_PASSWORD || 'Admin@123456';

  const admin = await prisma.user.upsert({
    where: {
      username: 'admin',
    },
    update: {
      name: '系统管理员',
      role: 'ADMIN',
      isActive: true,
      updatedAt: now,
    },
    create: {
      id: 'usr_admin',
      name: '系统管理员',
      username: 'admin',
      passwordHash: hashPassword(adminPassword),
      role: 'ADMIN',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  });

  const demoUsers = [
    {
      id: 'usr_boss_demo',
      name: '老板测试账号',
      username: 'boss',
      role: 'BOSS',
    },
    {
      id: 'usr_front_desk_demo',
      name: '前台测试账号',
      username: 'front_desk',
      role: 'FRONT_DESK',
    },
    {
      id: 'usr_sales_demo',
      name: '销售测试账号',
      username: 'sales',
      role: 'SALES',
    },
    {
      id: 'usr_finance_demo',
      name: '财务测试账号',
      username: 'finance',
      role: 'FINANCE',
    },
    {
      id: 'usr_warehouse_demo',
      name: '库管测试账号',
      username: 'warehouse',
      role: 'WAREHOUSE',
    },
    {
      id: 'usr_after_sales_demo',
      name: '售后测试账号',
      username: 'after_sales',
      role: 'AFTER_SALES',
    },
    {
      id: 'usr_taster_demo',
      name: '品鉴师测试账号',
      username: 'taster',
      role: 'TASTER',
    },
  ];

  for (const user of demoUsers) {
    await prisma.user.upsert({
      where: {
        username: user.username,
      },
      update: {
        name: user.name,
        role: user.role,
        isActive: true,
        updatedAt: now,
      },
      create: {
        id: user.id,
        name: user.name,
        username: user.username,
        passwordHash: hashPassword(demoPassword),
        role: user.role,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  await upsertSetting('only_show_marked_records', 'false', admin.id, now);
  await upsertSetting(
    'marked_records_restore_required',
    'false',
    admin.id,
    now,
  );

  await upsertTravelAgencies(
    [
      { name: '黔程旅行社', notes: '系统示例旅行社' },
      { name: '导游自带', notes: '系统示例导游自带来源' },
      { name: '山水国旅', notes: '系统示例旅行社' },
    ],
    now,
  );

  await upsertGuideSnapshots(
    [
      {
        name: '李导',
        phone: '13800006666',
        travelAgency: '黔程旅行社',
        remarks: '系统示例旅行团导游',
      },
      {
        name: '王导',
        phone: '13900008888',
        travelAgency: '导游自带',
        remarks: '系统示例导游自带团导游',
      },
      {
        name: '赵导',
        phone: '13700009999',
        travelAgency: '山水国旅',
        remarks: '系统示例待处理旅行团导游',
      },
    ],
    now,
  );

  const demoTravelGroup = await prisma.travelGroup.upsert({
    where: {
      groupNo: 'GZ-0622-018',
    },
    update: {
      visitDate: businessDate('2026-06-22'),
      travelAgency: '黔程旅行社',
      licensePlate: '贵A12345',
      guideName: '李导',
      guidePhone: '13800006666',
      guestCount: 32,
      tastingRoomNo: 'KB馆',
      tasterName: '周品鉴师',
      tasterId: 'usr_taster_demo',
      arrivalTime: '09:30',
      groupType: 'KB团',
      wineDetails: '酱香珍藏 53度 2瓶；年份礼盒 1盒',
      departureTime: '11:40',
      remarks: '系统示例旅行团',
      status: 'ORDERED',
      salesAmountCents: 647800,
      paidDepositCents: 100000,
      cashOnDeliveryCents: 150000,
      liquorCostDeductionCents: 38000,
      orderAmountCents: 647800,
      points: 648,
      returnedPoints: 200,
      unreturnedPoints: 448,
      guideInfoSent: true,
      travelAgencyInfoSent: false,
      financeMark: true,
      markedById: admin.id,
      markedAt: now,
      updatedById: admin.id,
      updatedAt: now,
    },
    create: {
      groupNo: 'GZ-0622-018',
      visitDate: businessDate('2026-06-22'),
      travelAgency: '黔程旅行社',
      licensePlate: '贵A12345',
      guideName: '李导',
      guidePhone: '13800006666',
      guestCount: 32,
      tastingRoomNo: 'KB馆',
      tasterName: '周品鉴师',
      tasterId: 'usr_taster_demo',
      arrivalTime: '09:30',
      groupType: 'KB团',
      wineDetails: '酱香珍藏 53度 2瓶；年份礼盒 1盒',
      departureTime: '11:40',
      remarks: '系统示例旅行团',
      status: 'ORDERED',
      salesAmountCents: 647800,
      paidDepositCents: 100000,
      cashOnDeliveryCents: 150000,
      liquorCostDeductionCents: 38000,
      orderAmountCents: 647800,
      points: 648,
      returnedPoints: 200,
      unreturnedPoints: 448,
      guideInfoSent: true,
      travelAgencyInfoSent: false,
      financeMark: true,
      markedById: admin.id,
      markedAt: now,
      createdById: admin.id,
      updatedById: admin.id,
      createdAt: now,
      updatedAt: now,
    },
  });

  await prisma.guideCarriedGroup.upsert({
    where: {
      groupNo: 'DG-0622-001',
    },
    update: {
      visitDate: businessDate('2026-06-22'),
      travelAgency: '导游自带',
      guideName: '王导',
      guidePhone: '13900008888',
      guestCount: 12,
      tastingRoomNo: 'AB馆',
      tasterName: '陈品鉴师',
      tasterId: 'usr_taster_demo',
      groupType: '散客团',
      salesAmountCents: 268000,
      orderAmountCents: 268000,
      points: 268,
      returnedPoints: 0,
      unreturnedPoints: 268,
      updatedById: admin.id,
      updatedAt: now,
    },
    create: {
      groupNo: 'DG-0622-001',
      visitDate: businessDate('2026-06-22'),
      travelAgency: '导游自带',
      guideName: '王导',
      guidePhone: '13900008888',
      guestCount: 12,
      tastingRoomNo: 'AB馆',
      tasterName: '陈品鉴师',
      tasterId: 'usr_taster_demo',
      groupType: '散客团',
      salesAmountCents: 268000,
      orderAmountCents: 268000,
      points: 268,
      returnedPoints: 0,
      unreturnedPoints: 268,
      createdById: admin.id,
      updatedById: admin.id,
      createdAt: now,
      updatedAt: now,
    },
  });

  await prisma.pendingTravelGroup.upsert({
    where: {
      groupNo: 'PD-0623-001',
    },
    update: {
      visitDate: businessDate('2026-06-23'),
      travelAgency: '山水国旅',
      guideName: '赵导',
      guidePhone: '13700009999',
      guestCount: 20,
      tastingRoomNo: '渠道馆',
      tasterName: '刘品鉴师',
      tasterId: 'usr_taster_demo',
      groupType: '渠道团',
      updatedById: admin.id,
      updatedAt: now,
    },
    create: {
      groupNo: 'PD-0623-001',
      visitDate: businessDate('2026-06-23'),
      travelAgency: '山水国旅',
      guideName: '赵导',
      guidePhone: '13700009999',
      guestCount: 20,
      tastingRoomNo: '渠道馆',
      tasterName: '刘品鉴师',
      tasterId: 'usr_taster_demo',
      groupType: '渠道团',
      createdById: admin.id,
      updatedById: admin.id,
      createdAt: now,
      updatedAt: now,
    },
  });

  const markedCustomer = await prisma.customer.upsert({
    where: {
      id: 'cust_stage4_smoke_marked',
    },
    update: {
      name: 'Stage4 Smoke Marked Customer',
      phone: '13800006621',
      province: 'Guizhou',
      city: 'Guiyang',
      district: 'Guanshanhu',
      address: 'stage4 smoke marked shipping address',
      financeMark: true,
      markedById: admin.id,
      markedAt: now,
      notes: 'stage4 smoke customer financeMark=true',
      updatedById: admin.id,
      updatedAt: now,
    },
    create: {
      id: 'cust_stage4_smoke_marked',
      name: 'Stage4 Smoke Marked Customer',
      phone: '13800006621',
      province: 'Guizhou',
      city: 'Guiyang',
      district: 'Guanshanhu',
      address: 'stage4 smoke marked shipping address',
      financeMark: true,
      markedById: admin.id,
      markedAt: now,
      notes: 'stage4 smoke customer financeMark=true',
      createdById: admin.id,
      updatedById: admin.id,
      createdAt: now,
      updatedAt: now,
    },
  });

  const unmarkedCustomer = await prisma.customer.upsert({
    where: {
      id: 'cust_stage4_test_unmarked',
    },
    update: {
      name: 'Stage4 Test Unmarked Customer',
      phone: '13900006622',
      province: 'Guizhou',
      city: 'Guiyang',
      district: 'Nanming',
      address: 'stage4 test warehouse pending shipping address',
      financeMark: false,
      markedById: null,
      markedAt: null,
      notes: 'stage4 test customer financeMark=false',
      updatedById: admin.id,
      updatedAt: now,
    },
    create: {
      id: 'cust_stage4_test_unmarked',
      name: 'Stage4 Test Unmarked Customer',
      phone: '13900006622',
      province: 'Guizhou',
      city: 'Guiyang',
      district: 'Nanming',
      address: 'stage4 test warehouse pending shipping address',
      financeMark: false,
      markedById: null,
      markedAt: null,
      notes: 'stage4 test customer financeMark=false',
      createdById: admin.id,
      updatedById: admin.id,
      createdAt: now,
      updatedAt: now,
    },
  });

  await prisma.salesOrder.upsert({
    where: {
      orderNo: 'SO-20260622-031',
    },
    update: {
      orderType: 'TRAVEL_GROUP',
      travelGroupId: demoTravelGroup.id,
      customerId: markedCustomer.id,
      customerName: markedCustomer.name,
      customerPhone: markedCustomer.phone,
      province: markedCustomer.province,
      city: markedCustomer.city,
      district: markedCustomer.district,
      address: markedCustomer.address,
      orderDate: businessDate('2026-06-22'),
      salesFormNo: 'SMOKE-FORM-20260622-031',
      totalAmountCents: 647800,
      cashOnDeliveryAmountCents: 150000,
      logisticsMethod: 'stage4 smoke express',
      packingStatus: 'PENDING',
      packageCount: 0,
      warehouseRemark: 'stage4 smoke warehouse pending package',
      logisticsNo: null,
      logisticsFeeCents: 0,
      invoiceRequired: true,
      invoiceIssued: false,
      financeRemark: 'stage4 smoke finance sample',
      remark: 'stage4 smoke travel group sales order',
      status: 'VALID',
      financeMark: true,
      markedById: admin.id,
      markedAt: now,
      salesUserId: 'usr_sales_demo',
      updatedById: admin.id,
      updatedAt: now,
      items: {
        deleteMany: {},
        create: [
          {
            productName: 'Stage4 Smoke Shipping Wine',
            quantity: 2,
            unitPriceCents: 129900,
            subtotalCents: 259800,
            deliveryType: 'SHIPPING',
            notes: 'stage4 smoke shipping item',
            sortOrder: 1,
            createdAt: now,
          },
          {
            productName: 'Stage4 Smoke Self Pickup Gift Box',
            quantity: 1,
            unitPriceCents: 388000,
            subtotalCents: 388000,
            deliveryType: 'SELF_PICKUP',
            notes: 'stage4 smoke self pickup item',
            sortOrder: 2,
            createdAt: now,
          },
        ],
      },
    },
    create: {
      orderNo: 'SO-20260622-031',
      orderType: 'TRAVEL_GROUP',
      travelGroupId: demoTravelGroup.id,
      customerId: markedCustomer.id,
      customerName: markedCustomer.name,
      customerPhone: markedCustomer.phone,
      province: markedCustomer.province,
      city: markedCustomer.city,
      district: markedCustomer.district,
      address: markedCustomer.address,
      orderDate: businessDate('2026-06-22'),
      salesFormNo: 'SMOKE-FORM-20260622-031',
      totalAmountCents: 647800,
      cashOnDeliveryAmountCents: 150000,
      logisticsMethod: 'stage4 smoke express',
      packingStatus: 'PENDING',
      packageCount: 0,
      warehouseRemark: 'stage4 smoke warehouse pending package',
      logisticsNo: null,
      logisticsFeeCents: 0,
      invoiceRequired: true,
      invoiceIssued: false,
      financeRemark: 'stage4 smoke finance sample',
      remark: 'stage4 smoke travel group sales order',
      status: 'VALID',
      financeMark: true,
      markedById: admin.id,
      markedAt: now,
      salesUserId: 'usr_sales_demo',
      createdById: admin.id,
      updatedById: admin.id,
      createdAt: now,
      updatedAt: now,
      items: {
        create: [
          {
            productName: 'Stage4 Smoke Shipping Wine',
            quantity: 2,
            unitPriceCents: 129900,
            subtotalCents: 259800,
            deliveryType: 'SHIPPING',
            notes: 'stage4 smoke shipping item',
            sortOrder: 1,
            createdAt: now,
          },
          {
            productName: 'Stage4 Smoke Self Pickup Gift Box',
            quantity: 1,
            unitPriceCents: 388000,
            subtotalCents: 388000,
            deliveryType: 'SELF_PICKUP',
            notes: 'stage4 smoke self pickup item',
            sortOrder: 2,
            createdAt: now,
          },
        ],
      },
    },
  });

  await prisma.salesOrder.upsert({
    where: {
      orderNo: 'SO-STAGE4-SMOKE-SHIP-001',
    },
    update: {
      orderType: 'EXTERNAL',
      travelGroupId: null,
      customerId: unmarkedCustomer.id,
      customerName: unmarkedCustomer.name,
      customerPhone: unmarkedCustomer.phone,
      province: unmarkedCustomer.province,
      city: unmarkedCustomer.city,
      district: unmarkedCustomer.district,
      address: unmarkedCustomer.address,
      orderDate: businessDate('2026-06-23'),
      salesFormNo: 'SMOKE-FORM-SHIP-001',
      totalAmountCents: 199900,
      cashOnDeliveryAmountCents: 0,
      logisticsMethod: null,
      packingStatus: 'PENDING',
      packageCount: 0,
      warehouseRemark: 'stage4 smoke warehouse pending shipping order',
      logisticsNo: null,
      logisticsFeeCents: 0,
      invoiceRequired: false,
      invoiceIssued: false,
      financeRemark: 'stage4 smoke unmarked customer order',
      remark: 'stage4 smoke shipping pending order for warehouse page',
      status: 'VALID',
      financeMark: false,
      markedById: null,
      markedAt: null,
      salesUserId: 'usr_sales_demo',
      updatedById: admin.id,
      updatedAt: now,
      items: {
        deleteMany: {},
        create: [
          {
            productName: 'Stage4 Smoke Warehouse Shipping Wine',
            quantity: 1,
            unitPriceCents: 199900,
            subtotalCents: 199900,
            deliveryType: 'SHIPPING',
            notes: 'stage4 smoke warehouse shipping item',
            sortOrder: 1,
            createdAt: now,
          },
        ],
      },
    },
    create: {
      orderNo: 'SO-STAGE4-SMOKE-SHIP-001',
      orderType: 'EXTERNAL',
      travelGroupId: null,
      customerId: unmarkedCustomer.id,
      customerName: unmarkedCustomer.name,
      customerPhone: unmarkedCustomer.phone,
      province: unmarkedCustomer.province,
      city: unmarkedCustomer.city,
      district: unmarkedCustomer.district,
      address: unmarkedCustomer.address,
      orderDate: businessDate('2026-06-23'),
      salesFormNo: 'SMOKE-FORM-SHIP-001',
      totalAmountCents: 199900,
      cashOnDeliveryAmountCents: 0,
      logisticsMethod: null,
      packingStatus: 'PENDING',
      packageCount: 0,
      warehouseRemark: 'stage4 smoke warehouse pending shipping order',
      logisticsNo: null,
      logisticsFeeCents: 0,
      invoiceRequired: false,
      invoiceIssued: false,
      financeRemark: 'stage4 smoke unmarked customer order',
      remark: 'stage4 smoke shipping pending order for warehouse page',
      status: 'VALID',
      financeMark: false,
      markedById: null,
      markedAt: null,
      salesUserId: 'usr_sales_demo',
      createdById: admin.id,
      updatedById: admin.id,
      createdAt: now,
      updatedAt: now,
      items: {
        create: [
          {
            productName: 'Stage4 Smoke Warehouse Shipping Wine',
            quantity: 1,
            unitPriceCents: 199900,
            subtotalCents: 199900,
            deliveryType: 'SHIPPING',
            notes: 'stage4 smoke warehouse shipping item',
            sortOrder: 1,
            createdAt: now,
          },
        ],
      },
    },
  });

  await prisma.dailyReconciliation.upsert({
    where: {
      businessDate: businessDate('2026-06-22'),
    },
    update: {
      travelGroupSalesCents: 647800,
      backOfficeSalesCents: 120000,
      buybackCents: 88000,
      externalSalesCents: 0,
      internalPurchaseCents: 0,
      afterSalesCents: 0,
      refundsCents: 0,
      otherReceivableCents: 0,
      notes: '系统示例对账记录',
      updatedById: admin.id,
      updatedAt: now,
      paymentMethods: {
        deleteMany: {},
        create: [
          { name: '现金', amountCents: 200000, sortOrder: 1, createdAt: now },
          { name: '微信', amountCents: 655800, sortOrder: 2, createdAt: now },
        ],
      },
    },
    create: {
      businessDate: businessDate('2026-06-22'),
      travelGroupSalesCents: 647800,
      backOfficeSalesCents: 120000,
      buybackCents: 88000,
      externalSalesCents: 0,
      internalPurchaseCents: 0,
      afterSalesCents: 0,
      refundsCents: 0,
      otherReceivableCents: 0,
      notes: '系统示例对账记录',
      createdById: admin.id,
      updatedById: admin.id,
      createdAt: now,
      updatedAt: now,
      paymentMethods: {
        create: [
          { name: '现金', amountCents: 200000, sortOrder: 1, createdAt: now },
          { name: '微信', amountCents: 655800, sortOrder: 2, createdAt: now },
        ],
      },
    },
  });

  await prisma.strikeBonusAward.upsert({
    where: {
      id: 'bonus_20260622_001',
    },
    update: {
      bonusDate: businessDate('2026-06-22'),
      travelAgency: '黔程旅行社',
      guideName: '李导',
      tasterName: '周品鉴师',
      roomNo: 'KB馆',
      salesAmountCents: 647800,
      bonusAmountCents: 50000,
      tasterPaidDate: businessDate('2026-06-23'),
      salesPaidDate: null,
      updatedAt: now,
    },
    create: {
      id: 'bonus_20260622_001',
      bonusDate: businessDate('2026-06-22'),
      travelAgency: '黔程旅行社',
      guideName: '李导',
      tasterName: '周品鉴师',
      roomNo: 'KB馆',
      salesAmountCents: 647800,
      bonusAmountCents: 50000,
      tasterPaidDate: businessDate('2026-06-23'),
      salesPaidDate: null,
      createdAt: now,
      updatedAt: now,
    },
  });

  await prisma.operationLog.upsert({
    where: {
      id: 'op_seed_phase1',
    },
    update: {
      userId: admin.id,
      action: 'seed.phase1',
      entityType: 'system',
      entityId: 'phase1',
      afterData: {
        defaultAdmin: admin.username,
        demoUsers: demoUsers.map((user) => user.username),
        settings: [
          'only_show_marked_records',
          'marked_records_restore_required',
        ],
      },
      createdAt: now,
    },
    create: {
      id: 'op_seed_phase1',
      userId: admin.id,
      action: 'seed.phase1',
      entityType: 'system',
      entityId: 'phase1',
      afterData: {
        defaultAdmin: admin.username,
        demoUsers: demoUsers.map((user) => user.username),
        settings: [
          'only_show_marked_records',
          'marked_records_restore_required',
        ],
      },
      createdAt: now,
    },
  });
}

async function upsertTravelAgencies(
  agencies: Array<{
    name: string;
    contactName?: string;
    contactPhone?: string;
    notes?: string;
  }>,
  updatedAt: Date,
) {
  const uniqueAgencies = new Map<
    string,
    {
      name: string;
      contactName?: string;
      contactPhone?: string;
      notes?: string;
    }
  >();
  for (const agency of agencies) {
    const name = agency.name.trim();
    if (!name) {
      continue;
    }
    uniqueAgencies.set(name, { ...agency, name });
  }

  for (const agency of uniqueAgencies.values()) {
    await prisma.travelAgency.upsert({
      where: {
        name: agency.name,
      },
      update: {
        contactName: agency.contactName ?? null,
        contactPhone: agency.contactPhone ?? null,
        notes: agency.notes ?? null,
        updatedAt,
      },
      create: {
        name: agency.name,
        contactName: agency.contactName ?? null,
        contactPhone: agency.contactPhone ?? null,
        notes: agency.notes ?? null,
        createdAt: updatedAt,
        updatedAt,
      },
    });
  }
}

async function upsertGuideSnapshots(
  guides: Array<{
    name: string;
    phone: string;
    travelAgency: string;
    remarks?: string;
  }>,
  updatedAt: Date,
) {
  const uniqueGuides = new Map<
    string,
    { name: string; phone: string; travelAgency: string; remarks?: string }
  >();
  for (const guide of guides) {
    if (!guide.phone) {
      continue;
    }
    uniqueGuides.set(guide.phone, guide);
  }

  for (const guide of uniqueGuides.values()) {
    await prisma.guide.upsert({
      where: {
        phone: guide.phone,
      },
      update: {
        name: guide.name,
        travelAgency: guide.travelAgency,
        remarks: guide.remarks ?? null,
        isActive: true,
        updatedAt,
      },
      create: {
        name: guide.name,
        phone: guide.phone,
        travelAgency: guide.travelAgency,
        remarks: guide.remarks ?? null,
        isActive: true,
        createdAt: updatedAt,
        updatedAt,
      },
    });
  }
}

async function upsertSetting(
  settingKey: string,
  settingValue: string,
  updatedBy: string,
  updatedAt: Date,
) {
  await prisma.systemSetting.upsert({
    where: {
      settingKey,
    },
    update: {
      settingValue,
      updatedBy,
      updatedAt,
    },
    create: {
      settingKey,
      settingValue,
      updatedBy,
      updatedAt,
    },
  });
}

function businessDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
