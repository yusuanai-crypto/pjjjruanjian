import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../api/api_client.dart';

class BusinessApi {
  BusinessApi({
    required ApiClient apiClient,
    required String token,
  })  : _apiClient = apiClient,
        _token = token;

  final ApiClient _apiClient;
  final String _token;

  Future<List<TravelGroupRecord>> listTravelGroups({
    int limit = 20,
    DateTime? start,
    DateTime? end,
    String? keyword,
    String? groupNo,
    String? guideId,
    String? tasterId,
    String? groupType,
    bool? financeMark,
    String? pendingStatus,
  }) async {
    final query = <String, String>{'limit': '$limit'};
    if (start != null) {
      query['dateFrom'] = formatDate(start);
    }
    if (end != null) {
      query['dateTo'] = formatDate(end);
    }
    _putNonEmpty(query, 'keyword', keyword);
    _putNonEmpty(query, 'groupNo', groupNo);
    _putNonEmpty(query, 'guideId', guideId);
    _putNonEmpty(query, 'tasterId', tasterId);
    _putNonEmpty(query, 'groupType', groupType);
    if (financeMark != null) {
      query['financeMark'] = '$financeMark';
    }
    _putNonEmpty(query, 'pendingStatus', pendingStatus);

    final payload = await _apiClient.getJson(
      _path('/api/travel-groups', query),
      token: _token,
    );
    final data = _data(payload);
    return _list(data['travelGroups'])
        .map((item) => TravelGroupRecord.fromJson(item))
        .toList();
  }

  Future<List<GuideRecord>> listGuides({
    String? keyword,
    String? travelAgency,
    bool? isActive,
    int limit = 50,
  }) async {
    final query = <String, String>{'limit': '$limit'};
    if (keyword != null && keyword.trim().isNotEmpty) {
      query['keyword'] = keyword.trim();
    }
    if (travelAgency != null && travelAgency.trim().isNotEmpty) {
      query['travelAgency'] = travelAgency.trim();
    }
    if (isActive != null) {
      query['isActive'] = '$isActive';
    }

    final payload = await _apiClient.getJson(
      _path('/api/guides', query),
      token: _token,
    );
    final data = _data(payload);
    return _list(data['guides'])
        .map((item) => GuideRecord.fromJson(item))
        .toList();
  }

  Future<List<TravelAgencyRecord>> listTravelAgencies({
    String? keyword,
    int limit = 100,
  }) async {
    final query = <String, String>{'limit': '$limit'};
    if (keyword != null && keyword.trim().isNotEmpty) {
      query['keyword'] = keyword.trim();
    }

    final payload = await _apiClient.getJson(
      _path('/api/travel-agencies', query),
      token: _token,
    );
    final data = _data(payload);
    return _list(data['travelAgencies'])
        .map((item) => TravelAgencyRecord.fromJson(item))
        .toList();
  }

  Future<TravelAgencyRecord> createTravelAgency(
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.postJson(
      '/api/travel-agencies',
      body: body,
      token: _token,
    );
    return TravelAgencyRecord.fromJson(_map(_data(payload)['travelAgency']));
  }

  Future<GuideRecord> createGuide(Map<String, dynamic> body) async {
    final payload = await _apiClient.postJson(
      '/api/guides',
      body: body,
      token: _token,
    );
    return GuideRecord.fromJson(_map(_data(payload)['guide']));
  }

  Future<GuideRecord> getGuide(String id) async {
    final payload = await _apiClient.getJson(
      '/api/guides/$id',
      token: _token,
    );
    return GuideRecord.fromJson(_map(_data(payload)['guide']));
  }

