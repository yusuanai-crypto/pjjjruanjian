import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/core/business/business_api.dart';

void main() {
  test('parses guide JSON and guide library states', () {
    final guide = GuideRecord.fromJson({
      'id': 'guide-1',
      'name': 'Guide One',
      'phone': '13900001111',
      'travelAgency': 'Agency One',
      'remarks': 'Prefers morning groups',
      'isActive': 'true',
      'createdAt': '2026-06-27T08:00:00.000Z',
      'updatedAt': '2026-06-27T09:00:00.000Z',
    });

    expect(guide.id, 'guide-1');
    expect(guide.name, 'Guide One');
    expect(guide.phone, '13900001111');
    expect(guide.travelAgency, 'Agency One');
    expect(guide.remarks, 'Prefers morning groups');
    expect(guide.isActive, isTrue);
    expect(guide.createdAt, '2026-06-27T08:00:00.000Z');
    expect(guide.updatedAt, '2026-06-27T09:00:00.000Z');

    const emptyState = GuideLibraryState.data(<GuideRecord>[]);
    expect(emptyState.isEmpty, isTrue);
    expect(emptyState.loading, isFalse);
    expect(emptyState.hasError, isFalse);

    const loadingState = GuideLibraryState.loading();
    expect(loadingState.loading, isTrue);
    expect(loadingState.isEmpty, isFalse);

    const errorState = GuideLibraryState.error('Failed to load guides');
    expect(errorState.hasError, isTrue);
    expect(errorState.isEmpty, isFalse);

    final agency = TravelAgencyRecord.fromJson({
      'id': 'agency-1',
      'name': 'Agency One',
      'contactName': 'Contact One',
      'contactPhone': '13900003333',
      'notes': 'Often handles morning groups',
      'createdAt': '2026-06-29T08:00:00.000Z',
      'updatedAt': '2026-06-29T09:00:00.000Z',
    });

    expect(agency.id, 'agency-1');
    expect(agency.name, 'Agency One');
    expect(agency.contactName, 'Contact One');
    expect(agency.contactPhone, '13900003333');
    expect(agency.notes, 'Often handles morning groups');
  });

  test('parses customer JSON returned by customer APIs', () {
    final customer = CustomerRecord.fromJson({
      'id': 'customer-1',
      'name': 'Smoke Customer',
      'phone': '13900001111',
      'province': '贵州省',
      'city': '贵阳市',
      'district': '南明区',
      'address': '测试地址 1 号',
      'financeMark': true,
      'markedById': 'usr_finance',
      'markedAt': '2026-06-29T08:00:00.000Z',
      'notes': 'smoke customer note',
      'createdById': 'usr_sales',
      'updatedById': 'usr_after_sales',
      'createdAt': '2026-06-29T07:00:00.000Z',
      'updatedAt': '2026-06-29T09:00:00.000Z',
      'recentOrders': [
        {
          'id': 'order-summary-1',
          'orderNo': 'SO20260629001',
          'customerName': 'Smoke Customer',
          'orderDate': '2026-06-29',
          'totalAmountCents': 39800,
          'deliverySummary': 'shipping',
          'packingStatus': 'pending',
        },
      ],
    });

    expect(customer.id, 'customer-1');
    expect(customer.name, 'Smoke Customer');
    expect(customer.phone, '13900001111');
    expect(customer.financeMark, isTrue);
    expect(customer.markedById, 'usr_finance');
    expect(customer.notes, 'smoke customer note');
    expect(customer.recentOrders.single.orderNo, 'SO20260629001');
    expect(customer.recentOrders.single.deliverySummary, 'shipping');
  });

  test('parses sales order JSON returned by business API', () {
    final order = SalesOrderRecord.fromJson({
      'id': 'order-1',
      'orderNo': 'SO20260629001',
      'orderType': 'travel_group',
      'customerId': 'customer-1',
      'customer': {
        'id': 'customer-1',
        'name': '测试客户',
        'phone': '13900002222',
        'financeMark': true,
      },
      'customerName': '测试客户',
      'customerPhone': '13900002222',
      'salesFormNo': 'FORM-001',
      'orderDate': '2026-06-24',
      'totalAmountCents': 647800,
      'cashOnDeliveryAmountCents': 5000,
      'status': 'valid',
      'deliverySummary': 'shipping',
      'packingStatus': 'pending',
      'logisticsMethod': '顺丰',
      'packageCount': 2,
      'warehouseRemark': '库管备注',
      'logisticsNo': 'SF123456',
      'logisticsFeeCents': 1888,
      'invoiceRequired': true,
      'invoiceIssued': true,
      'financeRemark': '财务备注',
      'financeMark': true,
      'markedById': 'usr_finance',
      'markedAt': '2026-06-24T08:00:00.000Z',
      'salesUserId': 'usr_sales',
      'province': '贵州省',
      'city': '贵阳市',
      'district': '观山湖区',
      'address': '测试地址',
      'items': [
        {
          'id': 'item-1',
          'salesOrderId': 'order-1',
          'productName': '酱香珍藏 53°',
          'quantity': 2,
          'unitPriceCents': 323900,
          'subtotalCents': 647800,
          'deliveryType': 'shipping',
          'notes': '礼盒装',
          'sortOrder': 1,
        },
      ],
      'travelGroup': {
        'id': 'group-1',
        'groupNo': 'GZ-TEST-001',
        'visitDate': '2026-06-24',
        'guestCount': 18,
        'status': 'ordered',
      },
    });

    expect(order.id, 'order-1');
    expect(order.orderNo, 'SO20260629001');
    expect(order.customerId, 'customer-1');
    expect(order.customer?.financeMark, isTrue);
    expect(order.salesFormNo, 'FORM-001');
    expect(order.totalAmountCents, 647800);
    expect(order.deliverySummary, 'shipping');
    expect(order.packingStatus, 'pending');
    expect(order.logisticsMethod, '顺丰');
    expect(order.packageCount, 2);
    expect(order.warehouseRemark, '库管备注');
    expect(order.logisticsNo, 'SF123456');
    expect(order.logisticsFeeCents, 1888);
    expect(order.invoiceRequired, isTrue);
    expect(order.invoiceIssued, isTrue);
    expect(order.financeRemark, '财务备注');
    expect(order.financeMark, isTrue);
    expect(order.address, '贵州省贵阳市观山湖区测试地址');
    expect(order.items, hasLength(1));
    expect(order.items.single.productName, '酱香珍藏 53°');
    expect(order.items.single.unitPriceCents, 323900);
    expect(order.items.single.subtotalCents, 647800);
    expect(order.items.single.notes, '礼盒装');
    expect(order.items.single.sortOrder, 1);
    expect(order.travelGroup?.groupNo, 'GZ-TEST-001');
  });

  test('parses sales order item JSON with subtotal fallback', () {
    final explicitSubtotal = SalesOrderItemRecord.fromJson({
      'id': 'item-1',
      'salesOrderId': 'order-1',
      'productName': '酱香珍藏',
      'quantity': '2',
      'unitPriceCents': '39900',
      'subtotalCents': '79800',
      'deliveryType': 'self_pickup',
      'notes': '客户自带',
      'sortOrder': '3',
    });

    expect(explicitSubtotal.id, 'item-1');
    expect(explicitSubtotal.salesOrderId, 'order-1');
    expect(explicitSubtotal.productName, '酱香珍藏');
    expect(explicitSubtotal.quantity, 2);
    expect(explicitSubtotal.unitPriceCents, 39900);
    expect(explicitSubtotal.subtotalCents, 79800);
    expect(explicitSubtotal.deliveryType, 'self_pickup');
    expect(explicitSubtotal.notes, '客户自带');
    expect(explicitSubtotal.sortOrder, 3);

    final fallbackSubtotal = SalesOrderItemRecord.fromJson({
      'productName': '年份礼盒',
      'quantity': 3,
      'unitPriceCents': 10000,
    });

    expect(fallbackSubtotal.id, isNull);
    expect(fallbackSubtotal.salesOrderId, isNull);
    expect(fallbackSubtotal.subtotalCents, 30000);
    expect(fallbackSubtotal.deliveryType, 'shipping');
    expect(fallbackSubtotal.notes, isNull);
    expect(fallbackSubtotal.sortOrder, 0);
  });

  test('parses after-sales order JSON returned by phase 6 APIs', () {
    final record = AfterSalesOrderRecord.fromJson({
      'id': 'as-1',
      'afterSalesNo': 'AS20260702001',
      'salesOrderId': 'order-1',
      'salesOrder': {
        'id': 'order-1',
        'orderNo': 'SO20260702001',
        'customerName': 'Smoke Customer',
        'orderDate': '2026-07-02',
        'totalAmountCents': 79800,
      },
      'customerId': 'customer-1',
      'customer': {
        'id': 'customer-1',
        'name': 'Smoke Customer',
        'phone': '13900001111',
        'financeMark': true,
      },
      'issueType': 'logistics_damage',
      'actionType': 'refund',
      'description': 'smoke logistics damage',
      'resolution': 'refund shipping damage',
      'refundAmountCents': '5000',
      'status': 'waiting_refund',
      'financeConfirmed': 'false',
      'financeConfirmedById': null,
      'financeConfirmedAt': null,
      'handledById': 'usr_after_sales',
      'handledAt': '2026-07-02T08:10:00.000Z',
      'completedAt': null,
      'notes': 'smoke note',
      'createdById': 'usr_after_sales',
      'updatedById': 'usr_after_sales',
      'createdAt': '2026-07-02T08:00:00.000Z',
      'updatedAt': '2026-07-02T08:10:00.000Z',
    });

    expect(record.afterSalesNo, 'AS20260702001');
    expect(record.salesOrder?.orderNo, 'SO20260702001');
    expect(record.customer?.financeMark, isTrue);
    expect(record.issueType, 'logistics_damage');
    expect(record.actionType, 'refund');
    expect(record.refundAmountCents, 5000);
    expect(record.status, 'waiting_refund');
    expect(record.financeConfirmed, isFalse);
    expect(record.notes, 'smoke note');
    expect(record.financeConfirmedById, isNull);
    expect(record.financeConfirmedAt, isNull);
    expect(record.handledById, 'usr_after_sales');
    expect(record.handledAt, '2026-07-02T08:10:00.000Z');
    expect(record.completedAt, isNull);
    expect(record.createdById, 'usr_after_sales');
    expect(record.updatedById, 'usr_after_sales');
    expect(record.createdAt, '2026-07-02T08:00:00.000Z');
    expect(record.updatedAt, '2026-07-02T08:10:00.000Z');

    final completed = AfterSalesOrderRecord.fromJson({
      'id': 'as-2',
      'afterSalesNo': 'AS20260702002',
      'salesOrderId': 'order-2',
      'customerId': null,
      'issueType': 'customer_return',
      'actionType': 'return_refund',
      'description': 'smoke completed return refund',
      'resolution': 'completed refund confirmed',
      'refundAmountCents': 79800,
      'status': 'completed',
      'financeConfirmed': true,
      'financeConfirmedById': 'usr_finance',
      'financeConfirmedAt': '2026-07-02T09:00:00.000Z',
      'handledById': 'usr_after_sales',
      'handledAt': '2026-07-02T09:05:00.000Z',
      'completedAt': '2026-07-02T09:10:00.000Z',
      'notes': 'smoke complete note',
      'createdById': 'usr_after_sales',
      'updatedById': 'usr_after_sales',
      'createdAt': '2026-07-02T08:30:00.000Z',
      'updatedAt': '2026-07-02T09:10:00.000Z',
    });

    expect(completed.salesOrder, isNull);
    expect(completed.customer, isNull);
    expect(completed.financeConfirmed, isTrue);
    expect(completed.financeConfirmedById, 'usr_finance');
    expect(completed.financeConfirmedAt, '2026-07-02T09:00:00.000Z');
    expect(completed.completedAt, '2026-07-02T09:10:00.000Z');
  });

  test('parses phase 7 commission and rebate JSON records', () {
    final commissionRule = CommissionRuleRecord.fromJson({
      'id': 'rule-commission-1',
      'ruleName': 'test sales commission',
      'targetType': 'sales_commission',
      'rate': '0.0200',
      'effectiveFrom': '2026-07-01',
      'effectiveTo': null,
      'isActive': 'true',
      'notes': 'smoke rule',
      'createdById': 'usr_finance',
      'updatedById': 'usr_finance',
      'createdAt': '2026-07-03T08:00:00.000Z',
      'updatedAt': '2026-07-03T09:00:00.000Z',
    });
    expect(commissionRule.targetType, 'sales_commission');
    expect(commissionRule.rate, '0.0200');
    expect(commissionRule.isActive, isTrue);

    final salesDeductionRule = SalesDeductionRuleRecord.fromJson({
      'id': 'rule-sales-deduction-1',
      'productName': 'test liquor',
      'deductionCostCents': '1200',
      'effectiveFrom': '2026-07-01',
      'isActive': true,
    });
    expect(salesDeductionRule.productName, 'test liquor');
    expect(salesDeductionRule.deductionCostCents, 1200);

    final agencyDeductionRule = AgencyDeductionRuleRecord.fromJson({
      'id': 'rule-agency-deduction-1',
      'agencyId': 'agency-1',
      'agencyName': 'test agency',
      'productName': 'test liquor',
      'deductionCostCents': 800,
      'effectiveFrom': '2026-07-01',
      'isActive': true,
    });
    expect(agencyDeductionRule.agencyId, 'agency-1');
    expect(agencyDeductionRule.productName, 'test liquor');

    final agencyRebateRule = AgencyRebateRuleRecord.fromJson({
      'id': 'rule-agency-rebate-1',
      'agencyName': 'test agency',
      'dailyRebateRate': '0.0300',
      'monthlyRebateRate': '0.0100',
      'totalRebateRate': '0.0400',
      'effectiveFrom': '2026-07-01',
      'isActive': true,
    });
    expect(agencyRebateRule.dailyRebateRate, '0.0300');
    expect(agencyRebateRule.totalRebateRate, '0.0400');

    final importResult = Stage7RuleImportResult.fromJson({
      'totalCount': 2,
      'successCount': 1,
      'failureCount': 1,
      'createdIdsSample': ['rule-sales-deduction-1'],
      'failureSamples': [
        {
          'index': 1,
          'rowNumber': 2,
          'code': 'RULE_EFFECTIVE_RANGE_OVERLAP',
          'message': 'overlap rule',
        },
      ],
      'results': [
        {
          'index': 0,
          'rowNumber': 1,
          'success': true,
          'rule': {
            'id': 'rule-sales-deduction-1',
            'productName': 'test liquor',
          },
        },
        {
          'index': 1,
          'rowNumber': 2,
          'success': false,
          'error': {
            'code': 'RULE_EFFECTIVE_RANGE_OVERLAP',
            'message': 'overlap rule',
          },
        },
      ],
    });
    expect(importResult.successCount, 1);
    expect(importResult.failureSamples.single.rowNumber, 2);
    expect(importResult.results.last.errorCode, 'RULE_EFFECTIVE_RANGE_OVERLAP');

    final commissionJson = {
      'id': 'commission-1',
      'salesOrderId': 'order-1',
      'travelGroupId': 'group-1',
      'commissionRuleId': 'rule-commission-1',
      'targetType': 'sales_commission',
      'targetUserId': 'usr_sales',
      'agencyId': 'agency-1',
      'agencyName': 'test agency',
      'salesOrderNo': 'SO20260703001',
      'salesOrder': {
        'id': 'order-1',
        'orderNo': 'SO20260703001',
        'orderDate': '2026-07-03',
        'status': 'valid',
        'customerName': 'Smoke Customer',
      },
      'travelGroup': {
        'id': 'group-1',
        'groupNo': 'TG-SMOKE-001',
        'visitDate': '2026-07-03',
        'travelAgency': 'test agency',
        'guideName': 'test guide',
        'tasterId': 'usr_taster',
        'tasterName': 'test taster',
        'financeMark': true,
      },
      'customer': {'id': 'customer-1', 'name': 'Smoke Customer'},
      'targetUser': {
        'id': 'usr_sales',
        'name': 'Smoke Sales',
        'username': 'smoke_sales',
        'role': 'sales',
      },
      'agency': {'id': 'agency-1', 'name': 'test agency'},
      'grossAmountCents': 100000,
      'confirmedRefundAmountCents': 10000,
      'baseAmountCents': 90000,
      'deductionAmountCents': 1200,
      'rateSnapshot': '0.0200',
      'amountCents': 1776,
      'pointsCents': 0,
      'manualInput': false,
      'isConfirmed': false,
      'confirmedBy': null,
      'confirmedAt': null,
      'calculationVersion': 'stage7-v1',
      'calculationNote': 'test calculation note',
      'calculationNoteSummary': 'test calculation note',
      'ruleSnapshot': {'rate': '0.0200'},
      'sourceSnapshot': {
        'salesOrder': {'id': 'order-1'},
        'warnings': ['missing_outreach'],
      },
      'createdAt': '2026-07-03T08:00:00.000Z',
      'updatedAt': '2026-07-03T09:00:00.000Z',
    };
    final commission = CommissionRecord.fromJson(commissionJson);
    expect(commission.salesOrderNo, 'SO20260703001');
    expect(commission.travelGroup?.groupNo, 'TG-SMOKE-001');
    expect(commission.customer?.name, 'Smoke Customer');
    expect(commission.targetUser?.username, 'smoke_sales');
    expect(commission.agency?.name, 'test agency');
    expect(commission.baseAmountCents, 90000);
    expect(commission.amountCents, 1776);
    expect(commission.rateSnapshot, '0.0200');
    expect(commission.ruleSnapshot?['rate'], '0.0200');
    expect(commission.sourceSnapshot?['warnings'], ['missing_outreach']);

    final recalculation = CommissionRecalculationResult.fromJson({
      'generatedRecords': [commissionJson],
      'updatedRecords': const [],
      'unchangedRecords': const [],
      'warnings': ['missing_outreach'],
    });
    expect(recalculation.records.single.id, 'commission-1');
    expect(recalculation.warnings, ['missing_outreach']);

    final summaryJson = {
      'id': 'summary-1',
      'travelGroupId': 'group-1',
      'travelGroup': {
        'id': 'group-1',
        'groupNo': 'TG-SMOKE-001',
        'visitDate': '2026-07-03',
        'travelAgency': 'test agency',
        'guideName': 'test guide',
        'financeMark': true,
      },
      'totalSalesAmountCents': 100000,
      'confirmedRefundAmountCents': 10000,
      'effectiveSalesAmountCents': 90000,
      'totalAgencyDeductionCents': 800,
      'agencyDeductionConfirmed': true,
      'agencyDeductionConfirmedById': 'usr_finance',
      'agencyDeductionConfirmedBy': {
        'id': 'usr_finance',
        'name': 'Smoke Finance',
        'username': 'finance',
        'role': 'finance',
      },
      'agencyDeductionConfirmedAt': '2026-07-03T09:10:00.000Z',
      'totalAgencyNetAmountCents': 89200,
      'totalDailyRebateCents': 2676,
      'totalMonthlyRebateCents': 892,
      'paidRebateCents': 1000,
      'unpaidRebateCents': 2568,
      'notes': 'test summary note',
      'guideInfoSent': true,
      'travelAgencyInfoSent': false,
      'calculationVersion': 'stage7-v1',
      'sourceSnapshot': {'orders': []},
      'updatedBy': {
        'id': 'usr_finance',
        'name': 'Smoke Finance',
        'username': 'finance',
        'role': 'finance',
      },
    };
    final summary = TravelGroupFinanceSummaryRecord.fromJson(summaryJson);
    expect(summary.travelGroup?.guideName, 'test guide');
    expect(summary.effectiveSalesAmountCents, 90000);
    expect(summary.totalAgencyNetAmountCents, 89200);
    expect(summary.agencyDeductionConfirmedBy?.role, 'finance');
    expect(summary.sourceSnapshot?['orders'], const []);

    final refresh = TravelGroupFinanceSummaryRefreshResult.fromJson({
      'travelGroupFinanceSummary': summaryJson,
      'amountChanged': true,
      'agencyDeductionConfirmationReset': false,
    });
    expect(refresh.travelGroupFinanceSummary?.id, 'summary-1');
    expect(refresh.amountChanged, isTrue);
    expect(refresh.agencyDeductionConfirmationReset, isFalse);
  });

  test('parses sales sheet JSON and tolerates missing fields', () {
    final sheet = SalesSheetRecord.fromJson({
      'visibility': 'internal',
      'companyName': '贵州酱酒馆',
      'order': {
        'id': 'order-1',
        'orderNo': 'SO20260701001',
        'orderType': 'travel_group',
        'orderTypeLabel': '旅行团订单',
        'salesFormNo': 'FORM-001',
        'orderDate': '2026-07-01',
        'remark': '客户需要礼袋',
      },
      'customer': {
        'id': 'customer-1',
        'name': '测试客户',
        'phone': '13800000000',
        'phoneMasked': '138****0000',
        'province': '贵州省',
        'city': '贵阳市',
        'district': '南明区',
        'address': '测试地址',
        'fullAddress': '贵州省贵阳市南明区测试地址',
      },
      'travelGroup': {
        'id': 'group-1',
        'groupNo': 'TG-001',
        'visitDate': '2026-07-01',
        'travelAgency': '测试旅行社',
        'guideName': '测试导游',
        'guidePhone': '13900001111',
        'tasterName': '测试品鉴师',
        'tastingRoomNo': 'A-101',
        'financeMark': true,
      },
      'salesUser': {
        'id': 'usr_sales',
        'name': '销售一号',
        'username': 'sales',
      },
      'items': [
        {
          'id': 'item-1',
          'productName': '酱香珍藏',
          'quantity': 2,
          'unitPriceCents': 39800,
          'unitPriceYuan': '398.00',
          'subtotalCents': 79600,
          'subtotalYuan': '796.00',
          'deliveryType': 'shipping',
          'deliveryTypeLabel': '邮寄',
          'notes': '礼盒装',
          'sortOrder': 1,
        },
      ],
      'amounts': {
        'totalAmountCents': 79600,
        'totalAmountYuan': '796.00',
        'cashOnDeliveryAmountCents': 1000,
        'cashOnDeliveryAmountYuan': '10.00',
        'logisticsFeeCents': 1200,
        'logisticsFeeYuan': '12.00',
      },
      'status': {'value': 'valid', 'label': '有效'},
      'delivery': {'summary': 'shipping', 'summaryLabel': '邮寄'},
      'logistics': {
        'method': '顺丰',
        'logisticsNo': 'SF123456',
        'packingStatus': 'packed',
        'packingStatusLabel': '已打包',
        'packageCount': 2,
      },
      'invoice': {
        'required': true,
        'requiredLabel': '需要开票',
        'issued': false,
        'issuedLabel': '未开票',
      },
      'qrCode': {
        'token': 'token-1',
        'url': 'https://example.test/public/sales-sheets/token-1',
        'generatedAt': '2026-07-01T08:00:00.000Z',
        'expiresAt': null,
      },
      'internalFields': {
        'financeRemark': '内部财务备注',
        'warehouseRemark': '内部仓库备注',
      },
      'public': {
        'visibility': 'public',
        'companyName': '贵州酱酒馆',
        'order': {
          'orderNo': 'SO20260701001',
          'orderDate': '2026-07-01',
        },
        'customer': {
          'name': '测试客户',
          'phoneMasked': '138****0000',
          'fullAddress': '贵州省贵阳市南明区测试地址',
        },
        'items': [
          {
            'productName': '酱香珍藏',
            'quantity': 2,
            'unitPriceCents': 39800,
            'unitPriceYuan': '398.00',
            'subtotalCents': 79600,
            'subtotalYuan': '796.00',
          },
        ],
        'qrCode': {
          'generatedAt': '2026-07-01T08:00:00.000Z',
          'expiresAt': null,
        },
      },
    });

    expect(sheet.visibility, 'internal');
    expect(sheet.order.id, 'order-1');
    expect(sheet.order.orderNo, 'SO20260701001');
    expect(sheet.customer.phone, '13800000000');
    expect(sheet.customer.phoneMasked, '138****0000');
    expect(sheet.travelGroup?.financeMark, isTrue);
    expect(sheet.salesUser?.username, 'sales');
    expect(sheet.items.single.productName, '酱香珍藏');
    expect(sheet.amounts.totalAmountCents, 79600);
    expect(sheet.amounts.totalAmountYuan, '796.00');
    expect(sheet.logistics.packageCount, 2);
    expect(sheet.invoice.required, isTrue);
    expect(sheet.qrCode?.token, 'token-1');
    expect(sheet.internalFields['financeRemark'], '内部财务备注');
    expect(sheet.public?.visibility, 'public');
    expect(sheet.public?.customer.phone, isNull);
    expect(sheet.public?.qrCode?.token, isNull);
    expect(sheet.public?.internalFields, isEmpty);

    final emptySheet = SalesSheetRecord.fromJson({});
    expect(emptySheet.visibility, 'internal');
    expect(emptySheet.order.orderNo, isNull);
    expect(emptySheet.items, isEmpty);
    expect(emptySheet.qrCode, isNull);
  });

  test('business API calls sales sheet and QR code endpoints', () async {
    final apiClient = _RecordingApiClient();
    final api = BusinessApi(apiClient: apiClient, token: 'token-1');

    apiClient.nextJson = {
      'data': {
        'salesSheet': {
          'order': {'id': 'order-1', 'orderNo': 'SO20260701001'},
          'qrCode': {'token': 'existing-token'},
        },
      },
    };
    final sheet = await api.getSalesOrderSalesSheet('order-1');

    expect(apiClient.lastMethod, 'GET');
    expect(apiClient.lastPath, '/api/sales-orders/order-1/sales-sheet');
    expect(apiClient.lastToken, 'token-1');
    expect(sheet.order.orderNo, 'SO20260701001');
    expect(sheet.qrCode?.token, 'existing-token');

    apiClient.nextJson = {
      'data': {
        'salesSheet': {
          'order': {'id': 'order-1', 'orderNo': 'SO20260701001'},
        },
        'qrCode': {
          'token': 'new-token',
          'url': 'https://example.test/public/sales-sheets/new-token',
        },
      },
    };
    final generated = await api.generateSalesOrderQrCode(
      'order-1',
      expiresInDays: 7,
      regenerate: true,
    );

    expect(apiClient.lastMethod, 'POST');
    expect(apiClient.lastPath, '/api/sales-orders/order-1/qr-code');
    expect(apiClient.lastBody?['expiresInDays'], 7);
    expect(apiClient.lastBody?['regenerate'], isTrue);
    expect(generated.qrCode?.token, 'new-token');
    expect(
      generated.qrCode?.url,
      'https://example.test/public/sales-sheets/new-token',
    );
  });

  test('business API builds Excel download paths with filters', () async {
    final apiClient = _RecordingApiClient();
    final api = BusinessApi(apiClient: apiClient, token: 'token-1');

    final salesFile = await api.downloadSalesOrdersExcel(
      start: DateTime(2026, 7, 1),
      end: DateTime(2026, 7, 2),
      query: '测试客户',
      customerPhone: '13800000000',
      status: 'valid',
      customerFinanceMark: true,
      salesUserId: 'usr_sales',
    );

    final salesUri = Uri.parse(apiClient.lastPath!);
    expect(apiClient.lastMethod, 'BYTES');
    expect(apiClient.lastToken, 'token-1');
    expect(apiClient.lastDefaultFileName, 'sales-orders.xlsx');
    expect(salesFile.fileName, 'export.xlsx');
    expect(salesUri.path, '/api/sales-orders/export.xlsx');
    expect(salesUri.queryParameters['dateFrom'], '2026-07-01');
    expect(salesUri.queryParameters['dateTo'], '2026-07-02');
    expect(salesUri.queryParameters['query'], '测试客户');
    expect(salesUri.queryParameters['customerPhone'], '13800000000');
    expect(salesUri.queryParameters['status'], 'valid');
    expect(salesUri.queryParameters['customerFinanceMark'], 'true');
    expect(salesUri.queryParameters['salesUserId'], 'usr_sales');

    await api.downloadTravelGroupsExcel(
      start: DateTime(2026, 7, 1),
      keyword: '测试旅行社',
      groupNo: 'TG-001',
      guideId: 'guide-1',
      financeMark: false,
      pendingStatus: 'pending_finance',
    );

    final travelUri = Uri.parse(apiClient.lastPath!);
    expect(apiClient.lastDefaultFileName, 'travel-groups.xlsx');
    expect(travelUri.path, '/api/travel-groups/export.xlsx');
    expect(travelUri.queryParameters['dateFrom'], '2026-07-01');
    expect(travelUri.queryParameters['keyword'], '测试旅行社');
    expect(travelUri.queryParameters['groupNo'], 'TG-001');
    expect(travelUri.queryParameters['guideId'], 'guide-1');
    expect(travelUri.queryParameters['financeMark'], 'false');
    expect(travelUri.queryParameters['pendingStatus'], 'pending_finance');
  });

  test('business API calls phase 7 commission endpoints', () async {
    final apiClient = _RecordingApiClient();
    final api = BusinessApi(apiClient: apiClient, token: 'token-1');
    final commissionRuleJson = {
      'id': 'rule-commission-1',
      'ruleName': 'test sales commission',
      'targetType': 'sales_commission',
      'rate': '0.0200',
      'effectiveFrom': '2026-07-01',
      'isActive': true,
    };
    final salesDeductionRuleJson = {
      'id': 'rule-sales-deduction-1',
      'productName': 'test liquor',
      'deductionCostCents': 1200,
      'effectiveFrom': '2026-07-01',
      'isActive': true,
    };
    final agencyDeductionRuleJson = {
      'id': 'rule-agency-deduction-1',
      'agencyId': 'agency-1',
      'agencyName': 'test agency',
      'productName': 'test liquor',
      'deductionCostCents': 800,
      'effectiveFrom': '2026-07-01',
      'isActive': true,
    };
    final agencyRebateRuleJson = {
      'id': 'rule-agency-rebate-1',
      'agencyId': 'agency-1',
      'agencyName': 'test agency',
      'dailyRebateRate': '0.0300',
      'monthlyRebateRate': '0.0100',
      'effectiveFrom': '2026-07-01',
      'isActive': true,
    };
    final commissionJson = {
      'id': 'commission-1',
      'salesOrderId': 'order-1',
      'travelGroupId': 'group-1',
      'targetType': 'sales_commission',
      'targetUserId': 'usr_sales',
      'grossAmountCents': 100000,
      'confirmedRefundAmountCents': 10000,
      'baseAmountCents': 90000,
      'deductionAmountCents': 1200,
      'rateSnapshot': '0.0200',
      'amountCents': 1776,
      'pointsCents': 0,
      'manualInput': false,
      'isConfirmed': false,
      'calculationVersion': 'stage7-v1',
    };
    final summaryJson = {
      'id': 'summary-1',
      'travelGroupId': 'group-1',
      'totalSalesAmountCents': 100000,
      'confirmedRefundAmountCents': 10000,
      'effectiveSalesAmountCents': 90000,
      'totalAgencyDeductionCents': 800,
      'agencyDeductionConfirmed': false,
      'totalAgencyNetAmountCents': 89200,
      'totalDailyRebateCents': 2676,
      'totalMonthlyRebateCents': 892,
      'paidRebateCents': 1000,
      'unpaidRebateCents': 2568,
      'guideInfoSent': false,
      'travelAgencyInfoSent': false,
    };

    apiClient.nextJson = {
      'data': {
        'commissionRules': [commissionRuleJson],
      },
    };
    await api.listCommissionRules(
      targetType: 'sales_commission',
      keyword: 'test',
      isActive: true,
      limit: 10,
    );
    var uri = Uri.parse(apiClient.lastPath!);
    expect(apiClient.lastMethod, 'GET');
    expect(uri.path, '/api/commission-rules');
    expect(uri.queryParameters['targetType'], 'sales_commission');
    expect(uri.queryParameters['keyword'], 'test');
    expect(uri.queryParameters['isActive'], 'true');

    apiClient.nextJson = {
      'data': {'commissionRule': commissionRuleJson},
    };
    await api.createCommissionRule({'ruleName': 'test sales commission'});
    expect(apiClient.lastMethod, 'POST');
    expect(apiClient.lastPath, '/api/commission-rules');
    expect(apiClient.lastBody?['ruleName'], 'test sales commission');

    await api.updateCommissionRule('rule-commission-1', {'isActive': false});
    expect(apiClient.lastMethod, 'PATCH');
    expect(apiClient.lastPath, '/api/commission-rules/rule-commission-1');
    expect(apiClient.lastBody?['isActive'], isFalse);

    apiClient.nextJson = {
      'data': {
        'salesDeductionRules': [salesDeductionRuleJson],
      },
    };
    await api.listSalesDeductionRules(
      productName: 'liquor',
      query: 'smoke',
      isActive: true,
    );
    uri = Uri.parse(apiClient.lastPath!);
    expect(uri.path, '/api/sales-deduction-rules');
    expect(uri.queryParameters['productName'], 'liquor');
    expect(uri.queryParameters['query'], 'smoke');

    apiClient.nextJson = {
      'data': {'salesDeductionRule': salesDeductionRuleJson},
    };
    await api.createSalesDeductionRule({'productName': 'test liquor'});
    expect(apiClient.lastPath, '/api/sales-deduction-rules');
    await api.updateSalesDeductionRule(
      'rule-sales-deduction-1',
      {'deductionCostCents': 1300},
    );
    expect(
      apiClient.lastPath,
      '/api/sales-deduction-rules/rule-sales-deduction-1',
    );
    apiClient.nextJson = {
      'data': {
        'importResult': {
          'totalCount': 2,
          'successCount': 1,
          'failureCount': 1,
          'createdIdsSample': ['rule-sales-deduction-2'],
          'failureSamples': [
            {
              'index': 1,
              'rowNumber': 2,
              'code': 'VALIDATION_FAILED',
              'message': 'deductionCostCents must be non-negative',
            },
          ],
          'results': [
            {
              'index': 0,
              'rowNumber': 1,
              'success': true,
              'rule': salesDeductionRuleJson,
            },
            {
              'index': 1,
              'rowNumber': 2,
              'success': false,
              'error': {
                'code': 'VALIDATION_FAILED',
                'message': 'deductionCostCents must be non-negative',
              },
            },
          ],
        },
      },
    };
    final salesImport = await api.importSalesDeductionRules([
      {'productName': 'test liquor', 'deductionCostCents': 1200},
      {'productName': 'bad liquor', 'deductionCostCents': -1},
    ]);
    expect(apiClient.lastPath, '/api/sales-deduction-rules/batch-import');
    expect((apiClient.lastBody?['rules'] as List), hasLength(2));
    expect(salesImport.successCount, 1);
    expect(salesImport.failureSamples.single.code, 'VALIDATION_FAILED');

    apiClient.nextJson = {
      'data': {
        'agencyDeductionRules': [agencyDeductionRuleJson],
      },
    };
    await api.listAgencyDeductionRules(
      agencyId: 'agency-1',
      agencyName: 'test agency',
      productName: 'liquor',
      isActive: true,
    );
    uri = Uri.parse(apiClient.lastPath!);
    expect(uri.path, '/api/agency-deduction-rules');
    expect(uri.queryParameters['agencyId'], 'agency-1');
    expect(uri.queryParameters['agencyName'], 'test agency');

    apiClient.nextJson = {
      'data': {'agencyDeductionRule': agencyDeductionRuleJson},
    };
    await api.createAgencyDeductionRule({'agencyName': 'test agency'});
    expect(apiClient.lastPath, '/api/agency-deduction-rules');
    await api.updateAgencyDeductionRule(
      'rule-agency-deduction-1',
      {'deductionCostCents': 900},
    );
    expect(
      apiClient.lastPath,
      '/api/agency-deduction-rules/rule-agency-deduction-1',
    );
    apiClient.nextJson = {
      'data': {
        'importResult': {
          'totalCount': 1,
          'successCount': 1,
          'failureCount': 0,
          'createdIdsSample': ['rule-agency-deduction-2'],
          'failureSamples': const [],
          'results': [
            {
              'index': 0,
              'rowNumber': 1,
              'success': true,
              'rule': agencyDeductionRuleJson,
            },
          ],
        },
      },
    };
    final agencyDeductionImport = await api.importAgencyDeductionRules([
      {
        'agencyName': 'test agency',
        'productName': 'test liquor',
        'deductionCostCents': 800,
      },
    ]);
    expect(
      apiClient.lastPath,
      '/api/agency-deduction-rules/batch-import',
    );
    expect(agencyDeductionImport.failureCount, 0);

    apiClient.nextJson = {
      'data': {
        'agencyRebateRules': [agencyRebateRuleJson],
      },
    };
    await api.listAgencyRebateRules(
      agencyName: 'test agency',
      keyword: 'smoke',
      isActive: false,
    );
    uri = Uri.parse(apiClient.lastPath!);
    expect(uri.path, '/api/agency-rebate-rules');
    expect(uri.queryParameters['agencyName'], 'test agency');
    expect(uri.queryParameters['keyword'], 'smoke');
    expect(uri.queryParameters['isActive'], 'false');

    apiClient.nextJson = {
      'data': {'agencyRebateRule': agencyRebateRuleJson},
    };
    await api.createAgencyRebateRule({'agencyName': 'test agency'});
    expect(apiClient.lastPath, '/api/agency-rebate-rules');
    await api.updateAgencyRebateRule(
      'rule-agency-rebate-1',
      {'monthlyRebateRate': '0.0200'},
    );
    expect(
      apiClient.lastPath,
      '/api/agency-rebate-rules/rule-agency-rebate-1',
    );
    apiClient.nextJson = {
      'data': {
        'importResult': {
          'totalCount': 1,
          'successCount': 1,
          'failureCount': 0,
          'createdIdsSample': ['rule-agency-rebate-2'],
          'failureSamples': const [],
          'results': [
            {
              'index': 0,
              'rowNumber': 1,
              'success': true,
              'rule': agencyRebateRuleJson,
            },
          ],
        },
      },
    };
    final agencyRebateImport = await api.importAgencyRebateRules([
      {
        'agencyName': 'test agency',
        'dailyRebateRate': '0.0300',
        'monthlyRebateRate': '0.0200',
      },
    ]);
    expect(apiClient.lastPath, '/api/agency-rebate-rules/batch-import');
    expect(agencyRebateImport.successCount, 1);

    apiClient.nextJson = {
      'data': {
        'generatedRecords': [commissionJson],
        'warnings': ['missing_outreach'],
      },
    };
    final recalculation = await api.recalculateCommissions('order-1');
    expect(apiClient.lastMethod, 'POST');
    expect(apiClient.lastPath, '/api/commission-records/recalculate');
    expect(apiClient.lastBody?['salesOrderId'], 'order-1');
    expect(recalculation.records.single.id, 'commission-1');

    apiClient.nextJson = {
      'data': {
        'commissionRecords': [commissionJson],
      },
    };
    await api.listCommissionRecords(
      start: DateTime(2026, 7, 1),
      end: DateTime(2026, 7, 3),
      targetType: 'sales_commission',
      targetUserId: 'usr_sales',
      agencyId: 'agency-1',
      travelGroupId: 'group-1',
      salesOrderId: 'order-1',
      isConfirmed: false,
      manualInput: false,
      query: 'smoke',
      limit: 20,
    );
    uri = Uri.parse(apiClient.lastPath!);
    expect(uri.path, '/api/commission-records');
    expect(uri.queryParameters['dateFrom'], '2026-07-01');
    expect(uri.queryParameters['dateTo'], '2026-07-03');
    expect(uri.queryParameters['targetType'], 'sales_commission');
    expect(uri.queryParameters['targetUserId'], 'usr_sales');
    expect(uri.queryParameters['agencyId'], 'agency-1');
    expect(uri.queryParameters['isConfirmed'], 'false');
    expect(uri.queryParameters['manualInput'], 'false');

    apiClient.nextJson = {
      'data': {'commissionRecord': commissionJson},
    };
    await api.getCommissionRecord('commission-1');
    expect(apiClient.lastPath, '/api/commission-records/commission-1');
    await api.updateTasterCommissionManualAmount(
      'commission-1',
      {'amountCents': 5000},
    );
    expect(
      apiClient.lastPath,
      '/api/commission-records/commission-1/manual-amount',
    );
    expect(apiClient.lastBody?['amountCents'], 5000);
    await api.confirmTasterCommission('commission-1', true);
    expect(apiClient.lastPath, '/api/commission-records/commission-1/confirm');
    expect(apiClient.lastBody?['isConfirmed'], isTrue);

    apiClient.nextJson = {
      'data': {
        'commissionRecords': [commissionJson],
      },
    };
    await api.listMyCommissionRecords(isConfirmed: true, limit: 5);
    uri = Uri.parse(apiClient.lastPath!);
    expect(uri.path, '/api/commission-records/me');
    expect(uri.queryParameters['isConfirmed'], 'true');

    await api.downloadCommissionRecordsExcel(
      start: DateTime(2026, 7, 1),
      targetType: 'agency_daily_rebate',
      query: 'smoke',
      limit: 100,
    );
    uri = Uri.parse(apiClient.lastPath!);
    expect(apiClient.lastMethod, 'BYTES');
    expect(apiClient.lastDefaultFileName, 'commission-records.xlsx');
    expect(uri.path, '/api/commission-records/export');
    expect(uri.queryParameters['targetType'], 'agency_daily_rebate');

    apiClient.nextJson = {
      'data': {
        'travelGroupFinanceSummaries': [summaryJson],
      },
    };
    await api.listTravelGroupFinanceSummaries(
      start: DateTime(2026, 7, 1),
      end: DateTime(2026, 7, 3),
      travelGroupId: 'group-1',
      agencyName: 'test agency',
      guideName: 'test guide',
      agencyDeductionConfirmed: false,
      query: 'smoke',
      limit: 20,
    );
    uri = Uri.parse(apiClient.lastPath!);
    expect(uri.path, '/api/travel-group-finance-summaries');
    expect(uri.queryParameters['travelGroupId'], 'group-1');
    expect(uri.queryParameters['agencyName'], 'test agency');
    expect(uri.queryParameters['guideName'], 'test guide');
    expect(uri.queryParameters['agencyDeductionConfirmed'], 'false');

    apiClient.nextJson = {
      'data': {'travelGroupFinanceSummary': summaryJson},
    };
    await api.getTravelGroupFinanceSummary('group-1');
    expect(apiClient.lastPath, '/api/travel-group-finance-summaries/group-1');
    await api.updateTravelGroupFinanceSummary(
      'group-1',
      {'paidRebateCents': 2000},
    );
    expect(apiClient.lastPath, '/api/travel-group-finance-summaries/group-1');
    expect(apiClient.lastBody?['paidRebateCents'], 2000);
    await api.confirmAgencyDeduction('group-1', true);
    expect(
      apiClient.lastPath,
      '/api/travel-group-finance-summaries/group-1/'
      'agency-deduction-confirm',
    );
    expect(apiClient.lastBody?['isConfirmed'], isTrue);

    apiClient.nextJson = {
      'data': {
        'travelGroupFinanceSummary': summaryJson,
        'amountChanged': true,
        'agencyDeductionConfirmationReset': false,
      },
    };
    final refresh = await api.refreshTravelGroupFinanceSummary('group-1');
    expect(
      apiClient.lastPath,
      '/api/travel-group-finance-summaries/group-1/refresh',
    );
    expect(refresh.amountChanged, isTrue);

    await api.downloadTravelGroupFinanceSummariesExcel(
      start: DateTime(2026, 7, 1),
      agencyName: 'test agency',
      guideName: 'test guide',
      agencyDeductionConfirmed: true,
      query: 'smoke',
      limit: 100,
    );
    uri = Uri.parse(apiClient.lastPath!);
    expect(apiClient.lastMethod, 'BYTES');
    expect(
      apiClient.lastDefaultFileName,
      'travel-group-finance-summaries.xlsx',
    );
    expect(uri.path, '/api/travel-group-finance-summaries/export');
    expect(uri.queryParameters['agencyName'], 'test agency');
    expect(uri.queryParameters['guideName'], 'test guide');
    expect(uri.queryParameters['agencyDeductionConfirmed'], 'true');
  });

  test('parses reconciliation JSON with positive refunds deduction', () {
    final reconciliation = ReconciliationRecord.fromJson({
      'businessDate': '2026-06-23',
      'travelGroupSalesCents': 39800,
      'backOfficeSalesCents': 10000,
      'buybackCents': 0,
      'externalSalesCents': 0,
      'internalPurchaseCents': 0,
      'afterSalesCents': 0,
      'refundsCents': 800,
      'otherReceivableCents': 0,
      'receivableTotalCents': 49000,
      'actualTotalCents': 48500,
      'differenceCents': -500,
      'paymentMethods': [
        {'name': '现金', 'amountCents': 20000, 'sortOrder': 1},
        {'name': '微信', 'amountCents': 28500, 'sortOrder': 2},
      ],
    });

    expect(reconciliation.refundsCents, 800);
    expect(reconciliation.receivableTotalCents, 49000);
    expect(reconciliation.actualTotalCents, 48500);
    expect(reconciliation.differenceCents, -500);
    expect(reconciliation.paymentMethods, hasLength(2));
  });

  test('parses travel group and finance overview JSON returned by business API',
      () {
    final group = TravelGroupRecord.fromJson({
      'id': 'group-1',
      'kind': 'travel',
      'groupNo': 'GZ-TEST-001',
      'visitDate': '2026-06-24',
      'licensePlate': '贵A12345',
      'guideId': 'guide-1',
      'guideName': '测试导游',
      'guidePhone': '13900001111',
      'travelAgency': '测试旅行社',
      'guestCount': '18',
      'tastingRoomNo': 'A-101',
      'tasterId': 'taster-1',
      'tasterName': '测试品鉴师',
      'arrivalTime': '09:30',
      'groupType': 'KB团',
      'wineDetails': '偏好酱香',
      'departureTime': '11:30',
      'status': 'ordered',
      'salesAmountCents': '647800',
      'guideInfoSent': true,
      'travelAgencyInfoSent': 'true',
      'financeMark': 'true',
      'markedById': 'usr_finance',
      'markedAt': '2026-06-24T08:00:00.000Z',
      'tasterSummary': 'Guests liked the reserve.',
      'tasterSummaryAt': '2026-06-24T09:00:00.000Z',
      'tastingItems': [
        {
          'id': 'item-1',
          'travelGroupId': 'group-1',
          'productName': '酱香珍藏',
          'quantity': '2',
          'unit': '瓶',
          'note': '开瓶',
          'sortOrder': '1',
        },
      ],
      'salesOrders': [
        {
          'id': 'order-1',
          'orderNo': 'SO-TEST-001',
          'orderType': 'travel_group',
          'orderDate': '2026-06-24',
          'customerName': '测试客户',
          'totalAmountCents': '647800',
          'cashOnDeliveryAmountCents': '5000',
          'status': 'valid',
          'financeMark': false,
        },
      ],
      'orderSummary': {
        'orderCount': '1',
        'totalAmountCents': '647800',
        'cashOnDeliveryAmountCents': '5000',
      },
      'pendingStatus': 'pending_finance',
      'pendingReasons': ['finance_unmarked_after_day_end'],
    });

    expect(group.groupNo, 'GZ-TEST-001');
    expect(group.kind, 'travel');
    expect(group.guideId, 'guide-1');
    expect(group.tasterId, 'taster-1');
    expect(group.guestCount, 18);
    expect(group.salesAmountCents, 647800);
    expect(group.guideInfoSent, isTrue);
    expect(group.travelAgencyInfoSent, isTrue);
    expect(group.financeMark, isTrue);
    expect(group.markedById, 'usr_finance');
    expect(group.tasterSummary, 'Guests liked the reserve.');
    expect(group.tastingItems, hasLength(1));
    expect(group.tastingItems.single.productName, '酱香珍藏');
    expect(group.tastingItems.single.quantity, 2);
    expect(group.salesOrders.single.orderNo, 'SO-TEST-001');
    expect(group.orderSummary.orderCount, 1);
    expect(group.orderSummary.cashOnDeliveryAmountCents, 5000);
    expect(group.pendingStatus, 'pending_finance');
    expect(group.pendingReasons, ['finance_unmarked_after_day_end']);

    final overview = FinanceOverview.fromJson({
      'metrics': {
        'travelGroupCount': 2,
        'orderCount': 3,
        'grossSalesAmountCents': 1295600,
        'salesAmountCents': 1295600,
        'refundAmountCents': 800,
        'pendingAfterSalesRefundAmountCents': 1200,
        'legacyRefundOrderAmountCents': 39800,
        'netSalesAmountCents': 1294800,
        'logisticsFeeCents': 1800,
        'pendingInvoiceCount': 1,
        'pendingCustomerMarkCount': 2,
        'pendingTravelGroupMarkCount': 1,
        'pendingAfterSalesConfirmCount': 1,
        'cashOnDeliveryAmountCents': 5000,
      },
      'recentOrders': [
        {
          'id': 'order-2',
          'orderNo': 'SO-TEST-002',
          'customerName': '测试客户',
          'orderDate': '2026-06-24',
          'totalAmountCents': 10000,
        },
      ],
    });

    expect(overview.travelGroupCount, 2);
    expect(overview.refundAmountCents, 800);
    expect(overview.pendingAfterSalesRefundAmountCents, 1200);
    expect(overview.legacyRefundOrderAmountCents, 39800);
    expect(overview.netSalesAmountCents, 1294800);
    expect(overview.logisticsFeeCents, 1800);
    expect(overview.pendingInvoiceCount, 1);
    expect(overview.pendingCustomerMarkCount, 2);
    expect(overview.pendingTravelGroupMarkCount, 1);
    expect(overview.pendingAfterSalesConfirmCount, 1);
    expect(overview.cashOnDeliveryAmountCents, 5000);
    expect(overview.recentOrders.single.orderNo, 'SO-TEST-002');
  });

  test('parses finance workbench JSON returned by phase 6 API', () {
    final workbench = FinanceWorkbenchRecord.fromJson({
      'metrics': {
        'travelGroupCount': 1,
        'orderCount': 2,
        'grossSalesAmountCents': 200000,
        'salesAmountCents': 200000,
        'refundAmountCents': 5000,
        'pendingAfterSalesRefundAmountCents': 3000,
        'legacyRefundOrderAmountCents': 79800,
        'netSalesAmountCents': 195000,
        'logisticsFeeCents': 2500,
        'pendingInvoiceCount': 1,
        'pendingCustomerMarkCount': 1,
        'pendingTravelGroupMarkCount': 1,
        'pendingAfterSalesConfirmCount': 1,
        'cashOnDeliveryAmountCents': 10000,
      },
      'recentOrders': [
        {
          'id': 'order-1',
          'orderNo': 'SO20260702001',
          'customerName': 'Smoke Customer',
          'orderDate': '2026-07-02',
          'totalAmountCents': 200000,
        },
      ],
      'pendingAfterSales': [
        {
          'id': 'as-1',
          'afterSalesNo': 'AS20260702001',
          'salesOrderId': 'order-1',
          'issueType': 'quality_issue',
          'actionType': 'refund',
          'description': 'smoke refund pending finance',
          'refundAmountCents': 3000,
          'status': 'waiting_refund',
          'financeConfirmed': false,
        },
      ],
      'pendingMarks': [
        {
          'type': 'customer',
          'reason': 'customer_unmarked',
          'customer': {
            'id': 'customer-1',
            'name': 'Smoke Customer',
            'financeMark': false,
          },
          'orderCount': 1,
          'latestOrder': {
            'id': 'order-1',
            'orderNo': 'SO20260702001',
            'customerName': 'Smoke Customer',
            'orderDate': '2026-07-02',
          },
        },
      ],
      'pendingLogistics': [
        {
          'order': {
            'id': 'order-2',
            'orderNo': 'SO20260702002',
            'customerName': 'Smoke Customer',
            'orderDate': '2026-07-02',
          },
          'reasons': ['missing_logistics_no', 'pending_invoice'],
        },
      ],
    });

    expect(workbench.metrics.netSalesAmountCents, 195000);
    expect(workbench.metrics.grossSalesAmountCents, 200000);
    expect(workbench.metrics.refundAmountCents, 5000);
    expect(workbench.metrics.pendingAfterSalesRefundAmountCents, 3000);
    expect(workbench.metrics.legacyRefundOrderAmountCents, 79800);
    expect(workbench.metrics.logisticsFeeCents, 2500);
    expect(workbench.metrics.pendingInvoiceCount, 1);
    expect(workbench.metrics.pendingCustomerMarkCount, 1);
    expect(workbench.metrics.pendingTravelGroupMarkCount, 1);
    expect(workbench.metrics.pendingAfterSalesConfirmCount, 1);
    expect(workbench.recentOrders.single.orderNo, 'SO20260702001');
    expect(workbench.pendingAfterSales.single.afterSalesNo, 'AS20260702001');
    expect(workbench.pendingAfterSales.single.refundAmountCents, 3000);
    expect(workbench.pendingAfterSales.single.financeConfirmed, isFalse);
    expect(workbench.pendingMarks.single.customer?.name, 'Smoke Customer');
    expect(workbench.pendingMarks.single.latestOrder?.orderNo, 'SO20260702001');
    expect(workbench.pendingMarks.single.orderCount, 1);
    expect(workbench.pendingLogistics.single.order?.orderNo, 'SO20260702002');
    expect(workbench.pendingLogistics.single.reasons,
        ['missing_logistics_no', 'pending_invoice']);
  });

  test('business API calls phase 6 endpoints with expected paths and bodies',
      () async {
    final apiClient = _RecordingApiClient();
    final api = BusinessApi(apiClient: apiClient, token: 'token-1');
    final afterSalesJson = {
      'id': 'as-1',
      'afterSalesNo': 'AS20260702001',
      'salesOrderId': 'order-1',
      'issueType': 'quality_issue',
      'actionType': 'refund',
      'description': 'smoke refund',
      'refundAmountCents': 500,
      'status': 'waiting_refund',
      'financeConfirmed': false,
    };

    apiClient.nextJson = {
      'data': {
        'afterSalesOrders': [afterSalesJson],
      },
    };
    final list = await api.listAfterSalesOrders(
      start: DateTime(2026, 7, 1),
      end: DateTime(2026, 7, 2),
      query: 'smoke',
      status: 'waiting_refund',
      issueType: 'quality_issue',
      actionType: 'refund',
      salesOrderId: 'order-1',
      customerId: 'customer-1',
      financeConfirmed: false,
      limit: 10,
    );
    final listUri = Uri.parse(apiClient.lastPath!);
    expect(apiClient.lastMethod, 'GET');
    expect(listUri.path, '/api/after-sales-orders');
    expect(listUri.queryParameters['dateFrom'], '2026-07-01');
    expect(listUri.queryParameters['dateTo'], '2026-07-02');
    expect(listUri.queryParameters['query'], 'smoke');
    expect(listUri.queryParameters['financeConfirmed'], 'false');
    expect(list.single.afterSalesNo, 'AS20260702001');

    apiClient.nextJson = {
      'data': {'afterSalesOrder': afterSalesJson},
    };
    await api.createAfterSalesOrder({
      'salesOrderId': 'order-1',
      'issueType': 'quality_issue',
      'actionType': 'refund',
      'description': 'smoke refund',
      'refundAmountCents': 500,
    });
    expect(apiClient.lastMethod, 'POST');
    expect(apiClient.lastPath, '/api/after-sales-orders');
    expect(apiClient.lastBody?['salesOrderId'], 'order-1');

    await api.getAfterSalesOrder('as-1');
    expect(apiClient.lastPath, '/api/after-sales-orders/as-1');

    await api.updateAfterSalesOrder('as-1', {'notes': 'updated'});
    expect(apiClient.lastMethod, 'PATCH');
    expect(apiClient.lastPath, '/api/after-sales-orders/as-1');
    expect(apiClient.lastBody?['notes'], 'updated');

    await api.updateAfterSalesOrderStatus('as-1', {
      'status': 'completed',
      'resolution': 'done',
    });
    expect(apiClient.lastPath, '/api/after-sales-orders/as-1/status');
    expect(apiClient.lastBody?['status'], 'completed');

    await api.confirmAfterSalesFinance('as-1', true);
    expect(apiClient.lastPath, '/api/after-sales-orders/as-1/finance-confirm');
    expect(apiClient.lastBody?['financeConfirmed'], isTrue);

    apiClient.nextJson = {
      'data': {
        'workbench': {
          'metrics': {'salesAmountCents': 1000},
          'recentOrders': const [],
          'pendingAfterSales': const [],
          'pendingMarks': const [],
          'pendingLogistics': const [],
        },
      },
    };
    await api.getFinanceWorkbench(
      start: DateTime(2026, 7, 1),
      end: DateTime(2026, 7, 2),
      query: 'smoke',
      limit: 30,
    );
    final workbenchUri = Uri.parse(apiClient.lastPath!);
    expect(workbenchUri.path, '/api/finance/workbench');
    expect(workbenchUri.queryParameters['limit'], '30');
    expect(workbenchUri.queryParameters['query'], 'smoke');

    apiClient.nextJson = {
      'data': {
        'warehouseOrders': [
          {
            'id': 'order-1',
            'orderNo': 'SO20260702001',
            'customerName': 'Smoke Customer',
            'orderDate': '2026-07-02',
          },
        ],
      },
    };
    await api.listWarehouseOrders(
      start: DateTime(2026, 7, 2),
      end: DateTime(2026, 7, 2),
      query: 'SO20260702001',
      packingStatus: 'pending',
      logisticsMethod: 'SF',
      limit: 25,
    );
    final warehouseUri = Uri.parse(apiClient.lastPath!);
    expect(warehouseUri.path, '/api/warehouse/orders');
    expect(warehouseUri.queryParameters['packingStatus'], 'pending');
    expect(warehouseUri.queryParameters['logisticsMethod'], 'SF');

    apiClient.nextJson = {
      'data': {
        'warehouseOrder': {
          'id': 'order-1',
          'orderNo': 'SO20260702001',
          'customerName': 'Smoke Customer',
          'orderDate': '2026-07-02',
          'packingStatus': 'packed',
        },
      },
    };
    await api.updateWarehouseOrderPacking('order-1', {
      'packingStatus': 'packed',
      'packageCount': 2,
    });
    expect(apiClient.lastPath, '/api/warehouse/orders/order-1/packing');
    expect(apiClient.lastBody?['packingStatus'], 'packed');
  });
}

