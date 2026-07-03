import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../api/api_client.dart';

typedef DownloadedFile = ApiDownloadedFile;

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
    final query = _travelGroupQueryParameters(
      limit: limit,
      start: start,
      end: end,
      keyword: keyword,
      groupNo: groupNo,
      guideId: guideId,
      tasterId: tasterId,
      groupType: groupType,
      financeMark: financeMark,
      pendingStatus: pendingStatus,
    );

    final payload = await _apiClient.getJson(
      _path('/api/travel-groups', query),
      token: _token,
    );
    final data = _data(payload);
    return _list(data['travelGroups'])
        .map((item) => TravelGroupRecord.fromJson(item))
        .toList();
  }

  Future<DownloadedFile> downloadTravelGroupsExcel({
    int? limit,
    DateTime? start,
    DateTime? end,
    String? keyword,
    String? groupNo,
    String? guideId,
    String? tasterId,
    String? groupType,
    bool? financeMark,
    String? pendingStatus,
  }) {
    final query = _travelGroupQueryParameters(
      limit: limit,
      start: start,
      end: end,
      keyword: keyword,
      groupNo: groupNo,
      guideId: guideId,
      tasterId: tasterId,
      groupType: groupType,
      financeMark: financeMark,
      pendingStatus: pendingStatus,
    );
    return _apiClient.getBytes(
      _path('/api/travel-groups/export.xlsx', query),
      token: _token,
      defaultFileName: 'travel-groups.xlsx',
    );
  }

  Map<String, String> _travelGroupQueryParameters({
    int? limit,
    DateTime? start,
    DateTime? end,
    String? keyword,
    String? groupNo,
    String? guideId,
    String? tasterId,
    String? groupType,
    bool? financeMark,
    String? pendingStatus,
  }) {
    final query = <String, String>{};
    if (limit != null) {
      query['limit'] = '$limit';
    }
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
    return query;
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

  Future<List<CustomerRecord>> listCustomers({
    String? keyword,
    String? query,
    String? phone,
    bool? financeMark,
    int limit = 20,
  }) async {
    final queryParameters = <String, String>{'limit': '$limit'};
    _putNonEmpty(queryParameters, 'keyword', keyword);
    _putNonEmpty(queryParameters, 'query', query);
    _putNonEmpty(queryParameters, 'phone', phone);
    if (financeMark != null) {
      queryParameters['financeMark'] = '$financeMark';
    }

    final payload = await _apiClient.getJson(
      _path('/api/customers', queryParameters),
      token: _token,
    );
    final data = _data(payload);
    return _list(data['customers'])
        .map((item) => CustomerRecord.fromJson(item))
        .toList();
  }

  Future<CustomerRecord> createCustomer(Map<String, dynamic> body) async {
    final payload = await _apiClient.postJson(
      '/api/customers',
      body: body,
      token: _token,
    );
    return CustomerRecord.fromJson(_map(_data(payload)['customer']));
  }

  Future<CustomerRecord> updateCustomer(
    String id,
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/customers/$id',
      body: body,
      token: _token,
    );
    return CustomerRecord.fromJson(_map(_data(payload)['customer']));
  }

  Future<CustomerRecord> setCustomerFinanceMark(
    String id,
    bool financeMark,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/customers/$id/finance-mark',
      body: {'financeMark': financeMark},
      token: _token,
    );
    return CustomerRecord.fromJson(_map(_data(payload)['customer']));
  }

  Future<List<SalesOrderRecord>> listSalesOrders({
    int limit = 20,
    DateTime? start,
    DateTime? end,
    String? keyword,
    String? query,
    String? customerId,
    String? customerPhone,
    String? travelGroupId,
    String? orderType,
    String? status,
    String? deliveryType,
    String? packingStatus,
    bool? financeMark,
    bool? customerFinanceMark,
    String? salesUserId,
  }) async {
    final queryParameters = _salesOrderQueryParameters(
      limit: limit,
      start: start,
      end: end,
      keyword: keyword,
      query: query,
      customerId: customerId,
      customerPhone: customerPhone,
      travelGroupId: travelGroupId,
      orderType: orderType,
      status: status,
      deliveryType: deliveryType,
      packingStatus: packingStatus,
      financeMark: financeMark,
      customerFinanceMark: customerFinanceMark,
      salesUserId: salesUserId,
    );

    final payload = await _apiClient.getJson(
      _path('/api/sales-orders', queryParameters),
      token: _token,
    );
    final data = _data(payload);
    return _list(data['salesOrders'])
        .map((item) => SalesOrderRecord.fromJson(item))
        .toList();
  }

  Future<DownloadedFile> downloadSalesOrdersExcel({
    int? limit,
    DateTime? start,
    DateTime? end,
    String? keyword,
    String? query,
    String? customerId,
    String? customerPhone,
    String? travelGroupId,
    String? orderType,
    String? status,
    String? deliveryType,
    String? packingStatus,
    bool? financeMark,
    bool? customerFinanceMark,
    String? salesUserId,
  }) {
    final queryParameters = _salesOrderQueryParameters(
      limit: limit,
      start: start,
      end: end,
      keyword: keyword,
      query: query,
      customerId: customerId,
      customerPhone: customerPhone,
      travelGroupId: travelGroupId,
      orderType: orderType,
      status: status,
      deliveryType: deliveryType,
      packingStatus: packingStatus,
      financeMark: financeMark,
      customerFinanceMark: customerFinanceMark,
      salesUserId: salesUserId,
    );
    return _apiClient.getBytes(
      _path('/api/sales-orders/export.xlsx', queryParameters),
      token: _token,
      defaultFileName: 'sales-orders.xlsx',
    );
  }

  Map<String, String> _salesOrderQueryParameters({
    int? limit,
    DateTime? start,
    DateTime? end,
    String? keyword,
    String? query,
    String? customerId,
    String? customerPhone,
    String? travelGroupId,
    String? orderType,
    String? status,
    String? deliveryType,
    String? packingStatus,
    bool? financeMark,
    bool? customerFinanceMark,
    String? salesUserId,
  }) {
    final queryParameters = <String, String>{};
    if (limit != null) {
      queryParameters['limit'] = '$limit';
    }
    if (start != null) {
      queryParameters['dateFrom'] = formatDate(start);
    }
    if (end != null) {
      queryParameters['dateTo'] = formatDate(end);
    }
    _putNonEmpty(queryParameters, 'keyword', keyword);
    _putNonEmpty(queryParameters, 'query', query);
    _putNonEmpty(queryParameters, 'customerId', customerId);
    _putNonEmpty(queryParameters, 'customerPhone', customerPhone);
    _putNonEmpty(queryParameters, 'travelGroupId', travelGroupId);
    _putNonEmpty(queryParameters, 'orderType', orderType);
    _putNonEmpty(queryParameters, 'status', status);
    _putNonEmpty(queryParameters, 'deliveryType', deliveryType);
    _putNonEmpty(queryParameters, 'packingStatus', packingStatus);
    if (financeMark != null) {
      queryParameters['financeMark'] = '$financeMark';
    }
    if (customerFinanceMark != null) {
      queryParameters['customerFinanceMark'] = '$customerFinanceMark';
    }
    _putNonEmpty(queryParameters, 'salesUserId', salesUserId);
    return queryParameters;
  }

  Future<SalesOrderRecord> getSalesOrder(String id) async {
    final payload = await _apiClient.getJson(
      '/api/sales-orders/$id',
      token: _token,
    );
    return SalesOrderRecord.fromJson(_map(_data(payload)['salesOrder']));
  }

  Future<SalesSheetRecord> getSalesOrderSalesSheet(String id) async {
    final payload = await _apiClient.getJson(
      '/api/sales-orders/$id/sales-sheet',
      token: _token,
    );
    return _salesSheetFromData(_data(payload));
  }

  Future<SalesSheetRecord> generateSalesOrderQrCode(
    String id, {
    int? expiresInDays,
    bool regenerate = false,
  }) async {
    final body = <String, dynamic>{'regenerate': regenerate};
    if (expiresInDays != null) {
      body['expiresInDays'] = expiresInDays;
    }
    final payload = await _apiClient.postJson(
      '/api/sales-orders/$id/qr-code',
      body: body,
      token: _token,
    );
    return _salesSheetFromData(_data(payload));
  }

  SalesSheetRecord _salesSheetFromData(Map<String, dynamic> data) {
    final salesSheet = SalesSheetRecord.fromJson(_map(data['salesSheet']));
    if (data['qrCode'] is Map) {
      return salesSheet.copyWith(
        qrCode: SalesSheetQrCode.fromJson(_map(data['qrCode'])),
      );
    }
    return salesSheet;
  }

  Future<SalesOrderRecord> createSalesOrder(Map<String, dynamic> body) async {
    final payload = await _apiClient.postJson(
      '/api/sales-orders',
      body: body,
      token: _token,
    );
    return SalesOrderRecord.fromJson(_map(_data(payload)['salesOrder']));
  }

  Future<SalesOrderRecord> updateSalesOrder(
    String id,
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/sales-orders/$id',
      body: body,
      token: _token,
    );
    return SalesOrderRecord.fromJson(_map(_data(payload)['salesOrder']));
  }

  Future<SalesOrderRecord> updateSalesOrderStatus(
    String id,
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/sales-orders/$id/status',
      body: body,
      token: _token,
    );
    return SalesOrderRecord.fromJson(_map(_data(payload)['salesOrder']));
  }

  Future<SalesOrderRecord> updateSalesOrderFinance(
    String id,
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/sales-orders/$id/finance',
      body: body,
      token: _token,
    );
    return SalesOrderRecord.fromJson(_map(_data(payload)['salesOrder']));
  }

  Future<SalesOrderRecord> updateSalesOrderPacking(
    String id,
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/sales-orders/$id/packing',
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

  Future<List<AfterSalesOrderRecord>> listAfterSalesOrders({
    int limit = 20,
    DateTime? start,
    DateTime? end,
    String? keyword,
    String? query,
    String? status,
    String? issueType,
    String? actionType,
    String? salesOrderId,
    String? customerId,
    bool? financeConfirmed,
  }) async {
    final queryParameters = _afterSalesOrderQueryParameters(
      limit: limit,
      start: start,
      end: end,
      keyword: keyword,
      query: query,
      status: status,
      issueType: issueType,
      actionType: actionType,
      salesOrderId: salesOrderId,
      customerId: customerId,
      financeConfirmed: financeConfirmed,
    );
    final payload = await _apiClient.getJson(
      _path('/api/after-sales-orders', queryParameters),
      token: _token,
    );
    return _list(_data(payload)['afterSalesOrders'])
        .map((item) => AfterSalesOrderRecord.fromJson(item))
        .toList();
  }

  Map<String, String> _afterSalesOrderQueryParameters({
    int? limit,
    DateTime? start,
    DateTime? end,
    String? keyword,
    String? query,
    String? status,
    String? issueType,
    String? actionType,
    String? salesOrderId,
    String? customerId,
    bool? financeConfirmed,
  }) {
    final queryParameters = <String, String>{};
    if (limit != null) {
      queryParameters['limit'] = '$limit';
    }
    if (start != null) {
      queryParameters['dateFrom'] = formatDate(start);
    }
    if (end != null) {
      queryParameters['dateTo'] = formatDate(end);
    }
    _putNonEmpty(queryParameters, 'keyword', keyword);
    _putNonEmpty(queryParameters, 'query', query);
    _putNonEmpty(queryParameters, 'status', status);
    _putNonEmpty(queryParameters, 'issueType', issueType);
    _putNonEmpty(queryParameters, 'actionType', actionType);
    _putNonEmpty(queryParameters, 'salesOrderId', salesOrderId);
    _putNonEmpty(queryParameters, 'customerId', customerId);
    if (financeConfirmed != null) {
      queryParameters['financeConfirmed'] = '$financeConfirmed';
    }
    return queryParameters;
  }

  Future<AfterSalesOrderRecord> createAfterSalesOrder(
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.postJson(
      '/api/after-sales-orders',
      body: body,
      token: _token,
    );
    return AfterSalesOrderRecord.fromJson(
      _map(_data(payload)['afterSalesOrder']),
    );
  }

  Future<AfterSalesOrderRecord> getAfterSalesOrder(String id) async {
    final payload = await _apiClient.getJson(
      '/api/after-sales-orders/$id',
      token: _token,
    );
    return AfterSalesOrderRecord.fromJson(
      _map(_data(payload)['afterSalesOrder']),
    );
  }

  Future<AfterSalesOrderRecord> updateAfterSalesOrder(
    String id,
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/after-sales-orders/$id',
      body: body,
      token: _token,
    );
    return AfterSalesOrderRecord.fromJson(
      _map(_data(payload)['afterSalesOrder']),
    );
  }

  Future<AfterSalesOrderRecord> updateAfterSalesOrderStatus(
    String id,
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/after-sales-orders/$id/status',
      body: body,
      token: _token,
    );
    return AfterSalesOrderRecord.fromJson(
      _map(_data(payload)['afterSalesOrder']),
    );
  }

  Future<AfterSalesOrderRecord> confirmAfterSalesFinance(
    String id,
    bool financeConfirmed,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/after-sales-orders/$id/finance-confirm',
      body: {'financeConfirmed': financeConfirmed},
      token: _token,
    );
    return AfterSalesOrderRecord.fromJson(
      _map(_data(payload)['afterSalesOrder']),
    );
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

  Future<FinanceWorkbenchRecord> getFinanceWorkbench({
    int limit = 20,
    DateTime? start,
    DateTime? end,
    String? query,
  }) async {
    final queryParameters = <String, String>{'limit': '$limit'};
    if (start != null) {
      queryParameters['dateFrom'] = formatDate(start);
    }
    if (end != null) {
      queryParameters['dateTo'] = formatDate(end);
    }
    _putNonEmpty(queryParameters, 'query', query);
    final payload = await _apiClient.getJson(
      _path('/api/finance/workbench', queryParameters),
      token: _token,
    );
    return FinanceWorkbenchRecord.fromJson(_map(_data(payload)['workbench']));
  }

  Future<List<SalesOrderRecord>> listWarehouseOrders({
    int limit = 50,
    DateTime? start,
    DateTime? end,
    String? query,
    String? packingStatus,
    String? logisticsMethod,
  }) async {
    final queryParameters = <String, String>{'limit': '$limit'};
    if (start != null) {
      queryParameters['dateFrom'] = formatDate(start);
    }
    if (end != null) {
      queryParameters['dateTo'] = formatDate(end);
    }
    _putNonEmpty(queryParameters, 'query', query);
    _putNonEmpty(queryParameters, 'packingStatus', packingStatus);
    _putNonEmpty(queryParameters, 'logisticsMethod', logisticsMethod);
    final payload = await _apiClient.getJson(
      _path('/api/warehouse/orders', queryParameters),
      token: _token,
    );
    return _list(_data(payload)['warehouseOrders'])
        .map((item) => SalesOrderRecord.fromJson(item))
        .toList();
  }

  Future<SalesOrderRecord> updateWarehouseOrderPacking(
    String id,
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/warehouse/orders/$id/packing',
      body: body,
      token: _token,
    );
    return SalesOrderRecord.fromJson(_map(_data(payload)['warehouseOrder']));
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