  Future<GuideRecord> updateGuide(
    String id,
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/guides/$id',
      body: body,
      token: _token,
    );
    return GuideRecord.fromJson(_map(_data(payload)['guide']));
  }

  Future<List<TasterOption>> listTasters() async {
    final payload = await _apiClient.getJson(
      '/api/users/tasters',
      token: _token,
    );
    final data = _data(payload);
    return _list(data['tasters'])
        .map((item) => TasterOption.fromJson(item))
        .toList();
  }

  Future<List<TravelGroupRecord>> listPendingTravelGroups({
    int limit = 100,
    DateTime? start,
    DateTime? end,
    String? keyword,
    String? pendingStatus,
  }) async {
    final query = <String, String>{'limit': '$limit'};
    if (start != null) {
      query['dateFrom'] = formatDate(start);
    }
    if (end != null) {
      query['dateTo'] = formatDate(end);
    }
    _putNonEmpty(query, 'keyword', keyword);
    _putNonEmpty(query, 'pendingStatus', pendingStatus);

    final payload = await _apiClient.getJson(
      _path('/api/pending-travel-groups', query),
      token: _token,
    );
    final data = _data(payload);
    return _list(data['pendingTravelGroups'])
        .map((item) => TravelGroupRecord.fromJson(item))
        .toList();
  }

  Future<TravelGroupRecord> createTravelGroup(Map<String, dynamic> body) async {
    final payload = await _apiClient.postJson(
      '/api/travel-groups',
      body: body,
      token: _token,
    );
    return TravelGroupRecord.fromJson(_map(_data(payload)['travelGroup']));
  }

  Future<TravelGroupRecord> updateTravelGroup(
    String id,
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/travel-groups/$id',
      body: body,
      token: _token,
    );
    return TravelGroupRecord.fromJson(_map(_data(payload)['travelGroup']));
  }

  Future<TravelGroupRecord> getTravelGroup(String id) async {
    final payload = await _apiClient.getJson(
      '/api/travel-groups/$id',
      token: _token,
    );
    return TravelGroupRecord.fromJson(_map(_data(payload)['travelGroup']));
  }

  Future<TravelGroupRecord> setTravelGroupFinanceMark(
    String id,
    bool financeMark,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/travel-groups/$id/finance-mark',
      body: {'financeMark': financeMark},
      token: _token,
    );
    return TravelGroupRecord.fromJson(_map(_data(payload)['travelGroup']));
  }

  Future<TravelGroupRecord> submitTravelGroupTasterSummary(
    String id,
    String tasterSummary,
  ) async {
    final payload = await _apiClient.postJson(
      '/api/travel-groups/$id/taster-summary',
      body: {'tasterSummary': tasterSummary},
      token: _token,
    );
    return TravelGroupRecord.fromJson(_map(_data(payload)['travelGroup']));
  }

  Future<List<SalesOrderRecord>> listSalesOrders({int limit = 20}) async {
    final payload = await _apiClient.getJson(
      _path('/api/sales-orders', {'limit': '$limit'}),
      token: _token,
    );
    final data = _data(payload);
    return _list(data['salesOrders'])
        .map((item) => SalesOrderRecord.fromJson(item))
        .toList();
  }

  Future<SalesOrderRecord> createSalesOrder(Map<String, dynamic> body) async {
    final payload = await _apiClient.postJson(
      '/api/sales-orders',
      body: body,
      token: _token,
    );
    return SalesOrderRecord.fromJson(_map(_data(payload)['salesOrder']));
  }

  Future<SalesOrderRecord> setSalesOrderFinanceMark(
    String id,
    bool financeMark,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/sales-orders/$id/finance-mark',
      body: {'financeMark': financeMark},
      token: _token,
    );
    return SalesOrderRecord.fromJson(_map(_data(payload)['salesOrder']));
  }

  Future<FinanceOverview> getFinanceOverview({
    required DateTime start,
    required DateTime end,
  }) async {
    final payload = await _apiClient.getJson(
      _path('/api/finance/overview', {
        'dateFrom': formatDate(start),
        'dateTo': formatDate(end),
        'limit': '20',
      }),
      token: _token,
    );
    return FinanceOverview.fromJson(_map(_data(payload)['overview']));
  }

  Future<ReconciliationRecord> getReconciliation(DateTime businessDate) async {
    final payload = await _apiClient.getJson(
      '/api/reconciliations/${formatDate(businessDate)}',
      token: _token,
    );
    return ReconciliationRecord.fromJson(
        _map(_data(payload)['reconciliation']));
  }

  Future<ReconciliationRecord> saveReconciliation(
    DateTime businessDate,
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.putJson(
      '/api/reconciliations/${formatDate(businessDate)}',
      body: body,
      token: _token,
    );
    return ReconciliationRecord.fromJson(
        _map(_data(payload)['reconciliation']));
  }
}

