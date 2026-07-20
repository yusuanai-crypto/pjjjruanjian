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

  Future<AiChatResponse> sendAiChatMessage(AiChatRequest request) async {
    final payload = await _apiClient.postJson(
      '/api/ai/chat',
      body: request.toJson(),
      token: _token,
    );
    return AiChatResponse.fromJson(_data(payload));
  }

  Future<List<AiChatTemplate>> getAiChatTemplates() async {
    final payload = await _apiClient.getJson(
      '/api/ai/chat/templates',
      token: _token,
    );
    return _list(payload['data'])
        .map((item) => AiChatTemplate.fromJson(item))
        .toList();
  }

  Future<AiChatHistoryPage> getAiChatHistory({
    int page = 1,
    int pageSize = 20,
    String? conversationId,
    String? intent,
    DateTime? dateFrom,
    DateTime? dateTo,
  }) async {
    final query = <String, String>{
      'page': '$page',
      'pageSize': '$pageSize',
    };
    _putNonEmpty(query, 'conversationId', conversationId);
    _putNonEmpty(query, 'intent', intent);
    if (dateFrom != null) {
      query['dateFrom'] = formatDate(dateFrom);
    }
    if (dateTo != null) {
      query['dateTo'] = formatDate(dateTo);
    }

    final payload = await _apiClient.getJson(
      _path('/api/ai/chat/history', query),
      token: _token,
    );
    return AiChatHistoryPage.fromJson(_data(payload));
  }

  Future<AiCapabilities> getAiCapabilities() async {
    final payload = await _apiClient.getJson(
      '/api/ai/capabilities',
      token: _token,
    );
    return AiCapabilities.fromJson(_data(payload));
  }

  Future<List<TravelGroupRecord>> listTravelGroups({
    int limit = 20,
    DateTime? start,
    DateTime? end,
    String? keyword,
    String? groupNo,
    String? guideId,
    String? tasterId,
    String? liaisonTasterId,
    String? travelAgency,
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
      liaisonTasterId: liaisonTasterId,
      travelAgency: travelAgency,
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
    String? liaisonTasterId,
    String? travelAgency,
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
      liaisonTasterId: liaisonTasterId,
      travelAgency: travelAgency,
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
    String? liaisonTasterId,
    String? travelAgency,
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
    _putNonEmpty(query, 'liaisonTasterId', liaisonTasterId);
    _putNonEmpty(query, 'travelAgency', travelAgency);
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

  Future<ProductPage> listProducts({
    int page = 1,
    int pageSize = 100,
    String? keyword,
    bool? isActive,
  }) async {
    final query = <String, String>{
      'page': '$page',
      'pageSize': '$pageSize',
    };
    _putNonEmpty(query, 'keyword', keyword);
    if (isActive != null) {
      query['isActive'] = '$isActive';
    }
    final payload = await _apiClient.getJson(
      _path('/api/products', query),
      token: _token,
    );
    return ProductPage.fromJson(_data(payload));
  }

  Future<List<ProductOptionRecord>> listProductOptions() async {
    final payload = await _apiClient.getJson(
      '/api/products/options',
      token: _token,
    );
    return _list(_data(payload)['products'])
        .map(ProductOptionRecord.fromJson)
        .toList();
  }

  Future<ProductRecord> getProduct(String id) async {
    final payload =
        await _apiClient.getJson('/api/products/$id', token: _token);
    return ProductRecord.fromJson(_map(_data(payload)['product']));
  }

  Future<ProductRecord> createProduct(Map<String, dynamic> body) async {
    final payload = await _apiClient.postJson(
      '/api/products',
      body: body,
      token: _token,
    );
    return ProductRecord.fromJson(_map(_data(payload)['product']));
  }

  Future<ProductRecord> updateProduct(
    String id,
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/products/$id',
      body: body,
      token: _token,
    );
    return ProductRecord.fromJson(_map(_data(payload)['product']));
  }

  Future<ProductRecord> setProductActive(String id, bool isActive) async {
    final payload = await _apiClient.patchJson(
      '/api/products/$id/status',
      body: {'isActive': isActive},
      token: _token,
    );
    return ProductRecord.fromJson(_map(_data(payload)['product']));
  }

  Future<List<ProductActualCostRecord>> listProductActualCosts(
    String productId,
  ) async {
    final payload = await _apiClient.getJson(
      '/api/products/$productId/actual-costs',
      token: _token,
    );
    return _list(_data(payload)['actualCosts'])
        .map(ProductActualCostRecord.fromJson)
        .toList();
  }

  Future<ProductActualCostRecord> createProductActualCost(
    String productId,
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.postJson(
      '/api/products/$productId/actual-costs',
      body: body,
      token: _token,
    );
    return ProductActualCostRecord.fromJson(
      _map(_data(payload)['actualCost']),
    );
  }

  Future<ProductActualCostRecord> updateProductActualCost(
    String id,
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/product-actual-costs/$id',
      body: body,
      token: _token,
    );
    return ProductActualCostRecord.fromJson(
      _map(_data(payload)['actualCost']),
    );
  }

  Future<ProductActualCostRecord> setProductActualCostActive(
    String id,
    bool isActive,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/product-actual-costs/$id/status',
      body: {'isActive': isActive},
      token: _token,
    );
    return ProductActualCostRecord.fromJson(
      _map(_data(payload)['actualCost']),
    );
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

  Future<TravelAgencyRecord> updateTravelAgency(
    String id,
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/travel-agencies/$id',
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

  Future<TravelGroupAttachmentUploadResult> uploadTravelGroupAttachments(
    String travelGroupId, {
    required TravelGroupAttachmentCategory category,
    required List<ApiMultipartFile> files,
  }) async {
    final payload = await _apiClient.postMultipartFiles(
      '/api/travel-groups/${Uri.encodeComponent(travelGroupId)}/attachments/'
      '${category.apiValue}',
      files: files,
      maxFileSizeBytes: 20 * 1024 * 1024,
      token: _token,
    );
    return TravelGroupAttachmentUploadResult.fromJson(_data(payload));
  }

  Future<DownloadedFile> downloadTravelGroupAttachment(
    String travelGroupId,
    TravelGroupAttachmentRecord attachment,
  ) {
    return _apiClient.getBytes(
      '/api/travel-groups/${Uri.encodeComponent(travelGroupId)}/attachments/'
      '${Uri.encodeComponent(attachment.id)}/download',
      token: _token,
      defaultFileName: attachment.originalName,
    );
  }

  Future<TravelGroupAttachmentDeleteResult> deleteTravelGroupAttachment(
    String travelGroupId,
    String attachmentId,
  ) async {
    final payload = await _apiClient.deleteJson(
      '/api/travel-groups/${Uri.encodeComponent(travelGroupId)}/attachments/'
      '${Uri.encodeComponent(attachmentId)}',
      token: _token,
    );
    return TravelGroupAttachmentDeleteResult.fromJson(_data(payload));
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

  Future<SalesSheetRecord> revokeSalesOrderQrCode(String id) async {
    final payload = await _apiClient.deleteJson(
      '/api/sales-orders/$id/qr-code',
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

  Future<AfterSalesOrderRecord> confirmAfterSalesWarehouse(
    String id, {
    String? note,
  }) async {
    final body = <String, dynamic>{};
    if (note != null && note.trim().isNotEmpty) {
      body['note'] = note.trim();
    }
    final payload = await _apiClient.patchJson(
      '/api/after-sales-orders/$id/warehouse-confirm',
      body: body,
      token: _token,
    );
    return AfterSalesOrderRecord.fromJson(
      _map(_data(payload)['afterSalesOrder']),
    );
  }

  Future<AfterSalesOrderRecord> confirmAfterSalesFinanceRefund(
    String id, {
    required List<ApiMultipartFile> files,
  }) async {
    final payload = await _apiClient.postMultipartFiles(
      '/api/after-sales-orders/$id/finance-refund-confirm',
      files: files,
      maxFileSizeBytes: 20 * 1024 * 1024,
      token: _token,
    );
    return AfterSalesOrderRecord.fromJson(
      _map(_data(payload)['afterSalesOrder']),
    );
  }

  Future<DownloadedFile> downloadAfterSalesRefundProof(
    String afterSalesOrderId,
    AfterSalesRefundProofAttachmentRecord attachment,
  ) {
    return _apiClient.getBytes(
      '/api/after-sales-orders/${Uri.encodeComponent(afterSalesOrderId)}'
      '/refund-proofs/${Uri.encodeComponent(attachment.id)}/download',
      token: _token,
      defaultFileName: attachment.originalName,
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

  Future<List<ReconciliationRecord>> listReconciliations({
    required DateTime dateFrom,
    required DateTime dateTo,
  }) async {
    final payload = await _apiClient.getJson(
      _path('/api/reconciliations', {
        'dateFrom': formatDate(dateFrom),
        'dateTo': formatDate(dateTo),
      }),
      token: _token,
    );
    return _list(_data(payload)['reconciliations'])
        .map(ReconciliationRecord.fromJson)
        .toList();
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

  Future<ReconciliationRecord> reviewReconciliation(
    DateTime businessDate,
  ) async {
    final payload = await _apiClient.postJson(
      '/api/reconciliations/${formatDate(businessDate)}/review',
      body: const <String, dynamic>{},
      token: _token,
    );
    return ReconciliationRecord.fromJson(
        _map(_data(payload)['reconciliation']));
  }

  Future<List<CommissionRuleRecord>> listCommissionRules({
    int limit = 100,
    String? targetType,
    String? keyword,
    String? query,
    bool? isActive,
  }) async {
    final payload = await _apiClient.getJson(
      _path(
        '/api/commission-rules',
        _stage7RuleQueryParameters(
          limit: limit,
          targetType: targetType,
          keyword: keyword,
          query: query,
          isActive: isActive,
        ),
      ),
      token: _token,
    );
    return _list(_data(payload)['commissionRules'])
        .map((item) => CommissionRuleRecord.fromJson(item))
        .toList();
  }

  Future<CommissionRuleRecord> createCommissionRule(
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.postJson(
      '/api/commission-rules',
      body: body,
      token: _token,
    );
    return CommissionRuleRecord.fromJson(
      _map(_data(payload)['commissionRule']),
    );
  }

  Future<CommissionRuleRecord> updateCommissionRule(
    String id,
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/commission-rules/$id',
      body: body,
      token: _token,
    );
    return CommissionRuleRecord.fromJson(
      _map(_data(payload)['commissionRule']),
    );
  }

  Future<List<SalesDeductionRuleRecord>> listSalesDeductionRules({
    int limit = 100,
    String? productId,
    String? productName,
    String? keyword,
    String? query,
    bool? isActive,
  }) async {
    final payload = await _apiClient.getJson(
      _path(
        '/api/sales-deduction-rules',
        _stage7RuleQueryParameters(
          limit: limit,
          productId: productId,
          productName: productName,
          keyword: keyword,
          query: query,
          isActive: isActive,
        ),
      ),
      token: _token,
    );
    return _list(_data(payload)['salesDeductionRules'])
        .map((item) => SalesDeductionRuleRecord.fromJson(item))
        .toList();
  }

  Future<SalesDeductionRuleRecord> createSalesDeductionRule(
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.postJson(
      '/api/sales-deduction-rules',
      body: body,
      token: _token,
    );
    return SalesDeductionRuleRecord.fromJson(
      _map(_data(payload)['salesDeductionRule']),
    );
  }

  Future<SalesDeductionRuleRecord> updateSalesDeductionRule(
    String id,
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/sales-deduction-rules/$id',
      body: body,
      token: _token,
    );
    return SalesDeductionRuleRecord.fromJson(
      _map(_data(payload)['salesDeductionRule']),
    );
  }

  Future<Stage7RuleImportResult> importSalesDeductionRules(
    List<Map<String, dynamic>> rules,
  ) async {
    final payload = await _apiClient.postJson(
      '/api/sales-deduction-rules/batch-import',
      body: {'rules': rules},
      token: _token,
    );
    return Stage7RuleImportResult.fromJson(
        _map(_data(payload)['importResult']));
  }

  Future<List<AgencyDeductionRuleRecord>> listAgencyDeductionRules({
    int limit = 100,
    String? productId,
    String? agencyId,
    String? agencyName,
    String? calculationMode,
    String? productName,
    String? keyword,
    String? query,
    bool? isActive,
  }) async {
    final payload = await _apiClient.getJson(
      _path(
        '/api/agency-deduction-rules',
        _stage7RuleQueryParameters(
          limit: limit,
          productId: productId,
          agencyId: agencyId,
          agencyName: agencyName,
          calculationMode: calculationMode,
          productName: productName,
          keyword: keyword,
          query: query,
          isActive: isActive,
        ),
      ),
      token: _token,
    );
    return _list(_data(payload)['agencyDeductionRules'])
        .map((item) => AgencyDeductionRuleRecord.fromJson(item))
        .toList();
  }

  Future<AgencyDeductionRuleRecord> createAgencyDeductionRule(
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.postJson(
      '/api/agency-deduction-rules',
      body: body,
      token: _token,
    );
    return AgencyDeductionRuleRecord.fromJson(
      _map(_data(payload)['agencyDeductionRule']),
    );
  }

  Future<AgencyDeductionRuleRecord> updateAgencyDeductionRule(
    String id,
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/agency-deduction-rules/$id',
      body: body,
      token: _token,
    );
    return AgencyDeductionRuleRecord.fromJson(
      _map(_data(payload)['agencyDeductionRule']),
    );
  }

  Future<Stage7RuleImportResult> importAgencyDeductionRules(
    List<Map<String, dynamic>> rules,
  ) async {
    final payload = await _apiClient.postJson(
      '/api/agency-deduction-rules/batch-import',
      body: {'rules': rules},
      token: _token,
    );
    return Stage7RuleImportResult.fromJson(
        _map(_data(payload)['importResult']));
  }

  Future<List<AgencyRebateRuleRecord>> listAgencyRebateRules({
    int limit = 100,
    String? agencyId,
    String? agencyName,
    String? keyword,
    String? query,
    bool? isActive,
  }) async {
    final payload = await _apiClient.getJson(
      _path(
        '/api/agency-rebate-rules',
        _stage7RuleQueryParameters(
          limit: limit,
          agencyId: agencyId,
          agencyName: agencyName,
          keyword: keyword,
          query: query,
          isActive: isActive,
        ),
      ),
      token: _token,
    );
    return _list(_data(payload)['agencyRebateRules'])
        .map((item) => AgencyRebateRuleRecord.fromJson(item))
        .toList();
  }

  Future<AgencyRebateRuleRecord> createAgencyRebateRule(
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.postJson(
      '/api/agency-rebate-rules',
      body: body,
      token: _token,
    );
    return AgencyRebateRuleRecord.fromJson(
      _map(_data(payload)['agencyRebateRule']),
    );
  }

  Future<AgencyRebateRuleRecord> updateAgencyRebateRule(
    String id,
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/agency-rebate-rules/$id',
      body: body,
      token: _token,
    );
    return AgencyRebateRuleRecord.fromJson(
      _map(_data(payload)['agencyRebateRule']),
    );
  }

  Future<Stage7RuleImportResult> importAgencyRebateRules(
    List<Map<String, dynamic>> rules,
  ) async {
    final payload = await _apiClient.postJson(
      '/api/agency-rebate-rules/batch-import',
      body: {'rules': rules},
      token: _token,
    );
    return Stage7RuleImportResult.fromJson(
        _map(_data(payload)['importResult']));
  }

  Future<CommissionRecalculationResult> recalculateCommissions(
    String salesOrderId,
  ) async {
    final payload = await _apiClient.postJson(
      '/api/commission-records/recalculate',
      body: {'salesOrderId': salesOrderId},
      token: _token,
    );
    return CommissionRecalculationResult.fromJson(_data(payload));
  }

  Future<List<CommissionRecord>> listCommissionRecords({
    int limit = 50,
    DateTime? start,
    DateTime? end,
    String? targetType,
    String? targetUserId,
    String? agencyId,
    String? travelGroupId,
    String? salesOrderId,
    bool? isConfirmed,
    bool? manualInput,
    String? query,
  }) async {
    final payload = await _apiClient.getJson(
      _path(
        '/api/commission-records',
        _commissionRecordQueryParameters(
          limit: limit,
          start: start,
          end: end,
          targetType: targetType,
          targetUserId: targetUserId,
          agencyId: agencyId,
          travelGroupId: travelGroupId,
          salesOrderId: salesOrderId,
          isConfirmed: isConfirmed,
          manualInput: manualInput,
          query: query,
        ),
      ),
      token: _token,
    );
    return _list(_data(payload)['commissionRecords'])
        .map((item) => CommissionRecord.fromJson(item))
        .toList();
  }

  Future<CommissionRecord> getCommissionRecord(String id) async {
    final payload = await _apiClient.getJson(
      '/api/commission-records/$id',
      token: _token,
    );
    return CommissionRecord.fromJson(_map(_data(payload)['commissionRecord']));
  }

  Future<List<CommissionRecord>> listMyCommissionRecords({
    int limit = 50,
    DateTime? start,
    DateTime? end,
    bool? isConfirmed,
    bool? manualInput,
    String? query,
  }) async {
    final payload = await _apiClient.getJson(
      _path(
        '/api/commission-records/me',
        _commissionRecordQueryParameters(
          limit: limit,
          start: start,
          end: end,
          isConfirmed: isConfirmed,
          manualInput: manualInput,
          query: query,
        ),
      ),
      token: _token,
    );
    return _list(_data(payload)['commissionRecords'])
        .map((item) => CommissionRecord.fromJson(item))
        .toList();
  }

  Future<CommissionRecord> updateTasterCommissionManualAmount(
    String id,
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/commission-records/$id/manual-amount',
      body: body,
      token: _token,
    );
    return CommissionRecord.fromJson(_map(_data(payload)['commissionRecord']));
  }

  Future<CommissionRecord> confirmTasterCommission(
    String id,
    bool isConfirmed,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/commission-records/$id/confirm',
      body: {'isConfirmed': isConfirmed},
      token: _token,
    );
    return CommissionRecord.fromJson(_map(_data(payload)['commissionRecord']));
  }

  Future<DownloadedFile> downloadCommissionRecordsExcel({
    int? limit,
    DateTime? start,
    DateTime? end,
    String? targetType,
    String? targetUserId,
    String? agencyId,
    String? travelGroupId,
    String? salesOrderId,
    bool? isConfirmed,
    bool? manualInput,
    String? query,
  }) {
    return _apiClient.getBytes(
      _path(
        '/api/commission-records/export',
        _commissionRecordQueryParameters(
          limit: limit,
          start: start,
          end: end,
          targetType: targetType,
          targetUserId: targetUserId,
          agencyId: agencyId,
          travelGroupId: travelGroupId,
          salesOrderId: salesOrderId,
          isConfirmed: isConfirmed,
          manualInput: manualInput,
          query: query,
        ),
      ),
      token: _token,
      defaultFileName: 'commission-records.xlsx',
    );
  }

  Future<List<TravelGroupFinanceSummaryRecord>>
      listTravelGroupFinanceSummaries({
    int limit = 50,
    DateTime? start,
    DateTime? end,
    String? travelGroupId,
    String? agencyName,
    String? guideName,
    bool? agencyDeductionConfirmed,
    String? query,
  }) async {
    final payload = await _apiClient.getJson(
      _path(
        '/api/travel-group-finance-summaries',
        _travelGroupFinanceSummaryQueryParameters(
          limit: limit,
          start: start,
          end: end,
          travelGroupId: travelGroupId,
          agencyName: agencyName,
          guideName: guideName,
          agencyDeductionConfirmed: agencyDeductionConfirmed,
          query: query,
        ),
      ),
      token: _token,
    );
    return _list(_data(payload)['travelGroupFinanceSummaries'])
        .map((item) => TravelGroupFinanceSummaryRecord.fromJson(item))
        .toList();
  }

  Future<TravelGroupFinanceSummaryRecord> getTravelGroupFinanceSummary(
    String travelGroupId,
  ) async {
    final payload = await _apiClient.getJson(
      '/api/travel-group-finance-summaries/$travelGroupId',
      token: _token,
    );
    return TravelGroupFinanceSummaryRecord.fromJson(
      _map(_data(payload)['travelGroupFinanceSummary']),
    );
  }

  Future<TravelGroupFinanceSummaryRecord> updateTravelGroupFinanceSummary(
    String travelGroupId,
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/travel-group-finance-summaries/$travelGroupId',
      body: body,
      token: _token,
    );
    return TravelGroupFinanceSummaryRecord.fromJson(
      _map(_data(payload)['travelGroupFinanceSummary']),
    );
  }

  Future<TravelGroupFinanceSummaryRecord> confirmAgencyDeduction(
    String travelGroupId,
    bool agencyDeductionConfirmed,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/travel-group-finance-summaries/$travelGroupId/'
      'agency-deduction-confirm',
      body: {'isConfirmed': agencyDeductionConfirmed},
      token: _token,
    );
    return TravelGroupFinanceSummaryRecord.fromJson(
      _map(_data(payload)['travelGroupFinanceSummary']),
    );
  }

  Future<TravelGroupFinanceSummaryRecord> setDailyRebatePaid(
    String travelGroupId,
    bool isPaid,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/travel-group-finance-summaries/$travelGroupId/'
      'daily-rebate-paid',
      body: {'isPaid': isPaid},
      token: _token,
    );
    return TravelGroupFinanceSummaryRecord.fromJson(
      _map(_data(payload)['travelGroupFinanceSummary']),
    );
  }

  Future<TravelGroupFinanceSummaryRecord> setMonthlyRebatePaid(
    String travelGroupId,
    bool isPaid,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/travel-group-finance-summaries/$travelGroupId/'
      'monthly-rebate-paid',
      body: {'isPaid': isPaid},
      token: _token,
    );
    return TravelGroupFinanceSummaryRecord.fromJson(
      _map(_data(payload)['travelGroupFinanceSummary']),
    );
  }

  Future<TravelGroupFinanceSummaryRefreshResult>
      refreshTravelGroupFinanceSummary(String travelGroupId) async {
    final payload = await _apiClient.postJson(
      '/api/travel-group-finance-summaries/$travelGroupId/refresh',
      token: _token,
    );
    return TravelGroupFinanceSummaryRefreshResult.fromJson(_data(payload));
  }

  Future<DownloadedFile> downloadTravelGroupFinanceSummariesExcel({
    int? limit,
    DateTime? start,
    DateTime? end,
    String? travelGroupId,
    String? agencyName,
    String? guideName,
    bool? agencyDeductionConfirmed,
    String? query,
  }) {
    return _apiClient.getBytes(
      _path(
        '/api/travel-group-finance-summaries/export',
        _travelGroupFinanceSummaryQueryParameters(
          limit: limit,
          start: start,
          end: end,
          travelGroupId: travelGroupId,
          agencyName: agencyName,
          guideName: guideName,
          agencyDeductionConfirmed: agencyDeductionConfirmed,
          query: query,
        ),
      ),
      token: _token,
      defaultFileName: 'travel-group-finance-summaries.xlsx',
    );
  }

  Future<AnalyticsOverview> getAnalyticsOverview({
    String? preset,
    DateTime? dateFrom,
    DateTime? dateTo,
    String? groupType,
    String? tasterId,
    String? travelAgency,
  }) async {
    final payload = await _apiClient.getJson(
      _path(
        '/api/analytics/overview',
        _analyticsQueryParameters(
          preset: preset,
          dateFrom: dateFrom,
          dateTo: dateTo,
          groupType: groupType,
          tasterId: tasterId,
          travelAgency: travelAgency,
        ),
      ),
      token: _token,
    );
    return AnalyticsOverview.fromJson(_data(payload));
  }

  Future<List<TasterRankingRecord>> listTasterRankings({
    String? preset,
    DateTime? dateFrom,
    DateTime? dateTo,
    String? sortBy,
    String? sortDirection,
    int? limit,
    String? groupType,
    String? travelAgency,
  }) async {
    final payload = await _apiClient.getJson(
      _path(
        '/api/analytics/taster-rankings',
        _analyticsQueryParameters(
          preset: preset,
          dateFrom: dateFrom,
          dateTo: dateTo,
          sortBy: sortBy,
          sortDirection: sortDirection,
          limit: limit,
          groupType: groupType,
          travelAgency: travelAgency,
        ),
      ),
      token: _token,
    );
    return _list(_data(payload)['rankings'])
        .map((item) => TasterRankingRecord.fromJson(item))
        .toList();
  }

  Future<TasterRankingDetail> getTasterRankingDetail(
    String tasterId, {
    String? preset,
    DateTime? dateFrom,
    DateTime? dateTo,
    String? sortBy,
    String? sortDirection,
    int? limit,
    String? groupType,
    String? travelAgency,
  }) async {
    final payload = await _apiClient.getJson(
      _path(
        '/api/analytics/taster-rankings/${Uri.encodeComponent(tasterId)}',
        _analyticsQueryParameters(
          preset: preset,
          dateFrom: dateFrom,
          dateTo: dateTo,
          sortBy: sortBy,
          sortDirection: sortDirection,
          limit: limit,
          groupType: groupType,
          travelAgency: travelAgency,
        ),
      ),
      token: _token,
    );
    return TasterRankingDetail.fromJson(_data(payload));
  }

  Future<List<AnalyticsTrendPoint>> getAnalyticsTrends({
    String? preset,
    DateTime? dateFrom,
    DateTime? dateTo,
    String? granularity,
    String? metric,
    String? groupType,
    String? tasterId,
    String? travelAgency,
  }) async {
    final payload = await _apiClient.getJson(
      _path(
        '/api/analytics/trends',
        _analyticsQueryParameters(
          preset: preset,
          dateFrom: dateFrom,
          dateTo: dateTo,
          granularity: granularity,
          metric: metric,
          groupType: groupType,
          tasterId: tasterId,
          travelAgency: travelAgency,
        ),
      ),
      token: _token,
    );
    return _list(_data(payload)['trends'])
        .map((item) => AnalyticsTrendPoint.fromJson(item))
        .toList();
  }

  Future<List<AnalyticsSourceOrder>> listAnalyticsSourceOrders({
    String? preset,
    DateTime? dateFrom,
    DateTime? dateTo,
    String? source,
    String? groupType,
    String? tasterId,
    String? travelAgency,
  }) async {
    final payload = await _apiClient.getJson(
      _path(
        '/api/analytics/source/orders',
        _analyticsQueryParameters(
          preset: preset,
          dateFrom: dateFrom,
          dateTo: dateTo,
          source: source,
          groupType: groupType,
          tasterId: tasterId,
          travelAgency: travelAgency,
        ),
      ),
      token: _token,
    );
    return _list(_data(payload)['orders'])
        .map((item) => AnalyticsSourceOrder.fromJson(item))
        .toList();
  }

  Future<List<AnalyticsSourceTravelGroup>> listAnalyticsSourceTravelGroups({
    String? preset,
    DateTime? dateFrom,
    DateTime? dateTo,
    bool? noEffectiveOrder,
    String? groupType,
    String? tasterId,
    String? travelAgency,
  }) async {
    final payload = await _apiClient.getJson(
      _path(
        '/api/analytics/source/travel-groups',
        _analyticsQueryParameters(
          preset: preset,
          dateFrom: dateFrom,
          dateTo: dateTo,
          noEffectiveOrder: noEffectiveOrder,
          groupType: groupType,
          tasterId: tasterId,
          travelAgency: travelAgency,
        ),
      ),
      token: _token,
    );
    return _list(_data(payload)['travelGroups'])
        .map((item) => AnalyticsSourceTravelGroup.fromJson(item))
        .toList();
  }

  Future<List<AnalyticsSourceAfterSales>> listAnalyticsSourceAfterSales({
    String? preset,
    DateTime? dateFrom,
    DateTime? dateTo,
    String? source,
    String? groupType,
    String? tasterId,
    String? travelAgency,
  }) async {
    final payload = await _apiClient.getJson(
      _path(
        '/api/analytics/source/after-sales',
        _analyticsQueryParameters(
          preset: preset,
          dateFrom: dateFrom,
          dateTo: dateTo,
          source: source,
          groupType: groupType,
          tasterId: tasterId,
          travelAgency: travelAgency,
        ),
      ),
      token: _token,
    );
    return _list(_data(payload)['afterSalesOrders'])
        .map((item) => AnalyticsSourceAfterSales.fromJson(item))
        .toList();
  }

  Future<DownloadedFile> exportAnalyticsOverview({
    String? preset,
    DateTime? dateFrom,
    DateTime? dateTo,
    String? groupType,
    String? tasterId,
    String? travelAgency,
  }) {
    return _apiClient.getBytes(
      _path(
        '/api/analytics/overview/export',
        _analyticsQueryParameters(
          preset: preset,
          dateFrom: dateFrom,
          dateTo: dateTo,
          groupType: groupType,
          tasterId: tasterId,
          travelAgency: travelAgency,
        ),
      ),
      token: _token,
      defaultFileName: 'analytics-overview.xlsx',
    );
  }

  Future<DownloadedFile> exportTasterRankings({
    String? preset,
    DateTime? dateFrom,
    DateTime? dateTo,
    String? sortBy,
    String? sortDirection,
    int? limit,
    String? groupType,
    String? travelAgency,
  }) {
    return _apiClient.getBytes(
      _path(
        '/api/analytics/taster-rankings/export',
        _analyticsQueryParameters(
          preset: preset,
          dateFrom: dateFrom,
          dateTo: dateTo,
          sortBy: sortBy,
          sortDirection: sortDirection,
          limit: limit,
          groupType: groupType,
          travelAgency: travelAgency,
        ),
      ),
      token: _token,
      defaultFileName: 'analytics-taster-rankings.xlsx',
    );
  }

  Map<String, String> _stage7RuleQueryParameters({
    int? limit,
    String? targetType,
    String? agencyId,
    String? agencyName,
    String? calculationMode,
    String? productName,
    String? productId,
    String? keyword,
    String? query,
    bool? isActive,
  }) {
    final queryParameters = <String, String>{};
    if (limit != null) {
      queryParameters['limit'] = '$limit';
    }
    _putNonEmpty(queryParameters, 'targetType', targetType);
    _putNonEmpty(queryParameters, 'agencyId', agencyId);
    _putNonEmpty(queryParameters, 'agencyName', agencyName);
    _putNonEmpty(queryParameters, 'calculationMode', calculationMode);
    _putNonEmpty(queryParameters, 'productName', productName);
    _putNonEmpty(queryParameters, 'productId', productId);
    _putNonEmpty(queryParameters, 'keyword', keyword);
    _putNonEmpty(queryParameters, 'query', query);
    if (isActive != null) {
      queryParameters['isActive'] = '$isActive';
    }
    return queryParameters;
  }

  Map<String, String> _commissionRecordQueryParameters({
    int? limit,
    DateTime? start,
    DateTime? end,
    String? targetType,
    String? targetUserId,
    String? agencyId,
    String? travelGroupId,
    String? salesOrderId,
    bool? isConfirmed,
    bool? manualInput,
    String? query,
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
    _putNonEmpty(queryParameters, 'targetType', targetType);
    _putNonEmpty(queryParameters, 'targetUserId', targetUserId);
    _putNonEmpty(queryParameters, 'agencyId', agencyId);
    _putNonEmpty(queryParameters, 'travelGroupId', travelGroupId);
    _putNonEmpty(queryParameters, 'salesOrderId', salesOrderId);
    if (isConfirmed != null) {
      queryParameters['isConfirmed'] = '$isConfirmed';
    }
    if (manualInput != null) {
      queryParameters['manualInput'] = '$manualInput';
    }
    _putNonEmpty(queryParameters, 'query', query);
    return queryParameters;
  }

  Map<String, String> _travelGroupFinanceSummaryQueryParameters({
    int? limit,
    DateTime? start,
    DateTime? end,
    String? travelGroupId,
    String? agencyName,
    String? guideName,
    bool? agencyDeductionConfirmed,
    String? query,
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
    _putNonEmpty(queryParameters, 'travelGroupId', travelGroupId);
    _putNonEmpty(queryParameters, 'agencyName', agencyName);
    _putNonEmpty(queryParameters, 'guideName', guideName);
    if (agencyDeductionConfirmed != null) {
      queryParameters['agencyDeductionConfirmed'] = '$agencyDeductionConfirmed';
    }
    _putNonEmpty(queryParameters, 'query', query);
    return queryParameters;
  }

  Map<String, String> _analyticsQueryParameters({
    String? preset,
    DateTime? dateFrom,
    DateTime? dateTo,
    String? sortBy,
    String? sortDirection,
    int? limit,
    String? granularity,
    String? metric,
    String? source,
    bool? noEffectiveOrder,
    String? groupType,
    String? tasterId,
    String? travelAgency,
  }) {
    final queryParameters = <String, String>{};
    _putNonEmpty(queryParameters, 'preset', preset);
    if (dateFrom != null) {
      queryParameters['dateFrom'] = formatDate(dateFrom);
    }
    if (dateTo != null) {
      queryParameters['dateTo'] = formatDate(dateTo);
    }
    _putNonEmpty(queryParameters, 'sortBy', sortBy);
    _putNonEmpty(queryParameters, 'sortDirection', sortDirection);
    if (limit != null) {
      queryParameters['limit'] = '$limit';
    }
    _putNonEmpty(queryParameters, 'granularity', granularity);
    _putNonEmpty(queryParameters, 'metric', metric);
    _putNonEmpty(queryParameters, 'source', source);
    if (noEffectiveOrder != null) {
      queryParameters['noEffectiveOrder'] = '$noEffectiveOrder';
    }
    _putNonEmpty(queryParameters, 'groupType', groupType);
    _putNonEmpty(queryParameters, 'tasterId', tasterId);
    _putNonEmpty(queryParameters, 'travelAgency', travelAgency);
    return queryParameters;
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

enum TravelGroupAttachmentCategory {
  keyCustomerPhoto('key_customer_photo'),
  guestInfo('guest_info');

  const TravelGroupAttachmentCategory(this.apiValue);

  final String apiValue;
}

class TravelGroupAttachmentRecord {
  const TravelGroupAttachmentRecord({
    required this.id,
    required this.category,
    required this.originalName,
    required this.contentType,
    required this.size,
    required this.uploadedById,
    required this.uploadedAt,
  });

  final String id;
  final String category;
  final String originalName;
  final String? contentType;
  final int size;
  final String? uploadedById;
  final String? uploadedAt;

  factory TravelGroupAttachmentRecord.fromJson(Map<String, dynamic> json) {
    return TravelGroupAttachmentRecord(
      id: '${json['id'] ?? ''}',
      category: '${json['category'] ?? ''}',
      originalName: '${json['originalName'] ?? ''}',
      contentType: _stringOrNull(json['contentType']),
      size: _intValue(json['size']),
      uploadedById: _stringOrNull(json['uploadedById']),
      uploadedAt: _stringOrNull(json['uploadedAt']),
    );
  }
}

class TravelGroupLiaisonTasterRecord {
  const TravelGroupLiaisonTasterRecord({
    required this.id,
    required this.name,
    required this.username,
  });

  final String? id;
  final String? name;
  final String? username;

  factory TravelGroupLiaisonTasterRecord.fromJson(
    Map<String, dynamic> json,
  ) {
    return TravelGroupLiaisonTasterRecord(
      id: _stringOrNull(json['id']),
      name: _stringOrNull(json['name']),
      username: _stringOrNull(json['username']),
    );
  }
}

class TravelGroupAttachmentUploadResult {
  const TravelGroupAttachmentUploadResult({
    required this.attachments,
    required this.travelGroup,
  });

  final List<TravelGroupAttachmentRecord> attachments;
  final TravelGroupRecord travelGroup;

  factory TravelGroupAttachmentUploadResult.fromJson(
    Map<String, dynamic> json,
  ) {
    return TravelGroupAttachmentUploadResult(
      attachments: _list(json['attachments'])
          .map(TravelGroupAttachmentRecord.fromJson)
          .toList(),
      travelGroup: TravelGroupRecord.fromJson(_map(json['travelGroup'])),
    );
  }
}

class TravelGroupAttachmentDeleteResult {
  const TravelGroupAttachmentDeleteResult({
    required this.attachment,
    required this.travelGroup,
  });

  final TravelGroupAttachmentRecord attachment;
  final TravelGroupRecord travelGroup;

  factory TravelGroupAttachmentDeleteResult.fromJson(
    Map<String, dynamic> json,
  ) {
    return TravelGroupAttachmentDeleteResult(
      attachment:
          TravelGroupAttachmentRecord.fromJson(_map(json['attachment'])),
      travelGroup: TravelGroupRecord.fromJson(_map(json['travelGroup'])),
    );
  }
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
    required this.sourceRegion,
    required this.ageInfo,
    required this.mentionedFeitian,
    required this.previousStopOrderStatus,
    required this.keyCustomerInfo,
    required this.keyCustomerPhotos,
    required this.guestInfoAttachments,
    required this.liaisonTasterId,
    required this.liaisonTasterName,
    required this.liaisonTaster,
    required this.expectedArrivalTime,
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
  final String? sourceRegion;
  final String? ageInfo;
  final bool? mentionedFeitian;
  final String? previousStopOrderStatus;
  final String? keyCustomerInfo;
  final List<TravelGroupAttachmentRecord> keyCustomerPhotos;
  final List<TravelGroupAttachmentRecord> guestInfoAttachments;
  final String? liaisonTasterId;
  final String? liaisonTasterName;
  final TravelGroupLiaisonTasterRecord? liaisonTaster;
  final String? expectedArrivalTime;
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
    final liaisonTasterId = _stringOrNull(json['liaisonTasterId']);
    final liaisonTasterName = _stringOrNull(json['liaisonTasterName']);
    final liaisonTasterJson = _map(json['liaisonTaster']);
    final liaisonTaster = liaisonTasterJson.isNotEmpty
        ? TravelGroupLiaisonTasterRecord.fromJson(liaisonTasterJson)
        : liaisonTasterId != null || liaisonTasterName != null
            ? TravelGroupLiaisonTasterRecord(
                id: liaisonTasterId,
                name: liaisonTasterName,
                username: null,
              )
            : null;
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
      sourceRegion: _stringOrNull(json['sourceRegion']),
      ageInfo: _stringOrNull(json['ageInfo']),
      mentionedFeitian: _boolOrNull(json['mentionedFeitian']),
      previousStopOrderStatus: _stringOrNull(json['previousStopOrderStatus']),
      keyCustomerInfo: _stringOrNull(json['keyCustomerInfo']),
      keyCustomerPhotos: _list(json['keyCustomerPhotos'])
          .map(TravelGroupAttachmentRecord.fromJson)
          .toList(),
      guestInfoAttachments: _list(json['guestInfoAttachments'])
          .map(TravelGroupAttachmentRecord.fromJson)
          .toList(),
      liaisonTasterId: liaisonTasterId,
      liaisonTasterName: liaisonTasterName,
      liaisonTaster: liaisonTaster,
      expectedArrivalTime: _stringOrNull(json['expectedArrivalTime']),
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
    required this.productId,
    required this.productName,
    required this.quantity,
    required this.unit,
    required this.note,
    required this.sortOrder,
  });

  final String id;
  final String? travelGroupId;
  final String? productId;
  final String productName;
  final int quantity;
  final String unit;
  final String? note;
  final int sortOrder;

  factory TravelGroupTastingItemRecord.fromJson(Map<String, dynamic> json) {
    return TravelGroupTastingItemRecord(
      id: '${json['id'] ?? ''}',
      travelGroupId: _stringOrNull(json['travelGroupId']),
      productId: _stringOrNull(json['productId']),
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
    required this.entryAmountCents,
    required this.tasterCommissionCents,
    required this.tasterId,
    required this.tasterName,
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
    required this.remark,
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
  final int entryAmountCents;
  final int tasterCommissionCents;
  final String? tasterId;
  final String? tasterName;
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
  final String? remark;
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
      entryAmountCents: _intValue(
        json['entryAmountCents'] ??
            json['orderEntryAmountCents'] ??
            json['totalAmountCents'],
      ),
      tasterCommissionCents: _intValue(json['tasterCommissionCents']),
      tasterId: _stringOrNull(json['tasterId'] ?? travelGroup?.tasterId),
      tasterName: _stringOrNull(json['tasterName'] ?? travelGroup?.tasterName),
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
      remark: _stringOrNull(json['remark']),
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
    required this.productId,
    required this.productName,
    required this.unit,
    required this.quantity,
    required this.unitPriceCents,
    required this.subtotalCents,
    required this.deliveryType,
    required this.notes,
    required this.sortOrder,
  });

  final String? id;
  final String? salesOrderId;
  final String? productId;
  final String productName;
  final String? unit;
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
      productId: _stringOrNull(json['productId']),
      productName: '${json['productName'] ?? ''}',
      unit: _stringOrNull(json['unit']),
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
    required this.warehouseConfirmedById,
    required this.warehouseConfirmedAt,
    required this.warehouseConfirmNote,
    required this.refundProofAttachments,
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
  final String? warehouseConfirmedById;
  final String? warehouseConfirmedAt;
  final String? warehouseConfirmNote;
  final List<AfterSalesRefundProofAttachmentRecord> refundProofAttachments;
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
      warehouseConfirmedById: _stringOrNull(json['warehouseConfirmedById']),
      warehouseConfirmedAt: _stringOrNull(json['warehouseConfirmedAt']),
      warehouseConfirmNote: _stringOrNull(json['warehouseConfirmNote']),
      refundProofAttachments: _list(json['refundProofAttachments'])
          .map((item) =>
              AfterSalesRefundProofAttachmentRecord.fromJson(_map(item)))
          .toList(),
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

class AfterSalesRefundProofAttachmentRecord {
  const AfterSalesRefundProofAttachmentRecord({
    required this.id,
    required this.category,
    required this.originalName,
    required this.contentType,
    required this.size,
    required this.uploadedById,
    required this.uploadedAt,
  });

  final String id;
  final String category;
  final String originalName;
  final String? contentType;
  final int size;
  final String? uploadedById;
  final String? uploadedAt;

  factory AfterSalesRefundProofAttachmentRecord.fromJson(
    Map<String, dynamic> json,
  ) {
    return AfterSalesRefundProofAttachmentRecord(
      id: '${json['id'] ?? ''}',
      category: '${json['category'] ?? ''}',
      originalName: '${json['originalName'] ?? ''}',
      contentType: _stringOrNull(json['contentType']),
      size: _intValue(json['size']),
      uploadedById: _stringOrNull(json['uploadedById']),
      uploadedAt: _stringOrNull(json['uploadedAt']),
    );
  }
}

class CommissionRuleRecord {
  const CommissionRuleRecord({
    required this.id,
    required this.ruleName,
    required this.targetType,
    required this.rate,
    required this.effectiveFrom,
    required this.effectiveTo,
    required this.isActive,
    required this.notes,
    required this.createdById,
    required this.updatedById,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String ruleName;
  final String targetType;
  final String rate;
  final String effectiveFrom;
  final String? effectiveTo;
  final bool isActive;
  final String? notes;
  final String? createdById;
  final String? updatedById;
  final String? createdAt;
  final String? updatedAt;

  factory CommissionRuleRecord.fromJson(Map<String, dynamic> json) {
    return CommissionRuleRecord(
      id: '${json['id'] ?? ''}',
      ruleName: '${json['ruleName'] ?? ''}',
      targetType: '${json['targetType'] ?? ''}',
      rate: '${json['rate'] ?? ''}',
      effectiveFrom: '${json['effectiveFrom'] ?? ''}',
      effectiveTo: _stringOrNull(json['effectiveTo']),
      isActive: _boolValue(json['isActive']),
      notes: _stringOrNull(json['notes']),
      createdById: _stringOrNull(json['createdById']),
      updatedById: _stringOrNull(json['updatedById']),
      createdAt: _stringOrNull(json['createdAt']),
      updatedAt: _stringOrNull(json['updatedAt']),
    );
  }
}

class ProductPage {
  const ProductPage({
    required this.products,
    required this.page,
    required this.pageSize,
    required this.total,
    required this.totalPages,
  });

  final List<ProductRecord> products;
  final int page;
  final int pageSize;
  final int total;
  final int totalPages;

  factory ProductPage.fromJson(Map<String, dynamic> json) {
    final pagination = _map(json['pagination']);
    return ProductPage(
      products: _list(json['products']).map(ProductRecord.fromJson).toList(),
      page: _intValue(pagination['page']),
      pageSize: _intValue(pagination['pageSize']),
      total: _intValue(pagination['total']),
      totalPages: _intValue(pagination['totalPages']),
    );
  }
}

class ProductRecord {
  const ProductRecord({
    required this.id,
    required this.name,
    required this.unit,
    required this.isActive,
    required this.notes,
    required this.createdById,
    required this.updatedById,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String name;
  final String unit;
  final bool isActive;
  final String? notes;
  final String? createdById;
  final String? updatedById;
  final String? createdAt;
  final String? updatedAt;

  factory ProductRecord.fromJson(Map<String, dynamic> json) {
    return ProductRecord(
      id: '${json['id'] ?? ''}',
      name: '${json['name'] ?? ''}',
      unit: '${json['unit'] ?? ''}',
      isActive: _boolValue(json['isActive']),
      notes: _stringOrNull(json['notes']),
      createdById: _stringOrNull(json['createdById']),
      updatedById: _stringOrNull(json['updatedById']),
      createdAt: _stringOrNull(json['createdAt']),
      updatedAt: _stringOrNull(json['updatedAt']),
    );
  }
}

class ProductOptionRecord {
  const ProductOptionRecord({
    required this.id,
    required this.name,
    required this.unit,
  });

  final String id;
  final String name;
  final String unit;

  String get label => '$name · $unit';

  factory ProductOptionRecord.fromJson(Map<String, dynamic> json) {
    return ProductOptionRecord(
      id: '${json['id'] ?? ''}',
      name: '${json['name'] ?? ''}',
      unit: '${json['unit'] ?? ''}',
    );
  }
}

class ProductActualCostRecord {
  const ProductActualCostRecord({
    required this.id,
    required this.productId,
    required this.costCents,
    required this.effectiveFrom,
    required this.effectiveTo,
    required this.isActive,
    required this.notes,
    required this.createdById,
    required this.updatedById,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String productId;
  final int costCents;
  final String effectiveFrom;
  final String? effectiveTo;
  final bool isActive;
  final String? notes;
  final String? createdById;
  final String? updatedById;
  final String? createdAt;
  final String? updatedAt;

  factory ProductActualCostRecord.fromJson(Map<String, dynamic> json) {
    return ProductActualCostRecord(
      id: '${json['id'] ?? ''}',
      productId: '${json['productId'] ?? ''}',
      costCents: _intValue(json['costCents']),
      effectiveFrom: '${json['effectiveFrom'] ?? ''}',
      effectiveTo: _stringOrNull(json['effectiveTo']),
      isActive: _boolValue(json['isActive']),
      notes: _stringOrNull(json['notes']),
      createdById: _stringOrNull(json['createdById']),
      updatedById: _stringOrNull(json['updatedById']),
      createdAt: _stringOrNull(json['createdAt']),
      updatedAt: _stringOrNull(json['updatedAt']),
    );
  }
}

class SalesDeductionRuleRecord {
  const SalesDeductionRuleRecord({
    required this.id,
    required this.productId,
    required this.productName,
    required this.deductionCostCents,
    required this.effectiveFrom,
    required this.effectiveTo,
    required this.isActive,
    required this.notes,
    required this.createdById,
    required this.updatedById,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String? productId;
  final String productName;
  final int deductionCostCents;
  final String effectiveFrom;
  final String? effectiveTo;
  final bool isActive;
  final String? notes;
  final String? createdById;
  final String? updatedById;
  final String? createdAt;
  final String? updatedAt;

  factory SalesDeductionRuleRecord.fromJson(Map<String, dynamic> json) {
    return SalesDeductionRuleRecord(
      id: '${json['id'] ?? ''}',
      productId: _stringOrNull(json['productId']),
      productName: '${json['productName'] ?? ''}',
      deductionCostCents: _intValue(json['deductionCostCents']),
      effectiveFrom: '${json['effectiveFrom'] ?? ''}',
      effectiveTo: _stringOrNull(json['effectiveTo']),
      isActive: _boolValue(json['isActive']),
      notes: _stringOrNull(json['notes']),
      createdById: _stringOrNull(json['createdById']),
      updatedById: _stringOrNull(json['updatedById']),
      createdAt: _stringOrNull(json['createdAt']),
      updatedAt: _stringOrNull(json['updatedAt']),
    );
  }
}

class AgencyDeductionRuleRecord {
  const AgencyDeductionRuleRecord({
    required this.id,
    required this.agencyId,
    required this.agencyName,
    required this.calculationMode,
    required this.deductionRate,
    required this.productId,
    required this.productName,
    required this.deductionCostCents,
    required this.effectiveFrom,
    required this.effectiveTo,
    required this.isActive,
    required this.notes,
    required this.createdById,
    required this.updatedById,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String? agencyId;
  final String? agencyName;
  final String calculationMode;
  final String deductionRate;
  final String? productId;
  final String productName;
  final int deductionCostCents;
  final String effectiveFrom;
  final String? effectiveTo;
  final bool isActive;
  final String? notes;
  final String? createdById;
  final String? updatedById;
  final String? createdAt;
  final String? updatedAt;

  factory AgencyDeductionRuleRecord.fromJson(Map<String, dynamic> json) {
    return AgencyDeductionRuleRecord(
      id: '${json['id'] ?? ''}',
      agencyId: _stringOrNull(json['agencyId']),
      agencyName: _stringOrNull(json['agencyName']),
      calculationMode:
          _stringOrNull(json['calculationMode']) ?? 'manual_product_reference',
      deductionRate: '${json['deductionRate'] ?? '0.3000'}',
      productId: _stringOrNull(json['productId']),
      productName: '${json['productName'] ?? ''}',
      deductionCostCents: _intValue(json['deductionCostCents']),
      effectiveFrom: '${json['effectiveFrom'] ?? ''}',
      effectiveTo: _stringOrNull(json['effectiveTo']),
      isActive: _boolValue(json['isActive']),
      notes: _stringOrNull(json['notes']),
      createdById: _stringOrNull(json['createdById']),
      updatedById: _stringOrNull(json['updatedById']),
      createdAt: _stringOrNull(json['createdAt']),
      updatedAt: _stringOrNull(json['updatedAt']),
    );
  }
}

class AgencyRebateRuleRecord {
  const AgencyRebateRuleRecord({
    required this.id,
    required this.agencyId,
    required this.agencyName,
    required this.dailyRebateRate,
    required this.monthlyRebateRate,
    required this.totalRebateRate,
    required this.effectiveFrom,
    required this.effectiveTo,
    required this.isActive,
    required this.notes,
    required this.createdById,
    required this.updatedById,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String? agencyId;
  final String? agencyName;
  final String dailyRebateRate;
  final String monthlyRebateRate;
  final String? totalRebateRate;
  final String effectiveFrom;
  final String? effectiveTo;
  final bool isActive;
  final String? notes;
  final String? createdById;
  final String? updatedById;
  final String? createdAt;
  final String? updatedAt;

  factory AgencyRebateRuleRecord.fromJson(Map<String, dynamic> json) {
    return AgencyRebateRuleRecord(
      id: '${json['id'] ?? ''}',
      agencyId: _stringOrNull(json['agencyId']),
      agencyName: _stringOrNull(json['agencyName']),
      dailyRebateRate: '${json['dailyRebateRate'] ?? ''}',
      monthlyRebateRate: '${json['monthlyRebateRate'] ?? ''}',
      totalRebateRate: _stringOrNull(json['totalRebateRate']),
      effectiveFrom: '${json['effectiveFrom'] ?? ''}',
      effectiveTo: _stringOrNull(json['effectiveTo']),
      isActive: _boolValue(json['isActive']),
      notes: _stringOrNull(json['notes']),
      createdById: _stringOrNull(json['createdById']),
      updatedById: _stringOrNull(json['updatedById']),
      createdAt: _stringOrNull(json['createdAt']),
      updatedAt: _stringOrNull(json['updatedAt']),
    );
  }
}

class Stage7RuleImportResult {
  const Stage7RuleImportResult({
    required this.totalCount,
    required this.successCount,
    required this.failureCount,
    required this.createdIdsSample,
    required this.failureSamples,
    required this.results,
  });

  final int totalCount;
  final int successCount;
  final int failureCount;
  final List<String> createdIdsSample;
  final List<Stage7RuleImportFailureSample> failureSamples;
  final List<Stage7RuleImportRowResult> results;

  factory Stage7RuleImportResult.fromJson(Map<String, dynamic> json) {
    return Stage7RuleImportResult(
      totalCount: _intValue(json['totalCount']),
      successCount: _intValue(json['successCount']),
      failureCount: _intValue(json['failureCount']),
      createdIdsSample: _stringList(json['createdIdsSample']),
      failureSamples: _list(json['failureSamples'])
          .map((item) => Stage7RuleImportFailureSample.fromJson(item))
          .toList(),
      results: _list(json['results'])
          .map((item) => Stage7RuleImportRowResult.fromJson(item))
          .toList(),
    );
  }
}

class Stage7RuleImportFailureSample {
  const Stage7RuleImportFailureSample({
    required this.index,
    required this.rowNumber,
    required this.code,
    required this.message,
  });

  final int index;
  final int rowNumber;
  final String? code;
  final String? message;

  factory Stage7RuleImportFailureSample.fromJson(Map<String, dynamic> json) {
    return Stage7RuleImportFailureSample(
      index: _intValue(json['index']),
      rowNumber: _intValue(json['rowNumber']),
      code: _stringOrNull(json['code']),
      message: _stringOrNull(json['message']),
    );
  }
}

class Stage7RuleImportRowResult {
  const Stage7RuleImportRowResult({
    required this.index,
    required this.rowNumber,
    required this.success,
    required this.rule,
    required this.errorCode,
    required this.errorMessage,
  });

  final int index;
  final int rowNumber;
  final bool success;
  final Map<String, dynamic>? rule;
  final String? errorCode;
  final String? errorMessage;

  factory Stage7RuleImportRowResult.fromJson(Map<String, dynamic> json) {
    final error = _map(json['error']);
    return Stage7RuleImportRowResult(
      index: _intValue(json['index']),
      rowNumber: _intValue(json['rowNumber']),
      success: _boolValue(json['success']),
      rule: json['rule'] is Map ? _map(json['rule']) : null,
      errorCode: _stringOrNull(error['code']),
      errorMessage: _stringOrNull(error['message']),
    );
  }
}

class CommissionRecord {
  const CommissionRecord({
    required this.id,
    required this.salesOrderId,
    required this.travelGroupId,
    required this.afterSalesOrderId,
    required this.commissionRuleId,
    required this.agencyRebateRuleId,
    required this.targetType,
    required this.targetUserId,
    required this.agencyId,
    required this.agencyName,
    required this.salesOrderNo,
    required this.salesOrder,
    required this.travelGroup,
    required this.customer,
    required this.targetUser,
    required this.agency,
    required this.grossAmountCents,
    required this.confirmedRefundAmountCents,
    required this.baseAmountCents,
    required this.deductionAmountCents,
    required this.rateSnapshot,
    required this.amountCents,
    required this.pointsCents,
    required this.manualInput,
    required this.isConfirmed,
    required this.confirmedById,
    required this.confirmedBy,
    required this.confirmedAt,
    required this.calculationVersion,
    required this.calculationNote,
    required this.calculationNoteSummary,
    required this.ruleSnapshot,
    required this.sourceSnapshot,
    required this.createdById,
    required this.updatedById,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String? salesOrderId;
  final String? travelGroupId;
  final String? afterSalesOrderId;
  final String? commissionRuleId;
  final String? agencyRebateRuleId;
  final String targetType;
  final String? targetUserId;
  final String? agencyId;
  final String? agencyName;
  final String? salesOrderNo;
  final Stage7SalesOrderSummaryRecord? salesOrder;
  final Stage7TravelGroupSummaryRecord? travelGroup;
  final Stage7CustomerSummaryRecord? customer;
  final Stage7UserSummaryRecord? targetUser;
  final Stage7AgencySummaryRecord? agency;
  final int grossAmountCents;
  final int confirmedRefundAmountCents;
  final int baseAmountCents;
  final int deductionAmountCents;
  final String? rateSnapshot;
  final int amountCents;
  final int pointsCents;
  final bool manualInput;
  final bool isConfirmed;
  final String? confirmedById;
  final Stage7UserSummaryRecord? confirmedBy;
  final String? confirmedAt;
  final String? calculationVersion;
  final String? calculationNote;
  final String? calculationNoteSummary;
  final Map<String, dynamic>? ruleSnapshot;
  final Map<String, dynamic>? sourceSnapshot;
  final String? createdById;
  final String? updatedById;
  final String? createdAt;
  final String? updatedAt;

  factory CommissionRecord.fromJson(Map<String, dynamic> json) {
    return CommissionRecord(
      id: '${json['id'] ?? ''}',
      salesOrderId: _stringOrNull(json['salesOrderId']),
      travelGroupId: _stringOrNull(json['travelGroupId']),
      afterSalesOrderId: _stringOrNull(json['afterSalesOrderId']),
      commissionRuleId: _stringOrNull(json['commissionRuleId']),
      agencyRebateRuleId: _stringOrNull(json['agencyRebateRuleId']),
      targetType: '${json['targetType'] ?? ''}',
      targetUserId: _stringOrNull(json['targetUserId']),
      agencyId: _stringOrNull(json['agencyId']),
      agencyName: _stringOrNull(json['agencyName']),
      salesOrderNo: _stringOrNull(json['salesOrderNo']),
      salesOrder: json['salesOrder'] is Map
          ? Stage7SalesOrderSummaryRecord.fromJson(_map(json['salesOrder']))
          : null,
      travelGroup: json['travelGroup'] is Map
          ? Stage7TravelGroupSummaryRecord.fromJson(_map(json['travelGroup']))
          : null,
      customer: json['customer'] is Map
          ? Stage7CustomerSummaryRecord.fromJson(_map(json['customer']))
          : null,
      targetUser: json['targetUser'] is Map
          ? Stage7UserSummaryRecord.fromJson(_map(json['targetUser']))
          : null,
      agency: json['agency'] is Map
          ? Stage7AgencySummaryRecord.fromJson(_map(json['agency']))
          : null,
      grossAmountCents: _intValue(json['grossAmountCents']),
      confirmedRefundAmountCents: _intValue(json['confirmedRefundAmountCents']),
      baseAmountCents: _intValue(json['baseAmountCents']),
      deductionAmountCents: _intValue(json['deductionAmountCents']),
      rateSnapshot: _stringOrNull(json['rateSnapshot']),
      amountCents: _intValue(json['amountCents']),
      pointsCents: _intValue(json['pointsCents']),
      manualInput: _boolValue(json['manualInput']),
      isConfirmed: _boolValue(json['isConfirmed']),
      confirmedById: _stringOrNull(json['confirmedById']),
      confirmedBy: json['confirmedBy'] is Map
          ? Stage7UserSummaryRecord.fromJson(_map(json['confirmedBy']))
          : null,
      confirmedAt: _stringOrNull(json['confirmedAt']),
      calculationVersion: _stringOrNull(json['calculationVersion']),
      calculationNote: _stringOrNull(json['calculationNote']),
      calculationNoteSummary: _stringOrNull(json['calculationNoteSummary']),
      ruleSnapshot:
          json['ruleSnapshot'] is Map ? _map(json['ruleSnapshot']) : null,
      sourceSnapshot:
          json['sourceSnapshot'] is Map ? _map(json['sourceSnapshot']) : null,
      createdById: _stringOrNull(json['createdById']),
      updatedById: _stringOrNull(json['updatedById']),
      createdAt: _stringOrNull(json['createdAt']),
      updatedAt: _stringOrNull(json['updatedAt']),
    );
  }
}

class CommissionRecalculationResult {
  const CommissionRecalculationResult({
    required this.generatedRecords,
    required this.updatedRecords,
    required this.unchangedRecords,
    required this.warnings,
  });

  final List<CommissionRecord> generatedRecords;
  final List<CommissionRecord> updatedRecords;
  final List<CommissionRecord> unchangedRecords;
  final List<String> warnings;

  List<CommissionRecord> get records => [
        ...generatedRecords,
        ...updatedRecords,
        ...unchangedRecords,
      ];

  factory CommissionRecalculationResult.fromJson(Map<String, dynamic> json) {
    final directRecords = _list(json['commissionRecords'])
        .map((item) => CommissionRecord.fromJson(item))
        .toList();
    final generatedRecords = _list(json['generatedRecords'])
        .map((item) => CommissionRecord.fromJson(item))
        .toList();
    return CommissionRecalculationResult(
      generatedRecords:
          generatedRecords.isNotEmpty ? generatedRecords : directRecords,
      updatedRecords: _list(json['updatedRecords'])
          .map((item) => CommissionRecord.fromJson(item))
          .toList(),
      unchangedRecords: _list(json['unchangedRecords'])
          .map((item) => CommissionRecord.fromJson(item))
          .toList(),
      warnings: _stringList(json['warnings']),
    );
  }
}

class TravelGroupFinanceSummaryRecord {
  const TravelGroupFinanceSummaryRecord({
    required this.id,
    required this.travelGroupId,
    required this.travelGroup,
    required this.totalSalesAmountCents,
    required this.totalCashOnDeliveryCents,
    required this.totalPaidDepositCents,
    required this.confirmedRefundAmountCents,
    required this.effectiveSalesAmountCents,
    required this.totalAgencyDeductionCents,
    required this.agencyDeductionConfirmed,
    required this.agencyDeductionConfirmedById,
    required this.agencyDeductionConfirmedBy,
    required this.agencyDeductionConfirmedAt,
    required this.totalAgencyNetAmountCents,
    required this.totalDailyRebateCents,
    required this.totalMonthlyRebateCents,
    required this.paidRebateCents,
    required this.unpaidRebateCents,
    required this.paidDailyRebateCents,
    required this.unpaidDailyRebateCents,
    required this.paidMonthlyRebateCents,
    required this.unpaidMonthlyRebateCents,
    required this.dailyRebatePaid,
    required this.dailyRebatePaidById,
    required this.dailyRebatePaidBy,
    required this.dailyRebatePaidAt,
    required this.monthlyRebatePaid,
    required this.monthlyRebatePaidById,
    required this.monthlyRebatePaidBy,
    required this.monthlyRebatePaidAt,
    required this.notes,
    required this.guideInfoSent,
    required this.travelAgencyInfoSent,
    required this.calculationVersion,
    required this.sourceSnapshot,
    required this.updatedById,
    required this.updatedBy,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String travelGroupId;
  final Stage7TravelGroupSummaryRecord? travelGroup;
  final int totalSalesAmountCents;
  final int totalCashOnDeliveryCents;
  final int totalPaidDepositCents;
  final int confirmedRefundAmountCents;
  final int effectiveSalesAmountCents;
  final int totalAgencyDeductionCents;
  final bool agencyDeductionConfirmed;
  final String? agencyDeductionConfirmedById;
  final Stage7UserSummaryRecord? agencyDeductionConfirmedBy;
  final String? agencyDeductionConfirmedAt;
  final int totalAgencyNetAmountCents;
  final int totalDailyRebateCents;
  final int totalMonthlyRebateCents;
  final int paidRebateCents;
  final int unpaidRebateCents;
  final int paidDailyRebateCents;
  final int unpaidDailyRebateCents;
  final int paidMonthlyRebateCents;
  final int unpaidMonthlyRebateCents;
  final bool dailyRebatePaid;
  final String? dailyRebatePaidById;
  final Stage7UserSummaryRecord? dailyRebatePaidBy;
  final String? dailyRebatePaidAt;
  final bool monthlyRebatePaid;
  final String? monthlyRebatePaidById;
  final Stage7UserSummaryRecord? monthlyRebatePaidBy;
  final String? monthlyRebatePaidAt;
  final String? notes;
  final bool guideInfoSent;
  final bool travelAgencyInfoSent;
  final String? calculationVersion;
  final Map<String, dynamic>? sourceSnapshot;
  final String? updatedById;
  final Stage7UserSummaryRecord? updatedBy;
  final String? createdAt;
  final String? updatedAt;

  factory TravelGroupFinanceSummaryRecord.fromJson(
    Map<String, dynamic> json,
  ) {
    return TravelGroupFinanceSummaryRecord(
      id: '${json['id'] ?? ''}',
      travelGroupId: '${json['travelGroupId'] ?? ''}',
      travelGroup: json['travelGroup'] is Map
          ? Stage7TravelGroupSummaryRecord.fromJson(_map(json['travelGroup']))
          : null,
      totalSalesAmountCents: _intValue(json['totalSalesAmountCents']),
      totalCashOnDeliveryCents: _intValue(json['totalCashOnDeliveryCents']),
      totalPaidDepositCents: _intValue(json['totalPaidDepositCents']),
      confirmedRefundAmountCents: _intValue(json['confirmedRefundAmountCents']),
      effectiveSalesAmountCents: _intValue(json['effectiveSalesAmountCents']),
      totalAgencyDeductionCents: _intValue(json['totalAgencyDeductionCents']),
      agencyDeductionConfirmed: _boolValue(json['agencyDeductionConfirmed']),
      agencyDeductionConfirmedById:
          _stringOrNull(json['agencyDeductionConfirmedById']),
      agencyDeductionConfirmedBy: json['agencyDeductionConfirmedBy'] is Map
          ? Stage7UserSummaryRecord.fromJson(
              _map(json['agencyDeductionConfirmedBy']),
            )
          : null,
      agencyDeductionConfirmedAt:
          _stringOrNull(json['agencyDeductionConfirmedAt']),
      totalAgencyNetAmountCents: _intValue(json['totalAgencyNetAmountCents']),
      totalDailyRebateCents: _intValue(json['totalDailyRebateCents']),
      totalMonthlyRebateCents: _intValue(json['totalMonthlyRebateCents']),
      paidRebateCents: _intValue(json['paidRebateCents']),
      unpaidRebateCents: _intValue(json['unpaidRebateCents']),
      paidDailyRebateCents: _intValue(json['paidDailyRebateCents']),
      unpaidDailyRebateCents: _intValue(json['unpaidDailyRebateCents']),
      paidMonthlyRebateCents: _intValue(json['paidMonthlyRebateCents']),
      unpaidMonthlyRebateCents: _intValue(json['unpaidMonthlyRebateCents']),
      dailyRebatePaid: _boolValue(json['dailyRebatePaid']),
      dailyRebatePaidById: _stringOrNull(json['dailyRebatePaidById']),
      dailyRebatePaidBy: json['dailyRebatePaidBy'] is Map
          ? Stage7UserSummaryRecord.fromJson(_map(json['dailyRebatePaidBy']))
          : null,
      dailyRebatePaidAt: _stringOrNull(json['dailyRebatePaidAt']),
      monthlyRebatePaid: _boolValue(json['monthlyRebatePaid']),
      monthlyRebatePaidById: _stringOrNull(json['monthlyRebatePaidById']),
      monthlyRebatePaidBy: json['monthlyRebatePaidBy'] is Map
          ? Stage7UserSummaryRecord.fromJson(
              _map(json['monthlyRebatePaidBy']),
            )
          : null,
      monthlyRebatePaidAt: _stringOrNull(json['monthlyRebatePaidAt']),
      notes: _stringOrNull(json['notes']),
      guideInfoSent: _boolValue(json['guideInfoSent']),
      travelAgencyInfoSent: _boolValue(json['travelAgencyInfoSent']),
      calculationVersion: _stringOrNull(json['calculationVersion']),
      sourceSnapshot:
          json['sourceSnapshot'] is Map ? _map(json['sourceSnapshot']) : null,
      updatedById: _stringOrNull(json['updatedById']),
      updatedBy: json['updatedBy'] is Map
          ? Stage7UserSummaryRecord.fromJson(_map(json['updatedBy']))
          : null,
      createdAt: _stringOrNull(json['createdAt']),
      updatedAt: _stringOrNull(json['updatedAt']),
    );
  }
}

class TravelGroupFinanceSummaryRefreshResult {
  const TravelGroupFinanceSummaryRefreshResult({
    required this.travelGroupFinanceSummary,
    required this.amountChanged,
    required this.agencyDeductionConfirmationReset,
  });

  final TravelGroupFinanceSummaryRecord? travelGroupFinanceSummary;
  final bool amountChanged;
  final bool agencyDeductionConfirmationReset;

  factory TravelGroupFinanceSummaryRefreshResult.fromJson(
    Map<String, dynamic> json,
  ) {
    return TravelGroupFinanceSummaryRefreshResult(
      travelGroupFinanceSummary: json['travelGroupFinanceSummary'] is Map
          ? TravelGroupFinanceSummaryRecord.fromJson(
              _map(json['travelGroupFinanceSummary']),
            )
          : null,
      amountChanged: _boolValue(json['amountChanged']),
      agencyDeductionConfirmationReset:
          _boolValue(json['agencyDeductionConfirmationReset']),
    );
  }
}

class AnalyticsDateRange {
  const AnalyticsDateRange({
    required this.preset,
    required this.dateFrom,
    required this.dateTo,
    required this.timezone,
  });

  final String preset;
  final String dateFrom;
  final String dateTo;
  final String timezone;

  factory AnalyticsDateRange.fromJson(Map<String, dynamic> json) {
    return AnalyticsDateRange(
      preset: '${json['preset'] ?? ''}',
      dateFrom: '${json['dateFrom'] ?? ''}',
      dateTo: '${json['dateTo'] ?? ''}',
      timezone: '${json['timezone'] ?? 'Asia/Shanghai'}',
    );
  }
}

class AnalyticsWarning {
  const AnalyticsWarning({
    required this.code,
    required this.message,
    required this.context,
  });

  final String code;
  final String message;
  final Map<String, dynamic>? context;

  factory AnalyticsWarning.fromJson(Map<String, dynamic> json) {
    final code = _stringOrNull(json['code']) ?? '';
    return AnalyticsWarning(
      code: code,
      message: _stringOrNull(json['message']) ?? code,
      context: json['context'] is Map ? _map(json['context']) : null,
    );
  }
}

class AnalyticsMetrics {
  const AnalyticsMetrics({
    required this.grossSalesAmountCents,
    required this.refundAmountCents,
    required this.pendingRefundAmountCents,
    required this.netSalesAmountCents,
    required this.totalGroupCount,
    required this.totalGuestCount,
    required this.groupScopedNetSalesAmountCents,
    required this.averageSalesPerGroupCents,
    required this.averageSalesPerGuestCents,
    required this.noEffectiveOrderGroupCount,
    required this.conversionGroupCount,
    required this.noOrderRate,
    required this.conversionRate,
  });

  final int grossSalesAmountCents;
  final int refundAmountCents;
  final int pendingRefundAmountCents;
  final int netSalesAmountCents;
  final int totalGroupCount;
  final int totalGuestCount;
  final int groupScopedNetSalesAmountCents;
  final int averageSalesPerGroupCents;
  final int averageSalesPerGuestCents;
  final int noEffectiveOrderGroupCount;
  final int conversionGroupCount;
  final double noOrderRate;
  final double conversionRate;

  factory AnalyticsMetrics.fromJson(Map<String, dynamic> json) {
    return AnalyticsMetrics(
      grossSalesAmountCents: _intValue(json['grossSalesAmountCents']),
      refundAmountCents: _intValue(json['refundAmountCents']),
      pendingRefundAmountCents: _intValue(json['pendingRefundAmountCents']),
      netSalesAmountCents: _intValue(json['netSalesAmountCents']),
      totalGroupCount: _intValue(json['totalGroupCount']),
      totalGuestCount: _intValue(json['totalGuestCount']),
      groupScopedNetSalesAmountCents:
          _intValue(json['groupScopedNetSalesAmountCents']),
      averageSalesPerGroupCents: _intValue(json['averageSalesPerGroupCents']),
      averageSalesPerGuestCents: _intValue(json['averageSalesPerGuestCents']),
      noEffectiveOrderGroupCount: _intValue(json['noEffectiveOrderGroupCount']),
      conversionGroupCount: _intValue(json['conversionGroupCount']),
      noOrderRate: _doubleValue(json['noOrderRate']),
      conversionRate: _doubleValue(json['conversionRate']),
    );
  }
}

class AnalyticsOverview {
  const AnalyticsOverview({
    required this.range,
    required this.metrics,
    required this.warnings,
  });

  final AnalyticsDateRange range;
  final AnalyticsMetrics metrics;
  final List<AnalyticsWarning> warnings;

  int get grossSalesAmountCents => metrics.grossSalesAmountCents;
  int get refundAmountCents => metrics.refundAmountCents;
  int get pendingRefundAmountCents => metrics.pendingRefundAmountCents;
  int get netSalesAmountCents => metrics.netSalesAmountCents;
  int get totalGroupCount => metrics.totalGroupCount;
  int get totalGuestCount => metrics.totalGuestCount;
  int get groupScopedNetSalesAmountCents =>
      metrics.groupScopedNetSalesAmountCents;
  int get averageSalesPerGroupCents => metrics.averageSalesPerGroupCents;
  int get averageSalesPerGuestCents => metrics.averageSalesPerGuestCents;
  int get noEffectiveOrderGroupCount => metrics.noEffectiveOrderGroupCount;
  int get conversionGroupCount => metrics.conversionGroupCount;
  double get noOrderRate => metrics.noOrderRate;
  double get conversionRate => metrics.conversionRate;

  factory AnalyticsOverview.fromJson(Map<String, dynamic> json) {
    final metrics = json['metrics'] is Map ? _map(json['metrics']) : json;
    return AnalyticsOverview(
      range: AnalyticsDateRange.fromJson(_map(json['range'])),
      metrics: AnalyticsMetrics.fromJson(metrics),
      warnings: _analyticsWarnings(json['warnings']),
    );
  }
}

class TasterRankingRecord {
  const TasterRankingRecord({
    required this.tasterId,
    required this.tasterName,
    required this.rank,
    required this.totalGroupCount,
    required this.totalGuestCount,
    required this.grossSalesAmountCents,
    required this.refundAmountCents,
    required this.netSalesAmountCents,
    required this.averageSalesPerGroupCents,
    required this.averageSalesPerGuestCents,
    required this.noEffectiveOrderGroupCount,
    required this.conversionGroupCount,
    required this.noOrderRate,
    required this.conversionRate,
    required this.warnings,
  });

  final String? tasterId;
  final String tasterName;
  final int rank;
  final int totalGroupCount;
  final int totalGuestCount;
  final int grossSalesAmountCents;
  final int refundAmountCents;
  final int netSalesAmountCents;
  final int averageSalesPerGroupCents;
  final int averageSalesPerGuestCents;
  final int noEffectiveOrderGroupCount;
  final int conversionGroupCount;
  final double noOrderRate;
  final double conversionRate;
  final List<AnalyticsWarning> warnings;

  factory TasterRankingRecord.fromJson(Map<String, dynamic> json) {
    return TasterRankingRecord(
      tasterId: _stringOrNull(json['tasterId']),
      tasterName: '${json['tasterName'] ?? ''}',
      rank: _intValue(json['rank']),
      totalGroupCount: _intValue(json['totalGroupCount']),
      totalGuestCount: _intValue(json['totalGuestCount']),
      grossSalesAmountCents: _intValue(json['grossSalesAmountCents']),
      refundAmountCents: _intValue(json['refundAmountCents']),
      netSalesAmountCents: _intValue(json['netSalesAmountCents']),
      averageSalesPerGroupCents: _intValue(json['averageSalesPerGroupCents']),
      averageSalesPerGuestCents: _intValue(json['averageSalesPerGuestCents']),
      noEffectiveOrderGroupCount: _intValue(json['noEffectiveOrderGroupCount']),
      conversionGroupCount: _intValue(json['conversionGroupCount']),
      noOrderRate: _doubleValue(json['noOrderRate']),
      conversionRate: _doubleValue(json['conversionRate']),
      warnings: _analyticsWarnings(json['warnings']),
    );
  }
}

class TasterRankingDetail {
  const TasterRankingDetail({
    required this.range,
    required this.tasterId,
    required this.tasterName,
    required this.summary,
    required this.travelGroups,
    required this.orders,
    required this.afterSalesOrders,
    required this.warnings,
  });

  final AnalyticsDateRange range;
  final String? tasterId;
  final String tasterName;
  final TasterRankingRecord summary;
  final List<AnalyticsSourceTravelGroup> travelGroups;
  final List<AnalyticsSourceOrder> orders;
  final List<AnalyticsSourceAfterSales> afterSalesOrders;
  final List<AnalyticsWarning> warnings;

  factory TasterRankingDetail.fromJson(Map<String, dynamic> json) {
    final taster = _map(json['taster']);
    final summary = TasterRankingRecord.fromJson(_map(json['summary']));
    final warnings = _analyticsWarnings(json['warnings']);
    return TasterRankingDetail(
      range: AnalyticsDateRange.fromJson(_map(json['range'])),
      tasterId: _stringOrNull(taster['id']) ?? summary.tasterId,
      tasterName: _stringOrNull(taster['name']) ?? summary.tasterName,
      summary: summary,
      travelGroups: _list(json['travelGroups'])
          .map((item) => AnalyticsSourceTravelGroup.fromJson(item))
          .toList(),
      orders: _list(json['orders'])
          .map((item) => AnalyticsSourceOrder.fromJson(item))
          .toList(),
      afterSalesOrders: _list(json['afterSalesOrders'])
          .map((item) => AnalyticsSourceAfterSales.fromJson(item))
          .toList(),
      warnings: warnings.isNotEmpty ? warnings : summary.warnings,
    );
  }
}

class AnalyticsTrendPoint {
  const AnalyticsTrendPoint({
    required this.periodStart,
    required this.periodEnd,
    required this.metricValue,
    required this.grossSalesAmountCents,
    required this.refundAmountCents,
    required this.pendingRefundAmountCents,
    required this.netSalesAmountCents,
    required this.totalGroupCount,
    required this.totalGuestCount,
    required this.groupScopedNetSalesAmountCents,
    required this.noEffectiveOrderGroupCount,
    required this.conversionGroupCount,
    required this.noOrderRate,
    required this.conversionRate,
  });

  final String periodStart;
  final String periodEnd;
  final double metricValue;
  final int grossSalesAmountCents;
  final int refundAmountCents;
  final int pendingRefundAmountCents;
  final int netSalesAmountCents;
  final int totalGroupCount;
  final int totalGuestCount;
  final int groupScopedNetSalesAmountCents;
  final int noEffectiveOrderGroupCount;
  final int conversionGroupCount;
  final double noOrderRate;
  final double conversionRate;

  factory AnalyticsTrendPoint.fromJson(Map<String, dynamic> json) {
    return AnalyticsTrendPoint(
      periodStart: '${json['periodStart'] ?? ''}',
      periodEnd: '${json['periodEnd'] ?? ''}',
      metricValue: _doubleValue(json['metricValue']),
      grossSalesAmountCents: _intValue(json['grossSalesAmountCents']),
      refundAmountCents: _intValue(json['refundAmountCents']),
      pendingRefundAmountCents: _intValue(json['pendingRefundAmountCents']),
      netSalesAmountCents: _intValue(json['netSalesAmountCents']),
      totalGroupCount: _intValue(json['totalGroupCount']),
      totalGuestCount: _intValue(json['totalGuestCount']),
      groupScopedNetSalesAmountCents:
          _intValue(json['groupScopedNetSalesAmountCents']),
      noEffectiveOrderGroupCount: _intValue(json['noEffectiveOrderGroupCount']),
      conversionGroupCount: _intValue(json['conversionGroupCount']),
      noOrderRate: _doubleValue(json['noOrderRate']),
      conversionRate: _doubleValue(json['conversionRate']),
    );
  }
}

class AnalyticsSourceOrder {
  const AnalyticsSourceOrder({
    required this.id,
    required this.orderNo,
    required this.orderDate,
    required this.status,
    required this.customerId,
    required this.customerName,
    required this.customerPhone,
    required this.customerFinanceMark,
    required this.travelGroupId,
    required this.travelGroupNo,
    required this.travelGroupVisitDate,
    required this.travelGroupFinanceMark,
    required this.tasterId,
    required this.tasterName,
    required this.groupType,
    required this.travelAgency,
    required this.totalAmountCents,
    required this.grossSalesAmountCents,
    required this.refundAmountCents,
    required this.pendingRefundAmountCents,
    required this.netSalesAmountCents,
    required this.effectiveAmountCents,
    required this.contributesToGrossSales,
    required this.contributesToEffectiveOrder,
    required this.items,
    required this.afterSalesOrderIds,
  });

  final String? id;
  final String? orderNo;
  final String? orderDate;
  final String? status;
  final String? customerId;
  final String? customerName;
  final String? customerPhone;
  final bool? customerFinanceMark;
  final String? travelGroupId;
  final String? travelGroupNo;
  final String? travelGroupVisitDate;
  final bool? travelGroupFinanceMark;
  final String? tasterId;
  final String? tasterName;
  final String? groupType;
  final String? travelAgency;
  final int totalAmountCents;
  final int grossSalesAmountCents;
  final int refundAmountCents;
  final int pendingRefundAmountCents;
  final int netSalesAmountCents;
  final int effectiveAmountCents;
  final bool contributesToGrossSales;
  final bool contributesToEffectiveOrder;
  final List<AnalyticsSourceOrderItem> items;
  final List<String> afterSalesOrderIds;

  factory AnalyticsSourceOrder.fromJson(Map<String, dynamic> json) {
    return AnalyticsSourceOrder(
      id: _stringOrNull(json['id']),
      orderNo: _stringOrNull(json['orderNo']),
      orderDate: _stringOrNull(json['orderDate']),
      status: _stringOrNull(json['status']),
      customerId: _stringOrNull(json['customerId']),
      customerName: _stringOrNull(json['customerName']),
      customerPhone: _stringOrNull(json['customerPhone']),
      customerFinanceMark: _boolOrNull(json['customerFinanceMark']),
      travelGroupId: _stringOrNull(json['travelGroupId']),
      travelGroupNo: _stringOrNull(json['travelGroupNo']),
      travelGroupVisitDate: _stringOrNull(json['travelGroupVisitDate']),
      travelGroupFinanceMark: _boolOrNull(json['travelGroupFinanceMark']),
      tasterId: _stringOrNull(json['tasterId']),
      tasterName: _stringOrNull(json['tasterName']),
      groupType: _stringOrNull(json['groupType']),
      travelAgency: _stringOrNull(json['travelAgency']),
      totalAmountCents: _intValue(json['totalAmountCents']),
      grossSalesAmountCents: _intValue(json['grossSalesAmountCents']),
      refundAmountCents: _intValue(json['refundAmountCents']),
      pendingRefundAmountCents: _intValue(json['pendingRefundAmountCents']),
      netSalesAmountCents: _intValue(json['netSalesAmountCents']),
      effectiveAmountCents: _intValue(json['effectiveAmountCents']),
      contributesToGrossSales: _boolValue(json['contributesToGrossSales']),
      contributesToEffectiveOrder:
          _boolValue(json['contributesToEffectiveOrder']),
      items: _list(json['items'])
          .map((item) => AnalyticsSourceOrderItem.fromJson(item))
          .toList(),
      afterSalesOrderIds: _stringList(json['afterSalesOrderIds']),
    );
  }
}

class AnalyticsSourceOrderItem {
  const AnalyticsSourceOrderItem({
    required this.id,
    required this.productName,
    required this.quantity,
    required this.unitPriceCents,
    required this.subtotalCents,
    required this.deliveryType,
  });

  final String? id;
  final String? productName;
  final int quantity;
  final int unitPriceCents;
  final int subtotalCents;
  final String? deliveryType;

  factory AnalyticsSourceOrderItem.fromJson(Map<String, dynamic> json) {
    return AnalyticsSourceOrderItem(
      id: _stringOrNull(json['id']),
      productName: _stringOrNull(json['productName']),
      quantity: _intValue(json['quantity']),
      unitPriceCents: _intValue(json['unitPriceCents']),
      subtotalCents: _intValue(json['subtotalCents']),
      deliveryType: _stringOrNull(json['deliveryType']),
    );
  }
}

class AnalyticsSourceTravelGroup {
  const AnalyticsSourceTravelGroup({
    required this.id,
    required this.groupNo,
    required this.visitDate,
    required this.guestCount,
    required this.tasterId,
    required this.tasterName,
    required this.groupType,
    required this.travelAgency,
    required this.financeMark,
    required this.noEffectiveOrder,
    required this.grossSalesAmountCents,
    required this.refundAmountCents,
    required this.netSalesAmountCents,
    required this.salesOrderIds,
    required this.warnings,
  });

  final String? id;
  final String? groupNo;
  final String? visitDate;
  final int guestCount;
  final String? tasterId;
  final String? tasterName;
  final String? groupType;
  final String? travelAgency;
  final bool? financeMark;
  final bool noEffectiveOrder;
  final int grossSalesAmountCents;
  final int refundAmountCents;
  final int netSalesAmountCents;
  final List<String> salesOrderIds;
  final List<AnalyticsWarning> warnings;

  factory AnalyticsSourceTravelGroup.fromJson(Map<String, dynamic> json) {
    return AnalyticsSourceTravelGroup(
      id: _stringOrNull(json['id']),
      groupNo: _stringOrNull(json['groupNo']),
      visitDate: _stringOrNull(json['visitDate']),
      guestCount: _intValue(json['guestCount']),
      tasterId: _stringOrNull(json['tasterId']),
      tasterName: _stringOrNull(json['tasterName']),
      groupType: _stringOrNull(json['groupType']),
      travelAgency: _stringOrNull(json['travelAgency']),
      financeMark: _boolOrNull(json['financeMark']),
      noEffectiveOrder: _boolValue(json['noEffectiveOrder']),
      grossSalesAmountCents: _intValue(json['grossSalesAmountCents']),
      refundAmountCents: _intValue(json['refundAmountCents']),
      netSalesAmountCents: _intValue(json['netSalesAmountCents']),
      salesOrderIds: _stringList(json['salesOrderIds']),
      warnings: _analyticsWarnings(json['warnings']),
    );
  }
}

class AnalyticsSourceAfterSales {
  const AnalyticsSourceAfterSales({
    required this.id,
    required this.afterSalesNo,
    required this.salesOrderId,
    required this.salesOrderNo,
    required this.createdAt,
    required this.refundAmountCents,
    required this.financeConfirmed,
    required this.financeConfirmedAt,
    required this.status,
    required this.issueType,
    required this.actionType,
    required this.description,
    required this.customerId,
    required this.customerName,
    required this.travelGroupId,
    required this.travelGroupNo,
    required this.tasterId,
    required this.tasterName,
  });

  final String? id;
  final String? afterSalesNo;
  final String? salesOrderId;
  final String? salesOrderNo;
  final String? createdAt;
  final int refundAmountCents;
  final bool financeConfirmed;
  final String? financeConfirmedAt;
  final String? status;
  final String? issueType;
  final String? actionType;
  final String? description;
  final String? customerId;
  final String? customerName;
  final String? travelGroupId;
  final String? travelGroupNo;
  final String? tasterId;
  final String? tasterName;

  factory AnalyticsSourceAfterSales.fromJson(Map<String, dynamic> json) {
    return AnalyticsSourceAfterSales(
      id: _stringOrNull(json['id']),
      afterSalesNo: _stringOrNull(json['afterSalesNo']),
      salesOrderId: _stringOrNull(json['salesOrderId']),
      salesOrderNo: _stringOrNull(json['salesOrderNo']),
      createdAt: _stringOrNull(json['createdAt']),
      refundAmountCents: _intValue(json['refundAmountCents']),
      financeConfirmed: _boolValue(json['financeConfirmed']),
      financeConfirmedAt: _stringOrNull(json['financeConfirmedAt']),
      status: _stringOrNull(json['status']),
      issueType: _stringOrNull(json['issueType']),
      actionType: _stringOrNull(json['actionType']),
      description: _stringOrNull(json['description']),
      customerId: _stringOrNull(json['customerId']),
      customerName: _stringOrNull(json['customerName']),
      travelGroupId: _stringOrNull(json['travelGroupId']),
      travelGroupNo: _stringOrNull(json['travelGroupNo']),
      tasterId: _stringOrNull(json['tasterId']),
      tasterName: _stringOrNull(json['tasterName']),
    );
  }
}

class Stage7SalesOrderSummaryRecord {
  const Stage7SalesOrderSummaryRecord({
    required this.id,
    required this.orderNo,
    required this.orderDate,
    required this.status,
    required this.customerName,
  });

  final String? id;
  final String? orderNo;
  final String? orderDate;
  final String? status;
  final String? customerName;

  factory Stage7SalesOrderSummaryRecord.fromJson(Map<String, dynamic> json) {
    return Stage7SalesOrderSummaryRecord(
      id: _stringOrNull(json['id']),
      orderNo: _stringOrNull(json['orderNo']),
      orderDate: _stringOrNull(json['orderDate']),
      status: _stringOrNull(json['status']),
      customerName: _stringOrNull(json['customerName']),
    );
  }
}

class Stage7TravelGroupSummaryRecord {
  const Stage7TravelGroupSummaryRecord({
    required this.id,
    required this.groupNo,
    required this.visitDate,
    required this.travelAgency,
    required this.guideName,
    required this.licensePlate,
    required this.guestCount,
    required this.tasterId,
    required this.tasterName,
    required this.financeMark,
  });

  final String? id;
  final String? groupNo;
  final String? visitDate;
  final String? travelAgency;
  final String? guideName;
  final String? licensePlate;
  final int guestCount;
  final String? tasterId;
  final String? tasterName;
  final bool? financeMark;

  factory Stage7TravelGroupSummaryRecord.fromJson(
    Map<String, dynamic> json,
  ) {
    return Stage7TravelGroupSummaryRecord(
      id: _stringOrNull(json['id']),
      groupNo: _stringOrNull(json['groupNo']),
      visitDate: _stringOrNull(json['visitDate']),
      travelAgency: _stringOrNull(json['travelAgency']),
      guideName: _stringOrNull(json['guideName']),
      licensePlate: _stringOrNull(json['licensePlate']),
      guestCount: _intValue(json['guestCount']),
      tasterId: _stringOrNull(json['tasterId']),
      tasterName: _stringOrNull(json['tasterName']),
      financeMark: _boolOrNull(json['financeMark']),
    );
  }
}

class Stage7CustomerSummaryRecord {
  const Stage7CustomerSummaryRecord({
    required this.id,
    required this.name,
  });

  final String? id;
  final String? name;

  factory Stage7CustomerSummaryRecord.fromJson(Map<String, dynamic> json) {
    return Stage7CustomerSummaryRecord(
      id: _stringOrNull(json['id']),
      name: _stringOrNull(json['name']),
    );
  }
}

class Stage7UserSummaryRecord {
  const Stage7UserSummaryRecord({
    required this.id,
    required this.name,
    required this.username,
    required this.role,
  });

  final String? id;
  final String? name;
  final String? username;
  final String? role;

  factory Stage7UserSummaryRecord.fromJson(Map<String, dynamic> json) {
    return Stage7UserSummaryRecord(
      id: _stringOrNull(json['id']),
      name: _stringOrNull(json['name']),
      username: _stringOrNull(json['username']),
      role: _stringOrNull(json['role']),
    );
  }
}

class Stage7AgencySummaryRecord {
  const Stage7AgencySummaryRecord({
    required this.id,
    required this.name,
  });

  final String? id;
  final String? name;

  factory Stage7AgencySummaryRecord.fromJson(Map<String, dynamic> json) {
    return Stage7AgencySummaryRecord(
      id: _stringOrNull(json['id']),
      name: _stringOrNull(json['name']),
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
    required this.active,
    required this.token,
    required this.url,
    required this.generatedAt,
    required this.expiresAt,
    required this.revokedAt,
  });

  final bool active;
  final String? token;
  final String? url;
  final String? generatedAt;
  final String? expiresAt;
  final String? revokedAt;

  factory SalesSheetQrCode.fromJson(Map<String, dynamic> json) {
    return SalesSheetQrCode(
      active: _boolValue(json['active']),
      token: _stringOrNull(json['token']),
      url: _stringOrNull(json['url']),
      generatedAt: _stringOrNull(json['generatedAt']),
      expiresAt: _stringOrNull(json['expiresAt']),
      revokedAt: _stringOrNull(json['revokedAt']),
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
    required this.id,
    required this.businessDate,
    required this.travelGroupSalesCents,
    required this.backOfficeSalesCents,
    required this.buybackCents,
    required this.externalSalesCents,
    required this.internalPurchaseCents,
    required this.afterSalesCents,
    required this.refundsCents,
    required this.receivableTotalCents,
    required this.actualTotalCents,
    required this.differenceCents,
    required this.reviewStatus,
    required this.status,
    required this.reviewIsStale,
    required this.reviewedById,
    required this.reviewedByName,
    required this.reviewedAt,
    required this.timezone,
    required this.paymentMethods,
    required this.notes,
  });

  final String? id;
  final String businessDate;
  final int travelGroupSalesCents;
  final int backOfficeSalesCents;
  final int buybackCents;
  final int externalSalesCents;
  final int internalPurchaseCents;
  final int afterSalesCents;
  final int refundsCents;
  final int receivableTotalCents;
  final int actualTotalCents;
  final int differenceCents;
  final String reviewStatus;
  final String status;
  final bool reviewIsStale;
  final String? reviewedById;
  final String? reviewedByName;
  final String? reviewedAt;
  final String timezone;
  final List<PaymentMethodRecord> paymentMethods;
  final String? notes;

  factory ReconciliationRecord.fromJson(Map<String, dynamic> json) {
    return ReconciliationRecord(
      id: _stringOrNull(json['id']),
      businessDate: '${json['businessDate'] ?? ''}',
      travelGroupSalesCents: _intValue(json['travelGroupSalesCents']),
      backOfficeSalesCents: _intValue(json['backOfficeSalesCents']),
      buybackCents: _intValue(json['buybackCents']),
      externalSalesCents: _intValue(json['externalSalesCents']),
      internalPurchaseCents: _intValue(json['internalPurchaseCents']),
      afterSalesCents: _intValue(json['afterSalesCents']),
      refundsCents: _intValue(json['refundsCents']),
      receivableTotalCents: _intValue(json['receivableTotalCents']),
      actualTotalCents: _intValue(json['actualTotalCents']),
      differenceCents: _intValue(json['differenceCents']),
      reviewStatus: '${json['reviewStatus'] ?? 'pending_review'}',
      status: '${json['status'] ?? 'pending_review'}',
      reviewIsStale: _boolValue(json['reviewIsStale']),
      reviewedById: _stringOrNull(json['reviewedById']),
      reviewedByName: _stringOrNull(json['reviewedByName']),
      reviewedAt: _stringOrNull(json['reviewedAt']),
      timezone: '${json['timezone'] ?? 'Asia/Shanghai'}',
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

class AiChatRequest {
  const AiChatRequest({
    required this.question,
    this.conversationId,
  });

  final String question;
  final String? conversationId;

  Map<String, dynamic> toJson() {
    final trimmedConversationId = conversationId?.trim();
    return {
      'question': question,
      if (trimmedConversationId != null && trimmedConversationId.isNotEmpty)
        'conversationId': trimmedConversationId,
    };
  }
}

class AiChatResponse {
  const AiChatResponse({
    required this.answer,
    required this.intent,
    required this.range,
    required this.sourceSummary,
    required this.warnings,
  });

  final String answer;
  final String intent;
  final AiDateRange? range;
  final List<SourceSummary> sourceSummary;
  final List<AiWarning> warnings;

  factory AiChatResponse.fromJson(Map<String, dynamic> json) {
    return AiChatResponse(
      answer: '${json['answer'] ?? ''}',
      intent: '${json['intent'] ?? ''}',
      range: json['range'] is Map
          ? AiDateRange.fromJson(_map(json['range']))
          : null,
      sourceSummary: _list(json['sourceSummary'])
          .map((item) => SourceSummary.fromJson(item))
          .toList(),
      warnings: _aiWarnings(json['warnings']),
    );
  }
}

class AiDateRange {
  const AiDateRange({
    this.preset,
    this.dateFrom,
    this.dateTo,
    this.timezone,
  });

  final String? preset;
  final String? dateFrom;
  final String? dateTo;
  final String? timezone;

  factory AiDateRange.fromJson(Map<String, dynamic> json) {
    return AiDateRange(
      preset: _stringOrNull(json['preset']),
      dateFrom: _stringOrNull(json['dateFrom']),
      dateTo: _stringOrNull(json['dateTo']),
      timezone: _stringOrNull(json['timezone']),
    );
  }
}

class AiChatTemplate {
  const AiChatTemplate({
    required this.id,
    required this.title,
    required this.question,
    required this.intent,
    required this.roleScopes,
  });

  final String id;
  final String title;
  final String question;
  final String intent;
  final List<String> roleScopes;

  factory AiChatTemplate.fromJson(Map<String, dynamic> json) {
    return AiChatTemplate(
      id: '${json['id'] ?? ''}',
      title: '${json['title'] ?? ''}',
      question: '${json['question'] ?? ''}',
      intent: '${json['intent'] ?? ''}',
      roleScopes: _stringList(json['roleScopes']),
    );
  }
}

class AiChatHistoryPage {
  const AiChatHistoryPage({
    required this.items,
    required this.page,
    required this.pageSize,
    required this.total,
    required this.totalPages,
  });

  final List<AiChatHistoryItem> items;
  final int page;
  final int pageSize;
  final int total;
  final int totalPages;

  factory AiChatHistoryPage.fromJson(Map<String, dynamic> json) {
    return AiChatHistoryPage(
      items: _list(json['items'])
          .map((item) => AiChatHistoryItem.fromJson(item))
          .toList(),
      page: _intValue(json['page']),
      pageSize: _intValue(json['pageSize']),
      total: _intValue(json['total']),
      totalPages: _intValue(json['totalPages']),
    );
  }
}

class AiChatHistoryItem {
  const AiChatHistoryItem({
    required this.id,
    required this.conversationId,
    required this.question,
    required this.answer,
    required this.intent,
    required this.dataScope,
    required this.toolCalls,
    required this.sourceSummary,
    required this.warnings,
    required this.modelProvider,
    required this.modelName,
    required this.promptTokens,
    required this.completionTokens,
    required this.latencyMs,
    required this.errorCode,
    required this.createdAt,
  });

  final String id;
  final String conversationId;
  final String question;
  final String answer;
  final String intent;
  final Map<String, dynamic>? dataScope;
  final List<AiToolCallSummary> toolCalls;
  final List<SourceSummary> sourceSummary;
  final List<AiWarning> warnings;
  final String? modelProvider;
  final String? modelName;
  final int? promptTokens;
  final int? completionTokens;
  final int? latencyMs;
  final String? errorCode;
  final String createdAt;

  factory AiChatHistoryItem.fromJson(Map<String, dynamic> json) {
    return AiChatHistoryItem(
      id: '${json['id'] ?? ''}',
      conversationId: '${json['conversationId'] ?? ''}',
      question: '${json['question'] ?? ''}',
      answer: '${json['answer'] ?? ''}',
      intent: '${json['intent'] ?? ''}',
      dataScope: json['dataScope'] is Map ? _map(json['dataScope']) : null,
      toolCalls: _list(json['toolCalls'])
          .map((item) => AiToolCallSummary.fromJson(item))
          .toList(),
      sourceSummary: _list(json['sourceSummary'])
          .map((item) => SourceSummary.fromJson(item))
          .toList(),
      warnings: _aiWarnings(json['warnings']),
      modelProvider: _stringOrNull(json['modelProvider']),
      modelName: _stringOrNull(json['modelName']),
      promptTokens:
          json['promptTokens'] == null ? null : _intValue(json['promptTokens']),
      completionTokens: json['completionTokens'] == null
          ? null
          : _intValue(json['completionTokens']),
      latencyMs:
          json['latencyMs'] == null ? null : _intValue(json['latencyMs']),
      errorCode: _stringOrNull(json['errorCode']),
      createdAt: '${json['createdAt'] ?? ''}',
    );
  }
}

class AiToolCallSummary {
  const AiToolCallSummary({
    required this.toolName,
    required this.rowCount,
    required this.globalMarkedFilterEnabled,
    required this.warnings,
  });

  final String toolName;
  final int rowCount;
  final bool globalMarkedFilterEnabled;
  final List<AiWarning> warnings;

  factory AiToolCallSummary.fromJson(Map<String, dynamic> json) {
    return AiToolCallSummary(
      toolName: '${json['toolName'] ?? ''}',
      rowCount: _intValue(json['rowCount']),
      globalMarkedFilterEnabled: _boolValue(json['globalMarkedFilterEnabled']),
      warnings: _aiWarnings(json['warnings']),
    );
  }
}

class SourceSummary {
  const SourceSummary({
    required this.toolName,
    required this.rowCount,
    required this.globalMarkedFilterEnabled,
    required this.scopeDescription,
    this.dateFrom,
    this.dateTo,
  });

  final String toolName;
  final int rowCount;
  final String? dateFrom;
  final String? dateTo;
  final bool globalMarkedFilterEnabled;
  final String scopeDescription;

  factory SourceSummary.fromJson(Map<String, dynamic> json) {
    return SourceSummary(
      toolName: '${json['toolName'] ?? ''}',
      rowCount: _intValue(json['rowCount']),
      dateFrom: _stringOrNull(json['dateFrom']),
      dateTo: _stringOrNull(json['dateTo']),
      globalMarkedFilterEnabled: _boolValue(json['globalMarkedFilterEnabled']),
      scopeDescription: '${json['scopeDescription'] ?? ''}',
    );
  }
}

class AiWarning {
  const AiWarning({
    required this.message,
    this.code,
    this.context,
  });

  final String message;
  final String? code;
  final Map<String, dynamic>? context;

  factory AiWarning.fromJson(Object? value) {
    if (value is Map) {
      final json = _map(value);
      final message =
          _stringOrNull(json['message']) ?? _stringOrNull(json['code']) ?? '';
      return AiWarning(
        message: message,
        code: _stringOrNull(json['code']),
        context: json['context'] is Map ? _map(json['context']) : null,
      );
    }

    final message = _stringOrNull(value) ?? '';
    return AiWarning(message: message, code: message.isEmpty ? null : message);
  }
}

class AiCapabilities {
  const AiCapabilities({
    required this.enabled,
    required this.role,
    required this.roleAllowed,
    required this.canUseAi,
    required this.scopeDescription,
    required this.allowedIntents,
    required this.tools,
    required this.limits,
    required this.model,
    required this.constraints,
  });

  final bool enabled;
  final String role;
  final bool roleAllowed;
  final bool canUseAi;
  final String scopeDescription;
  final List<String> allowedIntents;
  final List<AiToolCapability> tools;
  final AiCapabilityLimits limits;
  final AiModelCapability model;
  final AiCapabilityConstraints constraints;

  factory AiCapabilities.fromJson(Map<String, dynamic> json) {
    return AiCapabilities(
      enabled: _boolValue(json['enabled']),
      role: '${json['role'] ?? ''}',
      roleAllowed: _boolValue(json['roleAllowed']),
      canUseAi: _boolValue(json['canUseAi']),
      scopeDescription: '${json['scopeDescription'] ?? ''}',
      allowedIntents: _stringList(json['allowedIntents']),
      tools: _list(json['tools'])
          .map((item) => AiToolCapability.fromJson(item))
          .toList(),
      limits: AiCapabilityLimits.fromJson(_map(json['limits'])),
      model: AiModelCapability.fromJson(_map(json['model'])),
      constraints: AiCapabilityConstraints.fromJson(_map(json['constraints'])),
    );
  }
}

class AiToolCapability {
  const AiToolCapability({
    required this.toolName,
    required this.intent,
    required this.readOnly,
    required this.description,
  });

  final String toolName;
  final String intent;
  final bool readOnly;
  final String description;

  factory AiToolCapability.fromJson(Map<String, dynamic> json) {
    return AiToolCapability(
      toolName: '${json['toolName'] ?? ''}',
      intent: '${json['intent'] ?? ''}',
      readOnly: _boolValue(json['readOnly']),
      description: '${json['description'] ?? ''}',
    );
  }
}

class AiCapabilityLimits {
  const AiCapabilityLimits({
    required this.maxQuestionLength,
    required this.dailyLimitPerUser,
    required this.historyRetentionDays,
    required this.timeoutMs,
    required this.historyPageSizeDefault,
    required this.historyPageSizeMax,
  });

  final int maxQuestionLength;
  final int dailyLimitPerUser;
  final int historyRetentionDays;
  final int timeoutMs;
  final int historyPageSizeDefault;
  final int historyPageSizeMax;

  factory AiCapabilityLimits.fromJson(Map<String, dynamic> json) {
    return AiCapabilityLimits(
      maxQuestionLength: _intValue(json['maxQuestionLength']),
      dailyLimitPerUser: _intValue(json['dailyLimitPerUser']),
      historyRetentionDays: _intValue(json['historyRetentionDays']),
      timeoutMs: _intValue(json['timeoutMs']),
      historyPageSizeDefault: _intValue(json['historyPageSizeDefault']),
      historyPageSizeMax: _intValue(json['historyPageSizeMax']),
    );
  }
}

class AiModelCapability {
  const AiModelCapability({
    required this.mockMode,
    required this.hasApiKey,
    this.provider,
    this.modelName,
  });

  final bool mockMode;
  final String? provider;
  final String? modelName;
  final bool hasApiKey;

  factory AiModelCapability.fromJson(Map<String, dynamic> json) {
    return AiModelCapability(
      mockMode: _boolValue(json['mockMode']),
      provider: _stringOrNull(json['provider']),
      modelName: _stringOrNull(json['modelName']),
      hasApiKey: _boolValue(json['hasApiKey']),
    );
  }
}

class AiCapabilityConstraints {
  const AiCapabilityConstraints({
    required this.readOnly,
    required this.historyScope,
    required this.canGenerateSql,
    required this.canExecuteSql,
    required this.canWriteBusinessData,
  });

  final bool readOnly;
  final String historyScope;
  final bool canGenerateSql;
  final bool canExecuteSql;
  final bool canWriteBusinessData;

  factory AiCapabilityConstraints.fromJson(Map<String, dynamic> json) {
    return AiCapabilityConstraints(
      readOnly: _boolValue(json['readOnly']),
      historyScope: '${json['historyScope'] ?? ''}',
      canGenerateSql: _boolValue(json['canGenerateSql']),
      canExecuteSql: _boolValue(json['canExecuteSql']),
      canWriteBusinessData: _boolValue(json['canWriteBusinessData']),
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

List<AnalyticsWarning> _analyticsWarnings(Object? value) {
  if (value is List) {
    return value
        .map((item) {
          if (item is Map) {
            return AnalyticsWarning.fromJson(_map(item));
          }
          final code = _stringOrNull(item) ?? '';
          return AnalyticsWarning(
            code: code,
            message: code,
            context: null,
          );
        })
        .where((warning) => warning.code.isNotEmpty)
        .toList();
  }
  return const <AnalyticsWarning>[];
}

List<AiWarning> _aiWarnings(Object? value) {
  if (value is List) {
    return value
        .map(AiWarning.fromJson)
        .where((warning) => warning.message.isNotEmpty)
        .toList();
  }
  return const <AiWarning>[];
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

double _doubleValue(Object? value) {
  if (value is num) {
    return value.toDouble();
  }
  return double.tryParse('${value ?? 0}') ?? 0;
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
