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
    { id: 'usr_boss_demo', name: '老板测试账号', username: 'boss', role: 'BOSS' },
    { id: 'usr_front_desk_demo', name: '前台测试账号', username: 'front_desk', role: 'FRONT_DESK' },
    { id: 'usr_sales_demo', name: '销售测试账号', username: 'sales', role: 'SALES' },
    { id: 'usr_finance_demo', name: '财务测试账号', username: 'finance', role: 'FINANCE' },
    { id: 'usr_warehouse_demo', name: '库管测试账号', username: 'warehouse', role: 'WAREHOUSE' },
    { id: 'usr_after_sales_demo', name: '售后测试账号', username: 'after_sales', role: 'AFTER_SALES' },
    { id: 'usr_taster_demo', name: '品鉴师测试账号', username: 'taster', role: 'TASTER' },
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
  await upsertSetting('marked_records_restore_required', 'false', admin.id, now);

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

  await prisma.salesOrder.upsert({
    where: {
      orderNo: 'SO-20260622-031',
    },
    update: {
      orderType: 'TRAVEL_GROUP',
      travelGroupId: demoTravelGroup.id,
      customerName: '王女士',
      customerPhone: '13800006621',
      province: '贵州省',
      city: '贵阳市',
      district: '观山湖区',
      address: '示例收货地址',
      orderDate: businessDate('2026-06-22'),
      totalAmountCents: 647800,
      cashOnDeliveryAmountCents: 150000,
      remark: '系统示例销售订单',
      status: 'VALID',
      salesUserId: 'usr_sales_demo',
      updatedById: admin.id,
      updatedAt: now,
      items: {
        deleteMany: {},
        create: [
          {
            productName: '酱香珍藏 53度',
            quantity: 2,
            unitPriceCents: 129900,
            deliveryType: 'SHIPPING',
            createdAt: now,
          },
          {
            productName: '年份礼盒',
            quantity: 1,
            unitPriceCents: 388000,
            deliveryType: 'SELF_PICKUP',
            createdAt: now,
          },
        ],
      },
    },
    create: {
      orderNo: 'SO-20260622-031',
      orderType: 'TRAVEL_GROUP',
      travelGroupId: demoTravelGroup.id,
      customerName: '王女士',
      customerPhone: '13800006621',
      province: '贵州省',
      city: '贵阳市',
      district: '观山湖区',
      address: '示例收货地址',
      orderDate: businessDate('2026-06-22'),
      totalAmountCents: 647800,
      cashOnDeliveryAmountCents: 150000,
      remark: '系统示例销售订单',
      status: 'VALID',
      salesUserId: 'usr_sales_demo',
      createdById: admin.id,
      updatedById: admin.id,
      createdAt: now,
      updatedAt: now,
      items: {
        create: [
          {
            productName: '酱香珍藏 53度',
            quantity: 2,
            unitPriceCents: 129900,
            deliveryType: 'SHIPPING',
            createdAt: now,
          },
          {
            productName: '年份礼盒',
            quantity: 1,
            unitPriceCents: 388000,
            deliveryType: 'SELF_PICKUP',
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

  await prisma.operationLog.create({
    data: {
      userId: admin.id,
      action: 'seed.phase1',
      entityType: 'system',
      entityId: 'phase1',
      afterData: {
        defaultAdmin: admin.username,
        demoUsers: demoUsers.map((user) => user.username),
        settings: ['only_show_marked_records', 'marked_records_restore_required'],
      },
      createdAt: now,
    },
  });
}

async function upsertGuideSnapshots(
  guides: Array<{ name: string; phone: string; travelAgency: string; remarks?: string }>,
  updatedAt: Date,
) {
  const uniqueGuides = new Map<string, { name: string; phone: string; travelAgency: string; remarks?: string }>();
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

async function upsertSetting(settingKey: string, settingValue: string, updatedBy: string, updatedAt: Date) {
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