class TasterOption {
  const TasterOption({
    required this.id,
    required this.name,
    required this.username,
  });

  final String id;
  final String name;
  final String username;

  factory TasterOption.fromJson(Map<String, dynamic> json) {
    return TasterOption(
      id: '${json['id'] ?? ''}',
      name: '${json['name'] ?? ''}',
      username: '${json['username'] ?? ''}',
    );
  }
}

class GuideRecord {
  const GuideRecord({
    required this.id,
    required this.name,
    required this.phone,
    required this.travelAgency,
    required this.remarks,
    required this.isActive,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String name;
  final String phone;
  final String travelAgency;
  final String? remarks;
  final bool isActive;
  final String? createdAt;
  final String? updatedAt;

  factory GuideRecord.fromJson(Map<String, dynamic> json) {
    return GuideRecord(
      id: '${json['id'] ?? ''}',
      name: '${json['name'] ?? ''}',
      phone: '${json['phone'] ?? ''}',
      travelAgency: '${json['travelAgency'] ?? ''}',
      remarks: _stringOrNull(json['remarks']),
      isActive: _boolValue(json['isActive'] ?? true),
      createdAt: _stringOrNull(json['createdAt']),
      updatedAt: _stringOrNull(json['updatedAt']),
    );
  }
}

class TravelAgencyRecord {
  const TravelAgencyRecord({
    required this.id,
    required this.name,
    required this.contactName,
    required this.contactPhone,
    required this.notes,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String name;
  final String? contactName;
  final String? contactPhone;
  final String? notes;
  final String? createdAt;
  final String? updatedAt;

  factory TravelAgencyRecord.fromJson(Map<String, dynamic> json) {
    return TravelAgencyRecord(
      id: '${json['id'] ?? ''}',
      name: '${json['name'] ?? ''}',
      contactName: _stringOrNull(json['contactName']),
      contactPhone: _stringOrNull(json['contactPhone']),
      notes: _stringOrNull(json['notes']),
      createdAt: _stringOrNull(json['createdAt']),
      updatedAt: _stringOrNull(json['updatedAt']),
    );
  }
}

class GuideLibraryState {
  const GuideLibraryState({
    required this.guides,
    required this.loading,
    required this.errorMessage,
  });

  const GuideLibraryState.initial()
      : guides = const <GuideRecord>[],
        loading = false,
        errorMessage = null;

  const GuideLibraryState.loading()
      : guides = const <GuideRecord>[],
        loading = true,
        errorMessage = null;

  const GuideLibraryState.data(this.guides)
      : loading = false,
        errorMessage = null;

  const GuideLibraryState.error(this.errorMessage)
      : guides = const <GuideRecord>[],
        loading = false;

  final List<GuideRecord> guides;
  final bool loading;
  final String? errorMessage;

  bool get hasError => errorMessage != null && errorMessage!.isNotEmpty;

  bool get isEmpty => !loading && !hasError && guides.isEmpty;
}

class TravelGroupRecord {
  const TravelGroupRecord({
    required this.id,
    required this.kind,
    required this.groupNo,
    required this.visitDate,
    required this.travelAgency,
    required this.licensePlate,
    required this.guideId,
    required this.guideName,
    required this.guidePhone,
    required this.guestCount,
    required this.tastingRoomNo,
    required this.tasterId,
    required this.tasterName,
    required this.arrivalTime,
    required this.groupType,
    required this.wineDetails,
    required this.departureTime,
    required this.remarks,
    required this.status,
    required this.salesAmountCents,
    required this.paidDepositCents,
    required this.cashOnDeliveryCents,
    required this.liquorCostDeductionCents,
    required this.orderAmountCents,
    required this.points,
    required this.returnedPoints,
    required this.unreturnedPoints,
    required this.guideInfoSent,
    required this.travelAgencyInfoSent,
    required this.financeMark,
    required this.markedById,
    required this.markedAt,
    required this.tasterSummary,
    required this.tasterSummaryAt,
    required this.tastingItems,
    required this.salesOrders,
    required this.orderSummary,
    required this.pendingStatus,
    required this.pendingReasons,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String kind;
  final String groupNo;
  final String visitDate;
  final String? travelAgency;
  final String? licensePlate;
  final String? guideId;
  final String? guideName;
  final String? guidePhone;
  final int guestCount;
  final String? tastingRoomNo;
  final String? tasterId;
  final String? tasterName;
  final String? arrivalTime;
  final String? groupType;
  final String? wineDetails;
  final String? departureTime;
  final String? remarks;
  final String status;
  final int salesAmountCents;
  final int paidDepositCents;
  final int cashOnDeliveryCents;
  final int liquorCostDeductionCents;
  final int orderAmountCents;
  final int points;
  final int returnedPoints;
  final int unreturnedPoints;
  final bool guideInfoSent;
  final bool travelAgencyInfoSent;
  final bool financeMark;
  final String? markedById;
  final String? markedAt;
  final String? tasterSummary;
  final String? tasterSummaryAt;
  final List<TravelGroupTastingItemRecord> tastingItems;
  final List<TravelGroupOrderRecord> salesOrders;
  final TravelGroupOrderSummary orderSummary;
  final String? pendingStatus;
  final List<String> pendingReasons;
  final String? createdAt;
  final String? updatedAt;

  factory TravelGroupRecord.fromJson(Map<String, dynamic> json) {
    final orderSummary = _map(json['orderSummary']);
    return TravelGroupRecord(
      id: '${json['id'] ?? ''}',
      kind: '${json['kind'] ?? 'travel'}',
      groupNo: '${json['groupNo'] ?? ''}',
      visitDate: '${json['visitDate'] ?? ''}',
      travelAgency: _stringOrNull(json['travelAgency']),
      licensePlate: _stringOrNull(json['licensePlate']),
      guideId: _stringOrNull(json['guideId']),
      guideName: _stringOrNull(json['guideName']),
      guidePhone: _stringOrNull(json['guidePhone']),
      guestCount: _intValue(json['guestCount']),
      tastingRoomNo: _stringOrNull(json['tastingRoomNo']),
      tasterId: _stringOrNull(json['tasterId']),
      tasterName: _stringOrNull(json['tasterName']),
      arrivalTime: _stringOrNull(json['arrivalTime']),
      groupType: _stringOrNull(json['groupType']),
      wineDetails: _stringOrNull(json['wineDetails']),
      departureTime: _stringOrNull(json['departureTime']),
      remarks: _stringOrNull(json['remarks']),
      status: '${json['status'] ?? 'unmarked'}',
      salesAmountCents: _intValue(json['salesAmountCents']),
      paidDepositCents: _intValue(json['paidDepositCents']),
      cashOnDeliveryCents: _intValue(json['cashOnDeliveryCents']),
      liquorCostDeductionCents: _intValue(json['liquorCostDeductionCents']),
      orderAmountCents: _intValue(json['orderAmountCents']),
      points: _intValue(json['points']),
      returnedPoints: _intValue(json['returnedPoints']),
      unreturnedPoints: _intValue(json['unreturnedPoints']),
      guideInfoSent: _boolValue(json['guideInfoSent']),
      travelAgencyInfoSent: _boolValue(json['travelAgencyInfoSent']),
      financeMark: _boolValue(json['financeMark']),
      markedById: _stringOrNull(json['markedById']),
      markedAt: _stringOrNull(json['markedAt']),
      tasterSummary: _stringOrNull(json['tasterSummary']),
      tasterSummaryAt: _stringOrNull(json['tasterSummaryAt']),
      tastingItems: _list(json['tastingItems'])
          .map((item) => TravelGroupTastingItemRecord.fromJson(item))
          .toList(),
      salesOrders: _list(json['salesOrders'])
          .map((item) => TravelGroupOrderRecord.fromJson(item))
          .toList(),
      orderSummary: TravelGroupOrderSummary.fromJson(orderSummary),
      pendingStatus: _stringOrNull(json['pendingStatus']),
      pendingReasons: _stringList(json['pendingReasons']),
      createdAt: _stringOrNull(json['createdAt']),
      updatedAt: _stringOrNull(json['updatedAt']),
    );
  }
}

class TravelGroupTastingItemRecord {
  const TravelGroupTastingItemRecord({
    required this.id,
    required this.travelGroupId,
    required this.productName,
    required this.quantity,
    required this.unit,
    required this.note,
    required this.sortOrder,
  });

  final String id;
  final String? travelGroupId;
  final String productName;
  final int quantity;
  final String unit;
  final String? note;
  final int sortOrder;

  factory TravelGroupTastingItemRecord.fromJson(Map<String, dynamic> json) {
    return TravelGroupTastingItemRecord(
      id: '${json['id'] ?? ''}',
      travelGroupId: _stringOrNull(json['travelGroupId']),
      productName: '${json['productName'] ?? ''}',
      quantity: _intValue(json['quantity']),
      unit: '${json['unit'] ?? ''}',
      note: _stringOrNull(json['note']),
      sortOrder: _intValue(json['sortOrder']),
    );
  }
}

class TravelGroupOrderRecord {
  const TravelGroupOrderRecord({
    required this.id,
    required this.orderNo,
    required this.orderType,
    required this.orderDate,
    required this.customerName,
    required this.customerPhone,
    required this.totalAmountCents,
    required this.cashOnDeliveryAmountCents,
    required this.status,
    required this.financeMark,
    required this.markedById,
    required this.markedAt,
    required this.salesUserId,
  });

  final String id;
  final String orderNo;
  final String orderType;
  final String orderDate;
  final String? customerName;
  final String? customerPhone;
  final int totalAmountCents;
  final int cashOnDeliveryAmountCents;
  final String status;
  final bool financeMark;
  final String? markedById;
  final String? markedAt;
  final String? salesUserId;

  factory TravelGroupOrderRecord.fromJson(Map<String, dynamic> json) {
    return TravelGroupOrderRecord(
      id: '${json['id'] ?? ''}',
      orderNo: '${json['orderNo'] ?? ''}',
      orderType: '${json['orderType'] ?? 'travel_group'}',
      orderDate: '${json['orderDate'] ?? ''}',
      customerName: _stringOrNull(json['customerName']),
      customerPhone: _stringOrNull(json['customerPhone']),
      totalAmountCents: _intValue(json['totalAmountCents']),
      cashOnDeliveryAmountCents: _intValue(json['cashOnDeliveryAmountCents']),
      status: '${json['status'] ?? 'valid'}',
      financeMark: _boolValue(json['financeMark']),
      markedById: _stringOrNull(json['markedById']),
      markedAt: _stringOrNull(json['markedAt']),
      salesUserId: _stringOrNull(json['salesUserId']),
    );
  }
}

class TravelGroupOrderSummary {
  const TravelGroupOrderSummary({
    required this.orderCount,
    required this.totalAmountCents,
    required this.cashOnDeliveryAmountCents,
  });

  const TravelGroupOrderSummary.empty()
      : orderCount = 0,
        totalAmountCents = 0,
        cashOnDeliveryAmountCents = 0;

  final int orderCount;
  final int totalAmountCents;
  final int cashOnDeliveryAmountCents;

  factory TravelGroupOrderSummary.fromJson(Map<String, dynamic> json) {
    if (json.isEmpty) {
      return const TravelGroupOrderSummary.empty();
    }
    return TravelGroupOrderSummary(
      orderCount: _intValue(json['orderCount']),
      totalAmountCents: _intValue(json['totalAmountCents']),
      cashOnDeliveryAmountCents: _intValue(json['cashOnDeliveryAmountCents']),
    );
  }
}

class SalesOrderRecord {
  const SalesOrderRecord({
    required this.id,
    required this.orderNo,
    required this.orderType,
    required this.customerName,
    required this.customerPhone,
    required this.orderDate,
    required this.totalAmountCents,
    required this.cashOnDeliveryAmountCents,
    required this.status,
    required this.travelGroup,
    required this.address,
    required this.financeMark,
    required this.markedById,
    required this.markedAt,
    required this.items,
  });

  final String id;
  final String orderNo;
  final String orderType;
  final String customerName;
  final String? customerPhone;
  final String orderDate;
  final int totalAmountCents;
  final int cashOnDeliveryAmountCents;
  final String status;
  final TravelGroupRecord? travelGroup;
  final String? address;
  final bool financeMark;
  final String? markedById;
  final String? markedAt;
  final List<SalesOrderItemRecord> items;

  factory SalesOrderRecord.fromJson(Map<String, dynamic> json) {
    final travelGroup = json['travelGroup'];
    return SalesOrderRecord(
      id: '${json['id'] ?? ''}',
      orderNo: '${json['orderNo'] ?? ''}',
      orderType: '${json['orderType'] ?? 'travel_group'}',
      customerName: '${json['customerName'] ?? ''}',
      customerPhone: _stringOrNull(json['customerPhone']),
      orderDate: '${json['orderDate'] ?? ''}',
      totalAmountCents: _intValue(json['totalAmountCents']),
      cashOnDeliveryAmountCents: _intValue(json['cashOnDeliveryAmountCents']),
      status: '${json['status'] ?? 'valid'}',
      travelGroup: travelGroup is Map
          ? TravelGroupRecord.fromJson(_map(travelGroup))
          : null,
      address: _joinedAddress(json),
      financeMark: _boolValue(json['financeMark']),
      markedById: _stringOrNull(json['markedById']),
      markedAt: _stringOrNull(json['markedAt']),
      items: _list(json['items'])
          .map((item) => SalesOrderItemRecord.fromJson(item))
          .toList(),
    );
  }
}

class SalesOrderItemRecord {
  const SalesOrderItemRecord({
    required this.productName,
    required this.quantity,
    required this.deliveryType,
  });

  final String productName;
  final int quantity;
  final String deliveryType;

  factory SalesOrderItemRecord.fromJson(Map<String, dynamic> json) {
    return SalesOrderItemRecord(
      productName: '${json['productName'] ?? ''}',
      quantity: _intValue(json['quantity']),
      deliveryType: '${json['deliveryType'] ?? 'shipping'}',
    );
  }
}

class FinanceOverview {
  const FinanceOverview({
    required this.travelGroupCount,
    required this.orderCount,
    required this.salesAmountCents,
    required this.refundAmountCents,
    required this.cashOnDeliveryAmountCents,
    required this.recentOrders,
  });

  final int travelGroupCount;
  final int orderCount;
  final int salesAmountCents;
  final int refundAmountCents;
  final int cashOnDeliveryAmountCents;
  final List<SalesOrderRecord> recentOrders;

  factory FinanceOverview.fromJson(Map<String, dynamic> json) {
    final metrics = _map(json['metrics']);
    return FinanceOverview(
      travelGroupCount: _intValue(metrics['travelGroupCount']),
      orderCount: _intValue(metrics['orderCount']),
      salesAmountCents: _intValue(metrics['salesAmountCents']),
      refundAmountCents: _intValue(metrics['refundAmountCents']),
      cashOnDeliveryAmountCents:
          _intValue(metrics['cashOnDeliveryAmountCents']),
      recentOrders: _list(json['recentOrders'])
          .map((item) => SalesOrderRecord.fromJson(item))
          .toList(),
    );
  }
}

class ReconciliationRecord {
  const ReconciliationRecord({
    required this.businessDate,
    required this.travelGroupSalesCents,
    required this.backOfficeSalesCents,
    required this.buybackCents,
    required this.externalSalesCents,
    required this.internalPurchaseCents,
    required this.afterSalesCents,
    required this.refundsCents,
    required this.otherReceivableCents,
    required this.receivableTotalCents,
    required this.actualTotalCents,
    required this.differenceCents,
    required this.paymentMethods,
    required this.notes,
  });

  final String businessDate;
  final int travelGroupSalesCents;
  final int backOfficeSalesCents;
  final int buybackCents;
  final int externalSalesCents;
  final int internalPurchaseCents;
  final int afterSalesCents;
  final int refundsCents;
  final int otherReceivableCents;
  final int receivableTotalCents;
  final int actualTotalCents;
  final int differenceCents;
  final List<PaymentMethodRecord> paymentMethods;
  final String? notes;

  factory ReconciliationRecord.fromJson(Map<String, dynamic> json) {
    return ReconciliationRecord(
      businessDate: '${json['businessDate'] ?? ''}',
      travelGroupSalesCents: _intValue(json['travelGroupSalesCents']),
      backOfficeSalesCents: _intValue(json['backOfficeSalesCents']),
      buybackCents: _intValue(json['buybackCents']),
      externalSalesCents: _intValue(json['externalSalesCents']),
      internalPurchaseCents: _intValue(json['internalPurchaseCents']),
      afterSalesCents: _intValue(json['afterSalesCents']),
      refundsCents: _intValue(json['refundsCents']),
      otherReceivableCents: _intValue(json['otherReceivableCents']),
      receivableTotalCents: _intValue(json['receivableTotalCents']),
      actualTotalCents: _intValue(json['actualTotalCents']),
      differenceCents: _intValue(json['differenceCents']),
      paymentMethods: _list(json['paymentMethods'])
          .map((item) => PaymentMethodRecord.fromJson(item))
          .toList(),
      notes: _stringOrNull(json['notes']),
    );
  }
}

class PaymentMethodRecord {
  const PaymentMethodRecord({
    required this.name,
    required this.amountCents,
    required this.sortOrder,
  });

  final String name;
  final int amountCents;
  final int sortOrder;

  factory PaymentMethodRecord.fromJson(Map<String, dynamic> json) {
    return PaymentMethodRecord(
      name: '${json['name'] ?? ''}',
      amountCents: _intValue(json['amountCents']),
      sortOrder: _intValue(json['sortOrder']),
    );
  }
}

String _path(String path, Map<String, String> query) {
  final uri = Uri(path: path, queryParameters: query);
  return uri.toString();
}

void _putNonEmpty(Map<String, String> query, String key, String? value) {
  final text = value?.trim() ?? '';
  if (text.isNotEmpty) {
    query[key] = text;
  }
}

Map<String, dynamic> _data(Map<String, dynamic> payload) {
  return _map(payload['data']);
}

Map<String, dynamic> _map(Object? value) {
  if (value is Map) {
    return value.map((key, mapValue) => MapEntry('$key', mapValue));
  }
  return <String, dynamic>{};
}

List<Map<String, dynamic>> _list(Object? value) {
  if (value is List) {
    return value.whereType<Map>().map(_map).toList();
  }
  return const <Map<String, dynamic>>[];
}

List<String> _stringList(Object? value) {
  if (value is List) {
    return value
        .map((item) => '$item'.trim())
        .where((item) => item.isNotEmpty)
        .toList();
  }
  return const <String>[];
}

String? _stringOrNull(Object? value) {
  final text = value == null ? '' : '$value'.trim();
  return text.isEmpty ? null : text;
}

int _intValue(Object? value) {
  if (value is int) {
    return value;
  }
  if (value is num) {
    return value.toInt();
  }
  return int.tryParse('${value ?? 0}') ?? 0;
}

bool _boolValue(Object? value) {
  if (value is bool) {
    return value;
  }
  final text = '${value ?? ''}'.trim().toLowerCase();
  return text == 'true' || text == '1' || text == 'yes';
}

String? _joinedAddress(Map<String, dynamic> json) {
  final parts = [
    _stringOrNull(json['province']),
    _stringOrNull(json['city']),
    _stringOrNull(json['district']),
    _stringOrNull(json['address']),
  ].whereType<String>().where((part) => part.isNotEmpty).toList();
  if (parts.isEmpty) {
    return null;
  }
  return parts.join('');
}