class CustomerRecord {
  const CustomerRecord({
    required this.id,
    required this.name,
    required this.phone,
    required this.province,
    required this.city,
    required this.district,
    required this.address,
    required this.financeMark,
    required this.markedById,
    required this.markedAt,
    required this.notes,
    required this.createdById,
    required this.updatedById,
    required this.createdAt,
    required this.updatedAt,
    this.recentOrders = const <SalesOrderRecord>[],
  });

  final String id;
  final String name;
  final String? phone;
  final String? province;
  final String? city;
  final String? district;
  final String? address;
  final bool financeMark;
  final String? markedById;
  final String? markedAt;
  final String? notes;
  final String? createdById;
  final String? updatedById;
  final String? createdAt;
  final String? updatedAt;
  final List<SalesOrderRecord> recentOrders;

  factory CustomerRecord.fromJson(Map<String, dynamic> json) {
    return CustomerRecord(
      id: '${json['id'] ?? ''}',
      name: '${json['name'] ?? ''}',
      phone: _stringOrNull(json['phone']),
      province: _stringOrNull(json['province']),
      city: _stringOrNull(json['city']),
      district: _stringOrNull(json['district']),
      address: _stringOrNull(json['address']),
      financeMark: _boolValue(json['financeMark']),
      markedById: _stringOrNull(json['markedById']),
      markedAt: _stringOrNull(json['markedAt']),
      notes: _stringOrNull(json['notes']),
      createdById: _stringOrNull(json['createdById']),
      updatedById: _stringOrNull(json['updatedById']),
      createdAt: _stringOrNull(json['createdAt']),
      updatedAt: _stringOrNull(json['updatedAt']),
      recentOrders: _list(json['recentOrders'])
          .map((item) => SalesOrderRecord.fromJson(item))
          .toList(),
    );
  }
}