class _RecordingApiClient extends ApiClient {
  _RecordingApiClient() : super(baseUrl: 'http://127.0.0.1:3000');

  Map<String, dynamic> nextJson = <String, dynamic>{
    'data': <String, dynamic>{}
  };
  ApiDownloadedFile nextDownload = ApiDownloadedFile(
    bytes: Uint8List.fromList(<int>[1, 2, 3]),
    fileName: 'export.xlsx',
    contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );

  String? lastMethod;
  String? lastPath;
  String? lastToken;
  String? lastDefaultFileName;
  Map<String, dynamic>? lastBody;

  @override
  Future<Map<String, dynamic>> getJson(
    String path, {
    String? token,
  }) async {
    lastMethod = 'GET';
    lastPath = path;
    lastToken = token;
    return nextJson;
  }

  @override
  Future<Map<String, dynamic>> postJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    lastMethod = 'POST';
    lastPath = path;
    lastToken = token;
    lastBody = Map<String, dynamic>.from(body ?? <String, dynamic>{});
    return nextJson;
  }

  @override
  Future<Map<String, dynamic>> patchJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    lastMethod = 'PATCH';
    lastPath = path;
    lastToken = token;
    lastBody = Map<String, dynamic>.from(body ?? <String, dynamic>{});
    return nextJson;
  }

  @override
  Future<ApiDownloadedFile> getBytes(
    String path, {
    required String defaultFileName,
    String? token,
  }) async {
    lastMethod = 'BYTES';
    lastPath = path;
    lastToken = token;
    lastDefaultFileName = defaultFileName;
    return nextDownload;
  }
}
