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

  const stage7Users = await upsertStage7Users(demoPassword, now);

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

  const phase6Customer = await prisma.customer.upsert({
    where: {
      id: 'cust_stage6_smoke_after_sales',
    },
    update: {
      name: 'Stage6 Smoke Test After Sales Customer',
      phone: '13800006661',
      province: 'Guizhou',
      city: 'Guiyang',
      district: 'Yunyan',
      address: 'stage6 smoke test after sales shipping address',
      financeMark: true,
      markedById: admin.id,
      markedAt: now,
      notes: 'stage6 smoke test customer for after sales, finance and warehouse',
      updatedById: admin.id,
      updatedAt: now,
    },
    create: {
      id: 'cust_stage6_smoke_after_sales',
      name: 'Stage6 Smoke Test After Sales Customer',
      phone: '13800006661',
      province: 'Guizhou',
      city: 'Guiyang',
      district: 'Yunyan',
      address: 'stage6 smoke test after sales shipping address',
      financeMark: true,
      markedById: admin.id,
      markedAt: now,
      notes: 'stage6 smoke test customer for after sales, finance and warehouse',
      createdById: admin.id,
      updatedById: admin.id,
      createdAt: now,
      updatedAt: now,
    },
  });

  const phase6PartialRefundOrder = await upsertSeedSalesOrder(
    {
      orderNo: 'SO-STAGE6-SMOKE-REFUND-001',
      customer: phase6Customer,
      orderDate: businessDate('2026-07-02'),
      salesFormNo: 'SMOKE-FORM-STAGE6-REFUND-001',
      totalAmountCents: 268000,
      logisticsMethod: 'stage6 smoke express',
      packingStatus: 'PACKING',
      packageCount: 1,
      warehouseRemark: 'stage6 smoke test warehouse packing order',
      logisticsNo: 'STAGE6-SMOKE-LOGISTICS-001',
      logisticsFeeCents: 1800,
      invoiceRequired: true,
      invoiceIssued: false,
      financeRemark: 'stage6 smoke test partial refund finance sample',
      remark: 'stage6 smoke test partial_refund order with confirmed refund after sales',
      status: 'PARTIAL_REFUND',
      items: [
        {
          productName: 'Stage6 Smoke Test Refund Wine',
          quantity: 2,
          unitPriceCents: 134000,
          subtotalCents: 268000,
          deliveryType: 'SHIPPING',
          notes: 'stage6 smoke test refund shipping item',
        },
      ],
    },
    admin,
    now,
  );

  const phase6WaitingResendOrder = await upsertSeedSalesOrder(
    {
      orderNo: 'SO-STAGE6-SMOKE-RESEND-001',
      customer: phase6Customer,
      orderDate: businessDate('2026-07-02'),
      salesFormNo: 'SMOKE-FORM-STAGE6-RESEND-001',
      totalAmountCents: 188000,
      logisticsMethod: null,
      packingStatus: 'PENDING',
      packageCount: 0,
      warehouseRemark: 'stage6 smoke test warehouse pending resend order',
      logisticsNo: null,
      logisticsFeeCents: 0,
      invoiceRequired: false,
      invoiceIssued: false,
      financeRemark: 'stage6 smoke test waiting resend finance sample',
      remark: 'stage6 smoke test pending warehouse order with waiting resend after sales',
      status: 'VALID',
      items: [
        {
          productName: 'Stage6 Smoke Test Resend Wine',
          quantity: 1,
          unitPriceCents: 188000,
          subtotalCents: 188000,
          deliveryType: 'SHIPPING',
          notes: 'stage6 smoke test resend shipping item',
        },
      ],
    },
    admin,
    now,
  );

  const phase6PendingRefundOrder = await upsertSeedSalesOrder(
    {
      orderNo: 'SO-STAGE6-SMOKE-PENDING-REFUND-001',
      customer: phase6Customer,
      orderDate: businessDate('2026-07-02'),
      salesFormNo: 'SMOKE-FORM-STAGE6-PENDING-REFUND-001',
      totalAmountCents: 328000,
      logisticsMethod: 'stage6 smoke express',
      packingStatus: 'PACKED',
      packageCount: 2,
      warehouseRemark: 'stage6 smoke test packed order with logistics fee pending',
      logisticsNo: null,
      logisticsFeeCents: 0,
      invoiceRequired: true,
      invoiceIssued: false,
      financeRemark: 'stage6 smoke test logistics number and fee pending sample',
      remark: 'stage6 smoke test order for unconfirmed waiting_refund after sales',
      status: 'VALID',
      items: [
        {
          productName: 'Stage6 Smoke Test Pending Refund Wine',
          quantity: 2,
          unitPriceCents: 164000,
          subtotalCents: 328000,
          deliveryType: 'SHIPPING',
          notes: 'stage6 smoke test pending refund shipping item',
        },
      ],
    },
    admin,
    now,
  );

  const phase6RefundedOrder = await upsertSeedSalesOrder(
    {
      orderNo: 'SO-STAGE6-SMOKE-REFUNDED-001',
      customer: phase6Customer,
      orderDate: businessDate('2026-07-02'),
      salesFormNo: 'SMOKE-FORM-STAGE6-REFUNDED-001',
      totalAmountCents: 98000,
      logisticsMethod: 'stage6 smoke express',
      packingStatus: 'PACKED',
      packageCount: 1,
      warehouseRemark: 'stage6 smoke test packed refunded order',
      logisticsNo: 'STAGE6-SMOKE-LOGISTICS-REFUNDED',
      logisticsFeeCents: 1200,
      invoiceRequired: false,
      invoiceIssued: false,
      financeRemark: 'stage6 smoke test refunded finance sample',
      remark: 'stage6 smoke test refunded order with completed after sales',
      status: 'REFUNDED',
      items: [
        {
          productName: 'Stage6 Smoke Test Refunded Wine',
          quantity: 1,
          unitPriceCents: 98000,
          subtotalCents: 98000,
          deliveryType: 'SHIPPING',
          notes: 'stage6 smoke test refunded shipping item',
        },
      ],
    },
    admin,
    now,
  );

  const phase6CancelledOrder = await upsertSeedSalesOrder(
    {
      orderNo: 'SO-STAGE6-SMOKE-CANCELLED-001',
      customer: phase6Customer,
      orderDate: businessDate('2026-07-02'),
      salesFormNo: 'SMOKE-FORM-STAGE6-CANCELLED-001',
      totalAmountCents: 158000,
      logisticsMethod: null,
      packingStatus: 'ABNORMAL',
      packageCount: 0,
      warehouseRemark: 'stage6 smoke test abnormal cancelled order',
      logisticsNo: null,
      logisticsFeeCents: 0,
      invoiceRequired: false,
      invoiceIssued: false,
      financeRemark: 'stage6 smoke test cancelled finance sample',
      remark: 'stage6 smoke test cancelled order with completed cancel after sales',
      status: 'CANCELLED',
      items: [
        {
          productName: 'Stage6 Smoke Test Cancelled Wine',
          quantity: 1,
          unitPriceCents: 158000,
          subtotalCents: 158000,
          deliveryType: 'SHIPPING',
          notes: 'stage6 smoke test cancelled shipping item',
        },
      ],
    },
    admin,
    now,
  );

  await upsertSeedAfterSalesOrder(
    {
      afterSalesNo: 'AS20260702001',
      salesOrder: phase6PartialRefundOrder,
      customer: phase6Customer,
      issueType: 'QUALITY_ISSUE',
      actionType: 'REFUND',
      description: 'stage6 smoke test customer reports bottle seal issue and requests partial refund',
      resolution: 'stage6 smoke test finance confirmed partial refund',
      refundAmountCents: 5000,
      status: 'WAITING_REFUND',
      financeConfirmed: true,
      financeConfirmedById: 'usr_finance_demo',
      financeConfirmedAt: now,
      handledById: 'usr_after_sales_demo',
      handledAt: now,
      completedAt: null,
      notes: 'stage6 smoke test confirmed refund after sales order',
    },
    admin,
    now,
  );

  await upsertSeedAfterSalesOrder(
    {
      afterSalesNo: 'AS20260702002',
      salesOrder: phase6WaitingResendOrder,
      customer: phase6Customer,
      issueType: 'MISSING_ITEM',
      actionType: 'RESEND',
      description: 'stage6 smoke test customer reports one missing item and waits for resend',
      resolution: 'stage6 smoke test after sales arranged resend package',
      refundAmountCents: 0,
      status: 'WAITING_RESEND',
      financeConfirmed: false,
      financeConfirmedById: null,
      financeConfirmedAt: null,
      handledById: 'usr_after_sales_demo',
      handledAt: now,
      completedAt: null,
      notes: 'stage6 smoke test waiting resend after sales order',
    },
    admin,
    now,
  );

  await upsertSeedAfterSalesOrder(
    {
      afterSalesNo: 'AS20260702003',
      salesOrder: phase6PendingRefundOrder,
      customer: phase6Customer,
      issueType: 'LOGISTICS_DAMAGE',
      actionType: 'REFUND',
      description: 'stage6 smoke test logistics damage refund is waiting for finance confirmation',
      resolution: 'stage6 smoke test negotiated refund waiting finance confirmation',
      refundAmountCents: 2000,
      status: 'WAITING_REFUND',
      financeConfirmed: false,
      financeConfirmedById: null,
      financeConfirmedAt: null,
      handledById: 'usr_after_sales_demo',
      handledAt: now,
      completedAt: null,
      notes: 'stage6 smoke test unconfirmed waiting refund after sales order',
    },
    admin,
    now,
  );

  await upsertSeedAfterSalesOrder(
    {
      afterSalesNo: 'AS20260702004',
      salesOrder: phase6RefundedOrder,
      customer: phase6Customer,
      issueType: 'CUSTOMER_RETURN',
      actionType: 'RETURN_REFUND',
      description: 'stage6 smoke test customer return completed with full refund',
      resolution: 'stage6 smoke test returned goods received and refund completed',
      refundAmountCents: 98000,
      status: 'COMPLETED',
      financeConfirmed: true,
      financeConfirmedById: 'usr_finance_demo',
      financeConfirmedAt: now,
      handledById: 'usr_after_sales_demo',
      handledAt: now,
      completedAt: now,
      notes: 'stage6 smoke test completed refunded after sales order',
    },
    admin,
    now,
  );

  await upsertSeedAfterSalesOrder(
    {
      afterSalesNo: 'AS20260702005',
      salesOrder: phase6CancelledOrder,
      customer: phase6Customer,
      issueType: 'OTHER',
      actionType: 'CANCEL_ORDER',
      description: 'stage6 smoke test customer cancels order before delivery',
      resolution: 'stage6 smoke test cancelled order recorded by after sales',
      refundAmountCents: 0,
      status: 'COMPLETED',
      financeConfirmed: false,
      financeConfirmedById: null,
      financeConfirmedAt: null,
      handledById: 'usr_after_sales_demo',
      handledAt: now,
      completedAt: now,
      notes: 'stage6 smoke test completed cancelled after sales order',
    },
    admin,
    now,
  );

  await seedStage7CommissionAndPoints({
    admin,
    stage7Users,
    now,
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

type SeedUser = {
  id: string;
};

type Stage7SeedUsers = {
  salesLeader: SeedUser;
  outreach: SeedUser;
  salesNoLeader: SeedUser;
};

type SeedCustomer = {
  id: string;
  name: string;
  phone?: string | null;
  province?: string | null;
  city?: string | null;
  district?: string | null;
  address?: string | null;
};

type SeedSalesOrderItem = {
  productName: string;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
  deliveryType: string;
  notes?: string | null;
};

type SeedSalesOrderInput = {
  orderNo: string;
  customer: SeedCustomer;
  orderDate: Date;
  orderType?: string;
  travelGroupId?: string | null;
  salesUserId?: string | null;
  outreachUserId?: string | null;
  salesFormNo: string;
  totalAmountCents: number;
  cashOnDeliveryAmountCents?: number;
  logisticsMethod?: string | null;
  packingStatus: string;
  packageCount: number;
  warehouseRemark: string;
  logisticsNo?: string | null;
  logisticsFeeCents: number;
  invoiceRequired: boolean;
  invoiceIssued: boolean;
  financeRemark: string;
  remark: string;
  status: string;
  items: SeedSalesOrderItem[];
};

type SeedAfterSalesOrderInput = {
  afterSalesNo: string;
  salesOrder: {
    id: string;
  };
  customer?: {
    id: string;
  } | null;
  issueType: string;
  actionType: string;
  description: string;
  resolution?: string | null;
  refundAmountCents: number;
  status: string;
  financeConfirmed: boolean;
  financeConfirmedById?: string | null;
  financeConfirmedAt?: Date | null;
  handledById?: string | null;
  handledAt?: Date | null;
  completedAt?: Date | null;
  notes?: string | null;
};

async function upsertSeedSalesOrder(
  order: SeedSalesOrderInput,
  admin: SeedUser,
  now: Date,
) {
  const customer = order.customer;
  const orderData = {
    orderType: order.orderType ?? 'EXTERNAL',
    travelGroupId: order.travelGroupId ?? null,
    customerId: customer.id,
    customerName: customer.name,
    customerPhone: customer.phone ?? null,
    province: customer.province ?? null,
    city: customer.city ?? null,
    district: customer.district ?? null,
    address: customer.address ?? null,
    orderDate: order.orderDate,
    salesFormNo: order.salesFormNo,
    totalAmountCents: order.totalAmountCents,
    cashOnDeliveryAmountCents: order.cashOnDeliveryAmountCents ?? 0,
    logisticsMethod: order.logisticsMethod ?? null,
    packingStatus: order.packingStatus,
    packageCount: order.packageCount,
    warehouseRemark: order.warehouseRemark,
    logisticsNo: order.logisticsNo ?? null,
    logisticsFeeCents: order.logisticsFeeCents,
    invoiceRequired: order.invoiceRequired,
    invoiceIssued: order.invoiceIssued,
    financeRemark: order.financeRemark,
    remark: order.remark,
    status: order.status,
    financeMark: true,
    markedById: admin.id,
    markedAt: now,
    salesUserId: order.salesUserId ?? 'usr_sales_demo',
    outreachUserId: order.outreachUserId ?? null,
    updatedById: admin.id,
    updatedAt: now,
  };
  const items = buildSeedSalesOrderItems(order.items, now);

  return prisma.salesOrder.upsert({
    where: {
      orderNo: order.orderNo,
    },
    update: {
      ...orderData,
      items: {
        deleteMany: {},
        create: items,
      },
    },
    create: {
      orderNo: order.orderNo,
      ...orderData,
      createdById: admin.id,
      createdAt: now,
      items: {
        create: items,
      },
    },
  });
}

function buildSeedSalesOrderItems(items: SeedSalesOrderItem[], now: Date) {
  return items.map((item, index) => ({
    productName: item.productName,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    subtotalCents: item.subtotalCents,
    deliveryType: item.deliveryType,
    notes: item.notes ?? null,
    sortOrder: index + 1,
    createdAt: now,
  }));
}

async function upsertSeedAfterSalesOrder(
  afterSalesOrder: SeedAfterSalesOrderInput,
  admin: SeedUser,
  now: Date,
) {
  const afterSalesData = {
    salesOrderId: afterSalesOrder.salesOrder.id,
    customerId: afterSalesOrder.customer?.id ?? null,
    issueType: afterSalesOrder.issueType,
    actionType: afterSalesOrder.actionType,
    description: afterSalesOrder.description,
    resolution: afterSalesOrder.resolution ?? null,
    refundAmountCents: afterSalesOrder.refundAmountCents,
    status: afterSalesOrder.status,
    financeConfirmed: afterSalesOrder.financeConfirmed,
    financeConfirmedById: afterSalesOrder.financeConfirmedById ?? null,
    financeConfirmedAt: afterSalesOrder.financeConfirmedAt ?? null,
    handledById: afterSalesOrder.handledById ?? null,
    handledAt: afterSalesOrder.handledAt ?? null,
    completedAt: afterSalesOrder.completedAt ?? null,
    notes: afterSalesOrder.notes ?? null,
    updatedById: admin.id,
    updatedAt: now,
  };

  return prisma.afterSalesOrder.upsert({
    where: {
      afterSalesNo: afterSalesOrder.afterSalesNo,
    },
    update: afterSalesData,
    create: {
      afterSalesNo: afterSalesOrder.afterSalesNo,
      ...afterSalesData,
      createdById: admin.id,
      createdAt: now,
    },
  });
}

async function upsertStage7Users(
  demoPassword: string,
  now: Date,
): Promise<Stage7SeedUsers> {
  const passwordHash = hashPassword(demoPassword);
  const salesLeader = await prisma.user.upsert({
    where: {
      username: 'sales_leader_test',
    },
    update: {
      name: 'Stage7 test sales leader',
      role: 'SALES',
      leaderId: null,
      isActive: true,
      updatedAt: now,
    },
    create: {
      id: 'usr_sales_leader_test',
      name: 'Stage7 test sales leader',
      username: 'sales_leader_test',
      passwordHash,
      role: 'SALES',
      leaderId: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  });

  const outreach = await prisma.user.upsert({
    where: {
      username: 'outreach_test',
    },
    update: {
      name: 'Stage7 smoke outreach user',
      role: 'SALES',
      leaderId: null,
      isActive: true,
      updatedAt: now,
    },
    create: {
      id: 'usr_outreach_test',
      name: 'Stage7 smoke outreach user',
      username: 'outreach_test',
      passwordHash,
      role: 'SALES',
      leaderId: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  });

  const salesNoLeader = await prisma.user.upsert({
    where: {
      username: 'sales_no_leader_test',
    },
    update: {
      name: 'Stage7 test sales without leader',
      role: 'SALES',
      leaderId: null,
      isActive: true,
      updatedAt: now,
    },
    create: {
      id: 'usr_sales_no_leader_test',
      name: 'Stage7 test sales without leader',
      username: 'sales_no_leader_test',
      passwordHash,
      role: 'SALES',
      leaderId: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  });

  await prisma.user.update({
    where: {
      username: 'sales',
    },
    data: {
      leaderId: salesLeader.id,
      updatedAt: now,
    },
  });

  return {
    salesLeader,
    outreach,
    salesNoLeader,
  };
}

async function seedStage7CommissionAndPoints({
  admin,
  stage7Users,
  now,
}: {
  admin: SeedUser;
  stage7Users: Stage7SeedUsers;
  now: Date;
}) {
  const financeUserId = 'usr_finance_demo';
  const salesUserId = 'usr_sales_demo';

  const smokeAgency = await upsertStage7TravelAgency({
    name: 'Stage7 Smoke Agency',
    contactName: 'stage7 smoke contact',
    contactPhone: 's7-smoke-ct',
    notes: 'stage7 smoke test travel agency for commission and points seed',
    now,
  });
  const legacyAgency = await upsertStage7TravelAgency({
    name: 'Stage7 Test Legacy Agency',
    contactName: 'stage7 test legacy contact',
    contactPhone: 's7-test-ct',
    notes: 'stage7 test legacy agency name used for agencyName rule matching',
    now,
  });

  const commissionRules = await upsertStage7CommissionRules(admin.id, now);
  const salesDeductionRules = await upsertStage7SalesDeductionRules(
    admin.id,
    now,
  );
  const agencyDeductionRules = await upsertStage7AgencyDeductionRules({
    adminId: admin.id,
    now,
    smokeAgency,
    legacyAgency,
  });
  const agencyRebateRules = await upsertStage7AgencyRebateRules({
    adminId: admin.id,
    now,
    smokeAgency,
    legacyAgency,
  });

  const smokeGuide = await prisma.guide.upsert({
    where: {
      phone: 's7-smoke-guide',
    },
    update: {
      name: 'Stage7 Smoke Guide',
      travelAgency: smokeAgency.name,
      remarks: 'stage7 smoke test guide for commission seed',
      isActive: true,
      updatedAt: now,
    },
    create: {
      name: 'Stage7 Smoke Guide',
      phone: 's7-smoke-guide',
      travelAgency: smokeAgency.name,
      remarks: 'stage7 smoke test guide for commission seed',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  });

  const legacyGuide = await prisma.guide.upsert({
    where: {
      phone: 's7-test-guide',
    },
    update: {
      name: 'Stage7 Test Legacy Guide',
      travelAgency: legacyAgency.name,
      remarks: 'stage7 test guide for agencyName matching seed',
      isActive: true,
      updatedAt: now,
    },
    create: {
      name: 'Stage7 Test Legacy Guide',
      phone: 's7-test-guide',
      travelAgency: legacyAgency.name,
      remarks: 'stage7 test guide for agencyName matching seed',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  });

  const chainGroup = await upsertStage7TravelGroup({
    groupNo: 'TG-STAGE7-SMOKE-CHAIN-001',
    visitDate: businessDate('2026-07-03'),
    travelAgency: smokeAgency.name,
    guideName: smokeGuide.name,
    guidePhone: smokeGuide.phone,
    guideId: smokeGuide.id,
    remarks:
      'stage7 smoke complete chain travel group with sales, outreach, leader, taster, refunds and summary',
    salesAmountCents: 1000000,
    liquorCostDeductionCents: 270000,
    orderAmountCents: 630000,
    points: 31500,
    returnedPoints: 5000,
    unreturnedPoints: 26500,
    guideInfoSent: true,
    travelAgencyInfoSent: false,
    admin,
    now,
  });

  const refundedGroup = await upsertStage7TravelGroup({
    groupNo: 'TG-STAGE7-SMOKE-REFUNDED-001',
    visitDate: businessDate('2026-07-03'),
    travelAgency: smokeAgency.name,
    guideName: smokeGuide.name,
    guidePhone: smokeGuide.phone,
    guideId: smokeGuide.id,
    remarks: 'stage7 smoke full refund group with confirmed deduction summary',
    salesAmountCents: 180000,
    liquorCostDeductionCents: 0,
    orderAmountCents: 0,
    points: 0,
    returnedPoints: 0,
    unreturnedPoints: 0,
    guideInfoSent: true,
    travelAgencyInfoSent: true,
    admin,
    now,
  });

  const warningGroup = await upsertStage7TravelGroup({
    groupNo: 'TG-STAGE7-TEST-WARNINGS-001',
    visitDate: businessDate('2026-07-03'),
    travelAgency: 'Stage7 Test Missing Rule Agency',
    guideName: 'Stage7 Test Warning Guide',
    guidePhone: 's7-warn-guide',
    guideId: null,
    remarks: 'stage7 test group for missing rule, outreach and leader warnings',
    salesAmountCents: 800000,
    liquorCostDeductionCents: 0,
    orderAmountCents: 800000,
    points: 0,
    returnedPoints: 0,
    unreturnedPoints: 0,
    guideInfoSent: false,
    travelAgencyInfoSent: false,
    admin,
    now,
  });

  const legacyGroup = await upsertStage7TravelGroup({
    groupNo: 'TG-STAGE7-TEST-LEGACY-001',
    visitDate: businessDate('2026-07-03'),
    travelAgency: legacyAgency.name,
    guideName: legacyGuide.name,
    guidePhone: legacyGuide.phone,
    guideId: legacyGuide.id,
    remarks: 'stage7 test group using legacy agencyName matching rules',
    salesAmountCents: 580000,
    liquorCostDeductionCents: 40000,
    orderAmountCents: 540000,
    points: 21600,
    returnedPoints: 0,
    unreturnedPoints: 21600,
    guideInfoSent: false,
    travelAgencyInfoSent: false,
    admin,
    now,
  });

  const chainCustomer = await upsertStage7Customer({
    id: 'cust_stage7_smoke_chain',
    name: 'Stage7 Smoke Chain Customer',
    phone: 's7-smoke-phone-001',
    address: 'stage7 smoke synthetic address 001',
    notes: 'stage7 smoke customer for complete commission chain',
    admin,
    now,
  });
  const refundedCustomer = await upsertStage7Customer({
    id: 'cust_stage7_smoke_refunded',
    name: 'Stage7 Smoke Refunded Customer',
    phone: 's7-smoke-phone-002',
    address: 'stage7 smoke synthetic address 002',
    notes: 'stage7 smoke customer for full refund order',
    admin,
    now,
  });
  const warningCustomer = await upsertStage7Customer({
    id: 'cust_stage7_test_warnings',
    name: 'Stage7 Test Warning Customer',
    phone: 's7-test-phone-003',
    address: 'stage7 test synthetic address 003',
    notes: 'stage7 test customer for missing rule, outreach and leader warnings',
    admin,
    now,
  });
  const legacyCustomer = await upsertStage7Customer({
    id: 'cust_stage7_test_legacy',
    name: 'Stage7 Test Legacy Customer',
    phone: 's7-test-phone-004',
    address: 'stage7 test synthetic address 004',
    notes: 'stage7 test customer for legacy agencyName matching',
    admin,
    now,
  });

  const chainOrder = await upsertSeedSalesOrder(
    {
      orderNo: 'SO-STAGE7-SMOKE-CHAIN-001',
      orderType: 'TRAVEL_GROUP',
      travelGroupId: chainGroup.id,
      customer: chainCustomer,
      orderDate: businessDate('2026-07-03'),
      salesFormNo: 'SMOKE-FORM-STAGE7-CHAIN-001',
      totalAmountCents: 1000000,
      logisticsMethod: 'stage7 smoke express',
      packingStatus: 'PACKED',
      packageCount: 3,
      warehouseRemark: 'stage7 smoke complete chain packed order',
      logisticsNo: 'STAGE7-SMOKE-LOGISTICS-CHAIN',
      logisticsFeeCents: 2200,
      invoiceRequired: true,
      invoiceIssued: false,
      financeRemark: 'stage7 smoke complete chain finance sample',
      remark:
        'stage7 smoke complete chain order with confirmed and unconfirmed after-sales refunds',
      status: 'PARTIAL_REFUND',
      salesUserId,
      outreachUserId: stage7Users.outreach.id,
      items: [
        {
          productName: 'Stage7 Smoke Chain Wine A',
          quantity: 5,
          unitPriceCents: 100000,
          subtotalCents: 500000,
          deliveryType: 'SHIPPING',
          notes: 'stage7 smoke chain wine item covered by rules',
        },
        {
          productName: 'Stage7 Smoke Chain Gift Box B',
          quantity: 2,
          unitPriceCents: 250000,
          subtotalCents: 500000,
          deliveryType: 'SELF_PICKUP',
          notes: 'stage7 smoke chain gift box item covered by rules',
        },
      ],
    },
    admin,
    now,
  );

  const refundedOrder = await upsertSeedSalesOrder(
    {
      orderNo: 'SO-STAGE7-SMOKE-REFUNDED-001',
      orderType: 'TRAVEL_GROUP',
      travelGroupId: refundedGroup.id,
      customer: refundedCustomer,
      orderDate: businessDate('2026-07-03'),
      salesFormNo: 'SMOKE-FORM-STAGE7-REFUNDED-001',
      totalAmountCents: 180000,
      logisticsMethod: 'stage7 smoke express',
      packingStatus: 'PACKED',
      packageCount: 1,
      warehouseRemark: 'stage7 smoke refunded packed order',
      logisticsNo: 'STAGE7-SMOKE-LOGISTICS-REFUNDED',
      logisticsFeeCents: 1200,
      invoiceRequired: false,
      invoiceIssued: false,
      financeRemark: 'stage7 smoke full refund finance sample',
      remark: 'stage7 smoke full refund order for zero commission and points',
      status: 'REFUNDED',
      salesUserId,
      outreachUserId: stage7Users.outreach.id,
      items: [
        {
          productName: 'Stage7 Smoke Chain Wine A',
          quantity: 1,
          unitPriceCents: 180000,
          subtotalCents: 180000,
          deliveryType: 'SHIPPING',
          notes: 'stage7 smoke full refund covered rule item',
        },
      ],
    },
    admin,
    now,
  );

  const missingRuleOrder = await upsertSeedSalesOrder(
    {
      orderNo: 'SO-STAGE7-TEST-MISSING-RULE-001',
      orderType: 'TRAVEL_GROUP',
      travelGroupId: warningGroup.id,
      customer: warningCustomer,
      orderDate: businessDate('2026-07-03'),
      salesFormNo: 'TEST-FORM-STAGE7-MISSING-RULE-001',
      totalAmountCents: 220000,
      logisticsMethod: 'stage7 test express',
      packingStatus: 'PENDING',
      packageCount: 0,
      warehouseRemark: 'stage7 test missing rule warehouse sample',
      logisticsNo: null,
      logisticsFeeCents: 0,
      invoiceRequired: false,
      invoiceIssued: false,
      financeRemark: 'stage7 test missing rule finance sample',
      remark: 'stage7 test order intentionally missing sales and agency rules',
      status: 'VALID',
      salesUserId,
      outreachUserId: stage7Users.outreach.id,
      items: [
        {
          productName: 'Stage7 Test Unknown Wine No Rule',
          quantity: 1,
          unitPriceCents: 220000,
          subtotalCents: 220000,
          deliveryType: 'SHIPPING',
          notes: 'stage7 test item intentionally missing deduction rules',
        },
      ],
    },
    admin,
    now,
  );

  const missingOutreachOrder = await upsertSeedSalesOrder(
    {
      orderNo: 'SO-STAGE7-TEST-MISSING-OUTREACH-001',
      orderType: 'TRAVEL_GROUP',
      travelGroupId: legacyGroup.id,
      customer: legacyCustomer,
      orderDate: businessDate('2026-07-03'),
      salesFormNo: 'TEST-FORM-STAGE7-MISSING-OUTREACH-001',
      totalAmountCents: 320000,
      logisticsMethod: 'stage7 test express',
      packingStatus: 'PACKING',
      packageCount: 1,
      warehouseRemark: 'stage7 test missing outreach order',
      logisticsNo: null,
      logisticsFeeCents: 0,
      invoiceRequired: true,
      invoiceIssued: false,
      financeRemark: 'stage7 test missing outreach finance sample',
      remark: 'stage7 test order intentionally leaves outreachUserId empty',
      status: 'VALID',
      salesUserId,
      outreachUserId: null,
      items: [
        {
          productName: 'Stage7 Test Legacy Pack C',
          quantity: 2,
          unitPriceCents: 160000,
          subtotalCents: 320000,
          deliveryType: 'SHIPPING',
          notes: 'stage7 test legacy agency item covered by agencyName rules',
        },
      ],
    },
    admin,
    now,
  );

  const missingLeaderOrder = await upsertSeedSalesOrder(
    {
      orderNo: 'SO-STAGE7-TEST-MISSING-LEADER-001',
      orderType: 'TRAVEL_GROUP',
      travelGroupId: warningGroup.id,
      customer: warningCustomer,
      orderDate: businessDate('2026-07-03'),
      salesFormNo: 'TEST-FORM-STAGE7-MISSING-LEADER-001',
      totalAmountCents: 260000,
      logisticsMethod: 'stage7 test express',
      packingStatus: 'PENDING',
      packageCount: 0,
      warehouseRemark: 'stage7 test missing leader warehouse sample',
      logisticsNo: null,
      logisticsFeeCents: 0,
      invoiceRequired: false,
      invoiceIssued: false,
      financeRemark: 'stage7 test missing leader finance sample',
      remark: 'stage7 test order uses sales account without leaderId',
      status: 'VALID',
      salesUserId: stage7Users.salesNoLeader.id,
      outreachUserId: stage7Users.outreach.id,
      items: [
        {
          productName: 'Stage7 Smoke Chain Wine A',
          quantity: 1,
          unitPriceCents: 260000,
          subtotalCents: 260000,
          deliveryType: 'SHIPPING',
          notes: 'stage7 test item covered by product rule but sales has no leader',
        },
      ],
    },
    admin,
    now,
  );

  const confirmedAfterSales = await upsertSeedAfterSalesOrder(
    {
      afterSalesNo: 'AS-STAGE7-SMOKE-CHAIN-CONFIRMED',
      salesOrder: chainOrder,
      customer: chainCustomer,
      issueType: 'QUALITY_ISSUE',
      actionType: 'REFUND',
      description:
        'stage7 smoke confirmed refund for complete commission chain order',
      resolution:
        'stage7 smoke finance confirmed refund for commission adjustment',
      refundAmountCents: 100000,
      status: 'COMPLETED',
      financeConfirmed: true,
      financeConfirmedById: financeUserId,
      financeConfirmedAt: now,
      handledById: 'usr_after_sales_demo',
      handledAt: now,
      completedAt: now,
      notes: 'stage7 smoke confirmed refund participates in commission calculation',
    },
    admin,
    now,
  );

  const pendingAfterSales = await upsertSeedAfterSalesOrder(
    {
      afterSalesNo: 'AS-STAGE7-SMOKE-CHAIN-PENDING',
      salesOrder: chainOrder,
      customer: chainCustomer,
      issueType: 'LOGISTICS_DAMAGE',
      actionType: 'REFUND',
      description:
        'stage7 smoke pending refund for warning before finance confirmation',
      resolution: 'stage7 smoke pending refund waiting finance confirmation',
      refundAmountCents: 30000,
      status: 'WAITING_REFUND',
      financeConfirmed: false,
      financeConfirmedById: null,
      financeConfirmedAt: null,
      handledById: 'usr_after_sales_demo',
      handledAt: now,
      completedAt: null,
      notes: 'stage7 smoke unconfirmed refund should only produce pending adjustment warning',
    },
    admin,
    now,
  );

  await upsertSeedAfterSalesOrder(
    {
      afterSalesNo: 'AS-STAGE7-SMOKE-REFUNDED-FULL',
      salesOrder: refundedOrder,
      customer: refundedCustomer,
      issueType: 'CUSTOMER_RETURN',
      actionType: 'RETURN_REFUND',
      description: 'stage7 smoke full refund after-sales order',
      resolution: 'stage7 smoke full refund confirmed by finance',
      refundAmountCents: 180000,
      status: 'COMPLETED',
      financeConfirmed: true,
      financeConfirmedById: financeUserId,
      financeConfirmedAt: now,
      handledById: 'usr_after_sales_demo',
      handledAt: now,
      completedAt: now,
      notes: 'stage7 smoke full refund should zero out automatic commission and points',
    },
    admin,
    now,
  );

  await upsertStage7CommissionRecords({
    admin,
    now,
    chainOrder,
    chainGroup,
    smokeAgency,
    stage7Users,
    commissionRules,
    salesDeductionRules,
    agencyDeductionRules,
    agencyRebateRules,
    confirmedAfterSales,
    pendingAfterSales,
  });

  await upsertStage7TravelGroupSummaries({
    admin,
    now,
    chainGroup,
    refundedGroup,
    chainOrder,
    refundedOrder,
    smokeAgency,
    confirmedAfterSales,
    pendingAfterSales,
  });

  await prisma.operationLog.upsert({
    where: {
      id: 'op_seed_stage7_commission_points',
    },
    update: {
      userId: admin.id,
      action: 'seed.stage7_commission_points',
      entityType: 'system',
      entityId: 'stage7',
      afterData: {
        testData: true,
        users: [
          stage7Users.salesLeader.id,
          stage7Users.outreach.id,
          stage7Users.salesNoLeader.id,
        ],
        orders: [
          chainOrder.orderNo,
          refundedOrder.orderNo,
          missingRuleOrder.orderNo,
          missingOutreachOrder.orderNo,
          missingLeaderOrder.orderNo,
        ],
        rules: [
          commissionRules.sales.id,
          commissionRules.outreach.id,
          commissionRules.leader.id,
        ],
      },
      createdAt: now,
    },
    create: {
      id: 'op_seed_stage7_commission_points',
      userId: admin.id,
      action: 'seed.stage7_commission_points',
      entityType: 'system',
      entityId: 'stage7',
      afterData: {
        testData: true,
        users: [
          stage7Users.salesLeader.id,
          stage7Users.outreach.id,
          stage7Users.salesNoLeader.id,
        ],
        orders: [
          chainOrder.orderNo,
          refundedOrder.orderNo,
          missingRuleOrder.orderNo,
          missingOutreachOrder.orderNo,
          missingLeaderOrder.orderNo,
        ],
        rules: [
          commissionRules.sales.id,
          commissionRules.outreach.id,
          commissionRules.leader.id,
        ],
      },
      createdAt: now,
    },
  });
}

async function upsertStage7TravelAgency({
  name,
  contactName,
  contactPhone,
  notes,
  now,
}: {
  name: string;
  contactName: string;
  contactPhone: string;
  notes: string;
  now: Date;
}) {
  return prisma.travelAgency.upsert({
    where: {
      name,
    },
    update: {
      contactName,
      contactPhone,
      notes,
      updatedAt: now,
    },
    create: {
      name,
      contactName,
      contactPhone,
      notes,
      createdAt: now,
      updatedAt: now,
    },
  });
}

async function upsertStage7CommissionRules(adminId: string, now: Date) {
  const [sales, outreach, leader] = await Promise.all([
    prisma.commissionRule.upsert({
      where: { id: 'rule_s7_smoke_sales' },
      update: {
        ruleName: 'stage7 smoke sales commission 0.0200',
        targetType: 'SALES_COMMISSION',
        rate: '0.0200',
        effectiveFrom: businessDate('2026-01-01'),
        effectiveTo: null,
        isActive: true,
        notes: 'stage7 smoke default sales commission rule',
        updatedById: adminId,
        updatedAt: now,
      },
      create: {
        id: 'rule_s7_smoke_sales',
        ruleName: 'stage7 smoke sales commission 0.0200',
        targetType: 'SALES_COMMISSION',
        rate: '0.0200',
        effectiveFrom: businessDate('2026-01-01'),
        effectiveTo: null,
        isActive: true,
        notes: 'stage7 smoke default sales commission rule',
        createdById: adminId,
        updatedById: adminId,
        createdAt: now,
        updatedAt: now,
      },
    }),
    prisma.commissionRule.upsert({
      where: { id: 'rule_s7_smoke_outreach' },
      update: {
        ruleName: 'stage7 smoke outreach commission 0.0080',
        targetType: 'OUTREACH_COMMISSION',
        rate: '0.0080',
        effectiveFrom: businessDate('2026-01-01'),
        effectiveTo: null,
        isActive: true,
        notes: 'stage7 smoke default outreach commission rule',
        updatedById: adminId,
        updatedAt: now,
      },
      create: {
        id: 'rule_s7_smoke_outreach',
        ruleName: 'stage7 smoke outreach commission 0.0080',
        targetType: 'OUTREACH_COMMISSION',
        rate: '0.0080',
        effectiveFrom: businessDate('2026-01-01'),
        effectiveTo: null,
        isActive: true,
        notes: 'stage7 smoke default outreach commission rule',
        createdById: adminId,
        updatedById: adminId,
        createdAt: now,
        updatedAt: now,
      },
    }),
    prisma.commissionRule.upsert({
      where: { id: 'rule_s7_smoke_leader' },
      update: {
        ruleName: 'stage7 smoke leader commission 0.0024',
        targetType: 'LEADER_COMMISSION',
        rate: '0.0024',
        effectiveFrom: businessDate('2026-01-01'),
        effectiveTo: null,
        isActive: true,
        notes: 'stage7 smoke default leader commission rule',
        updatedById: adminId,
        updatedAt: now,
      },
      create: {
        id: 'rule_s7_smoke_leader',
        ruleName: 'stage7 smoke leader commission 0.0024',
        targetType: 'LEADER_COMMISSION',
        rate: '0.0024',
        effectiveFrom: businessDate('2026-01-01'),
        effectiveTo: null,
        isActive: true,
        notes: 'stage7 smoke default leader commission rule',
        createdById: adminId,
        updatedById: adminId,
        createdAt: now,
        updatedAt: now,
      },
    }),
  ]);

  return { sales, outreach, leader };
}

async function upsertStage7SalesDeductionRules(adminId: string, now: Date) {
  const [wineA, giftBoxB, legacyPackC] = await Promise.all([
    prisma.salesDeductionRule.upsert({
      where: { id: 'sdr_s7_wine_a' },
      update: {
        productName: 'Stage7 Smoke Chain Wine A',
        deductionCostCents: 40000,
        effectiveFrom: businessDate('2026-01-01'),
        effectiveTo: null,
        isActive: true,
        notes: 'stage7 smoke sales deduction rule for wine A',
        updatedById: adminId,
        updatedAt: now,
      },
      create: {
        id: 'sdr_s7_wine_a',
        productName: 'Stage7 Smoke Chain Wine A',
        deductionCostCents: 40000,
        effectiveFrom: businessDate('2026-01-01'),
        effectiveTo: null,
        isActive: true,
        notes: 'stage7 smoke sales deduction rule for wine A',
        createdById: adminId,
        updatedById: adminId,
        createdAt: now,
        updatedAt: now,
      },
    }),
    prisma.salesDeductionRule.upsert({
      where: { id: 'sdr_s7_gift_b' },
      update: {
        productName: 'Stage7 Smoke Chain Gift Box B',
        deductionCostCents: 50000,
        effectiveFrom: businessDate('2026-01-01'),
        effectiveTo: null,
        isActive: true,
        notes: 'stage7 smoke sales deduction rule for gift box B',
        updatedById: adminId,
        updatedAt: now,
      },
      create: {
        id: 'sdr_s7_gift_b',
        productName: 'Stage7 Smoke Chain Gift Box B',
        deductionCostCents: 50000,
        effectiveFrom: businessDate('2026-01-01'),
        effectiveTo: null,
        isActive: true,
        notes: 'stage7 smoke sales deduction rule for gift box B',
        createdById: adminId,
        updatedById: adminId,
        createdAt: now,
        updatedAt: now,
      },
    }),
    prisma.salesDeductionRule.upsert({
      where: { id: 'sdr_s7_pack_c' },
      update: {
        productName: 'Stage7 Test Legacy Pack C',
        deductionCostCents: 30000,
        effectiveFrom: businessDate('2026-01-01'),
        effectiveTo: null,
        isActive: true,
        notes: 'stage7 test sales deduction rule for legacy pack C',
        updatedById: adminId,
        updatedAt: now,
      },
      create: {
        id: 'sdr_s7_pack_c',
        productName: 'Stage7 Test Legacy Pack C',
        deductionCostCents: 30000,
        effectiveFrom: businessDate('2026-01-01'),
        effectiveTo: null,
        isActive: true,
        notes: 'stage7 test sales deduction rule for legacy pack C',
        createdById: adminId,
        updatedById: adminId,
        createdAt: now,
        updatedAt: now,
      },
    }),
  ]);

  return { wineA, giftBoxB, legacyPackC };
}

async function upsertStage7AgencyDeductionRules({
  adminId,
  now,
  smokeAgency,
  legacyAgency,
}: {
  adminId: string;
  now: Date;
  smokeAgency: { id: string; name: string };
  legacyAgency: { id: string; name: string };
}) {
  const [wineA, giftBoxB, legacyPackC] = await Promise.all([
    prisma.agencyDeductionRule.upsert({
      where: { id: 'adr_s7_smoke_wine_a' },
      update: {
        agencyId: smokeAgency.id,
        agencyName: smokeAgency.name,
        productName: 'Stage7 Smoke Chain Wine A',
        deductionCostCents: 30000,
        effectiveFrom: businessDate('2026-01-01'),
        effectiveTo: null,
        isActive: true,
        notes: 'stage7 smoke agency deduction rule for wine A',
        updatedById: adminId,
        updatedAt: now,
      },
      create: {
        id: 'adr_s7_smoke_wine_a',
        agencyId: smokeAgency.id,
        agencyName: smokeAgency.name,
        productName: 'Stage7 Smoke Chain Wine A',
        deductionCostCents: 30000,
        effectiveFrom: businessDate('2026-01-01'),
        effectiveTo: null,
        isActive: true,
        notes: 'stage7 smoke agency deduction rule for wine A',
        createdById: adminId,
        updatedById: adminId,
        createdAt: now,
        updatedAt: now,
      },
    }),
    prisma.agencyDeductionRule.upsert({
      where: { id: 'adr_s7_smoke_gift_b' },
      update: {
        agencyId: smokeAgency.id,
        agencyName: smokeAgency.name,
        productName: 'Stage7 Smoke Chain Gift Box B',
        deductionCostCents: 60000,
        effectiveFrom: businessDate('2026-01-01'),
        effectiveTo: null,
        isActive: true,
        notes: 'stage7 smoke agency deduction rule for gift box B',
        updatedById: adminId,
        updatedAt: now,
      },
      create: {
        id: 'adr_s7_smoke_gift_b',
        agencyId: smokeAgency.id,
        agencyName: smokeAgency.name,
        productName: 'Stage7 Smoke Chain Gift Box B',
        deductionCostCents: 60000,
        effectiveFrom: businessDate('2026-01-01'),
        effectiveTo: null,
        isActive: true,
        notes: 'stage7 smoke agency deduction rule for gift box B',
        createdById: adminId,
        updatedById: adminId,
        createdAt: now,
        updatedAt: now,
      },
    }),
    prisma.agencyDeductionRule.upsert({
      where: { id: 'adr_s7_legacy_pack_c' },
      update: {
        agencyId: null,
        agencyName: legacyAgency.name,
        productName: 'Stage7 Test Legacy Pack C',
        deductionCostCents: 20000,
        effectiveFrom: businessDate('2026-01-01'),
        effectiveTo: null,
        isActive: true,
        notes: 'stage7 test agencyName deduction rule for legacy pack C',
        updatedById: adminId,
        updatedAt: now,
      },
      create: {
        id: 'adr_s7_legacy_pack_c',
        agencyId: null,
        agencyName: legacyAgency.name,
        productName: 'Stage7 Test Legacy Pack C',
        deductionCostCents: 20000,
        effectiveFrom: businessDate('2026-01-01'),
        effectiveTo: null,
        isActive: true,
        notes: 'stage7 test agencyName deduction rule for legacy pack C',
        createdById: adminId,
        updatedById: adminId,
        createdAt: now,
        updatedAt: now,
      },
    }),
  ]);

  return { wineA, giftBoxB, legacyPackC };
}

async function upsertStage7AgencyRebateRules({
  adminId,
  now,
  smokeAgency,
  legacyAgency,
}: {
  adminId: string;
  now: Date;
  smokeAgency: { id: string; name: string };
  legacyAgency: { id: string; name: string };
}) {
  const [smoke, legacy] = await Promise.all([
    prisma.agencyRebateRule.upsert({
      where: { id: 'arr_s7_smoke' },
      update: {
        agencyId: smokeAgency.id,
        agencyName: smokeAgency.name,
        dailyRebateRate: '0.0300',
        monthlyRebateRate: '0.0200',
        totalRebateRate: '0.0500',
        effectiveFrom: businessDate('2026-01-01'),
        effectiveTo: null,
        isActive: true,
        notes: 'stage7 smoke agency rebate rule with daily and monthly rates',
        updatedById: adminId,
        updatedAt: now,
      },
      create: {
        id: 'arr_s7_smoke',
        agencyId: smokeAgency.id,
        agencyName: smokeAgency.name,
        dailyRebateRate: '0.0300',
        monthlyRebateRate: '0.0200',
        totalRebateRate: '0.0500',
        effectiveFrom: businessDate('2026-01-01'),
        effectiveTo: null,
        isActive: true,
        notes: 'stage7 smoke agency rebate rule with daily and monthly rates',
        createdById: adminId,
        updatedById: adminId,
        createdAt: now,
        updatedAt: now,
      },
    }),
    prisma.agencyRebateRule.upsert({
      where: { id: 'arr_s7_legacy_name' },
      update: {
        agencyId: null,
        agencyName: legacyAgency.name,
        dailyRebateRate: '0.0250',
        monthlyRebateRate: '0.0150',
        totalRebateRate: '0.0400',
        effectiveFrom: businessDate('2026-01-01'),
        effectiveTo: null,
        isActive: true,
        notes: 'stage7 test legacy agencyName rebate rule',
        updatedById: adminId,
        updatedAt: now,
      },
      create: {
        id: 'arr_s7_legacy_name',
        agencyId: null,
        agencyName: legacyAgency.name,
        dailyRebateRate: '0.0250',
        monthlyRebateRate: '0.0150',
        totalRebateRate: '0.0400',
        effectiveFrom: businessDate('2026-01-01'),
        effectiveTo: null,
        isActive: true,
        notes: 'stage7 test legacy agencyName rebate rule',
        createdById: adminId,
        updatedById: adminId,
        createdAt: now,
        updatedAt: now,
      },
    }),
  ]);

  return { smoke, legacy };
}

async function upsertStage7TravelGroup({
  groupNo,
  visitDate,
  travelAgency,
  guideName,
  guidePhone,
  guideId,
  remarks,
  salesAmountCents,
  liquorCostDeductionCents,
  orderAmountCents,
  points,
  returnedPoints,
  unreturnedPoints,
  guideInfoSent,
  travelAgencyInfoSent,
  admin,
  now,
}: {
  groupNo: string;
  visitDate: Date;
  travelAgency: string;
  guideName: string;
  guidePhone: string;
  guideId: string | null;
  remarks: string;
  salesAmountCents: number;
  liquorCostDeductionCents: number;
  orderAmountCents: number;
  points: number;
  returnedPoints: number;
  unreturnedPoints: number;
  guideInfoSent: boolean;
  travelAgencyInfoSent: boolean;
  admin: SeedUser;
  now: Date;
}) {
  const data = {
    visitDate,
    travelAgency,
    licensePlate: 'stage7-smoke-plate',
    guideName,
    guidePhone,
    guideId,
    guestCount: 18,
    tastingRoomNo: 'stage7-smoke-room',
    tasterName: 'Stage7 Smoke Taster',
    tasterId: 'usr_taster_demo',
    arrivalTime: '10:00',
    groupType: 'stage7 smoke test group',
    wineDetails: 'stage7 smoke/test seed tasting details',
    departureTime: '12:00',
    remarks,
    status: 'ORDERED',
    salesAmountCents,
    paidDepositCents: 0,
    cashOnDeliveryCents: 0,
    liquorCostDeductionCents,
    orderAmountCents,
    points,
    returnedPoints,
    unreturnedPoints,
    guideInfoSent,
    travelAgencyInfoSent,
    financeMark: true,
    markedById: admin.id,
    markedAt: now,
    updatedById: admin.id,
    updatedAt: now,
  };

  return prisma.travelGroup.upsert({
    where: { groupNo },
    update: data,
    create: {
      groupNo,
      ...data,
      createdById: admin.id,
      createdAt: now,
    },
  });
}

async function upsertStage7Customer({
  id,
  name,
  phone,
  address,
  notes,
  admin,
  now,
}: {
  id: string;
  name: string;
  phone: string;
  address: string;
  notes: string;
  admin: SeedUser;
  now: Date;
}) {
  return prisma.customer.upsert({
    where: { id },
    update: {
      name,
      phone,
      province: 'stage7-test-province',
      city: 'stage7-test-city',
      district: 'stage7-test-district',
      address,
      financeMark: true,
      markedById: admin.id,
      markedAt: now,
      notes,
      updatedById: admin.id,
      updatedAt: now,
    },
    create: {
      id,
      name,
      phone,
      province: 'stage7-test-province',
      city: 'stage7-test-city',
      district: 'stage7-test-district',
      address,
      financeMark: true,
      markedById: admin.id,
      markedAt: now,
      notes,
      createdById: admin.id,
      updatedById: admin.id,
      createdAt: now,
      updatedAt: now,
    },
  });
}

async function upsertStage7CommissionRecords({
  admin,
  now,
  chainOrder,
  chainGroup,
  smokeAgency,
  stage7Users,
  commissionRules,
  salesDeductionRules,
  agencyDeductionRules,
  agencyRebateRules,
  confirmedAfterSales,
  pendingAfterSales,
}: {
  admin: SeedUser;
  now: Date;
  chainOrder: { id: string; orderNo: string };
  chainGroup: { id: string; groupNo: string };
  smokeAgency: { id: string; name: string };
  stage7Users: Stage7SeedUsers;
  commissionRules: {
    sales: { id: string };
    outreach: { id: string };
    leader: { id: string };
  };
  salesDeductionRules: {
    wineA: { id: string };
    giftBoxB: { id: string };
  };
  agencyDeductionRules: {
    wineA: { id: string };
    giftBoxB: { id: string };
  };
  agencyRebateRules: {
    smoke: { id: string };
  };
  confirmedAfterSales: { id: string; afterSalesNo: string };
  pendingAfterSales: { id: string; afterSalesNo: string };
}) {
  const commonSourceSnapshot = {
    seed: 'stage7 smoke complete chain',
    orderNo: chainOrder.orderNo,
    travelGroupNo: chainGroup.groupNo,
    agencyName: smokeAgency.name,
    grossAmountCents: 1000000,
    confirmedRefundAmountCents: 100000,
    pendingRefundAmountCents: 30000,
    confirmedAfterSalesIds: [confirmedAfterSales.id],
    pendingAfterSalesIds: [pendingAfterSales.id],
    salesUserId: 'usr_sales_demo',
    outreachUserId: stage7Users.outreach.id,
    leaderId: stage7Users.salesLeader.id,
    tasterId: 'usr_taster_demo',
    warnings: ['stage7_smoke_pending_refund_not_deducted'],
  };
  const salesRuleSnapshot = {
    seed: 'stage7 smoke employee commission rules',
    salesDeductionRuleIds: [
      salesDeductionRules.wineA.id,
      salesDeductionRules.giftBoxB.id,
    ],
    salesDeductionAmountCents: 300000,
  };
  const agencyRuleSnapshot = {
    seed: 'stage7 smoke agency rebate and deduction rules',
    agencyDeductionRuleIds: [
      agencyDeductionRules.wineA.id,
      agencyDeductionRules.giftBoxB.id,
    ],
    agencyRebateRuleId: agencyRebateRules.smoke.id,
    agencyDeductionAmountCents: 270000,
  };

  await upsertStage7CommissionRecord({
    id: 'cr_s7_chain_sales',
    salesOrderId: chainOrder.id,
    travelGroupId: chainGroup.id,
    afterSalesOrderId: null,
    commissionRuleId: commissionRules.sales.id,
    agencyRebateRuleId: null,
    targetType: 'SALES_COMMISSION',
    targetUserId: 'usr_sales_demo',
    agencyId: smokeAgency.id,
    agencyName: smokeAgency.name,
    grossAmountCents: 1000000,
    confirmedRefundAmountCents: 100000,
    baseAmountCents: 600000,
    deductionAmountCents: 300000,
    rateSnapshot: '0.0200',
    amountCents: 12000,
    pointsCents: 0,
    manualInput: false,
    isConfirmed: false,
    confirmedById: null,
    confirmedAt: null,
    calculationNote:
      'stage7 smoke sales commission: (1000000 - 100000 - 300000) * 0.0200 = 12000',
    ruleSnapshot: {
      ...salesRuleSnapshot,
      commissionRuleId: commissionRules.sales.id,
    },
    sourceSnapshot: commonSourceSnapshot,
    admin,
    now,
  });

  await upsertStage7CommissionRecord({
    id: 'cr_s7_chain_outreach',
    salesOrderId: chainOrder.id,
    travelGroupId: chainGroup.id,
    afterSalesOrderId: null,
    commissionRuleId: commissionRules.outreach.id,
    agencyRebateRuleId: null,
    targetType: 'OUTREACH_COMMISSION',
    targetUserId: stage7Users.outreach.id,
    agencyId: smokeAgency.id,
    agencyName: smokeAgency.name,
    grossAmountCents: 1000000,
    confirmedRefundAmountCents: 100000,
    baseAmountCents: 600000,
    deductionAmountCents: 300000,
    rateSnapshot: '0.0080',
    amountCents: 4800,
    pointsCents: 0,
    manualInput: false,
    isConfirmed: false,
    confirmedById: null,
    confirmedAt: null,
    calculationNote:
      'stage7 smoke outreach commission: (1000000 - 100000 - 300000) * 0.0080 = 4800',
    ruleSnapshot: {
      ...salesRuleSnapshot,
      commissionRuleId: commissionRules.outreach.id,
    },
    sourceSnapshot: commonSourceSnapshot,
    admin,
    now,
  });

  await upsertStage7CommissionRecord({
    id: 'cr_s7_chain_leader',
    salesOrderId: chainOrder.id,
    travelGroupId: chainGroup.id,
    afterSalesOrderId: null,
    commissionRuleId: commissionRules.leader.id,
    agencyRebateRuleId: null,
    targetType: 'LEADER_COMMISSION',
    targetUserId: stage7Users.salesLeader.id,
    agencyId: smokeAgency.id,
    agencyName: smokeAgency.name,
    grossAmountCents: 1000000,
    confirmedRefundAmountCents: 100000,
    baseAmountCents: 600000,
    deductionAmountCents: 300000,
    rateSnapshot: '0.0024',
    amountCents: 1440,
    pointsCents: 0,
    manualInput: false,
    isConfirmed: false,
    confirmedById: null,
    confirmedAt: null,
    calculationNote:
      'stage7 smoke leader commission: (1000000 - 100000 - 300000) * 0.0024 = 1440',
    ruleSnapshot: {
      ...salesRuleSnapshot,
      commissionRuleId: commissionRules.leader.id,
    },
    sourceSnapshot: commonSourceSnapshot,
    admin,
    now,
  });

  await upsertStage7CommissionRecord({
    id: 'cr_s7_chain_agency_daily',
    salesOrderId: chainOrder.id,
    travelGroupId: chainGroup.id,
    afterSalesOrderId: null,
    commissionRuleId: null,
    agencyRebateRuleId: agencyRebateRules.smoke.id,
    targetType: 'AGENCY_DAILY_REBATE',
    targetUserId: null,
    agencyId: smokeAgency.id,
    agencyName: smokeAgency.name,
    grossAmountCents: 1000000,
    confirmedRefundAmountCents: 100000,
    baseAmountCents: 630000,
    deductionAmountCents: 270000,
    rateSnapshot: '0.0300',
    amountCents: 0,
    pointsCents: 18900,
    manualInput: false,
    isConfirmed: false,
    confirmedById: null,
    confirmedAt: null,
    calculationNote:
      'stage7 smoke agency daily rebate: (1000000 - 100000 - 270000) * 0.0300 = 18900',
    ruleSnapshot: agencyRuleSnapshot,
    sourceSnapshot: commonSourceSnapshot,
    admin,
    now,
  });

  await upsertStage7CommissionRecord({
    id: 'cr_s7_chain_agency_monthly',
    salesOrderId: chainOrder.id,
    travelGroupId: chainGroup.id,
    afterSalesOrderId: null,
    commissionRuleId: null,
    agencyRebateRuleId: agencyRebateRules.smoke.id,
    targetType: 'AGENCY_MONTHLY_REBATE',
    targetUserId: null,
    agencyId: smokeAgency.id,
    agencyName: smokeAgency.name,
    grossAmountCents: 1000000,
    confirmedRefundAmountCents: 100000,
    baseAmountCents: 630000,
    deductionAmountCents: 270000,
    rateSnapshot: '0.0200',
    amountCents: 0,
    pointsCents: 12600,
    manualInput: false,
    isConfirmed: false,
    confirmedById: null,
    confirmedAt: null,
    calculationNote:
      'stage7 smoke agency monthly rebate: (1000000 - 100000 - 270000) * 0.0200 = 12600',
    ruleSnapshot: agencyRuleSnapshot,
    sourceSnapshot: commonSourceSnapshot,
    admin,
    now,
  });

  await upsertStage7CommissionRecord({
    id: 'cr_s7_taster_manual_pending',
    salesOrderId: null,
    travelGroupId: chainGroup.id,
    afterSalesOrderId: null,
    commissionRuleId: null,
    agencyRebateRuleId: null,
    targetType: 'TASTER_COMMISSION',
    targetUserId: 'usr_taster_demo',
    agencyId: smokeAgency.id,
    agencyName: smokeAgency.name,
    grossAmountCents: 1000000,
    confirmedRefundAmountCents: 100000,
    baseAmountCents: 0,
    deductionAmountCents: 0,
    rateSnapshot: null,
    amountCents: 8800,
    pointsCents: 0,
    manualInput: true,
    isConfirmed: false,
    confirmedById: null,
    confirmedAt: null,
    calculationNote:
      'stage7 smoke taster manual commission pending finance confirmation',
    ruleSnapshot: {
      seed: 'stage7 smoke manual taster commission has no automatic rule',
    },
    sourceSnapshot: commonSourceSnapshot,
    admin,
    now,
  });

  await upsertStage7CommissionRecord({
    id: 'cr_s7_taster_manual_confirmed',
    salesOrderId: null,
    travelGroupId: chainGroup.id,
    afterSalesOrderId: null,
    commissionRuleId: null,
    agencyRebateRuleId: null,
    targetType: 'TASTER_COMMISSION',
    targetUserId: 'usr_taster_demo',
    agencyId: smokeAgency.id,
    agencyName: smokeAgency.name,
    grossAmountCents: 1000000,
    confirmedRefundAmountCents: 100000,
    baseAmountCents: 0,
    deductionAmountCents: 0,
    rateSnapshot: null,
    amountCents: 6600,
    pointsCents: 0,
    manualInput: true,
    isConfirmed: true,
    confirmedById: 'usr_finance_demo',
    confirmedAt: now,
    calculationNote:
      'stage7 smoke taster manual commission already confirmed by finance',
    ruleSnapshot: {
      seed: 'stage7 smoke confirmed manual taster commission has no automatic rule',
    },
    sourceSnapshot: commonSourceSnapshot,
    admin,
    now,
  });
}

async function upsertStage7CommissionRecord(record: {
  id: string;
  salesOrderId: string | null;
  travelGroupId: string | null;
  afterSalesOrderId: string | null;
  commissionRuleId: string | null;
  agencyRebateRuleId: string | null;
  targetType: string;
  targetUserId: string | null;
  agencyId: string | null;
  agencyName: string | null;
  grossAmountCents: number;
  confirmedRefundAmountCents: number;
  baseAmountCents: number;
  deductionAmountCents: number;
  rateSnapshot: string | null;
  amountCents: number;
  pointsCents: number;
  manualInput: boolean;
  isConfirmed: boolean;
  confirmedById: string | null;
  confirmedAt: Date | null;
  calculationNote: string;
  ruleSnapshot: Record<string, unknown>;
  sourceSnapshot: Record<string, unknown>;
  admin: SeedUser;
  now: Date;
}) {
  const data = {
    salesOrderId: record.salesOrderId,
    travelGroupId: record.travelGroupId,
    afterSalesOrderId: record.afterSalesOrderId,
    commissionRuleId: record.commissionRuleId,
    agencyRebateRuleId: record.agencyRebateRuleId,
    targetType: record.targetType,
    targetUserId: record.targetUserId,
    agencyId: record.agencyId,
    agencyName: record.agencyName,
    grossAmountCents: record.grossAmountCents,
    confirmedRefundAmountCents: record.confirmedRefundAmountCents,
    baseAmountCents: record.baseAmountCents,
    deductionAmountCents: record.deductionAmountCents,
    rateSnapshot: record.rateSnapshot,
    amountCents: record.amountCents,
    pointsCents: record.pointsCents,
    manualInput: record.manualInput,
    isConfirmed: record.isConfirmed,
    confirmedById: record.confirmedById,
    confirmedAt: record.confirmedAt,
    calculationVersion: 'stage7_v1',
    calculationNote: record.calculationNote,
    ruleSnapshot: record.ruleSnapshot,
    sourceSnapshot: record.sourceSnapshot,
    updatedById: record.admin.id,
    updatedAt: record.now,
  };

  return prisma.commissionRecord.upsert({
    where: { id: record.id },
    update: data,
    create: {
      id: record.id,
      ...data,
      createdById: record.admin.id,
      createdAt: record.now,
    },
  });
}

async function upsertStage7TravelGroupSummaries({
  admin,
  now,
  chainGroup,
  refundedGroup,
  chainOrder,
  refundedOrder,
  smokeAgency,
  confirmedAfterSales,
  pendingAfterSales,
}: {
  admin: SeedUser;
  now: Date;
  chainGroup: { id: string; groupNo: string };
  refundedGroup: { id: string; groupNo: string };
  chainOrder: { id: string; orderNo: string };
  refundedOrder: { id: string; orderNo: string };
  smokeAgency: { id: string; name: string };
  confirmedAfterSales: { id: string; afterSalesNo: string };
  pendingAfterSales: { id: string; afterSalesNo: string };
}) {
  await upsertStage7TravelGroupFinanceSummary({
    travelGroupId: chainGroup.id,
    totalSalesAmountCents: 1000000,
    confirmedRefundAmountCents: 100000,
    effectiveSalesAmountCents: 900000,
    totalAgencyDeductionCents: 270000,
    agencyDeductionConfirmed: false,
    agencyDeductionConfirmedById: null,
    agencyDeductionConfirmedAt: null,
    totalAgencyNetAmountCents: 630000,
    totalDailyRebateCents: 18900,
    totalMonthlyRebateCents: 12600,
    paidRebateCents: 5000,
    unpaidRebateCents: 26500,
    notes:
      'stage7 smoke summary with unconfirmed agency deduction and pending refund warning',
    guideInfoSent: true,
    travelAgencyInfoSent: false,
    sourceSnapshot: {
      seed: 'stage7 smoke unconfirmed summary',
      travelGroupNo: chainGroup.groupNo,
      orderNos: [chainOrder.orderNo],
      agencyId: smokeAgency.id,
      agencyName: smokeAgency.name,
      confirmedAfterSalesNos: [confirmedAfterSales.afterSalesNo],
      pendingAfterSalesNos: [pendingAfterSales.afterSalesNo],
      warnings: ['stage7_smoke_agency_deduction_not_confirmed'],
    },
    admin,
    now,
  });

  await upsertStage7TravelGroupFinanceSummary({
    travelGroupId: refundedGroup.id,
    totalSalesAmountCents: 180000,
    confirmedRefundAmountCents: 180000,
    effectiveSalesAmountCents: 0,
    totalAgencyDeductionCents: 0,
    agencyDeductionConfirmed: true,
    agencyDeductionConfirmedById: 'usr_finance_demo',
    agencyDeductionConfirmedAt: now,
    totalAgencyNetAmountCents: 0,
    totalDailyRebateCents: 0,
    totalMonthlyRebateCents: 0,
    paidRebateCents: 0,
    unpaidRebateCents: 0,
    notes: 'stage7 smoke summary with confirmed agency deduction after full refund',
    guideInfoSent: true,
    travelAgencyInfoSent: true,
    sourceSnapshot: {
      seed: 'stage7 smoke confirmed summary',
      travelGroupNo: refundedGroup.groupNo,
      orderNos: [refundedOrder.orderNo],
      agencyId: smokeAgency.id,
      agencyName: smokeAgency.name,
      fullRefund: true,
    },
    admin,
    now,
  });
}

async function upsertStage7TravelGroupFinanceSummary(summary: {
  travelGroupId: string;
  totalSalesAmountCents: number;
  confirmedRefundAmountCents: number;
  effectiveSalesAmountCents: number;
  totalAgencyDeductionCents: number;
  agencyDeductionConfirmed: boolean;
  agencyDeductionConfirmedById: string | null;
  agencyDeductionConfirmedAt: Date | null;
  totalAgencyNetAmountCents: number;
  totalDailyRebateCents: number;
  totalMonthlyRebateCents: number;
  paidRebateCents: number;
  unpaidRebateCents: number;
  notes: string;
  guideInfoSent: boolean;
  travelAgencyInfoSent: boolean;
  sourceSnapshot: Record<string, unknown>;
  admin: SeedUser;
  now: Date;
}) {
  const data = {
    totalSalesAmountCents: summary.totalSalesAmountCents,
    confirmedRefundAmountCents: summary.confirmedRefundAmountCents,
    effectiveSalesAmountCents: summary.effectiveSalesAmountCents,
    totalAgencyDeductionCents: summary.totalAgencyDeductionCents,
    agencyDeductionConfirmed: summary.agencyDeductionConfirmed,
    agencyDeductionConfirmedById: summary.agencyDeductionConfirmedById,
    agencyDeductionConfirmedAt: summary.agencyDeductionConfirmedAt,
    totalAgencyNetAmountCents: summary.totalAgencyNetAmountCents,
    totalDailyRebateCents: summary.totalDailyRebateCents,
    totalMonthlyRebateCents: summary.totalMonthlyRebateCents,
    paidRebateCents: summary.paidRebateCents,
    unpaidRebateCents: summary.unpaidRebateCents,
    notes: summary.notes,
    guideInfoSent: summary.guideInfoSent,
    travelAgencyInfoSent: summary.travelAgencyInfoSent,
    calculationVersion: 'stage7_v1',
    sourceSnapshot: summary.sourceSnapshot,
    updatedById: summary.admin.id,
    updatedAt: summary.now,
  };

  return prisma.travelGroupFinanceSummary.upsert({
    where: {
      travelGroupId: summary.travelGroupId,
    },
    update: data,
    create: {
      travelGroupId: summary.travelGroupId,
      ...data,
      createdAt: summary.now,
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