class SalesOrderRecord {
  const SalesOrderRecord({
    required this.id,
    required this.orderNo,
    required this.orderType,
    required this.customerId,
    required this.customer,
    required this.customerName,
    required this.customerPhone,
    required this.province,
    required this.city,
    required this.district,
    required this.orderDate,
    required this.salesFormNo,
    required this.totalAmountCents,
    required this.cashOnDeliveryAmountCents,
    required this.status,
    required this.deliverySummary,
    required this.logisticsMethod,
    required this.packingStatus,
    required this.packageCount,
    required this.warehouseRemark,
    required this.logisticsNo,
    required this.logisticsFeeCents,
    required this.invoiceRequired,
    required this.invoiceIssued,
    required this.financeRemark,
    required this.travelGroup,
    required this.travelGroupId,
    required this.address,
    required this.financeMark,
    required this.markedById,
    required this.markedAt,
    required this.salesUserId,
    required this.items,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String orderNo;
  final String orderType;
  final String? customerId;
  final CustomerRecord? customer;
  final String customerName;
  final String? customerPhone;
  final String? province;
  final String? city;
  final String? district;
  final String orderDate;
  final String? salesFormNo;
  final int totalAmountCents;
  final int cashOnDeliveryAmountCents;
  final String status;
  final String? deliverySummary;
  final String? logisticsMethod;
  final String packingStatus;
  final int packageCount;
  final String? warehouseRemark;
  final String? logisticsNo;
  final int logisticsFeeCents;
  final bool invoiceRequired;
  final bool invoiceIssued;
  final String? financeRemark;
  final TravelGroupRecord? travelGroup;
  final String? travelGroupId;
  final String? address;
  final bool financeMark;
  final String? markedById;
  final String? markedAt;
  final String? salesUserId;
  final List<SalesOrderItemRecord> items;
  final String? createdAt;
  final String? updatedAt;

  factory SalesOrderRecord.fromJson(Map<String, dynamic> json) {
    final customer = json['customer'] is Map
        ? CustomerRecord.fromJson(_map(json['customer']))
        : null;
    final travelGroup = json['travelGroup'] is Map
        ? TravelGroupRecord.fromJson(_map(json['travelGroup']))
        : null;
    return SalesOrderRecord(
      id: '${json['id'] ?? ''}',
      orderNo: '${json['orderNo'] ?? ''}',
      orderType: '${json['orderType'] ?? 'travel_group'}',
      customerId: _stringOrNull(json['customerId']),
      customer: customer,
      customerName: '${json['customerName'] ?? customer?.name ?? ''}',
      customerPhone: _stringOrNull(json['customerPhone']),
      province: _stringOrNull(json['province']),
      city: _stringOrNull(json['city']),
      district: _stringOrNull(json['district']),
      orderDate: '${json['orderDate'] ?? ''}',
      salesFormNo: _stringOrNull(json['salesFormNo']),
      totalAmountCents: _intValue(json['totalAmountCents']),
      cashOnDeliveryAmountCents: _intValue(json['cashOnDeliveryAmountCents']),
      status: '${json['status'] ?? 'valid'}',
      deliverySummary: _stringOrNull(json['deliverySummary']),
      logisticsMethod: _stringOrNull(json['logisticsMethod']),
      packingStatus: '${json['packingStatus'] ?? 'pending'}',
      packageCount: _intValue(json['packageCount']),
      warehouseRemark: _stringOrNull(json['warehouseRemark']),
      logisticsNo: _stringOrNull(json['logisticsNo']),
      logisticsFeeCents: _intValue(json['logisticsFeeCents']),
      invoiceRequired: _boolValue(json['invoiceRequired']),
      invoiceIssued: _boolValue(json['invoiceIssued']),
      financeRemark: _stringOrNull(json['financeRemark']),
      travelGroup: travelGroup,
      travelGroupId: _stringOrNull(json['travelGroupId']),
      address: _joinedAddress(json),
      financeMark: _boolValue(json['financeMark']),
      markedById: _stringOrNull(json['markedById']),
      markedAt: _stringOrNull(json['markedAt']),
      salesUserId: _stringOrNull(json['salesUserId']),
      items: _list(json['items'])
          .map((item) => SalesOrderItemRecord.fromJson(item))
          .toList(),
      createdAt: _stringOrNull(json['createdAt']),
      updatedAt: _stringOrNull(json['updatedAt']),
    );
  }
}

class SalesOrderItemRecord {
  const SalesOrderItemRecord({
    required this.id,
    required this.salesOrderId,
    required this.productName,
    required this.quantity,
    required this.unitPriceCents,
    required this.subtotalCents,
    required this.deliveryType,
    required this.notes,
    required this.sortOrder,
  });

  final String? id;
  final String? salesOrderId;
  final String productName;
  final int quantity;
  final int unitPriceCents;
  final int subtotalCents;
  final String deliveryType;
  final String? notes;
  final int sortOrder;

  factory SalesOrderItemRecord.fromJson(Map<String, dynamic> json) {
    final quantity = _intValue(json['quantity']);
    final unitPriceCents = _intValue(json['unitPriceCents']);
    return SalesOrderItemRecord(
      id: _stringOrNull(json['id']),
      salesOrderId: _stringOrNull(json['salesOrderId']),
      productName: '${json['productName'] ?? ''}',
      quantity: quantity,
      unitPriceCents: unitPriceCents,
      subtotalCents: json.containsKey('subtotalCents')
          ? _intValue(json['subtotalCents'])
          : quantity * unitPriceCents,
      deliveryType: '${json['deliveryType'] ?? 'shipping'}',
      notes: _stringOrNull(json['notes']),
      sortOrder: _intValue(json['sortOrder']),
    );
  }
}

class AfterSalesOrderRecord {
  const AfterSalesOrderRecord({
    required this.id,
    required this.afterSalesNo,
    required this.salesOrderId,
    required this.salesOrder,
    required this.customerId,
    required this.customer,
    required this.issueType,
    required this.actionType,
    required this.description,
    required this.resolution,
    required this.refundAmountCents,
    required this.status,
    required this.financeConfirmed,
    required this.financeConfirmedById,
    required this.financeConfirmedAt,
    required this.handledById,
    required this.handledAt,
    required this.completedAt,
    required this.notes,
    required this.createdById,
    required this.updatedById,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String afterSalesNo;
  final String salesOrderId;
  final SalesOrderRecord? salesOrder;
  final String? customerId;
  final CustomerRecord? customer;
  final String issueType;
  final String actionType;
  final String description;
  final String? resolution;
  final int refundAmountCents;
  final String status;
  final bool financeConfirmed;
  final String? financeConfirmedById;
  final String? financeConfirmedAt;
  final String? handledById;
  final String? handledAt;
  final String? completedAt;
  final String? notes;
  final String? createdById;
  final String? updatedById;
  final String? createdAt;
  final String? updatedAt;

  factory AfterSalesOrderRecord.fromJson(Map<String, dynamic> json) {
    return AfterSalesOrderRecord(
      id: '${json['id'] ?? ''}',
      afterSalesNo: '${json['afterSalesNo'] ?? ''}',
      salesOrderId: '${json['salesOrderId'] ?? ''}',
      salesOrder: json['salesOrder'] is Map
          ? SalesOrderRecord.fromJson(_map(json['salesOrder']))
          : null,
      customerId: _stringOrNull(json['customerId']),
      customer: json['customer'] is Map
          ? CustomerRecord.fromJson(_map(json['customer']))
          : null,
      issueType: '${json['issueType'] ?? ''}',
      actionType: '${json['actionType'] ?? ''}',
      description: '${json['description'] ?? ''}',
      resolution: _stringOrNull(json['resolution']),
      refundAmountCents: _intValue(json['refundAmountCents']),
      status: '${json['status'] ?? 'negotiating'}',
      financeConfirmed: _boolValue(json['financeConfirmed']),
      financeConfirmedById: _stringOrNull(json['financeConfirmedById']),
      financeConfirmedAt: _stringOrNull(json['financeConfirmedAt']),
      handledById: _stringOrNull(json['handledById']),
      handledAt: _stringOrNull(json['handledAt']),
      completedAt: _stringOrNull(json['completedAt']),
      notes: _stringOrNull(json['notes']),
      createdById: _stringOrNull(json['createdById']),
      updatedById: _stringOrNull(json['updatedById']),
      createdAt: _stringOrNull(json['createdAt']),
      updatedAt: _stringOrNull(json['updatedAt']),
    );
  }
}

class SalesSheetRecord {
  const SalesSheetRecord({
    required this.visibility,
    required this.companyName,
    required this.order,
    required this.customer,
    required this.travelGroup,
    required this.salesUser,
    required this.items,
    required this.amounts,
    required this.status,
    required this.delivery,
    required this.logistics,
    required this.invoice,
    required this.qrCode,
    required this.internalFields,
    required this.public,
  });

  final String visibility;
  final String companyName;
  final SalesSheetOrderRecord order;
  final SalesSheetCustomerRecord customer;
  final SalesSheetTravelGroupRecord? travelGroup;
  final SalesSheetSalesUserRecord? salesUser;
  final List<SalesSheetItemRecord> items;
  final SalesSheetAmountsRecord amounts;
  final SalesSheetStatusRecord status;
  final SalesSheetDeliveryRecord delivery;
  final SalesSheetLogisticsRecord logistics;
  final SalesSheetInvoiceRecord invoice;
  final SalesSheetQrCode? qrCode;
  final Map<String, dynamic> internalFields;
  final SalesSheetRecord? public;

  factory SalesSheetRecord.fromJson(Map<String, dynamic> json) {
    return SalesSheetRecord(
      visibility: '${json['visibility'] ?? 'internal'}',
      companyName: '${json['companyName'] ?? ''}',
      order: SalesSheetOrderRecord.fromJson(_map(json['order'])),
      customer: SalesSheetCustomerRecord.fromJson(_map(json['customer'])),
      travelGroup: json['travelGroup'] is Map
          ? SalesSheetTravelGroupRecord.fromJson(_map(json['travelGroup']))
          : null,
      salesUser: json['salesUser'] is Map
          ? SalesSheetSalesUserRecord.fromJson(_map(json['salesUser']))
          : null,
      items: _list(json['items'])
          .map((item) => SalesSheetItemRecord.fromJson(item))
          .toList(),
      amounts: SalesSheetAmountsRecord.fromJson(_map(json['amounts'])),
      status: SalesSheetStatusRecord.fromJson(_map(json['status'])),
      delivery: SalesSheetDeliveryRecord.fromJson(_map(json['delivery'])),
      logistics: SalesSheetLogisticsRecord.fromJson(_map(json['logistics'])),
      invoice: SalesSheetInvoiceRecord.fromJson(_map(json['invoice'])),
      qrCode: json['qrCode'] is Map
          ? SalesSheetQrCode.fromJson(_map(json['qrCode']))
          : null,
      internalFields: _map(json['internalFields']),
      public: json['public'] is Map
          ? SalesSheetRecord.fromJson(_map(json['public']))
          : null,
    );
  }

  SalesSheetRecord copyWith({
    SalesSheetQrCode? qrCode,
  }) {
    return SalesSheetRecord(
      visibility: visibility,
      companyName: companyName,
      order: order,
      customer: customer,
      travelGroup: travelGroup,
      salesUser: salesUser,
      items: items,
      amounts: amounts,
      status: status,
      delivery: delivery,
      logistics: logistics,
      invoice: invoice,
      qrCode: qrCode ?? this.qrCode,
      internalFields: internalFields,
      public: public,
    );
  }
}

class SalesSheetOrderRecord {
  const SalesSheetOrderRecord({
    required this.id,
    required this.orderNo,
    required this.orderType,
    required this.orderTypeLabel,
    required this.salesFormNo,
    required this.orderDate,
    required this.remark,
  });

  final String? id;
  final String? orderNo;
  final String? orderType;
  final String? orderTypeLabel;
  final String? salesFormNo;
  final String? orderDate;
  final String? remark;

  factory SalesSheetOrderRecord.fromJson(Map<String, dynamic> json) {
    return SalesSheetOrderRecord(
      id: _stringOrNull(json['id']),
      orderNo: _stringOrNull(json['orderNo']),
      orderType: _stringOrNull(json['orderType']),
      orderTypeLabel: _stringOrNull(json['orderTypeLabel']),
      salesFormNo: _stringOrNull(json['salesFormNo']),
      orderDate: _stringOrNull(json['orderDate']),
      remark: _stringOrNull(json['remark']),
    );
  }
}

class SalesSheetCustomerRecord {
  const SalesSheetCustomerRecord({
    required this.id,
    required this.name,
    required this.phone,
    required this.phoneMasked,
    required this.province,
    required this.city,
    required this.district,
    required this.address,
    required this.fullAddress,
  });

  final String? id;
  final String? name;
  final String? phone;
  final String? phoneMasked;
  final String? province;
  final String? city;
  final String? district;
  final String? address;
  final String? fullAddress;

  factory SalesSheetCustomerRecord.fromJson(Map<String, dynamic> json) {
    return SalesSheetCustomerRecord(
      id: _stringOrNull(json['id']),
      name: _stringOrNull(json['name']),
      phone: _stringOrNull(json['phone']),
      phoneMasked: _stringOrNull(json['phoneMasked']),
      province: _stringOrNull(json['province']),
      city: _stringOrNull(json['city']),
      district: _stringOrNull(json['district']),
      address: _stringOrNull(json['address']),
      fullAddress: _stringOrNull(json['fullAddress']),
    );
  }
}

class SalesSheetTravelGroupRecord {
  const SalesSheetTravelGroupRecord({
    required this.id,
    required this.groupNo,
    required this.visitDate,
    required this.travelAgency,
    required this.guideName,
    required this.guidePhone,
    required this.tasterName,
    required this.tastingRoomNo,
    required this.financeMark,
  });

  final String? id;
  final String? groupNo;
  final String? visitDate;
  final String? travelAgency;
  final String? guideName;
  final String? guidePhone;
  final String? tasterName;
  final String? tastingRoomNo;
  final bool? financeMark;

  factory SalesSheetTravelGroupRecord.fromJson(Map<String, dynamic> json) {
    return SalesSheetTravelGroupRecord(
      id: _stringOrNull(json['id']),
      groupNo: _stringOrNull(json['groupNo']),
      visitDate: _stringOrNull(json['visitDate']),
      travelAgency: _stringOrNull(json['travelAgency']),
      guideName: _stringOrNull(json['guideName']),
      guidePhone: _stringOrNull(json['guidePhone']),
      tasterName: _stringOrNull(json['tasterName']),
      tastingRoomNo: _stringOrNull(json['tastingRoomNo']),
      financeMark: _boolOrNull(json['financeMark']),
    );
  }
}

class SalesSheetSalesUserRecord {
  const SalesSheetSalesUserRecord({
    required this.id,
    required this.name,
    required this.username,
  });

  final String? id;
  final String? name;
  final String? username;

  factory SalesSheetSalesUserRecord.fromJson(Map<String, dynamic> json) {
    return SalesSheetSalesUserRecord(
      id: _stringOrNull(json['id']),
      name: _stringOrNull(json['name']),
      username: _stringOrNull(json['username']),
    );
  }
}

class SalesSheetItemRecord {
  const SalesSheetItemRecord({
    required this.id,
    required this.productName,
    required this.quantity,
    required this.unitPriceCents,
    required this.unitPriceYuan,
    required this.subtotalCents,
    required this.subtotalYuan,
    required this.deliveryType,
    required this.deliveryTypeLabel,
    required this.notes,
    required this.sortOrder,
  });

  final String? id;
  final String? productName;
  final int quantity;
  final int unitPriceCents;
  final String? unitPriceYuan;
  final int subtotalCents;
  final String? subtotalYuan;
  final String? deliveryType;
  final String? deliveryTypeLabel;
  final String? notes;
  final int sortOrder;

  factory SalesSheetItemRecord.fromJson(Map<String, dynamic> json) {
    return SalesSheetItemRecord(
      id: _stringOrNull(json['id']),
      productName: _stringOrNull(json['productName']),
      quantity: _intValue(json['quantity']),
      unitPriceCents: _intValue(json['unitPriceCents']),
      unitPriceYuan: _stringOrNull(json['unitPriceYuan']),
      subtotalCents: _intValue(json['subtotalCents']),
      subtotalYuan: _stringOrNull(json['subtotalYuan']),
      deliveryType: _stringOrNull(json['deliveryType']),
      deliveryTypeLabel: _stringOrNull(json['deliveryTypeLabel']),
      notes: _stringOrNull(json['notes']),
      sortOrder: _intValue(json['sortOrder']),
    );
  }
}

class SalesSheetAmountsRecord {
  const SalesSheetAmountsRecord({
    required this.totalAmountCents,
    required this.totalAmountYuan,
    required this.cashOnDeliveryAmountCents,
    required this.cashOnDeliveryAmountYuan,
    required this.logisticsFeeCents,
    required this.logisticsFeeYuan,
  });

  final int totalAmountCents;
  final String? totalAmountYuan;
  final int cashOnDeliveryAmountCents;
  final String? cashOnDeliveryAmountYuan;
  final int logisticsFeeCents;
  final String? logisticsFeeYuan;

  factory SalesSheetAmountsRecord.fromJson(Map<String, dynamic> json) {
    return SalesSheetAmountsRecord(
      totalAmountCents: _intValue(json['totalAmountCents']),
      totalAmountYuan: _stringOrNull(json['totalAmountYuan']),
      cashOnDeliveryAmountCents: _intValue(json['cashOnDeliveryAmountCents']),
      cashOnDeliveryAmountYuan: _stringOrNull(json['cashOnDeliveryAmountYuan']),
      logisticsFeeCents: _intValue(json['logisticsFeeCents']),
      logisticsFeeYuan: _stringOrNull(json['logisticsFeeYuan']),
    );
  }
}

class SalesSheetStatusRecord {
  const SalesSheetStatusRecord({
    required this.value,
    required this.label,
  });

  final String? value;
  final String? label;

  factory SalesSheetStatusRecord.fromJson(Map<String, dynamic> json) {
    return SalesSheetStatusRecord(
      value: _stringOrNull(json['value']),
      label: _stringOrNull(json['label']),
    );
  }
}

class SalesSheetDeliveryRecord {
  const SalesSheetDeliveryRecord({
    required this.summary,
    required this.summaryLabel,
  });

  final String? summary;
  final String? summaryLabel;

  factory SalesSheetDeliveryRecord.fromJson(Map<String, dynamic> json) {
    return SalesSheetDeliveryRecord(
      summary: _stringOrNull(json['summary']),
      summaryLabel: _stringOrNull(json['summaryLabel']),
    );
  }
}

class SalesSheetLogisticsRecord {
  const SalesSheetLogisticsRecord({
    required this.method,
    required this.logisticsNo,
    required this.packingStatus,
    required this.packingStatusLabel,
    required this.packageCount,
  });

  final String? method;
  final String? logisticsNo;
  final String? packingStatus;
  final String? packingStatusLabel;
  final int packageCount;

  factory SalesSheetLogisticsRecord.fromJson(Map<String, dynamic> json) {
    return SalesSheetLogisticsRecord(
      method: _stringOrNull(json['method']),
      logisticsNo: _stringOrNull(json['logisticsNo']),
      packingStatus: _stringOrNull(json['packingStatus']),
      packingStatusLabel: _stringOrNull(json['packingStatusLabel']),
      packageCount: _intValue(json['packageCount']),
    );
  }
}

class SalesSheetInvoiceRecord {
  const SalesSheetInvoiceRecord({
    required this.required,
    required this.requiredLabel,
    required this.issued,
    required this.issuedLabel,
  });

  final bool required;
  final String? requiredLabel;
  final bool issued;
  final String? issuedLabel;

  factory SalesSheetInvoiceRecord.fromJson(Map<String, dynamic> json) {
    return SalesSheetInvoiceRecord(
      required: _boolValue(json['required']),
      requiredLabel: _stringOrNull(json['requiredLabel']),
      issued: _boolValue(json['issued']),
      issuedLabel: _stringOrNull(json['issuedLabel']),
    );
  }
}

class SalesSheetQrCode {
  const SalesSheetQrCode({
    required this.token,
    required this.url,
    required this.generatedAt,
    required this.expiresAt,
  });

  final String? token;
  final String? url;
  final String? generatedAt;
  final String? expiresAt;

  factory SalesSheetQrCode.fromJson(Map<String, dynamic> json) {
    return SalesSheetQrCode(
      token: _stringOrNull(json['token']),
      url: _stringOrNull(json['url']),
      generatedAt: _stringOrNull(json['generatedAt']),
      expiresAt: _stringOrNull(json['expiresAt']),
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
    this.grossSalesAmountCents = 0,
    this.pendingAfterSalesRefundAmountCents = 0,
    this.legacyRefundOrderAmountCents = 0,
    this.netSalesAmountCents = 0,
    this.logisticsFeeCents = 0,
    this.pendingInvoiceCount = 0,
    this.pendingCustomerMarkCount = 0,
    this.pendingTravelGroupMarkCount = 0,
    this.pendingAfterSalesConfirmCount = 0,
  });

  final int travelGroupCount;
  final int orderCount;
  final int salesAmountCents;
  final int refundAmountCents;
  final int cashOnDeliveryAmountCents;
  final List<SalesOrderRecord> recentOrders;
  final int grossSalesAmountCents;
  final int pendingAfterSalesRefundAmountCents;
  final int legacyRefundOrderAmountCents;
  final int netSalesAmountCents;
  final int logisticsFeeCents;
  final int pendingInvoiceCount;
  final int pendingCustomerMarkCount;
  final int pendingTravelGroupMarkCount;
  final int pendingAfterSalesConfirmCount;

  factory FinanceOverview.fromJson(Map<String, dynamic> json) {
    final metrics = _map(json['metrics']);
    final salesAmountCents = _intValue(metrics['salesAmountCents']);
    final refundAmountCents = _intValue(metrics['refundAmountCents']);
    final grossSalesAmountCents = metrics.containsKey('grossSalesAmountCents')
        ? _intValue(metrics['grossSalesAmountCents'])
        : salesAmountCents;
    final netSalesAmountCents = metrics.containsKey('netSalesAmountCents')
        ? _intValue(metrics['netSalesAmountCents'])
        : grossSalesAmountCents - refundAmountCents;
    return FinanceOverview(
      travelGroupCount: _intValue(metrics['travelGroupCount']),
      orderCount: _intValue(metrics['orderCount']),
      salesAmountCents: salesAmountCents,
      refundAmountCents: refundAmountCents,
      cashOnDeliveryAmountCents:
          _intValue(metrics['cashOnDeliveryAmountCents']),
      recentOrders: _list(json['recentOrders'])
          .map((item) => SalesOrderRecord.fromJson(item))
          .toList(),
      grossSalesAmountCents: grossSalesAmountCents,
      pendingAfterSalesRefundAmountCents:
          _intValue(metrics['pendingAfterSalesRefundAmountCents']),
      legacyRefundOrderAmountCents:
          _intValue(metrics['legacyRefundOrderAmountCents']),
      netSalesAmountCents: netSalesAmountCents,
      logisticsFeeCents: _intValue(metrics['logisticsFeeCents']),
      pendingInvoiceCount: _intValue(metrics['pendingInvoiceCount']),
      pendingCustomerMarkCount: _intValue(metrics['pendingCustomerMarkCount']),
      pendingTravelGroupMarkCount:
          _intValue(metrics['pendingTravelGroupMarkCount']),
      pendingAfterSalesConfirmCount:
          _intValue(metrics['pendingAfterSalesConfirmCount']),
    );
  }

  FinanceOverview copyWith({
    List<SalesOrderRecord>? recentOrders,
  }) {
    return FinanceOverview(
      travelGroupCount: travelGroupCount,
      orderCount: orderCount,
      salesAmountCents: salesAmountCents,
      refundAmountCents: refundAmountCents,
      cashOnDeliveryAmountCents: cashOnDeliveryAmountCents,
      recentOrders: recentOrders ?? this.recentOrders,
      grossSalesAmountCents: grossSalesAmountCents,
      pendingAfterSalesRefundAmountCents: pendingAfterSalesRefundAmountCents,
      legacyRefundOrderAmountCents: legacyRefundOrderAmountCents,
      netSalesAmountCents: netSalesAmountCents,
      logisticsFeeCents: logisticsFeeCents,
      pendingInvoiceCount: pendingInvoiceCount,
      pendingCustomerMarkCount: pendingCustomerMarkCount,
      pendingTravelGroupMarkCount: pendingTravelGroupMarkCount,
      pendingAfterSalesConfirmCount: pendingAfterSalesConfirmCount,
    );
  }
}

class FinanceWorkbenchRecord {
  const FinanceWorkbenchRecord({
    required this.metrics,
    required this.recentOrders,
    required this.pendingAfterSales,
    required this.pendingMarks,
    required this.pendingLogistics,
  });

  final FinanceOverview metrics;
  final List<SalesOrderRecord> recentOrders;
  final List<AfterSalesOrderRecord> pendingAfterSales;
  final List<FinancePendingMarkRecord> pendingMarks;
  final List<FinancePendingLogisticsRecord> pendingLogistics;

  factory FinanceWorkbenchRecord.fromJson(Map<String, dynamic> json) {
    final metrics = FinanceOverview.fromJson({
      'metrics': _map(json['metrics']),
      'recentOrders': _list(json['recentOrders']),
    });
    return FinanceWorkbenchRecord(
      metrics: metrics,
      recentOrders: metrics.recentOrders,
      pendingAfterSales: _list(json['pendingAfterSales'])
          .map((item) => AfterSalesOrderRecord.fromJson(item))
          .toList(),
      pendingMarks: _list(json['pendingMarks'])
          .map((item) => FinancePendingMarkRecord.fromJson(item))
          .toList(),
      pendingLogistics: _list(json['pendingLogistics'])
          .map((item) => FinancePendingLogisticsRecord.fromJson(item))
          .toList(),
    );
  }
}

class FinancePendingMarkRecord {
  const FinancePendingMarkRecord({
    required this.type,
    required this.reason,
    required this.customer,
    required this.travelGroup,
    required this.orderCount,
    required this.latestOrder,
  });

  final String type;
  final String? reason;
  final CustomerRecord? customer;
  final TravelGroupRecord? travelGroup;
  final int orderCount;
  final SalesOrderRecord? latestOrder;

  factory FinancePendingMarkRecord.fromJson(Map<String, dynamic> json) {
    return FinancePendingMarkRecord(
      type: '${json['type'] ?? ''}',
      reason: _stringOrNull(json['reason']),
      customer: json['customer'] is Map
          ? CustomerRecord.fromJson(_map(json['customer']))
          : null,
      travelGroup: json['travelGroup'] is Map
          ? TravelGroupRecord.fromJson(_map(json['travelGroup']))
          : null,
      orderCount: _intValue(json['orderCount']),
      latestOrder: json['latestOrder'] is Map
          ? SalesOrderRecord.fromJson(_map(json['latestOrder']))
          : null,
    );
  }
}

class FinancePendingLogisticsRecord {
  const FinancePendingLogisticsRecord({
    required this.order,
    required this.reasons,
  });

  final SalesOrderRecord? order;
  final List<String> reasons;

  factory FinancePendingLogisticsRecord.fromJson(Map<String, dynamic> json) {
    return FinancePendingLogisticsRecord(
      order: json['order'] is Map
          ? SalesOrderRecord.fromJson(_map(json['order']))
          : null,
      reasons: _stringList(json['reasons']),
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

bool? _boolOrNull(Object? value) {
  if (value == null) {
    return null;
  }
  return _boolValue(value);
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
