import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../api/api_client.dart';
import '../file_security_policy.dart';

typedef DownloadedFile = ApiDownloadedFile;

class BusinessApi {
  BusinessApi({
    required ApiClient apiClient,
    required String token,
  })  : _apiClient = apiClient,
        _token = token;

  final ApiClient _apiClient;
  final String _token;

  Future<SpecialOrderListPage> listSpecialOrders({
    String? orderType,
    String? workflowStatus,
    String? keyword,
    int limit = 100,
    int skip = 0,
  }) async {
    final query = <String, String>{
      'limit': '$limit',
      'skip': '$skip',
    };
    _putNonEmpty(query, 'orderType', orderType);
    _putNonEmpty(query, 'workflowStatus', workflowStatus);
    _putNonEmpty(query, 'keyword', keyword);
    final payload = await _apiClient.getJson(
      _path('/api/special-orders', query),
      token: _token,
    );
    return SpecialOrderListPage.fromJson(_data(payload));
  }

  Future<SpecialOrderReferenceData> getSpecialOrderReferenceData({
    String? keyword,
    String? customerId,
  }) async {
    final query = <String, String>{};
    _putNonEmpty(query, 'keyword', keyword);
    _putNonEmpty(query, 'customerId', customerId);
    final payload = await _apiClient.getJson(
      _path('/api/special-orders/reference-data', query),
      token: _token,
    );
    return SpecialOrderReferenceData.fromJson(
      _map(_data(payload)['referenceData']),
    );
  }

  Future<SpecialOrderRecord> getSpecialOrder(String id) async {
    final payload = await _apiClient.getJson(
      '/api/special-orders/${Uri.encodeComponent(id)}',
      token: _token,
    );
    return SpecialOrderRecord.fromJson(
      _map(_data(payload)['specialOrder']),
    );
  }

  Future<SpecialOrderRecord> createSpecialOrder(
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.postJson(
      '/api/special-orders',
      body: body,
      token: _token,
    );
    return SpecialOrderRecord.fromJson(
      _map(_data(payload)['specialOrder']),
    );
  }

  Future<SpecialOrderRecord> updateSpecialOrder(
    String id,
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/special-orders/${Uri.encodeComponent(id)}',
      body: body,
      token: _token,
    );
    return SpecialOrderRecord.fromJson(
      _map(_data(payload)['specialOrder']),
    );
  }

  Future<List<SpecialOrderCommissionRecord>> listSpecialOrderCommissions(
    String orderId, {
    bool includeInactive = false,
  }) async {
    final payload = await _apiClient.getJson(
      _path(
        '/api/special-orders/${Uri.encodeComponent(orderId)}/commissions',
        {'includeInactive': '$includeInactive'},
      ),
      token: _token,
    );
    return _list(_data(payload)['commissions'])
        .map(SpecialOrderCommissionRecord.fromJson)
        .toList();
  }

  Future<SpecialOrderCommissionRecord> createSpecialOrderCommission(
    String orderId,
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.postJson(
      '/api/special-orders/${Uri.encodeComponent(orderId)}/commissions',
      body: body,
      token: _token,
    );
    return SpecialOrderCommissionRecord.fromJson(
      _map(_data(payload)['commission']),
    );
  }

  Future<SpecialOrderCommissionRecord> updateSpecialOrderCommission(
    String orderId,
    String commissionId,
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/special-orders/${Uri.encodeComponent(orderId)}/commissions/'
      '${Uri.encodeComponent(commissionId)}',
      body: body,
      token: _token,
    );
    return SpecialOrderCommissionRecord.fromJson(
      _map(_data(payload)['commission']),
    );
  }

  Future<void> deleteSpecialOrderCommission(
    String orderId,
    String commissionId, {
    required int manualVersion,
    required String reason,
    required String idempotencyKey,
  }) async {
    await _apiClient.deleteJson(
      '/api/special-orders/${Uri.encodeComponent(orderId)}/commissions/'
      '${Uri.encodeComponent(commissionId)}',
      body: {
        'manualVersion': manualVersion,
        'reason': reason,
        'idempotencyKey': idempotencyKey,
      },
      token: _token,
    );
  }

  Future<SpecialOrderRecord> cancelSpecialOrder(
    String id, {
    required int workflowVersion,
    required String idempotencyKey,
    String? reason,
  }) async {
    final payload = await _apiClient.deleteJson(
      '/api/special-orders/${Uri.encodeComponent(id)}',
      body: {
        'workflowVersion': workflowVersion,
        'idempotencyKey': idempotencyKey,
        if (reason?.trim().isNotEmpty == true) 'reason': reason!.trim(),
      },
      token: _token,
    );
    return SpecialOrderRecord.fromJson(
      _map(_data(payload)['specialOrder']),
    );
  }

  Future<SpecialOrderRecord> submitSpecialOrder(
    String id, {
    required int workflowVersion,
    required String idempotencyKey,
  }) {
    return _specialOrderAction(
      id,
      'submit',
      workflowVersion: workflowVersion,
      idempotencyKey: idempotencyKey,
    );
  }

  Future<SpecialOrderRecord> withdrawSpecialOrder(
    String id, {
    required int workflowVersion,
    required String idempotencyKey,
  }) {
    return _specialOrderAction(
      id,
      'withdraw',
      workflowVersion: workflowVersion,
      idempotencyKey: idempotencyKey,
    );
  }

  Future<SpecialOrderRecord> approveSpecialOrder(
    String id, {
    required int workflowVersion,
    required String idempotencyKey,
  }) {
    return _specialOrderAction(
      id,
      'approve',
      workflowVersion: workflowVersion,
      idempotencyKey: idempotencyKey,
    );
  }

  Future<SpecialOrderRecord> rejectSpecialOrder(
    String id, {
    required int workflowVersion,
    required String idempotencyKey,
    required String reason,
  }) {
    return _specialOrderAction(
      id,
      'reject',
      workflowVersion: workflowVersion,
      idempotencyKey: idempotencyKey,
      reason: reason,
    );
  }

  Future<SpecialOrderRecord> unapproveSpecialOrder(
    String id, {
    required int workflowVersion,
    required String idempotencyKey,
    required String reason,
  }) {
    return _specialOrderAction(
      id,
      'unapprove',
      workflowVersion: workflowVersion,
      idempotencyKey: idempotencyKey,
      reason: reason,
    );
  }

  Future<SpecialOrderRecord> completeSpecialOrder(
    String id, {
    required int workflowVersion,
    required String idempotencyKey,
  }) {
    return _specialOrderAction(
      id,
      'complete',
      workflowVersion: workflowVersion,
      idempotencyKey: idempotencyKey,
    );
  }

  Future<SpecialOrderRecord> recordSpecialOrderPayment(
    String id, {
    required int workflowVersion,
    required String idempotencyKey,
    required int amountCents,
    required String paymentMethodId,
    String? referenceNo,
    String? remark,
  }) async {
    final payload = await _apiClient.postJson(
      '/api/special-orders/${Uri.encodeComponent(id)}/payments',
      body: {
        'workflowVersion': workflowVersion,
        'idempotencyKey': idempotencyKey,
        'amountCents': amountCents,
        'paymentMethodId': paymentMethodId,
        if (referenceNo?.trim().isNotEmpty == true)
          'referenceNo': referenceNo!.trim(),
        if (remark?.trim().isNotEmpty == true) 'remark': remark!.trim(),
      },
      token: _token,
    );
    return SpecialOrderRecord.fromJson(
      _map(_data(payload)['specialOrder']),
    );
  }

  Future<SpecialOrderRecord> _specialOrderAction(
    String id,
    String action, {
    required int workflowVersion,
    required String idempotencyKey,
    String? reason,
  }) async {
    final payload = await _apiClient.postJson(
      '/api/special-orders/${Uri.encodeComponent(id)}/$action',
      body: {
        'workflowVersion': workflowVersion,
        'idempotencyKey': idempotencyKey,
        if (reason?.trim().isNotEmpty == true) 'reason': reason!.trim(),
      },
      token: _token,
    );
    return SpecialOrderRecord.fromJson(
      _map(_data(payload)['specialOrder']),
    );
  }

  Future<DownloadedFile> downloadSpecialOrdersExcel({
    String? orderType,
    String? workflowStatus,
    String? keyword,
  }) {
    final query = <String, String>{};
    _putNonEmpty(query, 'orderType', orderType);
    _putNonEmpty(query, 'workflowStatus', workflowStatus);
    _putNonEmpty(query, 'keyword', keyword);
    return _apiClient.getBytes(
      _path('/api/special-orders/export.xlsx', query),
      token: _token,
      defaultFileName: 'special-orders.xlsx',
    );
  }

  Future<Map<String, dynamic>> getSpecialOrderPrintData(String id) async {
    final payload = await _apiClient.getJson(
      '/api/special-orders/${Uri.encodeComponent(id)}/print-data',
      token: _token,
    );
    return _map(_data(payload)['printData']);
  }

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
    String? tastingRoomNo,
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
      tastingRoomNo: tastingRoomNo,
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
    String? tastingRoomNo,
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
      tastingRoomNo: tastingRoomNo,
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
    String? tastingRoomNo,
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
    _putNonEmpty(query, 'tastingRoomNo', tastingRoomNo);
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
    bool? isActive,
    int limit = 50,
  }) async {
    final query = <String, String>{'limit': '$limit'};
    if (keyword != null && keyword.trim().isNotEmpty) {
      query['keyword'] = keyword.trim();
    }
    if (isActive != null) {
      query['isActive'] = '$isActive';
    }

    return _withGuideApiError(() async {
      final payload = await _apiClient.getJson(
        _path('/api/guides', query),
        token: _token,
      );
      final data = _data(payload);
      return _list(data['guides'])
          .map((item) => GuideRecord.fromJson(item))
          .toList();
    });
  }

  Future<GuidePage> listGuidesPage({
    int page = 1,
    int pageSize = 20,
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
    return _withGuideApiError(() async {
      final payload = await _apiClient.getJson(
        _path('/api/guides', query),
        token: _token,
      );
      return GuidePage.fromJson(_data(payload));
    });
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

  Future<SerializedInventoryPage> listSerializedInventory({
    int page = 1,
    int pageSize = 100,
    String? moutaiName,
    String? logisticsCode,
    DateTime? factoryDate,
    String? productionBatch,
    String? batchSerialNo,
    String? status,
    String? orderNo,
    String? warehouseId,
    bool includeCost = true,
  }) async {
    final query = <String, String>{
      'page': '$page',
      'pageSize': '$pageSize',
    };
    _putNonEmpty(query, 'moutaiName', moutaiName);
    _putNonEmpty(query, 'logisticsCode', logisticsCode);
    if (factoryDate != null) {
      query['factoryDate'] = formatDate(factoryDate);
    }
    _putNonEmpty(query, 'productionBatch', productionBatch);
    _putNonEmpty(query, 'batchSerialNo', batchSerialNo);
    _putNonEmpty(query, 'status', status);
    _putNonEmpty(query, 'orderNo', orderNo);
    _putNonEmpty(query, 'warehouseId', warehouseId);
    final payload = await _apiClient.getJson(
      _path('/api/serialized-inventory', query),
      token: _token,
    );
    return SerializedInventoryPage.fromJson(
      _data(payload),
      includeCost: includeCost,
    );
  }

  Future<List<SerializedInventoryUnitRecord>> listAvailableSerializedInventory({
    required String productId,
    required String warehouseId,
    String? query,
  }) async {
    final parameters = <String, String>{
      'productId': productId,
      'warehouseId': warehouseId,
    };
    _putNonEmpty(parameters, 'query', query);
    final payload = await _apiClient.getJson(
      _path('/api/serialized-inventory/available', parameters),
      token: _token,
    );
    return _list(_data(payload)['units'])
        .map(
          (item) => SerializedInventoryUnitRecord.fromJson(
            item,
            includeCost: false,
          ),
        )
        .toList();
  }

  Future<List<SerializedInventoryUnitRecord>> createSerializedInventoryUnits(
      Map<String, dynamic> body) async {
    final payload = await _apiClient.postJson(
      '/api/serialized-inventory/batch',
      body: body,
      token: _token,
    );
    return _list(_data(payload)['units'])
        .map(SerializedInventoryUnitRecord.fromJson)
        .toList();
  }

  Future<SerializedInventoryUnitRecord> updateSerializedInventoryUnit(
    String id,
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/serialized-inventory/${Uri.encodeComponent(id)}',
      body: body,
      token: _token,
    );
    return SerializedInventoryUnitRecord.fromJson(
      _map(_data(payload)['unit']),
    );
  }

  Future<SerializedInventoryUnitRecord> correctSerializedInventoryUnit(
    String id,
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/serialized-inventory/${Uri.encodeComponent(id)}/correction',
      body: body,
      token: _token,
    );
    return SerializedInventoryUnitRecord.fromJson(
      _map(_data(payload)['unit']),
    );
  }

  Future<DownloadedFile> exportMoutaiLogisticsDocx(
    List<String> unitIds,
  ) {
    return _apiClient.postBytes(
      '/api/serialized-inventory/export-moutai-logistics-docx',
      body: {'unitIds': unitIds},
      token: _token,
      defaultFileName: '茅台物流单.docx',
    );
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
    return _withGuideApiError(() async {
      final payload = await _apiClient.postJson(
        '/api/guides',
        body: body,
        token: _token,
      );
      return GuideRecord.fromJson(_map(_data(payload)['guide']));
    });
  }

  Future<GuideRecord> getGuide(String id) async {
    return _withGuideApiError(() async {
      final payload = await _apiClient.getJson(
        '/api/guides/$id',
        token: _token,
      );
      return GuideRecord.fromJson(_map(_data(payload)['guide']));
    });
  }

  Future<GuideRecord> updateGuide(
    String id,
    Map<String, dynamic> body,
  ) async {
    return _withGuideApiError(() async {
      final payload = await _apiClient.patchJson(
        '/api/guides/$id',
        body: body,
        token: _token,
      );
      return GuideRecord.fromJson(_map(_data(payload)['guide']));
    });
  }

  Future<GuideRecord> disableGuide(String id) async {
    return _setGuideActive(id, false);
  }

  Future<GuideRecord> enableGuide(String id) async {
    return _setGuideActive(id, true);
  }

  Future<GuideRecord> _setGuideActive(String id, bool isActive) async {
    return _withGuideApiError(() async {
      final action = isActive ? 'enable' : 'disable';
      final payload = await _apiClient.postJson(
        '/api/guides/$id/$action',
        token: _token,
      );
      return GuideRecord.fromJson(_map(_data(payload)['guide']));
    });
  }

  Future<T> _withGuideApiError<T>(Future<T> Function() request) async {
    try {
      return await request();
    } on ApiException catch (error) {
      throw ApiException(
        statusCode: error.statusCode,
        code: error.code,
        message: guideApiErrorMessage(error),
      );
    }
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

  Future<TravelGroupRecord> setTravelGroupNotEntered(
    String id,
    bool confirmed,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/travel-groups/$id/not-entered',
      body: {'confirmed': confirmed},
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
      maxFileSizeBytes: fileSecurityMaxFileBytes,
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

  Future<List<PaymentMethodRecord>> listPaymentMethods({
    bool includeInactive = false,
  }) async {
    final payload = await _apiClient.getJson(
      includeInactive
          ? _path('/api/payment-methods', const {'includeInactive': 'true'})
          : '/api/payment-methods',
      token: _token,
    );
    return _list(_data(payload)['paymentMethods'])
        .map(PaymentMethodRecord.fromJson)
        .toList();
  }

  Future<PaymentMethodRecord> createPaymentMethod(
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.postJson(
      '/api/payment-methods',
      body: body,
      token: _token,
    );
    return PaymentMethodRecord.fromJson(
      _map(_data(payload)['paymentMethod']),
    );
  }

  Future<PaymentMethodRecord> updatePaymentMethod(
    String id,
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/payment-methods/${Uri.encodeComponent(id)}',
      body: body,
      token: _token,
    );
    return PaymentMethodRecord.fromJson(
      _map(_data(payload)['paymentMethod']),
    );
  }

  Future<PaymentMethodRecord> enablePaymentMethod(String id) async {
    final payload = await _apiClient.patchJson(
      '/api/payment-methods/${Uri.encodeComponent(id)}/enable',
      body: const <String, dynamic>{},
      token: _token,
    );
    return PaymentMethodRecord.fromJson(
      _map(_data(payload)['paymentMethod']),
    );
  }

  Future<PaymentMethodRecord> disablePaymentMethod(String id) async {
    final payload = await _apiClient.patchJson(
      '/api/payment-methods/${Uri.encodeComponent(id)}/disable',
      body: const <String, dynamic>{},
      token: _token,
    );
    return PaymentMethodRecord.fromJson(
      _map(_data(payload)['paymentMethod']),
    );
  }

  Future<PaymentMethodRecord> setDefaultPaymentMethod(String id) async {
    final payload = await _apiClient.patchJson(
      '/api/payment-methods/${Uri.encodeComponent(id)}/default',
      body: const <String, dynamic>{},
      token: _token,
    );
    return PaymentMethodRecord.fromJson(
      _map(_data(payload)['paymentMethod']),
    );
  }

  Future<List<PaymentMethodRecord>> sortPaymentMethods(
    List<Map<String, dynamic>> items,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/payment-methods/sort-order',
      body: {'items': items},
      token: _token,
    );
    return _list(_data(payload)['paymentMethods'])
        .map(PaymentMethodRecord.fromJson)
        .toList();
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
    DateTime? shippingDateStart,
    DateTime? shippingDateEnd,
    String? shippingDateSort,
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
      shippingDateStart: shippingDateStart,
      shippingDateEnd: shippingDateEnd,
      shippingDateSort: shippingDateSort,
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
    DateTime? shippingDateStart,
    DateTime? shippingDateEnd,
    String? shippingDateSort,
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
      shippingDateStart: shippingDateStart,
      shippingDateEnd: shippingDateEnd,
      shippingDateSort: shippingDateSort,
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
    DateTime? shippingDateStart,
    DateTime? shippingDateEnd,
    String? shippingDateSort,
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
    if (shippingDateStart != null) {
      queryParameters['shippingDateFrom'] = formatDate(shippingDateStart);
    }
    if (shippingDateEnd != null) {
      queryParameters['shippingDateTo'] = formatDate(shippingDateEnd);
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
    _putNonEmpty(queryParameters, 'shippingDateSort', shippingDateSort);
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

  Future<SalesOrderMutationResult> createSalesOrder(
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.postJson(
      '/api/sales-orders',
      body: body,
      token: _token,
    );
    return SalesOrderMutationResult.fromJson(_data(payload));
  }

  Future<SalesOrderAssignmentOptions> getSalesOrderAssignmentOptions(
    DateTime orderDate,
  ) async {
    final payload = await _apiClient.getJson(
      _path('/api/sales-orders/assignment-options', {
        'date': formatDate(orderDate),
      }),
      token: _token,
    );
    return SalesOrderAssignmentOptions.fromJson(
      _map(_data(payload)['assignmentOptions']),
    );
  }

  Future<SalesOrderRecord> updateSalesOrder(
    String id,
    Map<String, dynamic> body,
  ) async {
    return (await updateSalesOrderWithRecalculation(id, body)).salesOrder;
  }

  Future<SalesOrderMutationResult> updateSalesOrderWithRecalculation(
    String id,
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/sales-orders/$id',
      body: body,
      token: _token,
    );
    return SalesOrderMutationResult.fromJson(_data(payload));
  }

  Future<SalesOrderRecord> replaceSalesOrderPaymentDetails(
    String id,
    List<Map<String, dynamic>> paymentDetails,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/sales-orders/${Uri.encodeComponent(id)}/payment-details',
      body: {'paymentDetails': paymentDetails},
      token: _token,
    );
    return SalesOrderRecord.fromJson(_map(_data(payload)['salesOrder']));
  }

  Future<SalesOrderRecord> setSalesOrderCompletion(
    String id,
    bool completed,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/sales-orders/${Uri.encodeComponent(id)}/completion',
      body: {'completed': completed},
      token: _token,
    );
    return SalesOrderRecord.fromJson(_map(_data(payload)['salesOrder']));
  }

  Future<SalesOrderRecord> completeSalesOrder(String id) {
    return setSalesOrderCompletion(id, true);
  }

  Future<SalesOrderRecord> setSalesOrderPaymentDetailsLock(
    String id,
    bool locked,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/sales-orders/${Uri.encodeComponent(id)}/payment-details-lock',
      body: {'locked': locked},
      token: _token,
    );
    return SalesOrderRecord.fromJson(_map(_data(payload)['salesOrder']));
  }

  Future<SalesOrderRecord> lockSalesOrderPaymentDetails(String id) {
    return setSalesOrderPaymentDetailsLock(id, true);
  }

  Future<SalesOrderRecord> unlockSalesOrderPaymentDetails(String id) {
    return setSalesOrderPaymentDetailsLock(id, false);
  }

  Future<SalesOrderRecord> confirmCollectOnDeliveryPayment(
    String orderId,
    String detailId,
    bool confirmed,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/sales-orders/${Uri.encodeComponent(orderId)}/payment-details/${Uri.encodeComponent(detailId)}/agency-confirmation',
      body: {'confirmed': confirmed},
      token: _token,
    );
    return SalesOrderRecord.fromJson(_map(_data(payload)['salesOrder']));
  }

  Future<SalesOrderRecord> confirmAgencyCollectionPayment(
    String orderId,
    String detailId,
    bool confirmed,
  ) {
    return confirmCollectOnDeliveryPayment(
      orderId,
      detailId,
      confirmed,
    );
  }

  Future<SalesOrderRecord> updateSalesOrderPointsDestination(
    String id, {
    required int personalAmountCents,
    String? guideId,
    String? dailyRebateRate,
    String? monthlyRebateRate,
  }) async {
    final payload = await _apiClient.patchJson(
      '/api/sales-orders/${Uri.encodeComponent(id)}/points-destination',
      body: {
        'personalAmountCents': personalAmountCents,
        if (guideId != null) 'guideId': guideId,
        if (dailyRebateRate != null) 'dailyRebateRate': dailyRebateRate,
        if (monthlyRebateRate != null) 'monthlyRebateRate': monthlyRebateRate,
      },
      token: _token,
    );
    return SalesOrderRecord.fromJson(
      _map(_data(payload)['salesOrder']),
    );
  }

  Future<SalesOrderRecord> salesEditSalesOrder(
    String id,
    Map<String, dynamic> body,
  ) async {
    return (await salesEditSalesOrderWithRecalculation(id, body)).salesOrder;
  }

  Future<SalesOrderMutationResult> salesEditSalesOrderWithRecalculation(
    String id,
    Map<String, dynamic> body,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/sales-orders/$id/sales-edit',
      body: body,
      token: _token,
    );
    return SalesOrderMutationResult.fromJson(_data(payload));
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

  Future<SalesOrderRecord> updateSalesOrderShippingDate(
    String id, {
    required String shippingDate,
    String? reason,
  }) async {
    final payload = await _apiClient.patchJson(
      '/api/sales-orders/${Uri.encodeComponent(id)}/shipping-date',
      body: {
        'shippingDate': shippingDate,
        if (reason != null && reason.trim().isNotEmpty) 'reason': reason.trim(),
      },
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
    bool? unfinished,
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
      unfinished: unfinished,
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
    bool? unfinished,
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
    if (unfinished != null) {
      queryParameters['unfinished'] = '$unfinished';
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
    String? refundPaymentDetailId,
  }) async {
    final payload = await _apiClient.postMultipartFiles(
      '/api/after-sales-orders/$id/finance-refund-confirm',
      files: files,
      fields: {
        if (refundPaymentDetailId?.trim().isNotEmpty == true)
          'refundPaymentDetailId': refundPaymentDetailId!.trim(),
      },
      maxFileSizeBytes: fileSecurityMaxFileBytes,
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

  Future<SalesOrderRecord> changeWarehouseOrderFulfillment(
    String orderId,
    String warehouseId,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/warehouse/orders/${Uri.encodeComponent(orderId)}/packing',
      body: {'fulfillmentWarehouseId': warehouseId},
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
      _withRecalculation(_data(payload), 'commissionRule'),
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
      _withRecalculation(_data(payload), 'commissionRule'),
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
    final data = _data(payload);
    return AgencyDeductionRuleRecord.fromJson(
      _withRecalculation(data, 'agencyDeductionRule'),
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
    final data = _data(payload);
    return AgencyDeductionRuleRecord.fromJson(
      _withRecalculation(data, 'agencyDeductionRule'),
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
    final data = _data(payload);
    return Stage7RuleImportResult.fromJson(
      _withRecalculation(data, 'importResult'),
    );
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
    final data = _data(payload);
    return AgencyRebateRuleRecord.fromJson(
      _withRecalculation(data, 'agencyRebateRule'),
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
    final data = _data(payload);
    return AgencyRebateRuleRecord.fromJson(
      _withRecalculation(data, 'agencyRebateRule'),
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
    final data = _data(payload);
    return Stage7RuleImportResult.fromJson(
      _withRecalculation(data, 'importResult'),
    );
  }

  Future<CommissionRecalculationResult> recalculateCommissions(
    String salesOrderId, {
    bool agencyOnly = false,
  }) async {
    final payload = await _apiClient.postJson(
      '/api/commission-records/recalculate',
      body: {
        'salesOrderId': salesOrderId,
        if (agencyOnly) 'agencyOnly': true,
      },
      token: _token,
    );
    return CommissionRecalculationResult.fromJson(_data(payload));
  }

  Future<CommissionRecalculationResult> recalculateTravelGroups(
    List<String> travelGroupIds,
  ) async {
    final payload = await _apiClient.postJson(
      '/api/commission-records/recalculate',
      body: {
        'travelGroupIds': travelGroupIds,
        'agencyOnly': true,
        'allowLatestAgencyRebateRuleFallback': true,
      },
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

  Future<CommissionRecord> saveSalesOrderTasterCommission({
    required String salesOrderId,
    required int amountCents,
    String? recordId,
  }) async {
    if (salesOrderId.trim().isEmpty) {
      throw ArgumentError.value(
        salesOrderId,
        'salesOrderId',
        'salesOrderId cannot be blank',
      );
    }
    if (amountCents < 0 || amountCents > 2147483647) {
      throw ArgumentError.value(
        amountCents,
        'amountCents',
        'amountCents is outside the supported range',
      );
    }
    return updateTasterCommissionManualAmount(
      recordId?.trim().isNotEmpty == true ? recordId!.trim() : 'new',
      {
        'salesOrderId': salesOrderId.trim(),
        'amountCents': amountCents,
      },
    );
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

  Future<List<TravelGroupFinanceSummaryRecord>> listFinanceRows({
    int limit = 100,
    DateTime? start,
    DateTime? end,
    String? travelGroupId,
    String? agencyName,
    String? guideName,
    String? query,
  }) async {
    final payload = await _apiClient.getJson(
      _path(
        '/api/travel-group-finance-summaries/finance-rows',
        _travelGroupFinanceSummaryQueryParameters(
          limit: limit,
          start: start,
          end: end,
          travelGroupId: travelGroupId,
          agencyName: agencyName,
          guideName: guideName,
          query: query,
        ),
      ),
      token: _token,
    );
    return _list(_data(payload)['financeRows'])
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

  Future<TravelGroupFinanceSummaryRecord> updateAgencyDeduction(
    String travelGroupId,
    int totalAgencyDeductionCents,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/travel-group-finance-summaries/$travelGroupId/'
      'agency-deduction',
      body: {
        'totalAgencyDeductionCents': totalAgencyDeductionCents,
      },
      token: _token,
    );
    return TravelGroupFinanceSummaryRecord.fromJson(
      _map(_data(payload)['travelGroupFinanceSummary']),
    );
  }

  Future<AfterSalesOrderRecord> updateAfterSalesAgencyDeduction(
    String afterSalesOrderId,
    int agencyDeductionAdjustmentCents,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/after-sales-orders/$afterSalesOrderId/agency-deduction',
      body: {
        'agencyDeductionAdjustmentCents': agencyDeductionAdjustmentCents,
      },
      token: _token,
    );
    return AfterSalesOrderRecord.fromJson(
      _map(_data(payload)['afterSalesOrder']),
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

  Future<DownloadedFile> downloadSelectedTravelGroupFinanceSummariesExcel(
    List<String> travelGroupIds,
  ) {
    final normalizedIds = travelGroupIds
        .map((id) => id.trim())
        .where((id) => id.isNotEmpty)
        .toSet()
        .toList();
    if (normalizedIds.isEmpty) {
      throw ArgumentError.value(
        travelGroupIds,
        'travelGroupIds',
        'At least one non-empty travel group ID is required.',
      );
    }
    return _apiClient.postBytes(
      '/api/travel-group-finance-summaries/export',
      body: {'travelGroupIds': normalizedIds},
      token: _token,
      defaultFileName: 'points-table-selected.xlsx',
    );
  }

  Future<DownloadedFile> downloadFinanceRowsExcel({
    int? limit,
    DateTime? start,
    DateTime? end,
    String? agencyName,
    String? guideName,
    String? query,
  }) {
    return _apiClient.getBytes(
      _path(
        '/api/travel-group-finance-summaries/finance-rows/export',
        _travelGroupFinanceSummaryQueryParameters(
          limit: limit,
          start: start,
          end: end,
          agencyName: agencyName,
          guideName: guideName,
          query: query,
        ),
      ),
      token: _token,
      defaultFileName: 'finance-rows.xlsx',
    );
  }

  Future<DownloadedFile> downloadSelectedFinanceRowsExcel(
    List<String> financeRowIds,
  ) {
    final normalizedIds = financeRowIds
        .map((id) => id.trim())
        .where((id) => id.isNotEmpty)
        .toSet()
        .toList();
    if (normalizedIds.isEmpty) {
      throw ArgumentError.value(
        financeRowIds,
        'financeRowIds',
        'At least one non-empty finance row ID is required.',
      );
    }
    return _apiClient.postBytes(
      '/api/travel-group-finance-summaries/finance-rows/export',
      body: {'financeRowIds': normalizedIds},
      token: _token,
      defaultFileName: 'finance-rows-selected.xlsx',
    );
  }

  Future<List<GuidePointsSummaryRecord>> listGuidePointsSummaries({
    int limit = 100,
    DateTime? start,
    DateTime? end,
    String? travelGroupId,
    String? guideId,
    String? guideName,
    String? query,
  }) async {
    final parameters = <String, String>{'limit': '$limit'};
    if (start != null) {
      parameters['dateFrom'] = formatDate(start);
    }
    if (end != null) {
      parameters['dateTo'] = formatDate(end);
    }
    _putNonEmpty(parameters, 'travelGroupId', travelGroupId);
    _putNonEmpty(parameters, 'guideId', guideId);
    _putNonEmpty(parameters, 'guideName', guideName);
    _putNonEmpty(parameters, 'query', query);
    final payload = await _apiClient.getJson(
      _path('/api/guide-points-summaries', parameters),
      token: _token,
    );
    return _list(_data(payload)['guidePointsSummaries'])
        .map(GuidePointsSummaryRecord.fromJson)
        .toList();
  }

  Future<GuidePointsSummaryRecord> getGuidePointsSummary(
    String id,
  ) async {
    final payload = await _apiClient.getJson(
      '/api/guide-points-summaries/${Uri.encodeComponent(id)}',
      token: _token,
    );
    return GuidePointsSummaryRecord.fromJson(
      _map(_data(payload)['guidePointsSummary']),
    );
  }

  Future<GuidePointsSummaryRecord?> updateGuidePersonalOrderRates(
    String orderId, {
    String? dailyRebateRate,
    String? monthlyRebateRate,
  }) async {
    final payload = await _apiClient.patchJson(
      '/api/guide-points-summaries/orders/'
      '${Uri.encodeComponent(orderId)}/rates',
      body: {
        if (dailyRebateRate != null) 'dailyRebateRate': dailyRebateRate,
        if (monthlyRebateRate != null) 'monthlyRebateRate': monthlyRebateRate,
      },
      token: _token,
    );
    final value = _data(payload)['guidePointsSummary'];
    return value is Map ? GuidePointsSummaryRecord.fromJson(_map(value)) : null;
  }

  Future<GuidePointsSummaryRecord> setGuideDailyPointsPaid(
    String id,
    bool isPaid,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/guide-points-summaries/${Uri.encodeComponent(id)}/'
      'daily-points-paid',
      body: {'isPaid': isPaid},
      token: _token,
    );
    return GuidePointsSummaryRecord.fromJson(
      _map(_data(payload)['guidePointsSummary']),
    );
  }

  Future<GuidePointsSummaryRecord> setGuideMonthlyPointsPaid(
    String id,
    bool isPaid,
  ) async {
    final payload = await _apiClient.patchJson(
      '/api/guide-points-summaries/${Uri.encodeComponent(id)}/'
      'monthly-points-paid',
      body: {'isPaid': isPaid},
      token: _token,
    );
    return GuidePointsSummaryRecord.fromJson(
      _map(_data(payload)['guidePointsSummary']),
    );
  }

  Future<DownloadedFile> downloadGuidePointsSummariesExcel({
    DateTime? start,
    DateTime? end,
    String? guideId,
    String? query,
  }) {
    final parameters = <String, String>{};
    if (start != null) {
      parameters['dateFrom'] = formatDate(start);
    }
    if (end != null) {
      parameters['dateTo'] = formatDate(end);
    }
    _putNonEmpty(parameters, 'guideId', guideId);
    _putNonEmpty(parameters, 'query', query);
    return _apiClient.getBytes(
      _path('/api/guide-points-summaries/export.xlsx', parameters),
      token: _token,
      defaultFileName: 'guide-points.xlsx',
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

  Future<List<SalesPerformanceRecord>> listSalesPerformance({
    String? preset,
    DateTime? dateFrom,
    DateTime? dateTo,
    String? sortBy,
    String? sortDirection,
  }) async {
    final payload = await _apiClient.getJson(
      _path(
        '/api/analytics/sales-performance',
        _analyticsQueryParameters(
          preset: preset,
          dateFrom: dateFrom,
          dateTo: dateTo,
          sortBy: sortBy,
          sortDirection: sortDirection,
        ),
      ),
      token: _token,
    );
    return _list(_data(payload)['salesPerformance'])
        .map(SalesPerformanceRecord.fromJson)
        .toList();
  }

  Future<SalesPerformanceDetail> getSalesPerformanceDetail(
    String? salesUserId, {
    String? preset,
    DateTime? dateFrom,
    DateTime? dateTo,
    String? sortBy,
    String? sortDirection,
  }) async {
    final target = salesUserId?.trim().isNotEmpty == true
        ? salesUserId!.trim()
        : 'unassigned';
    final payload = await _apiClient.getJson(
      _path(
        '/api/analytics/sales-performance/${Uri.encodeComponent(target)}',
        _analyticsQueryParameters(
          preset: preset,
          dateFrom: dateFrom,
          dateTo: dateTo,
          sortBy: sortBy,
          sortDirection: sortDirection,
        ),
      ),
      token: _token,
    );
    return SalesPerformanceDetail.fromJson(_data(payload));
  }

  Future<DownloadedFile> exportSalesPerformance({
    String? preset,
    DateTime? dateFrom,
    DateTime? dateTo,
    String? sortBy,
    String? sortDirection,
  }) {
    return _apiClient.getBytes(
      _path(
        '/api/analytics/sales-performance/export',
        _analyticsQueryParameters(
          preset: preset,
          dateFrom: dateFrom,
          dateTo: dateTo,
          sortBy: sortBy,
          sortDirection: sortDirection,
        ),
      ),
      token: _token,
      defaultFileName: 'analytics-sales-performance.xlsx',
    );
  }

  Future<ProfitAnalysisResponse> getTravelGroupProfits({
    String? preset,
    DateTime? dateFrom,
    DateTime? dateTo,
    String? query,
    String? status,
    String? sortBy,
    String? sortDirection,
    int? page,
    int? pageSize,
  }) async {
    final payload = await _apiClient.getJson(
      _path(
        '/api/analytics/travel-group-profits',
        _analyticsQueryParameters(
          preset: preset,
          dateFrom: dateFrom,
          dateTo: dateTo,
          query: query,
          status: status,
          sortBy: sortBy,
          sortDirection: sortDirection,
          page: page,
          pageSize: pageSize,
        ),
      ),
      token: _token,
    );
    return ProfitAnalysisResponse.fromJson(_data(payload));
  }

  Future<DownloadedFile> exportTravelGroupProfits({
    String? preset,
    DateTime? dateFrom,
    DateTime? dateTo,
    String? query,
    String? status,
    String? sortBy,
    String? sortDirection,
  }) {
    return _apiClient.getBytes(
      _path(
        '/api/analytics/travel-group-profits/export',
        _analyticsQueryParameters(
          preset: preset,
          dateFrom: dateFrom,
          dateTo: dateTo,
          query: query,
          status: status,
          sortBy: sortBy,
          sortDirection: sortDirection,
        ),
      ),
      token: _token,
      defaultFileName: 'travel-group-profits.xlsx',
    );
  }

  Future<DailyLossProfitResponse> getDailyLossProfits({
    String? preset,
    DateTime? dateFrom,
    DateTime? dateTo,
    int? page,
    int? pageSize,
  }) async {
    final payload = await _apiClient.getJson(
      _path(
        '/api/analytics/daily-loss-profits',
        _analyticsQueryParameters(
          preset: preset,
          dateFrom: dateFrom,
          dateTo: dateTo,
          page: page,
          pageSize: pageSize,
        ),
      ),
      token: _token,
    );
    return DailyLossProfitResponse.fromJson(_data(payload));
  }

  Future<DownloadedFile> exportDailyLossProfits({
    String? preset,
    DateTime? dateFrom,
    DateTime? dateTo,
  }) {
    return _apiClient.getBytes(
      _path(
        '/api/analytics/daily-loss-profits/export',
        _analyticsQueryParameters(
          preset: preset,
          dateFrom: dateFrom,
          dateTo: dateTo,
        ),
      ),
      token: _token,
      defaultFileName: 'daily-loss-profit.xlsx',
    );
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
    String? query,
    String? status,
    String? sortBy,
    String? sortDirection,
    int? limit,
    int? page,
    int? pageSize,
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
    _putNonEmpty(queryParameters, 'query', query);
    _putNonEmpty(queryParameters, 'status', status);
    _putNonEmpty(queryParameters, 'sortBy', sortBy);
    _putNonEmpty(queryParameters, 'sortDirection', sortDirection);
    if (limit != null) {
      queryParameters['limit'] = '$limit';
    }
    if (page != null) {
      queryParameters['page'] = '$page';
    }
    if (pageSize != null) {
      queryParameters['pageSize'] = '$pageSize';
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
    required this.remarks,
    required this.isActive,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String name;
  final String phone;
  final String? remarks;
  final bool isActive;
  final String? createdAt;
  final String? updatedAt;

  factory GuideRecord.fromJson(Map<String, dynamic> json) {
    return GuideRecord(
      id: '${json['id'] ?? ''}',
      name: '${json['name'] ?? ''}',
      phone: '${json['phone'] ?? ''}',
      remarks: _stringOrNull(json['remarks']),
      isActive: _boolValue(json['isActive'] ?? true),
      createdAt: _stringOrNull(json['createdAt']),
      updatedAt: _stringOrNull(json['updatedAt']),
    );
  }
}

class AfterSalesOrderItemRecord {
  const AfterSalesOrderItemRecord({
    required this.id,
    required this.afterSalesOrderId,
    required this.sourceSalesOrderItemId,
    required this.productId,
    required this.productName,
    required this.unit,
    required this.quantity,
    required this.originalUnitPriceCents,
    required this.subtotalCents,
    required this.returnRequired,
    required this.expectedReturnQty,
    required this.postedReceivedQty,
    required this.remainingReturnQty,
    required this.returnProgressStatus,
    required this.isHistoricalPlaceholder,
    required this.notes,
    required this.sortOrder,
  });

  final String id;
  final String afterSalesOrderId;
  final String? sourceSalesOrderItemId;
  final String? productId;
  final String productName;
  final String? unit;
  final int quantity;
  final int originalUnitPriceCents;
  final int subtotalCents;
  final bool returnRequired;
  final int expectedReturnQty;
  final int postedReceivedQty;
  final int remainingReturnQty;
  final String returnProgressStatus;
  final bool isHistoricalPlaceholder;
  final String? notes;
  final int sortOrder;

  factory AfterSalesOrderItemRecord.fromJson(Map<String, dynamic> json) {
    return AfterSalesOrderItemRecord(
      id: '${json['id'] ?? ''}',
      afterSalesOrderId: '${json['afterSalesOrderId'] ?? ''}',
      sourceSalesOrderItemId: _stringOrNull(json['sourceSalesOrderItemId']),
      productId: _stringOrNull(json['productId']),
      productName: '${json['productName'] ?? ''}',
      unit: _stringOrNull(json['unit']),
      quantity: _intValue(json['quantity']),
      originalUnitPriceCents: _intValue(json['originalUnitPriceCents']),
      subtotalCents: _intValue(json['subtotalCents']),
      returnRequired: _boolValue(json['returnRequired']),
      expectedReturnQty: _intValue(json['expectedReturnQty']),
      postedReceivedQty: _intValue(json['postedReceivedQty']),
      remainingReturnQty: json.containsKey('remainingReturnQty')
          ? _intValue(json['remainingReturnQty'])
          : (_intValue(json['expectedReturnQty']) -
                  _intValue(json['postedReceivedQty']))
              .clamp(0, 1 << 31)
              .toInt(),
      returnProgressStatus:
          '${json['returnProgressStatus'] ?? 'not_required'}'.toLowerCase(),
      isHistoricalPlaceholder: _boolValue(json['isHistoricalPlaceholder']),
      notes: _stringOrNull(json['notes']),
      sortOrder: _intValue(json['sortOrder']),
    );
  }
}

class GuidePage {
  const GuidePage({
    required this.guides,
    required this.page,
    required this.pageSize,
    required this.total,
    required this.totalPages,
  });

  final List<GuideRecord> guides;
  final int page;
  final int pageSize;
  final int total;
  final int totalPages;

  factory GuidePage.fromJson(Map<String, dynamic> json) {
    final pagination = _map(json['pagination']);
    return GuidePage(
      guides: _list(json['guides']).map(GuideRecord.fromJson).toList(),
      page: _intValue(pagination['page']),
      pageSize: _intValue(pagination['pageSize']),
      total: _intValue(pagination['total']),
      totalPages: _intValue(pagination['totalPages']),
    );
  }
}

String guideApiErrorMessage(ApiException error) {
  switch (error.code) {
    case 'GUIDE_PHONE_EXISTS':
      return '该手机号已被其他导游使用。';
    case 'GUIDE_DISABLED':
      return '该手机号对应的导游已停用，请在列表中找到该导游并点击“恢复”。';
    case 'GUIDE_NOT_FOUND':
      return '导游不存在或已被移除。';
    case 'PERMISSION_DENIED':
      return '当前账号没有导游管理权限。';
    case 'VALIDATION_FAILED':
      return '请检查导游姓名、手机号和备注是否填写正确。';
    default:
      return error.message;
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

class TravelGroupUserSnapshotRecord {
  const TravelGroupUserSnapshotRecord({
    required this.id,
    required this.name,
    required this.username,
  });

  final String? id;
  final String? name;
  final String? username;

  factory TravelGroupUserSnapshotRecord.fromJson(
    Map<String, dynamic> json,
  ) {
    return TravelGroupUserSnapshotRecord(
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
    required this.adultCount,
    required this.childCount,
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
    this.entryStatus = 'pending_entry',
    this.notEnteredConfirmedAt,
    this.notEnteredConfirmedById,
    this.notEnteredConfirmedBy,
    required this.groupType,
    required this.wineDetails,
    required this.departureTime,
    required this.remarks,
    required this.status,
    required this.parkingFeeCents,
    required this.cigaretteFeeCents,
    this.lossStatus = 'PENDING',
    this.lossConfirmedAt,
    this.lossConfirmedById,
    this.lossConfirmedByName,
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
    this.tasterEditCount = 0,
    this.tasterEditLimit,
    this.tasterEditRemaining,
    this.tasterEditUnlimited = true,
    this.canEditByCurrentUser = false,
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
  final int adultCount;
  final int childCount;
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
  final String entryStatus;
  final String? notEnteredConfirmedAt;
  final String? notEnteredConfirmedById;
  final TravelGroupUserSnapshotRecord? notEnteredConfirmedBy;
  final String? groupType;
  final String? wineDetails;
  final String? departureTime;
  final String? remarks;
  final String status;
  final int parkingFeeCents;
  final int? cigaretteFeeCents;
  final String lossStatus;
  final String? lossConfirmedAt;
  final String? lossConfirmedById;
  final String? lossConfirmedByName;
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
  final int tasterEditCount;
  final int? tasterEditLimit;
  final int? tasterEditRemaining;
  final bool tasterEditUnlimited;
  final bool canEditByCurrentUser;
  final List<TravelGroupTastingItemRecord> tastingItems;
  final List<TravelGroupOrderRecord> salesOrders;
  final TravelGroupOrderSummary orderSummary;
  final String? pendingStatus;
  final List<String> pendingReasons;
  final String? createdAt;
  final String? updatedAt;

  factory TravelGroupRecord.fromJson(Map<String, dynamic> json) {
    final guestCount = _intValue(json['guestCount']);
    final adultCount = json.containsKey('adultCount')
        ? _intValue(json['adultCount'])
        : guestCount;
    final childCount =
        json.containsKey('childCount') ? _intValue(json['childCount']) : 0;
    final orderSummary = _map(json['orderSummary']);
    final liaisonTasterId = _stringOrNull(json['liaisonTasterId']);
    final liaisonTasterName = _stringOrNull(json['liaisonTasterName']);
    final arrivalTime = _stringOrNull(json['arrivalTime']);
    final notEnteredConfirmedAt = _stringOrNull(json['notEnteredConfirmedAt']);
    final notEnteredConfirmedByJson = _map(json['notEnteredConfirmedBy']);
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
      adultCount: adultCount,
      childCount: childCount,
      guestCount: guestCount,
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
      arrivalTime: arrivalTime,
      entryStatus: _travelGroupEntryStatus(
        json['entryStatus'],
        arrivalTime: arrivalTime,
        notEnteredConfirmedAt: notEnteredConfirmedAt,
      ),
      notEnteredConfirmedAt: notEnteredConfirmedAt,
      notEnteredConfirmedById: _stringOrNull(json['notEnteredConfirmedById']),
      notEnteredConfirmedBy: notEnteredConfirmedByJson.isEmpty
          ? null
          : TravelGroupUserSnapshotRecord.fromJson(
              notEnteredConfirmedByJson,
            ),
      groupType: _stringOrNull(json['groupType']),
      wineDetails: _stringOrNull(json['wineDetails']),
      departureTime: _stringOrNull(json['departureTime']),
      remarks: _stringOrNull(json['remarks']),
      status: '${json['status'] ?? 'unmarked'}',
      parkingFeeCents: json.containsKey('parkingFeeCents')
          ? _intValue(json['parkingFeeCents'])
          : 500,
      cigaretteFeeCents: json['cigaretteFeeCents'] == null
          ? null
          : _intValue(json['cigaretteFeeCents']),
      lossStatus: '${json['lossStatus'] ?? 'PENDING'}'.toUpperCase(),
      lossConfirmedAt: _stringOrNull(json['lossConfirmedAt']),
      lossConfirmedById: _stringOrNull(json['lossConfirmedById']),
      lossConfirmedByName: _stringOrNull(_map(json['lossConfirmedBy'])['name']),
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
      tasterEditCount: _intValue(json['tasterEditCount']),
      tasterEditLimit: json['tasterEditLimit'] == null
          ? null
          : _intValue(json['tasterEditLimit']),
      tasterEditRemaining: json['tasterEditRemaining'] == null
          ? null
          : _intValue(json['tasterEditRemaining']),
      tasterEditUnlimited: json.containsKey('tasterEditUnlimited')
          ? _boolValue(json['tasterEditUnlimited'])
          : json['tasterEditLimit'] == null &&
              json['tasterEditRemaining'] == null,
      canEditByCurrentUser: _boolValue(json['canEditByCurrentUser']),
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
    this.salesEditCount = 0,
    this.salesEditLimit = 1,
    this.salesEditRemaining = 1,
    this.canEditByCurrentUser = false,
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
  final int salesEditCount;
  final int salesEditLimit;
  final int salesEditRemaining;
  final bool canEditByCurrentUser;

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
      salesEditCount: _intValue(json['salesEditCount']),
      salesEditLimit: json.containsKey('salesEditLimit')
          ? _intValue(json['salesEditLimit'])
          : 1,
      salesEditRemaining: json.containsKey('salesEditRemaining')
          ? _intValue(json['salesEditRemaining'])
          : 1,
      canEditByCurrentUser: _boolValue(json['canEditByCurrentUser']),
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

class PaymentMethodRecord {
  const PaymentMethodRecord({
    this.id = '',
    this.code = '',
    required this.name,
    this.category = 'direct_receipt',
    this.serviceFeeRate,
    this.isActive = true,
    this.sortOrder = 0,
    this.isDefault = false,
    this.createdById,
    this.updatedById,
    this.createdAt,
    this.updatedAt,
    this.amountCents = 0,
  });

  final String id;
  final String code;
  final String name;
  final String category;
  final String? serviceFeeRate;
  final bool isActive;
  final int sortOrder;
  final bool isDefault;
  final String? createdById;
  final String? updatedById;
  final String? createdAt;
  final String? updatedAt;
  final int amountCents;

  bool get isCollectOnDelivery => category == 'collect_on_delivery';

  bool get isAgencyCollection => isCollectOnDelivery;

  factory PaymentMethodRecord.fromJson(Map<String, dynamic> json) {
    return PaymentMethodRecord(
      id: '${json['id'] ?? ''}',
      code: '${json['code'] ?? ''}',
      name: '${json['name'] ?? ''}',
      category: _normalizePaymentMethodCategory(json['category']),
      serviceFeeRate: _stringOrNull(json['serviceFeeRate']),
      isActive:
          json.containsKey('isActive') ? _boolValue(json['isActive']) : true,
      sortOrder: _intValue(json['sortOrder']),
      isDefault: _boolValue(json['isDefault']),
      createdById: _stringOrNull(json['createdById']),
      updatedById: _stringOrNull(json['updatedById']),
      createdAt: _stringOrNull(json['createdAt']),
      updatedAt: _stringOrNull(json['updatedAt']),
      amountCents: _intValue(json['amountCents']),
    );
  }
}

typedef SalesPaymentMethodRecord = PaymentMethodRecord;

class SalesOrderPaymentDetailRecord {
  const SalesOrderPaymentDetailRecord({
    required this.id,
    required this.paymentMethodId,
    required this.paymentMethodNameSnapshot,
    required this.paymentMethodCategorySnapshot,
    required this.amountCents,
    required this.sortOrder,
    required this.requiresAgencyConfirmation,
    required this.agencyCollectionConfirmed,
    required this.agencyCollectionConfirmedAt,
    required this.agencyCollectionConfirmedById,
    this.agencyCollectionConfirmedByName,
  });

  final String id;
  final String paymentMethodId;
  final String paymentMethodNameSnapshot;
  final String paymentMethodCategorySnapshot;
  final int amountCents;
  final int sortOrder;
  final bool requiresAgencyConfirmation;
  final bool agencyCollectionConfirmed;
  final String? agencyCollectionConfirmedAt;
  final String? agencyCollectionConfirmedById;
  final String? agencyCollectionConfirmedByName;

  bool get isCollectOnDelivery =>
      paymentMethodCategorySnapshot == 'collect_on_delivery';

  bool get isAgencyCollection => isCollectOnDelivery;

  factory SalesOrderPaymentDetailRecord.fromJson(
    Map<String, dynamic> json,
  ) {
    return SalesOrderPaymentDetailRecord(
      id: '${json['id'] ?? ''}',
      paymentMethodId: '${json['paymentMethodId'] ?? ''}',
      paymentMethodNameSnapshot: '${json['paymentMethodNameSnapshot'] ?? ''}',
      paymentMethodCategorySnapshot: _normalizePaymentMethodCategory(
        json['paymentMethodCategorySnapshot'],
      ),
      amountCents: _intValue(json['amountCents']),
      sortOrder: _intValue(json['sortOrder']),
      requiresAgencyConfirmation: json.containsKey('requiresAgencyConfirmation')
          ? _boolValue(json['requiresAgencyConfirmation'])
          : _normalizePaymentMethodCategory(
                json['paymentMethodCategorySnapshot'],
              ) ==
              'collect_on_delivery',
      agencyCollectionConfirmed: _boolValue(
        json['agencyCollectionConfirmed'] ?? json['collectionConfirmed'],
      ),
      agencyCollectionConfirmedAt: _stringOrNull(
        json['agencyCollectionConfirmedAt'] ?? json['collectionConfirmedAt'],
      ),
      agencyCollectionConfirmedById: _stringOrNull(
        json['agencyCollectionConfirmedById'] ??
            json['collectionConfirmedById'],
      ),
      agencyCollectionConfirmedByName: _stringOrNull(
        json['agencyCollectionConfirmedByName'] ??
            json['collectionConfirmedByName'] ??
            _map(
              json['agencyCollectionConfirmedBy'] ??
                  json['collectionConfirmedBy'],
            )['name'],
      ),
    );
  }
}

class PaymentSummaryRecord {
  const PaymentSummaryRecord({
    required this.directReceiptAmountCents,
    required this.collectOnDeliveryAmountCents,
    required this.confirmedCollectOnDeliveryAmountCents,
    required this.pendingCollectOnDeliveryAmountCents,
    required this.hasPendingCollectOnDelivery,
  });

  const PaymentSummaryRecord.empty()
      : directReceiptAmountCents = 0,
        collectOnDeliveryAmountCents = 0,
        confirmedCollectOnDeliveryAmountCents = 0,
        pendingCollectOnDeliveryAmountCents = 0,
        hasPendingCollectOnDelivery = false;

  final int directReceiptAmountCents;
  final int collectOnDeliveryAmountCents;
  final int confirmedCollectOnDeliveryAmountCents;
  final int pendingCollectOnDeliveryAmountCents;
  final bool hasPendingCollectOnDelivery;

  bool get isCollectOnDelivery => hasPendingCollectOnDelivery;

  factory PaymentSummaryRecord.fromJson(Map<String, dynamic> json) {
    final pendingAmountCents = _intValue(
      json['pendingCollectOnDeliveryAmountCents'],
    );
    return PaymentSummaryRecord(
      directReceiptAmountCents: _intValue(json['directReceiptAmountCents']),
      collectOnDeliveryAmountCents:
          _intValue(json['collectOnDeliveryAmountCents']),
      confirmedCollectOnDeliveryAmountCents:
          _intValue(json['confirmedCollectOnDeliveryAmountCents']),
      pendingCollectOnDeliveryAmountCents: pendingAmountCents,
      hasPendingCollectOnDelivery:
          json.containsKey('hasPendingCollectOnDelivery')
              ? _boolValue(json['hasPendingCollectOnDelivery'])
              : pendingAmountCents != 0,
    );
  }

  factory PaymentSummaryRecord.fromSalesOrderDetails({
    required List<SalesOrderPaymentDetailRecord> paymentDetails,
    required int totalAmountCents,
    required int cashOnDeliveryAmountCents,
  }) {
    if (paymentDetails.isEmpty) {
      return PaymentSummaryRecord(
        directReceiptAmountCents: totalAmountCents - cashOnDeliveryAmountCents,
        collectOnDeliveryAmountCents: cashOnDeliveryAmountCents,
        confirmedCollectOnDeliveryAmountCents: 0,
        pendingCollectOnDeliveryAmountCents: cashOnDeliveryAmountCents,
        hasPendingCollectOnDelivery: cashOnDeliveryAmountCents != 0,
      );
    }
    var direct = 0;
    var collect = 0;
    var confirmed = 0;
    var pending = 0;
    var hasPending = false;
    for (final detail in paymentDetails) {
      if (!detail.isCollectOnDelivery) {
        direct += detail.amountCents;
        continue;
      }
      collect += detail.amountCents;
      if (detail.agencyCollectionConfirmed) {
        confirmed += detail.amountCents;
      } else {
        pending += detail.amountCents;
        hasPending = hasPending || detail.amountCents != 0;
      }
    }
    return PaymentSummaryRecord(
      directReceiptAmountCents: direct,
      collectOnDeliveryAmountCents: collect,
      confirmedCollectOnDeliveryAmountCents: confirmed,
      pendingCollectOnDeliveryAmountCents: pending,
      hasPendingCollectOnDelivery: hasPending,
    );
  }

  factory PaymentSummaryRecord.fromSalesSheetDetails({
    required List<SalesSheetPaymentDetailRecord> paymentDetails,
    required int totalAmountCents,
    required int cashOnDeliveryAmountCents,
  }) {
    if (paymentDetails.isEmpty) {
      return PaymentSummaryRecord(
        directReceiptAmountCents: totalAmountCents - cashOnDeliveryAmountCents,
        collectOnDeliveryAmountCents: cashOnDeliveryAmountCents,
        confirmedCollectOnDeliveryAmountCents: 0,
        pendingCollectOnDeliveryAmountCents: cashOnDeliveryAmountCents,
        hasPendingCollectOnDelivery: cashOnDeliveryAmountCents != 0,
      );
    }
    var direct = 0;
    var collect = 0;
    var confirmed = 0;
    var pending = 0;
    var hasPending = false;
    for (final detail in paymentDetails) {
      if (!detail.isCollectOnDelivery) {
        direct += detail.amountCents;
        continue;
      }
      collect += detail.amountCents;
      if (detail.agencyCollectionConfirmed) {
        confirmed += detail.amountCents;
      } else {
        pending += detail.amountCents;
        hasPending = hasPending || detail.amountCents != 0;
      }
    }
    return PaymentSummaryRecord(
      directReceiptAmountCents: direct,
      collectOnDeliveryAmountCents: collect,
      confirmedCollectOnDeliveryAmountCents: confirmed,
      pendingCollectOnDeliveryAmountCents: pending,
      hasPendingCollectOnDelivery: hasPending,
    );
  }
}

class SalesOrderMutationResult {
  const SalesOrderMutationResult({
    required this.salesOrder,
    required this.recalculation,
  });

  final SalesOrderRecord salesOrder;
  final CommissionRecalculationResult? recalculation;

  factory SalesOrderMutationResult.fromJson(Map<String, dynamic> json) {
    return SalesOrderMutationResult(
      salesOrder: SalesOrderRecord.fromJson(_map(json['salesOrder'])),
      recalculation: json['recalculation'] is Map
          ? CommissionRecalculationResult.fromJson(
              _map(json['recalculation']),
            )
          : null,
    );
  }
}

class SalesOrderAssignmentUser {
  const SalesOrderAssignmentUser({
    required this.id,
    required this.name,
    required this.username,
    required this.leaderId,
    required this.leaderName,
    required this.leaderActive,
  });

  final String id;
  final String name;
  final String username;
  final String? leaderId;
  final String? leaderName;
  final bool? leaderActive;

  factory SalesOrderAssignmentUser.fromJson(Map<String, dynamic> json) {
    return SalesOrderAssignmentUser(
      id: '${json['id'] ?? ''}',
      name: '${json['name'] ?? ''}',
      username: '${json['username'] ?? ''}',
      leaderId: _stringOrNull(json['leaderId']),
      leaderName: _stringOrNull(json['leaderName']),
      leaderActive: json['leaderActive'] == null
          ? null
          : _boolValue(json['leaderActive']),
    );
  }
}

class SalesOrderAssignmentOptions {
  const SalesOrderAssignmentOptions({
    required this.calculationDate,
    required this.currentUserId,
    required this.currentUserRole,
    required this.canChangeSalesUser,
    required this.activeCommissionTargetTypes,
    required this.salesUsers,
  });

  final String calculationDate;
  final String? currentUserId;
  final String currentUserRole;
  final bool canChangeSalesUser;
  final Set<String> activeCommissionTargetTypes;
  final List<SalesOrderAssignmentUser> salesUsers;

  bool get outreachCommissionRequired =>
      activeCommissionTargetTypes.contains('OUTREACH_COMMISSION');

  bool get leaderCommissionEnabled =>
      activeCommissionTargetTypes.contains('LEADER_COMMISSION');

  factory SalesOrderAssignmentOptions.fromJson(Map<String, dynamic> json) {
    return SalesOrderAssignmentOptions(
      calculationDate: '${json['calculationDate'] ?? ''}',
      currentUserId: _stringOrNull(json['currentUserId']),
      currentUserRole: '${json['currentUserRole'] ?? ''}',
      canChangeSalesUser: _boolValue(json['canChangeSalesUser']),
      activeCommissionTargetTypes:
          _stringList(json['activeCommissionTargetTypes']).toSet(),
      salesUsers: _list(json['salesUsers'])
          .map(SalesOrderAssignmentUser.fromJson)
          .where((user) => user.id.isNotEmpty)
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
    required this.shippingDate,
    required this.shippingRiskWarnings,
    required this.canEditShippingDate,
    required this.salesFormNo,
    required this.totalAmountCents,
    required this.entryAmountCents,
    required this.tasterCommissionCents,
    this.tasterCommission,
    required this.tasterId,
    required this.tasterName,
    required this.cashOnDeliveryAmountCents,
    required this.status,
    required this.deliverySummary,
    required this.logisticsMethod,
    required this.logisticsProviderCode,
    required this.packingStatus,
    required this.packageCount,
    required this.warehouseRemark,
    required this.hasPackingMark,
    required this.logisticsNo,
    required this.trackingState,
    required this.trackingStateLabel,
    required this.trackingLatestLocation,
    required this.trackingLatestDescription,
    required this.trackingEventAt,
    required this.trackingCheckedAt,
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
    required this.outreachUserId,
    required this.items,
    required this.createdAt,
    required this.updatedAt,
    this.salesEditCount = 0,
    this.salesEditLimit = 1,
    this.salesEditRemaining = 1,
    this.canEditByCurrentUser = false,
    this.pointsDestination = 'TRAVEL_AGENCY',
    this.personalAmountCents = 0,
    this.normalAmountCents = 0,
    this.personalPointsGuideId,
    this.personalPointsGuide,
    this.personalGuideNameSnapshot,
    this.personalDailyRebateRate,
    this.personalMonthlyRebateRate,
    this.pointsDestinationChangedById,
    this.pointsDestinationChangedAt,
    this.personalRatesUpdatedById,
    this.personalRatesUpdatedAt,
    this.sourceSalesOrderId,
    this.fulfillmentWarehouseId,
    this.fulfillmentWarehouseName,
    this.paymentDetails = const <SalesOrderPaymentDetailRecord>[],
    this.paymentDetailsSummary = '',
    this.paymentSummary = const PaymentSummaryRecord.empty(),
    this.paymentStatus = 'received',
    this.paymentStatusLabel = '已到账',
    this.completedAt,
    this.completedById,
    this.isCompleted = false,
    this.paymentDetailsLockedAt,
    this.paymentDetailsLockedById,
    this.paymentDetailsUnlockedAt,
    this.paymentDetailsUnlockedById,
    this.paymentDetailsLocked = false,
    this.workflowStatus,
    this.workflowVersion = 0,
    this.manualCommissions = const <SpecialOrderCommissionRecord>[],
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
  final String? shippingDate;
  final List<SalesOrderShippingRiskWarning> shippingRiskWarnings;
  final bool canEditShippingDate;
  final String? salesFormNo;
  final int totalAmountCents;
  final int entryAmountCents;
  final int tasterCommissionCents;
  final SalesOrderTasterCommissionRecord? tasterCommission;
  final String? tasterId;
  final String? tasterName;
  final int cashOnDeliveryAmountCents;
  final String status;
  final String? deliverySummary;
  final String? logisticsMethod;
  final String? logisticsProviderCode;
  final String packingStatus;
  final int packageCount;
  final String? warehouseRemark;
  final bool hasPackingMark;
  final String? logisticsNo;
  final String? trackingState;
  final String? trackingStateLabel;
  final String? trackingLatestLocation;
  final String? trackingLatestDescription;
  final String? trackingEventAt;
  final String? trackingCheckedAt;
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
  final String? outreachUserId;
  final List<SalesOrderItemRecord> items;
  final String? createdAt;
  final String? updatedAt;
  final int salesEditCount;
  final int salesEditLimit;
  final int salesEditRemaining;
  final bool canEditByCurrentUser;
  final String pointsDestination;
  final int personalAmountCents;
  final int normalAmountCents;
  final String? personalPointsGuideId;
  final GuideRecord? personalPointsGuide;
  final String? personalGuideNameSnapshot;
  final String? personalDailyRebateRate;
  final String? personalMonthlyRebateRate;
  final String? pointsDestinationChangedById;
  final String? pointsDestinationChangedAt;
  final String? personalRatesUpdatedById;
  final String? personalRatesUpdatedAt;
  final String? sourceSalesOrderId;
  final String? fulfillmentWarehouseId;
  final String? fulfillmentWarehouseName;
  final List<SalesOrderPaymentDetailRecord> paymentDetails;
  final String paymentDetailsSummary;
  final PaymentSummaryRecord paymentSummary;
  final String paymentStatus;
  final String paymentStatusLabel;
  final String? completedAt;
  final String? completedById;
  final bool isCompleted;
  final String? paymentDetailsLockedAt;
  final String? paymentDetailsLockedById;
  final String? paymentDetailsUnlockedAt;
  final String? paymentDetailsUnlockedById;
  final bool paymentDetailsLocked;
  final String? workflowStatus;
  final int workflowVersion;
  final List<SpecialOrderCommissionRecord> manualCommissions;

  bool get isWorkflowSpecialOrder =>
      workflowStatus != null &&
      const {'internal', 'external', 'buyback'}
          .contains(orderType.toLowerCase());

  bool get isGuidePersonal =>
      personalAmountCents > 0 ||
      pointsDestination.toUpperCase() == 'GUIDE_PERSONAL';

  factory SalesOrderRecord.fromJson(Map<String, dynamic> json) {
    final customer = json['customer'] is Map
        ? CustomerRecord.fromJson(_map(json['customer']))
        : null;
    final travelGroup = json['travelGroup'] is Map
        ? TravelGroupRecord.fromJson(_map(json['travelGroup']))
        : null;
    final tasterCommission = json['tasterCommission'] is Map
        ? SalesOrderTasterCommissionRecord.fromJson(
            _map(json['tasterCommission']),
          )
        : null;
    final fulfillmentWarehouseJson = _map(json['fulfillmentWarehouse']);
    final fulfillmentWarehouseId =
        _stringOrNull(json['fulfillmentWarehouseId']) ??
            (fulfillmentWarehouseJson.isNotEmpty
                ? _stringOrNull(fulfillmentWarehouseJson['id'])
                : null);
    final fulfillmentWarehouseName =
        _stringOrNull(json['fulfillmentWarehouseName']) ??
            (fulfillmentWarehouseJson.isNotEmpty
                ? _stringOrNull(fulfillmentWarehouseJson['name'])
                : null);
    final totalAmountCents = _intValue(json['totalAmountCents']);
    final pointsDestination =
        '${json['pointsDestination'] ?? 'TRAVEL_AGENCY'}'.toUpperCase();
    final personalAmountCents = json.containsKey('personalAmountCents')
        ? _intValue(json['personalAmountCents'])
        : pointsDestination == 'GUIDE_PERSONAL'
            ? totalAmountCents
            : 0;
    final cashOnDeliveryAmountCents =
        _intValue(json['cashOnDeliveryAmountCents']);
    final paymentDetails = _list(json['paymentDetails'])
        .map(SalesOrderPaymentDetailRecord.fromJson)
        .toList();
    final paymentSummary = json['paymentSummary'] is Map
        ? PaymentSummaryRecord.fromJson(_map(json['paymentSummary']))
        : PaymentSummaryRecord.fromSalesOrderDetails(
            paymentDetails: paymentDetails,
            totalAmountCents: totalAmountCents,
            cashOnDeliveryAmountCents: cashOnDeliveryAmountCents,
          );
    final paymentDetailsLockedAt =
        _stringOrNull(json['paymentDetailsLockedAt']);
    final paymentDetailsUnlockedAt =
        _stringOrNull(json['paymentDetailsUnlockedAt']);
    return SalesOrderRecord(
      id: '${json['id'] ?? ''}',
      orderNo: '${json['orderNo'] ?? ''}',
      orderType: '${json['orderType'] ?? 'travel_group'}',
      sourceSalesOrderId: _stringOrNull(json['sourceSalesOrderId']),
      customerId: _stringOrNull(json['customerId']),
      customer: customer,
      customerName: '${json['customerName'] ?? customer?.name ?? ''}',
      customerPhone: _stringOrNull(json['customerPhone']),
      province: _stringOrNull(json['province']),
      city: _stringOrNull(json['city']),
      district: _stringOrNull(json['district']),
      orderDate: '${json['orderDate'] ?? ''}',
      shippingDate: _stringOrNull(json['shippingDate']),
      shippingRiskWarnings: _list(json['shippingRiskWarnings'])
          .map((item) => SalesOrderShippingRiskWarning.fromJson(_map(item)))
          .toList(),
      canEditShippingDate: _boolValue(json['canEditShippingDate']),
      salesFormNo: _stringOrNull(json['salesFormNo']),
      totalAmountCents: totalAmountCents,
      entryAmountCents: _intValue(
        json['entryAmountCents'] ??
            json['orderEntryAmountCents'] ??
            json['totalAmountCents'],
      ),
      tasterCommissionCents: json.containsKey('tasterCommissionCents')
          ? _intValue(json['tasterCommissionCents'])
          : tasterCommission?.amountCents ?? 0,
      tasterCommission: tasterCommission,
      tasterId: _stringOrNull(json['tasterId'] ?? travelGroup?.tasterId),
      tasterName: _stringOrNull(json['tasterName'] ?? travelGroup?.tasterName),
      cashOnDeliveryAmountCents: cashOnDeliveryAmountCents,
      paymentDetails: paymentDetails,
      paymentDetailsSummary:
          '${json['paymentDetailsSummary'] ?? (json['paymentSummary'] is String ? json['paymentSummary'] : '')}',
      paymentSummary: paymentSummary,
      paymentStatus:
          '${json['paymentStatus'] ?? (paymentSummary.hasPendingCollectOnDelivery ? 'collect_on_delivery' : 'received')}',
      paymentStatusLabel:
          '${json['paymentStatusLabel'] ?? (paymentSummary.hasPendingCollectOnDelivery ? '代收款' : '已到账')}',
      completedAt: _stringOrNull(json['completedAt']),
      completedById: _stringOrNull(json['completedById']),
      isCompleted: json.containsKey('isCompleted')
          ? _boolValue(json['isCompleted'])
          : _stringOrNull(json['completedAt']) != null,
      paymentDetailsLockedAt: paymentDetailsLockedAt,
      paymentDetailsLockedById: _stringOrNull(json['paymentDetailsLockedById']),
      paymentDetailsUnlockedAt: paymentDetailsUnlockedAt,
      paymentDetailsUnlockedById:
          _stringOrNull(json['paymentDetailsUnlockedById']),
      paymentDetailsLocked: json.containsKey('paymentDetailsLocked')
          ? _boolValue(json['paymentDetailsLocked'])
          : paymentDetailsLockedAt != null && paymentDetailsUnlockedAt == null,
      workflowStatus: _stringOrNull(json['workflowStatus'])?.toLowerCase(),
      workflowVersion: _intValue(json['workflowVersion']),
      manualCommissions: _list(json['manualCommissions'])
          .map(SpecialOrderCommissionRecord.fromJson)
          .toList(),
      status: '${json['status'] ?? 'valid'}',
      deliverySummary: _stringOrNull(json['deliverySummary']),
      logisticsMethod: _stringOrNull(json['logisticsMethod']),
      logisticsProviderCode: _stringOrNull(json['logisticsProviderCode']),
      packingStatus: '${json['packingStatus'] ?? 'pending'}',
      packageCount: _intValue(json['packageCount']),
      warehouseRemark: _stringOrNull(json['warehouseRemark']),
      hasPackingMark: _boolValue(json['hasPackingMark']),
      logisticsNo: _stringOrNull(json['logisticsNo']),
      trackingState: _stringOrNull(json['trackingState']),
      trackingStateLabel: _stringOrNull(json['trackingStateLabel']),
      trackingLatestLocation: _stringOrNull(json['trackingLatestLocation']),
      trackingLatestDescription:
          _stringOrNull(json['trackingLatestDescription']),
      trackingEventAt: _stringOrNull(json['trackingEventAt']),
      trackingCheckedAt: _stringOrNull(json['trackingCheckedAt']),
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
      outreachUserId: _stringOrNull(json['outreachUserId']),
      items: _list(json['items'])
          .map((item) => SalesOrderItemRecord.fromJson(item))
          .toList(),
      createdAt: _stringOrNull(json['createdAt']),
      updatedAt: _stringOrNull(json['updatedAt']),
      salesEditCount: _intValue(json['salesEditCount']),
      salesEditLimit: json.containsKey('salesEditLimit')
          ? _intValue(json['salesEditLimit'])
          : 1,
      salesEditRemaining: json.containsKey('salesEditRemaining')
          ? _intValue(json['salesEditRemaining'])
          : 1,
      canEditByCurrentUser: _boolValue(json['canEditByCurrentUser']),
      pointsDestination: pointsDestination,
      personalAmountCents: personalAmountCents,
      normalAmountCents: json.containsKey('normalAmountCents')
          ? _intValue(json['normalAmountCents'])
          : totalAmountCents - personalAmountCents,
      personalPointsGuideId: _stringOrNull(json['personalPointsGuideId']),
      personalPointsGuide: json['personalPointsGuide'] is Map
          ? GuideRecord.fromJson(_map(json['personalPointsGuide']))
          : null,
      personalGuideNameSnapshot:
          _stringOrNull(json['personalGuideNameSnapshot']),
      personalDailyRebateRate: _stringOrNull(json['personalDailyRebateRate']),
      personalMonthlyRebateRate:
          _stringOrNull(json['personalMonthlyRebateRate']),
      pointsDestinationChangedById:
          _stringOrNull(json['pointsDestinationChangedById']),
      pointsDestinationChangedAt:
          _stringOrNull(json['pointsDestinationChangedAt']),
      personalRatesUpdatedById: _stringOrNull(json['personalRatesUpdatedById']),
      personalRatesUpdatedAt: _stringOrNull(json['personalRatesUpdatedAt']),
      fulfillmentWarehouseId: fulfillmentWarehouseId,
      fulfillmentWarehouseName: fulfillmentWarehouseName,
    );
  }
}

class SalesOrderTasterCommissionRecord {
  const SalesOrderTasterCommissionRecord({
    required this.recordId,
    required this.amountCents,
    required this.isConfirmed,
    required this.confirmedById,
    required this.confirmedByName,
    required this.confirmedAt,
  });

  final String recordId;
  final int amountCents;
  final bool isConfirmed;
  final String? confirmedById;
  final String? confirmedByName;
  final String? confirmedAt;

  factory SalesOrderTasterCommissionRecord.fromJson(
    Map<String, dynamic> json,
  ) {
    return SalesOrderTasterCommissionRecord(
      recordId: '${json['recordId'] ?? ''}',
      amountCents: _intValue(json['amountCents']),
      isConfirmed: _boolValue(json['isConfirmed']),
      confirmedById: _stringOrNull(json['confirmedById']),
      confirmedByName: _stringOrNull(json['confirmedByName']),
      confirmedAt: _stringOrNull(json['confirmedAt']),
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
    required this.serializedUnitIds,
    required this.serializedUnits,
    required this.inventoryLineKey,
    required this.fulfillment,
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
  final List<String> serializedUnitIds;
  final List<SalesOrderSerializedUnitRecord> serializedUnits;
  final String? inventoryLineKey;
  final SalesOrderItemFulfillmentRecord? fulfillment;

  factory SalesOrderItemRecord.fromJson(Map<String, dynamic> json) {
    final quantity = _intValue(json['quantity']);
    final unitPriceCents = _intValue(json['unitPriceCents']);
    final fulfillmentJson = _map(json['serializedFulfillment']);
    final fulfillment = fulfillmentJson.isEmpty
        ? null
        : SalesOrderItemFulfillmentRecord.fromJson(fulfillmentJson);
    final directSerializedUnits = _list(json['serializedUnits']);
    final serializedUnitsJson = directSerializedUnits.isNotEmpty
        ? directSerializedUnits
        : _list(fulfillmentJson['units']);
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
      serializedUnitIds: _list(json['serializedUnitIds'])
          .map((value) => '$value')
          .where((value) => value.isNotEmpty)
          .toList(),
      serializedUnits: serializedUnitsJson
          .map(SalesOrderSerializedUnitRecord.fromJson)
          .toList(),
      inventoryLineKey: _stringOrNull(json['inventoryLineKey']),
      fulfillment: fulfillment,
    );
  }
}

class SalesOrderItemFulfillmentRecord {
  const SalesOrderItemFulfillmentRecord({
    required this.status,
    required this.requestedQty,
    required this.assignedQty,
    required this.outboundQty,
    required this.unassignedQty,
    required this.units,
  });

  final String status;
  final int requestedQty;
  final int assignedQty;
  final int outboundQty;
  final int unassignedQty;
  final List<SalesOrderSerializedUnitRecord> units;

  factory SalesOrderItemFulfillmentRecord.fromJson(
    Map<String, dynamic> json,
  ) {
    return SalesOrderItemFulfillmentRecord(
      status: '${json['status'] ?? ''}'.toLowerCase(),
      requestedQty: _intValue(json['requestedQty']),
      assignedQty: _intValue(json['assignedQty']),
      outboundQty: _intValue(json['outboundQty']),
      unassignedQty: _intValue(json['unassignedQty']),
      units: _list(json['units'])
          .map(SalesOrderSerializedUnitRecord.fromJson)
          .toList(),
    );
  }
}

class SalesOrderSerializedUnitRecord {
  const SalesOrderSerializedUnitRecord({
    required this.id,
    required this.moutaiName,
    required this.logisticsCode,
    required this.factoryDate,
    required this.productionBatch,
    required this.batchSerialNo,
    required this.assignmentStatus,
  });

  final String id;
  final String? moutaiName;
  final String? logisticsCode;
  final String? factoryDate;
  final String? productionBatch;
  final String? batchSerialNo;
  final String? assignmentStatus;

  factory SalesOrderSerializedUnitRecord.fromJson(
    Map<String, dynamic> json,
  ) {
    return SalesOrderSerializedUnitRecord(
      id: '${json['id'] ?? ''}',
      moutaiName: _stringOrNull(json['moutaiName']),
      logisticsCode: _stringOrNull(json['logisticsCode']),
      factoryDate: _stringOrNull(json['factoryDate']),
      productionBatch: _stringOrNull(json['productionBatch']),
      batchSerialNo: _stringOrNull(json['batchSerialNo']),
      assignmentStatus: _stringOrNull(json['assignmentStatus'])?.toLowerCase(),
    );
  }
}

class SalesOrderShippingRiskWarning {
  const SalesOrderShippingRiskWarning({
    required this.code,
    required this.message,
  });

  final String code;
  final String message;

  factory SalesOrderShippingRiskWarning.fromJson(Map<String, dynamic> json) {
    return SalesOrderShippingRiskWarning(
      code: '${json['code'] ?? ''}',
      message: '${json['message'] ?? ''}',
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
    this.personalPointsRefundAmountCents = 0,
    this.normalPointsRefundAmountCents = 0,
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
    this.sourceSalesOrderId,
    this.sourceSalesOrder,
    this.afterSalesSalesOrderId,
    this.afterSalesSalesOrder,
    this.items = const <AfterSalesOrderItemRecord>[],
    this.deductionCalculationMode = 'manual_product_reference',
    this.sourceAgencyDeductionCents = 0,
    this.agencyDeductionRate,
    this.dailyRebateRate = 0,
    this.monthlyRebateRate = 0,
    this.agencyDeductionRuleId,
    this.agencyRebateRuleId,
    this.calculationDate,
    this.agencyDeductionAdjustmentCents,
    this.financialEffectStatus = 'pending_confirmation',
    this.receipts = const <AfterSalesReceiptRecord>[],
    this.refundPaymentDetailId,
    this.refundPaymentMethodNameSnapshot,
    this.refundOccurredAt,
    this.deductsPaymentServiceFee = false,
    this.refundTimingStatus = 'cross_day',
    this.isSameDayRefund = false,
    this.requiresRefundPaymentDetail = false,
    this.refundPaymentDetailOptions =
        const <AfterSalesRefundPaymentDetailOptionRecord>[],
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
  final int personalPointsRefundAmountCents;
  final int normalPointsRefundAmountCents;
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
  final String? sourceSalesOrderId;
  final SalesOrderRecord? sourceSalesOrder;
  final String? afterSalesSalesOrderId;
  final SalesOrderRecord? afterSalesSalesOrder;
  final List<AfterSalesOrderItemRecord> items;
  final String deductionCalculationMode;
  final int sourceAgencyDeductionCents;
  final double? agencyDeductionRate;
  final double dailyRebateRate;
  final double monthlyRebateRate;
  final String? agencyDeductionRuleId;
  final String? agencyRebateRuleId;
  final String? calculationDate;
  final int? agencyDeductionAdjustmentCents;
  final String financialEffectStatus;
  final List<AfterSalesReceiptRecord> receipts;
  final String? refundPaymentDetailId;
  final String? refundPaymentMethodNameSnapshot;
  final String? refundOccurredAt;
  final bool deductsPaymentServiceFee;
  final String refundTimingStatus;
  final bool isSameDayRefund;
  final bool requiresRefundPaymentDetail;
  final List<AfterSalesRefundPaymentDetailOptionRecord>
      refundPaymentDetailOptions;

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
      personalPointsRefundAmountCents:
          _intValue(json['personalPointsRefundAmountCents']),
      normalPointsRefundAmountCents:
          json.containsKey('normalPointsRefundAmountCents')
              ? _intValue(json['normalPointsRefundAmountCents'])
              : _intValue(json['refundAmountCents']) -
                  _intValue(json['personalPointsRefundAmountCents']),
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
      sourceSalesOrderId: _stringOrNull(
        json['sourceSalesOrderId'] ?? json['salesOrderId'],
      ),
      sourceSalesOrder: json['sourceSalesOrder'] is Map
          ? SalesOrderRecord.fromJson(_map(json['sourceSalesOrder']))
          : json['salesOrder'] is Map
              ? SalesOrderRecord.fromJson(_map(json['salesOrder']))
              : null,
      afterSalesSalesOrderId: _stringOrNull(json['afterSalesSalesOrderId']),
      afterSalesSalesOrder: json['afterSalesSalesOrder'] is Map
          ? SalesOrderRecord.fromJson(_map(json['afterSalesSalesOrder']))
          : null,
      items: _list(json['items'])
          .map((item) => AfterSalesOrderItemRecord.fromJson(_map(item)))
          .toList(),
      deductionCalculationMode:
          '${json['deductionCalculationMode'] ?? 'manual_product_reference'}',
      sourceAgencyDeductionCents: _intValue(json['sourceAgencyDeductionCents']),
      agencyDeductionRate: _doubleOrNull(json['agencyDeductionRate']),
      dailyRebateRate: _doubleValue(json['dailyRebateRate']),
      monthlyRebateRate: _doubleValue(json['monthlyRebateRate']),
      agencyDeductionRuleId: _stringOrNull(json['agencyDeductionRuleId']),
      agencyRebateRuleId: _stringOrNull(json['agencyRebateRuleId']),
      calculationDate: _stringOrNull(json['calculationDate']),
      agencyDeductionAdjustmentCents:
          json.containsKey('agencyDeductionAdjustmentCents') &&
                  json['agencyDeductionAdjustmentCents'] != null
              ? _intValue(json['agencyDeductionAdjustmentCents'])
              : null,
      financialEffectStatus:
          '${json['financialEffectStatus'] ?? 'pending_confirmation'}',
      receipts: _list(json['receipts'])
          .map((item) => AfterSalesReceiptRecord.fromJson(_map(item)))
          .toList(),
      refundPaymentDetailId: _stringOrNull(json['refundPaymentDetailId']),
      refundPaymentMethodNameSnapshot:
          _stringOrNull(json['refundPaymentMethodNameSnapshot']),
      refundOccurredAt: _stringOrNull(json['refundOccurredAt']),
      deductsPaymentServiceFee: _boolValue(json['deductsPaymentServiceFee']),
      refundTimingStatus: '${json['refundTimingStatus'] ?? 'cross_day'}',
      isSameDayRefund: _boolValue(json['isSameDayRefund']),
      requiresRefundPaymentDetail:
          _boolValue(json['requiresRefundPaymentDetail']),
      refundPaymentDetailOptions: _list(json['refundPaymentDetailOptions'])
          .map(
            (item) => AfterSalesRefundPaymentDetailOptionRecord.fromJson(
              _map(item),
            ),
          )
          .toList(),
    );
  }
}

class AfterSalesRefundPaymentDetailOptionRecord {
  const AfterSalesRefundPaymentDetailOptionRecord({
    required this.id,
    required this.paymentMethodNameSnapshot,
    required this.originalAmountCents,
    required this.confirmedSameDayRefundAmountCents,
    required this.remainingRefundableAmountCents,
  });

  final String id;
  final String paymentMethodNameSnapshot;
  final int originalAmountCents;
  final int confirmedSameDayRefundAmountCents;
  final int remainingRefundableAmountCents;

  factory AfterSalesRefundPaymentDetailOptionRecord.fromJson(
    Map<String, dynamic> json,
  ) {
    return AfterSalesRefundPaymentDetailOptionRecord(
      id: '${json['id'] ?? ''}',
      paymentMethodNameSnapshot: '${json['paymentMethodNameSnapshot'] ?? ''}',
      originalAmountCents: _intValue(json['originalAmountCents']),
      confirmedSameDayRefundAmountCents:
          _intValue(json['confirmedSameDayRefundAmountCents']),
      remainingRefundableAmountCents:
          _intValue(json['remainingRefundableAmountCents']),
    );
  }
}

class AfterSalesReceiptRecord {
  const AfterSalesReceiptRecord({
    required this.id,
    required this.afterSalesOrderId,
    required this.warehouseId,
    required this.warehouseName,
    required this.productId,
    required this.productName,
    required this.quantity,
    required this.condition,
    required this.note,
    required this.createdAt,
  });

  final String id;
  final String afterSalesOrderId;
  final String? warehouseId;
  final String? warehouseName;
  final String? productId;
  final String productName;
  final int quantity;
  final String condition;
  final String? note;
  final String? createdAt;

  factory AfterSalesReceiptRecord.fromJson(Map<String, dynamic> json) {
    final warehouse = _map(json['warehouse']);
    final product = _map(json['product']);
    return AfterSalesReceiptRecord(
      id: '${json['id'] ?? ''}',
      afterSalesOrderId: '${json['afterSalesOrderId'] ?? ''}',
      warehouseId: _stringOrNull(json['warehouseId']),
      warehouseName: _stringOrNull(warehouse['name']),
      productId: _stringOrNull(json['productId']),
      productName: '${json['productName'] ?? product['name'] ?? ''}',
      quantity: _intValue(json['quantity']),
      condition: '${json['condition'] ?? 'SALEABLE'}',
      note: _stringOrNull(json['note']),
      createdAt: _stringOrNull(json['createdAt']),
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
    this.recalculation,
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
  final CommissionRecalculationResult? recalculation;

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
      recalculation: json['recalculation'] is Map
          ? CommissionRecalculationResult.fromJson(
              _map(json['recalculation']),
            )
          : null,
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
    required this.inventoryTrackingMode,
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
  final String inventoryTrackingMode;
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
      inventoryTrackingMode:
          '${json['inventoryTrackingMode'] ?? 'none'}'.toLowerCase(),
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
    required this.inventoryTrackingMode,
  });

  final String id;
  final String name;
  final String unit;
  final String inventoryTrackingMode;

  bool get usesSerializedInventory => inventoryTrackingMode == 'serialized';

  String get label => '$name · $unit';

  factory ProductOptionRecord.fromJson(Map<String, dynamic> json) {
    return ProductOptionRecord(
      id: '${json['id'] ?? ''}',
      name: '${json['name'] ?? ''}',
      unit: '${json['unit'] ?? ''}',
      inventoryTrackingMode:
          '${json['inventoryTrackingMode'] ?? 'none'}'.toLowerCase(),
    );
  }
}

class SerializedInventoryPage {
  const SerializedInventoryPage({
    required this.units,
    required this.page,
    required this.pageSize,
    required this.total,
    required this.totalPages,
  });

  final List<SerializedInventoryUnitRecord> units;
  final int page;
  final int pageSize;
  final int total;
  final int totalPages;

  factory SerializedInventoryPage.fromJson(
    Map<String, dynamic> json, {
    bool includeCost = true,
  }) {
    final pagination = _map(json['pagination']);
    return SerializedInventoryPage(
      units: _list(json['units'])
          .map(
            (item) => SerializedInventoryUnitRecord.fromJson(
              item,
              includeCost: includeCost,
            ),
          )
          .toList(),
      page: _intValue(pagination['page']),
      pageSize: _intValue(pagination['pageSize']),
      total: _intValue(pagination['total']),
      totalPages: _intValue(pagination['totalPages']),
    );
  }
}

class SerializedInventoryUnitRecord {
  const SerializedInventoryUnitRecord({
    required this.id,
    required this.productId,
    required this.productName,
    required this.moutaiName,
    required this.factoryDate,
    required this.productionBatch,
    required this.batchSerialNo,
    required this.logisticsCode,
    required this.purchaseCostCents,
    required this.status,
    required this.dataComplete,
    required this.salesOrderId,
    required this.salesOrderNo,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String productId;
  final String? productName;
  final String? moutaiName;
  final String? factoryDate;
  final String? productionBatch;
  final String? batchSerialNo;
  final String? logisticsCode;
  final int? purchaseCostCents;
  final String status;
  final bool dataComplete;
  final String? salesOrderId;
  final String? salesOrderNo;
  final String? createdAt;
  final String? updatedAt;

  factory SerializedInventoryUnitRecord.fromJson(
    Map<String, dynamic> json, {
    bool includeCost = true,
  }) {
    final salesOrder = _map(json['salesOrder']);
    return SerializedInventoryUnitRecord(
      id: '${json['id'] ?? ''}',
      productId: '${json['productId'] ?? ''}',
      productName: _stringOrNull(json['productName']),
      moutaiName: _stringOrNull(json['moutaiName']),
      factoryDate: _stringOrNull(json['factoryDate']),
      productionBatch: _stringOrNull(json['productionBatch']),
      batchSerialNo: _stringOrNull(json['batchSerialNo']),
      logisticsCode: _stringOrNull(json['logisticsCode']),
      purchaseCostCents: includeCost &&
              json.containsKey('purchaseCostCents') &&
              json['purchaseCostCents'] != null
          ? _intValue(json['purchaseCostCents'])
          : null,
      status: '${json['status'] ?? 'pending_cost'}',
      dataComplete: _boolValue(json['dataComplete']),
      salesOrderId: _stringOrNull(salesOrder['id']),
      salesOrderNo: _stringOrNull(salesOrder['orderNo']),
      createdAt: _stringOrNull(json['createdAt']),
      updatedAt: _stringOrNull(json['updatedAt']),
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
    required this.recalculation,
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
  final CommissionRecalculationResult? recalculation;

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
      recalculation: json['recalculation'] is Map
          ? CommissionRecalculationResult.fromJson(
              _map(json['recalculation']),
            )
          : null,
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
    required this.recalculation,
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
  final CommissionRecalculationResult? recalculation;

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
      recalculation: json['recalculation'] is Map
          ? CommissionRecalculationResult.fromJson(
              _map(json['recalculation']),
            )
          : null,
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
    required this.recalculation,
  });

  final int totalCount;
  final int successCount;
  final int failureCount;
  final List<String> createdIdsSample;
  final List<Stage7RuleImportFailureSample> failureSamples;
  final List<Stage7RuleImportRowResult> results;
  final CommissionRecalculationResult? recalculation;

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
      recalculation: json['recalculation'] is Map
          ? CommissionRecalculationResult.fromJson(
              _map(json['recalculation']),
            )
          : null,
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
    required this.source,
    required this.orderCount,
    required this.travelGroupCount,
    required this.successCount,
    required this.failureCount,
    required this.skippedCount,
    required this.skippedConfirmedCount,
    required this.skippedManualOverrideCount,
    required this.generatedRecords,
    required this.updatedRecords,
    required this.unchangedRecords,
    required this.warnings,
    required this.travelGroupFinanceSummaries,
  });

  final String? source;
  final int orderCount;
  final int travelGroupCount;
  final int successCount;
  final int failureCount;
  final int skippedCount;
  final int skippedConfirmedCount;
  final int skippedManualOverrideCount;
  final List<CommissionRecord> generatedRecords;
  final List<CommissionRecord> updatedRecords;
  final List<CommissionRecord> unchangedRecords;
  final List<CommissionRecalculationWarning> warnings;
  final List<TravelGroupFinanceSummaryRecord> travelGroupFinanceSummaries;

  List<CommissionRecord> get records => [
        ...generatedRecords,
        ...updatedRecords,
        ...unchangedRecords,
      ];

  int get generatedCount => generatedRecords.length;
  int get updatedCount => updatedRecords.length;
  int get unchangedCount => unchangedRecords.length;

  String get displayMessage {
    final warningCodes = warnings.map((warning) => warning.code).toSet();
    final changedRecords = [...generatedRecords, ...updatedRecords];
    final dailyChangedCount = changedRecords
        .where((record) => record.targetType.toLowerCase().contains('daily'))
        .length;
    final monthlyChangedCount = changedRecords
        .where((record) => record.targetType.toLowerCase().contains('monthly'))
        .length;
    const noRuleCodes = {
      'missing_agency_rebate_rule',
      'missing_agency_daily_rebate_rule',
      'missing_agency_monthly_rebate_rule',
    };
    final ordersWithoutRules = warnings
        .where((warning) => noRuleCodes.contains(warning.code))
        .map((warning) => '${warning.context?['salesOrderId'] ?? ''}')
        .where((id) => id.isNotEmpty)
        .toSet();
    final parts = <String>[];
    if (dailyChangedCount > 0 && monthlyChangedCount > 0) {
      parts.add(
        '已生成或更新日返 $dailyChangedCount 条、月返 $monthlyChangedCount 条',
      );
    } else if (changedRecords.isNotEmpty) {
      parts.add(
        '仅生成或更新日返 $dailyChangedCount 条、月返 $monthlyChangedCount 条，请核对未更新部分的业务原因',
      );
    } else if (warningCodes.any(noRuleCodes.contains)) {
      parts.add('未生成日返或月返：没有适用且唯一的旅行社返点规则');
    } else if (warningCodes.any(_protectedAgencyRebateWarningCodes.contains)) {
      parts.add('未覆盖积分记录：相关旅行团处于已返款、已确认或人工维护状态');
    } else if (failureCount > 0) {
      parts.add('未完成积分更新：重算或汇总刷新发生失败');
    } else {
      parts.add('重新计算已完成，没有需要生成或更新的日返/月返记录');
    }
    parts.add('涉及旅行团 $travelGroupCount 个、订单 $orderCount 笔');
    if (unchangedRecords.isNotEmpty) {
      parts.add('已有 ${unchangedRecords.length} 条记录金额未变化');
    }
    if (skippedCount > 0) {
      parts.add('跳过 $skippedCount 项');
    }
    if (failureCount > 0) {
      parts.add('失败 $failureCount 项');
    }
    if (warningCodes.contains('agency_rebate_rule_fallback_applied')) {
      parts.add('部分历史订单使用当前启用的返点规则补算');
    }
    const warningMessages = <String, String>{
      'missing_agency_rebate_rule': '部分订单未找到适用的旅行社返点规则',
      'missing_agency_daily_rebate_rule': '部分订单未找到适用的日返规则',
      'missing_agency_monthly_rebate_rule': '部分订单未找到适用的月返规则',
      'ambiguous_agency_rebate_rule': '存在多条同优先级旅行社返点规则，未自动选择',
      'travel_agency_id_not_matched': '部分订单的旅行社名称未匹配到旅行社档案',
      'manual_override': '旅行团已人工维护扣酒成本，自动重算已跳过',
      'agency_deduction_confirmed': '旅行团扣酒成本已确认，自动重算已跳过',
      'daily_rebate_paid': '日返已返款，受保护的日返金额未被覆盖',
      'monthly_rebate_paid': '月返已返款，受保护的月返金额未被覆盖',
      'order_recalculation_failed': '订单积分重算失败',
      'travel_group_summary_refresh_failed': '订单积分已处理，但旅行团汇总刷新失败',
      'agency_name_legacy_fallback': '通过旅行社名称兼容命中未绑定 ID 的历史返点规则，请尽快回填',
    };
    for (final entry in warningMessages.entries) {
      final matchingWarnings =
          warnings.where((warning) => warning.code == entry.key).toList();
      if (matchingWarnings.isNotEmpty) {
        final references = _warningReferenceSamples(matchingWarnings);
        parts.add(
          '${entry.value} ${matchingWarnings.length} 项'
          '${references.isEmpty ? '' : '（$references）'}',
        );
      }
    }
    if (orderCount > 0 &&
        ordersWithoutRules.length >= orderCount &&
        !warningCodes.contains('agency_rebate_rule_fallback_applied')) {
      parts.add('全部 $orderCount 笔订单均未命中规则');
    }
    return parts.join('；');
  }

  bool get hasFailureWarning =>
      failureCount > 0 ||
      warnings.any(
        (warning) =>
            warning.code == 'order_recalculation_failed' ||
            warning.code == 'travel_group_summary_refresh_failed',
      );

  bool get hasBusinessWarning => warnings.isNotEmpty || skippedCount > 0;

  int get updatedCountOrRecords =>
      generatedRecords.length + updatedRecords.length;

  factory CommissionRecalculationResult.fromJson(Map<String, dynamic> json) {
    final directRecords = _list(json['commissionRecords'])
        .map((item) => CommissionRecord.fromJson(item))
        .toList();
    final generatedRecords = _list(json['generatedRecords'])
        .map((item) => CommissionRecord.fromJson(item))
        .toList();
    return CommissionRecalculationResult(
      source: _stringOrNull(json['source']),
      orderCount: _intValue(json['orderCount']),
      travelGroupCount: _intValue(json['travelGroupCount']),
      successCount: _intValue(json['successCount']),
      failureCount: _intValue(json['failureCount']),
      skippedCount: _intValue(json['skippedCount']),
      skippedConfirmedCount: _intValue(json['skippedConfirmedCount']),
      skippedManualOverrideCount: _intValue(json['skippedManualOverrideCount']),
      generatedRecords:
          generatedRecords.isNotEmpty ? generatedRecords : directRecords,
      updatedRecords: _list(json['updatedRecords'])
          .map((item) => CommissionRecord.fromJson(item))
          .toList(),
      unchangedRecords: _list(json['unchangedRecords'])
          .map((item) => CommissionRecord.fromJson(item))
          .toList(),
      warnings: _recalculationWarnings(json['warnings']),
      travelGroupFinanceSummaries: _list(json['travelGroupFinanceSummaries'])
          .map((item) => TravelGroupFinanceSummaryRecord.fromJson(item))
          .toList(),
    );
  }
}

const _protectedAgencyRebateWarningCodes = {
  'manual_override',
  'agency_deduction_confirmed',
  'daily_rebate_paid',
  'monthly_rebate_paid',
};

String _warningReferenceSamples(
  List<CommissionRecalculationWarning> warnings,
) {
  final references = <String>[];
  for (final warning in warnings) {
    final context = warning.context;
    if (context == null) continue;
    for (final key in const [
      'travelGroupNo',
      'travelGroupId',
      'salesOrderNo',
      'orderNo',
      'salesOrderId',
    ]) {
      final value = '${context[key] ?? ''}'.trim();
      if (value.isNotEmpty && !references.contains(value)) {
        references.add(value);
        break;
      }
    }
    if (references.length >= 3) break;
  }
  return references.join('、');
}

class CommissionRecalculationWarning {
  const CommissionRecalculationWarning({
    required this.code,
    required this.message,
    required this.context,
  });

  final String code;
  final String message;
  final Map<String, dynamic>? context;

  factory CommissionRecalculationWarning.fromJson(
    Map<String, dynamic> json,
  ) {
    return CommissionRecalculationWarning(
      code: '${json['code'] ?? 'recalculation_warning'}',
      message: '${json['message'] ?? '重算产生待处理提示。'}',
      context: json['context'] is Map ? _map(json['context']) : null,
    );
  }
}

class TravelGroupFinanceSummaryRecord {
  const TravelGroupFinanceSummaryRecord({
    required this.id,
    required this.summaryExists,
    required this.travelGroupId,
    required this.travelGroup,
    required this.totalSalesAmountCents,
    required this.totalCashOnDeliveryCents,
    required this.totalPaidDepositCents,
    required this.confirmedRefundAmountCents,
    required this.effectiveSalesAmountCents,
    required this.afterSalesCount,
    required this.activeAfterSalesCount,
    required this.pendingAfterSalesRefundCount,
    required this.pendingAfterSalesRefundAmountCents,
    required this.latestAfterSalesNo,
    required this.latestAfterSalesStatus,
    required this.afterSalesImpactStatus,
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
    this.financeRowId = '',
    this.rowKind = 'travel_group_summary',
    this.orderType = 'travel_group',
    this.financeDate,
    this.afterSalesNo,
    this.sourceSalesOrderNo,
    this.afterSalesStatus,
    this.deductionCalculationMode,
    this.agencyDeductionAdjustmentCents,
    this.sourceAgencyDeductionCents = 0,
    this.financialEffectStatus,
    this.financeConfirmed = true,
    this.financialAmountsReady = true,
    this.includedInFormalTotals = true,
  });

  final String? id;
  final bool summaryExists;
  final String travelGroupId;
  final Stage7TravelGroupSummaryRecord? travelGroup;
  final int totalSalesAmountCents;
  final int totalCashOnDeliveryCents;
  final int totalPaidDepositCents;
  final int confirmedRefundAmountCents;
  final int effectiveSalesAmountCents;
  final int afterSalesCount;
  final int activeAfterSalesCount;
  final int pendingAfterSalesRefundCount;
  final int pendingAfterSalesRefundAmountCents;
  final String? latestAfterSalesNo;
  final String? latestAfterSalesStatus;
  final String afterSalesImpactStatus;
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
  final String financeRowId;
  final String rowKind;
  final String orderType;
  final String? financeDate;
  final String? afterSalesNo;
  final String? sourceSalesOrderNo;
  final String? afterSalesStatus;
  final String? deductionCalculationMode;
  final int? agencyDeductionAdjustmentCents;
  final int sourceAgencyDeductionCents;
  final String? financialEffectStatus;
  final bool financeConfirmed;
  final bool financialAmountsReady;
  final bool includedInFormalTotals;

  bool get isAfterSales => rowKind == 'after_sales_adjustment';

  factory TravelGroupFinanceSummaryRecord.fromJson(
    Map<String, dynamic> json,
  ) {
    return TravelGroupFinanceSummaryRecord(
      id: _stringOrNull(json['id']),
      summaryExists: _boolValue(json['summaryExists'] ?? true),
      travelGroupId: '${json['travelGroupId'] ?? ''}',
      travelGroup: json['travelGroup'] is Map
          ? Stage7TravelGroupSummaryRecord.fromJson(_map(json['travelGroup']))
          : null,
      totalSalesAmountCents: _intValue(json['totalSalesAmountCents']),
      totalCashOnDeliveryCents: _intValue(json['totalCashOnDeliveryCents']),
      totalPaidDepositCents: _intValue(json['totalPaidDepositCents']),
      confirmedRefundAmountCents: _intValue(json['confirmedRefundAmountCents']),
      effectiveSalesAmountCents: _intValue(json['effectiveSalesAmountCents']),
      afterSalesCount: _intValue(json['afterSalesCount']),
      activeAfterSalesCount: _intValue(json['activeAfterSalesCount']),
      pendingAfterSalesRefundCount:
          _intValue(json['pendingAfterSalesRefundCount']),
      pendingAfterSalesRefundAmountCents:
          _intValue(json['pendingAfterSalesRefundAmountCents']),
      latestAfterSalesNo: _stringOrNull(json['latestAfterSalesNo']),
      latestAfterSalesStatus: _stringOrNull(json['latestAfterSalesStatus']),
      afterSalesImpactStatus:
          _stringOrNull(json['afterSalesImpactStatus']) ?? 'none',
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
      financeRowId: _stringOrNull(
            json['financeRowId'] ?? json['rowId'],
          ) ??
          '${json['travelGroupId'] ?? ''}',
      rowKind: '${json['rowKind'] ?? 'travel_group_summary'}',
      orderType: '${json['orderType'] ?? 'travel_group'}',
      financeDate: _stringOrNull(
        json['financeDate'] ?? _map(json['travelGroup'])['visitDate'],
      ),
      afterSalesNo: _stringOrNull(json['afterSalesNo']),
      sourceSalesOrderNo: _stringOrNull(json['sourceSalesOrderNo']),
      afterSalesStatus: _stringOrNull(json['afterSalesStatus']),
      deductionCalculationMode: _stringOrNull(json['deductionCalculationMode']),
      agencyDeductionAdjustmentCents:
          json.containsKey('agencyDeductionAdjustmentCents') &&
                  json['agencyDeductionAdjustmentCents'] != null
              ? _intValue(json['agencyDeductionAdjustmentCents'])
              : null,
      sourceAgencyDeductionCents: _intValue(json['sourceAgencyDeductionCents']),
      financialEffectStatus: _stringOrNull(json['financialEffectStatus']),
      financeConfirmed: _boolValue(json['financeConfirmed'] ?? true),
      financialAmountsReady: _boolValue(json['financialAmountsReady'] ?? true),
      includedInFormalTotals:
          _boolValue(json['includedInFormalTotals'] ?? true),
    );
  }
}

class GuidePointsSummaryRecord {
  const GuidePointsSummaryRecord({
    required this.id,
    required this.travelGroupId,
    required this.guideId,
    required this.guideNameSnapshot,
    required this.guide,
    required this.travelGroup,
    required this.orderCount,
    required this.totalSalesAmountCents,
    required this.totalCashOnDeliveryCents,
    required this.totalPaidDepositCents,
    required this.confirmedRefundAmountCents,
    required this.effectiveSalesAmountCents,
    required this.totalLiquorCostDeductionCents,
    required this.totalNetAmountCents,
    required this.totalDailyPointsCents,
    required this.totalMonthlyPointsCents,
    required this.paidPointsCents,
    required this.unpaidPointsCents,
    required this.paidDailyPointsCents,
    required this.unpaidDailyPointsCents,
    required this.paidMonthlyPointsCents,
    required this.unpaidMonthlyPointsCents,
    required this.dailyPointsPaid,
    required this.dailyPointsPaidBy,
    required this.dailyPointsPaidAt,
    required this.monthlyPointsPaid,
    required this.monthlyPointsPaidBy,
    required this.monthlyPointsPaidAt,
    required this.notes,
    required this.afterSalesImpactStatus,
    required this.orders,
    required this.calculationVersion,
    required this.updatedAt,
  });

  final String id;
  final String travelGroupId;
  final String guideId;
  final String guideNameSnapshot;
  final GuideRecord? guide;
  final Stage7TravelGroupSummaryRecord? travelGroup;
  final int orderCount;
  final int totalSalesAmountCents;
  final int totalCashOnDeliveryCents;
  final int totalPaidDepositCents;
  final int confirmedRefundAmountCents;
  final int effectiveSalesAmountCents;
  final int totalLiquorCostDeductionCents;
  final int totalNetAmountCents;
  final int totalDailyPointsCents;
  final int totalMonthlyPointsCents;
  final int paidPointsCents;
  final int unpaidPointsCents;
  final int paidDailyPointsCents;
  final int unpaidDailyPointsCents;
  final int paidMonthlyPointsCents;
  final int unpaidMonthlyPointsCents;
  final bool dailyPointsPaid;
  final Stage7UserSummaryRecord? dailyPointsPaidBy;
  final String? dailyPointsPaidAt;
  final bool monthlyPointsPaid;
  final Stage7UserSummaryRecord? monthlyPointsPaidBy;
  final String? monthlyPointsPaidAt;
  final String? notes;
  final String afterSalesImpactStatus;
  final List<GuidePointsOrderRecord> orders;
  final String? calculationVersion;
  final String? updatedAt;

  factory GuidePointsSummaryRecord.fromJson(Map<String, dynamic> json) {
    final impact = _map(json['afterSalesImpact']);
    return GuidePointsSummaryRecord(
      id: '${json['id'] ?? ''}',
      travelGroupId: '${json['travelGroupId'] ?? ''}',
      guideId: '${json['guideId'] ?? ''}',
      guideNameSnapshot: '${json['guideNameSnapshot'] ?? ''}',
      guide: json['guide'] is Map
          ? GuideRecord.fromJson(_map(json['guide']))
          : null,
      travelGroup: json['travelGroup'] is Map
          ? Stage7TravelGroupSummaryRecord.fromJson(
              _map(json['travelGroup']),
            )
          : null,
      orderCount: _intValue(json['orderCount']),
      totalSalesAmountCents: _intValue(json['totalSalesAmountCents']),
      totalCashOnDeliveryCents: _intValue(json['totalCashOnDeliveryCents']),
      totalPaidDepositCents: _intValue(json['totalPaidDepositCents']),
      confirmedRefundAmountCents: _intValue(json['confirmedRefundAmountCents']),
      effectiveSalesAmountCents: _intValue(json['effectiveSalesAmountCents']),
      totalLiquorCostDeductionCents:
          _intValue(json['totalLiquorCostDeductionCents']),
      totalNetAmountCents: _intValue(json['totalNetAmountCents']),
      totalDailyPointsCents: _intValue(json['totalDailyPointsCents']),
      totalMonthlyPointsCents: _intValue(json['totalMonthlyPointsCents']),
      paidPointsCents: _intValue(json['paidPointsCents']),
      unpaidPointsCents: _intValue(json['unpaidPointsCents']),
      paidDailyPointsCents: _intValue(json['paidDailyPointsCents']),
      unpaidDailyPointsCents: _intValue(json['unpaidDailyPointsCents']),
      paidMonthlyPointsCents: _intValue(json['paidMonthlyPointsCents']),
      unpaidMonthlyPointsCents: _intValue(json['unpaidMonthlyPointsCents']),
      dailyPointsPaid: _boolValue(json['dailyPointsPaid']),
      dailyPointsPaidBy: json['dailyPointsPaidBy'] is Map
          ? Stage7UserSummaryRecord.fromJson(
              _map(json['dailyPointsPaidBy']),
            )
          : null,
      dailyPointsPaidAt: _stringOrNull(json['dailyPointsPaidAt']),
      monthlyPointsPaid: _boolValue(json['monthlyPointsPaid']),
      monthlyPointsPaidBy: json['monthlyPointsPaidBy'] is Map
          ? Stage7UserSummaryRecord.fromJson(
              _map(json['monthlyPointsPaidBy']),
            )
          : null,
      monthlyPointsPaidAt: _stringOrNull(json['monthlyPointsPaidAt']),
      notes: _stringOrNull(json['notes']),
      afterSalesImpactStatus: _stringOrNull(impact['status']) ?? 'none',
      orders:
          _list(json['orders']).map(GuidePointsOrderRecord.fromJson).toList(),
      calculationVersion: _stringOrNull(json['calculationVersion']),
      updatedAt: _stringOrNull(json['updatedAt']),
    );
  }
}

class GuidePointsOrderRecord {
  const GuidePointsOrderRecord({
    required this.id,
    required this.orderNo,
    required this.orderDate,
    required this.customerName,
    required this.status,
    required this.grossAmountCents,
    required this.confirmedRefundAmountCents,
    required this.effectiveAmountCents,
    required this.liquorCostDeductionCents,
    required this.netAmountCents,
    required this.guideId,
    required this.guideName,
    required this.dailyRebateRate,
    required this.dailyPointsCents,
    required this.monthlyRebateRate,
    required this.monthlyPointsCents,
  });

  final String id;
  final String orderNo;
  final String? orderDate;
  final String customerName;
  final String status;
  final int grossAmountCents;
  final int confirmedRefundAmountCents;
  final int effectiveAmountCents;
  final int liquorCostDeductionCents;
  final int netAmountCents;
  final String? guideId;
  final String? guideName;
  final String dailyRebateRate;
  final int dailyPointsCents;
  final String monthlyRebateRate;
  final int monthlyPointsCents;

  factory GuidePointsOrderRecord.fromJson(Map<String, dynamic> json) {
    return GuidePointsOrderRecord(
      id: '${json['id'] ?? ''}',
      orderNo: '${json['orderNo'] ?? ''}',
      orderDate: _stringOrNull(json['orderDate']),
      customerName: '${json['customerName'] ?? ''}',
      status: '${json['status'] ?? ''}',
      grossAmountCents: _intValue(json['grossAmountCents']),
      confirmedRefundAmountCents: _intValue(json['confirmedRefundAmountCents']),
      effectiveAmountCents: _intValue(json['effectiveAmountCents']),
      liquorCostDeductionCents: _intValue(json['liquorCostDeductionCents']),
      netAmountCents: _intValue(json['netAmountCents']),
      guideId: _stringOrNull(json['guideId']),
      guideName: _stringOrNull(json['guideName']),
      dailyRebateRate: _stringOrNull(json['dailyRebateRate']) ?? '0.0000',
      dailyPointsCents: _intValue(json['dailyPointsCents']),
      monthlyRebateRate: _stringOrNull(json['monthlyRebateRate']) ?? '0.0000',
      monthlyPointsCents: _intValue(json['monthlyPointsCents']),
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

class SalesPerformanceRecord {
  const SalesPerformanceRecord({
    required this.salesUserId,
    required this.salesUserName,
    required this.isActive,
    required this.isUnassigned,
    required this.orderCount,
    required this.grossSalesAmountCents,
    required this.refundAmountCents,
    required this.netSalesAmountCents,
    required this.averageSalesPerOrderCents,
  });

  final String? salesUserId;
  final String salesUserName;
  final bool isActive;
  final bool isUnassigned;
  final int orderCount;
  final int grossSalesAmountCents;
  final int refundAmountCents;
  final int netSalesAmountCents;
  final int? averageSalesPerOrderCents;

  factory SalesPerformanceRecord.fromJson(Map<String, dynamic> json) {
    return SalesPerformanceRecord(
      salesUserId: _stringOrNull(json['salesUserId']),
      salesUserName: '${json['salesUserName'] ?? ''}',
      isActive: _boolValue(json['isActive']),
      isUnassigned: _boolValue(json['isUnassigned']),
      orderCount: _intValue(json['orderCount']),
      grossSalesAmountCents: _intValue(json['grossSalesAmountCents']),
      refundAmountCents: _intValue(json['refundAmountCents']),
      netSalesAmountCents: _intValue(json['netSalesAmountCents']),
      averageSalesPerOrderCents: json['averageSalesPerOrderCents'] == null
          ? null
          : _intValue(json['averageSalesPerOrderCents']),
    );
  }
}

class SalesPerformanceOrder {
  const SalesPerformanceOrder({
    required this.id,
    required this.orderNo,
    required this.orderDate,
    required this.customerName,
    required this.status,
    required this.grossSalesAmountCents,
    required this.refundAmountCents,
    required this.netSalesAmountCents,
    required this.contributesToOrderCount,
    required this.afterSalesOrderIds,
  });

  final String id;
  final String orderNo;
  final String? orderDate;
  final String customerName;
  final String status;
  final int grossSalesAmountCents;
  final int refundAmountCents;
  final int netSalesAmountCents;
  final bool contributesToOrderCount;
  final List<String> afterSalesOrderIds;

  factory SalesPerformanceOrder.fromJson(Map<String, dynamic> json) {
    return SalesPerformanceOrder(
      id: '${json['id'] ?? ''}',
      orderNo: '${json['orderNo'] ?? ''}',
      orderDate: _stringOrNull(json['orderDate']),
      customerName: '${json['customerName'] ?? ''}',
      status: '${json['status'] ?? ''}',
      grossSalesAmountCents: _intValue(json['grossSalesAmountCents']),
      refundAmountCents: _intValue(json['refundAmountCents']),
      netSalesAmountCents: _intValue(json['netSalesAmountCents']),
      contributesToOrderCount: _boolValue(json['contributesToOrderCount']),
      afterSalesOrderIds: _stringList(json['afterSalesOrderIds']),
    );
  }
}

class SalesPerformanceDetail {
  const SalesPerformanceDetail({
    required this.range,
    required this.salesUserId,
    required this.salesUserName,
    required this.isActive,
    required this.isUnassigned,
    required this.summary,
    required this.orders,
  });

  final AnalyticsDateRange range;
  final String? salesUserId;
  final String salesUserName;
  final bool isActive;
  final bool isUnassigned;
  final SalesPerformanceRecord summary;
  final List<SalesPerformanceOrder> orders;

  factory SalesPerformanceDetail.fromJson(Map<String, dynamic> json) {
    final salesUser = _map(json['salesUser']);
    final summary = SalesPerformanceRecord.fromJson(_map(json['summary']));
    return SalesPerformanceDetail(
      range: AnalyticsDateRange.fromJson(_map(json['range'])),
      salesUserId: _stringOrNull(salesUser['id']) ?? summary.salesUserId,
      salesUserName: _stringOrNull(salesUser['name']) ?? summary.salesUserName,
      isActive: salesUser.containsKey('isActive')
          ? _boolValue(salesUser['isActive'])
          : summary.isActive,
      isUnassigned: salesUser.containsKey('isUnassigned')
          ? _boolValue(salesUser['isUnassigned'])
          : summary.isUnassigned,
      summary: summary,
      orders:
          _list(json['orders']).map(SalesPerformanceOrder.fromJson).toList(),
    );
  }
}

class DailyLossProfitResponse {
  const DailyLossProfitResponse({
    required this.range,
    required this.summary,
    required this.items,
    required this.pagination,
  });

  final AnalyticsDateRange range;
  final DailyLossProfitSummary summary;
  final List<DailyLossProfitRecord> items;
  final ProfitAnalysisPagination pagination;

  factory DailyLossProfitResponse.fromJson(Map<String, dynamic> json) {
    return DailyLossProfitResponse(
      range: AnalyticsDateRange.fromJson(_map(json['range'])),
      summary: DailyLossProfitSummary.fromJson(_map(json['summary'])),
      items: _list(json['items']).map(DailyLossProfitRecord.fromJson).toList(),
      pagination: ProfitAnalysisPagination.fromJson(_map(json['pagination'])),
    );
  }
}

class DailyLossProfitSummary {
  const DailyLossProfitSummary({
    required this.rowCount,
    required this.totalLossQuantity,
    required this.calculableLossQuantity,
    required this.unpricedLossQuantity,
    required this.estimatedProfitLossCents,
    required this.knownEstimatedProfitLossCents,
    required this.incompleteRowCount,
    required this.costCoverageStatus,
  });

  final int rowCount;
  final int totalLossQuantity;
  final int calculableLossQuantity;
  final int unpricedLossQuantity;
  final int? estimatedProfitLossCents;
  final int knownEstimatedProfitLossCents;
  final int incompleteRowCount;
  final String costCoverageStatus;

  factory DailyLossProfitSummary.fromJson(Map<String, dynamic> json) {
    final incompleteRowCount = _intValue(json['incompleteRowCount']);
    return DailyLossProfitSummary(
      rowCount: _intValue(json['rowCount']),
      totalLossQuantity: _intValue(json['totalLossQuantity']),
      calculableLossQuantity: _intValue(json['calculableLossQuantity']),
      unpricedLossQuantity: _intValue(json['unpricedLossQuantity']),
      estimatedProfitLossCents: json['estimatedProfitLossCents'] == null
          ? null
          : _intValue(json['estimatedProfitLossCents']),
      knownEstimatedProfitLossCents:
          _intValue(json['knownEstimatedProfitLossCents']),
      incompleteRowCount: incompleteRowCount,
      costCoverageStatus: _stringOrNull(json['costCoverageStatus']) ??
          (incompleteRowCount > 0 ? 'incomplete' : 'complete'),
    );
  }
}

class DailyLossProfitRecord {
  const DailyLossProfitRecord({
    required this.date,
    required this.productId,
    required this.productName,
    required this.tastingRoomNo,
    required this.operatorId,
    required this.operatorName,
    required this.lossQuantity,
    required this.unit,
    required this.estimatedProfitLossCents,
    required this.costCoverageStatus,
    required this.warnings,
  });

  final String date;
  final String? productId;
  final String productName;
  final String tastingRoomNo;
  final String? operatorId;
  final String operatorName;
  final int lossQuantity;
  final String unit;
  final int? estimatedProfitLossCents;
  final String costCoverageStatus;
  final List<AnalyticsWarning> warnings;

  factory DailyLossProfitRecord.fromJson(Map<String, dynamic> json) {
    final estimatedProfitLossCents = json['estimatedProfitLossCents'] == null
        ? null
        : _intValue(json['estimatedProfitLossCents']);
    return DailyLossProfitRecord(
      date: '${json['date'] ?? ''}',
      productId: _stringOrNull(json['productId']),
      productName: '${json['productName'] ?? ''}',
      tastingRoomNo: _stringOrNull(json['tastingRoomNo']) ?? '未填写',
      operatorId: _stringOrNull(json['operatorId']),
      operatorName: _stringOrNull(json['operatorName']) ?? '未知操作员',
      lossQuantity: _intValue(json['lossQuantity']),
      unit: '${json['unit'] ?? ''}',
      estimatedProfitLossCents: estimatedProfitLossCents,
      costCoverageStatus: _stringOrNull(json['costCoverageStatus']) ??
          (estimatedProfitLossCents == null ? 'unavailable' : 'available'),
      warnings: _analyticsWarnings(json['warnings']),
    );
  }
}

class ProfitAnalysisResponse {
  const ProfitAnalysisResponse({
    required this.range,
    required this.summary,
    required this.items,
    required this.pagination,
  });

  final AnalyticsDateRange range;
  final ProfitAnalysisSummary summary;
  final List<TravelGroupProfitRecord> items;
  final ProfitAnalysisPagination pagination;

  factory ProfitAnalysisResponse.fromJson(Map<String, dynamic> json) {
    return ProfitAnalysisResponse(
      range: AnalyticsDateRange.fromJson(_map(json['range'])),
      summary: ProfitAnalysisSummary.fromJson(_map(json['summary'])),
      items:
          _list(json['items']).map(TravelGroupProfitRecord.fromJson).toList(),
      pagination: ProfitAnalysisPagination.fromJson(_map(json['pagination'])),
    );
  }
}

class ProfitAnalysisSummary {
  const ProfitAnalysisSummary({
    required this.groupCount,
    required this.completeGroupCount,
    required this.estimatedGroupCount,
    required this.incompleteGroupCount,
    required this.noSalesGroupCount,
    required this.effectiveSalesAmountCents,
    required this.actualProductCostCents,
    required this.taxFeeCents,
    required this.paymentServiceFeeCents,
    required this.totalExpenseCents,
    required this.estimatedProfitCents,
    required this.knownEstimatedProfitCents,
    required this.estimatedProfitRate,
  });

  final int groupCount;
  final int completeGroupCount;
  final int estimatedGroupCount;
  final int incompleteGroupCount;
  final int noSalesGroupCount;
  final int effectiveSalesAmountCents;
  final int actualProductCostCents;
  final int? taxFeeCents;
  final int? paymentServiceFeeCents;
  final int totalExpenseCents;
  final int? estimatedProfitCents;
  final int knownEstimatedProfitCents;
  final double? estimatedProfitRate;

  int get calculableGroupCount =>
      completeGroupCount + estimatedGroupCount + noSalesGroupCount;

  factory ProfitAnalysisSummary.fromJson(Map<String, dynamic> json) {
    return ProfitAnalysisSummary(
      groupCount: _intValue(json['groupCount']),
      completeGroupCount: _intValue(json['completeGroupCount']),
      estimatedGroupCount: _intValue(json['estimatedGroupCount']),
      incompleteGroupCount: _intValue(json['incompleteGroupCount']),
      noSalesGroupCount: _intValue(json['noSalesGroupCount']),
      effectiveSalesAmountCents: _intValue(json['effectiveSalesAmountCents']),
      actualProductCostCents: _intValue(json['actualProductCostCents']),
      taxFeeCents: _nullableNewCentsField(json, 'taxFeeCents'),
      paymentServiceFeeCents:
          _nullableNewCentsField(json, 'paymentServiceFeeCents'),
      totalExpenseCents: _intValue(json['totalExpenseCents']),
      estimatedProfitCents: json['estimatedProfitCents'] == null
          ? null
          : _intValue(json['estimatedProfitCents']),
      knownEstimatedProfitCents: _intValue(json['knownEstimatedProfitCents']),
      estimatedProfitRate: json['estimatedProfitRate'] == null
          ? null
          : _doubleValue(json['estimatedProfitRate']),
    );
  }
}

class TravelGroupProfitRecord {
  const TravelGroupProfitRecord({
    required this.travelGroupId,
    required this.groupNo,
    required this.visitDate,
    required this.travelAgency,
    required this.guideName,
    required this.tasterName,
    required this.guestCount,
    required this.orderCount,
    required this.effectiveSalesAmountCents,
    required this.confirmedRefundAmountCents,
    required this.pendingRefundAmountCents,
    required this.actualProductCostCents,
    required this.logisticsFeeCents,
    required this.parkingFeeCents,
    required this.cigaretteFeeCents,
    required this.salesCommissionCents,
    required this.salesCommissionCalculated,
    required this.leaderCommissionCents,
    required this.leaderCommissionCalculated,
    required this.outreachCommissionCents,
    required this.outreachCommissionCalculated,
    required this.employeeCommissionCents,
    required this.tasterCommissionCents,
    required this.dailyAgencyRebateCents,
    required this.monthlyAgencyRebateCents,
    required this.taxFeeCents,
    required this.paymentServiceFeeCents,
    required this.paymentMethodFeeBreakdown,
    required this.totalExpenseCents,
    required this.estimatedProfitCents,
    required this.estimatedProfitRate,
    required this.calculationStatus,
    required this.warnings,
  });

  final String travelGroupId;
  final String groupNo;
  final String visitDate;
  final String travelAgency;
  final String guideName;
  final String tasterName;
  final int guestCount;
  final int orderCount;
  final int effectiveSalesAmountCents;
  final int confirmedRefundAmountCents;
  final int pendingRefundAmountCents;
  final int actualProductCostCents;
  final int logisticsFeeCents;
  final int parkingFeeCents;
  final int? cigaretteFeeCents;
  final int salesCommissionCents;
  final bool salesCommissionCalculated;
  final int leaderCommissionCents;
  final bool leaderCommissionCalculated;
  final int outreachCommissionCents;
  final bool outreachCommissionCalculated;
  final int employeeCommissionCents;
  final int tasterCommissionCents;
  final int dailyAgencyRebateCents;
  final int monthlyAgencyRebateCents;
  final int? taxFeeCents;
  final int? paymentServiceFeeCents;
  final List<PaymentMethodFeeBreakdownRecord> paymentMethodFeeBreakdown;
  final int totalExpenseCents;
  final int? estimatedProfitCents;
  final double? estimatedProfitRate;
  final String calculationStatus;
  final List<AnalyticsWarning> warnings;

  bool hasWarning(String code) =>
      warnings.any((warning) => warning.code == code);

  factory TravelGroupProfitRecord.fromJson(Map<String, dynamic> json) {
    return TravelGroupProfitRecord(
      travelGroupId: '${json['travelGroupId'] ?? ''}',
      groupNo: '${json['groupNo'] ?? ''}',
      visitDate: '${json['visitDate'] ?? ''}',
      travelAgency: '${json['travelAgency'] ?? ''}',
      guideName: '${json['guideName'] ?? ''}',
      tasterName: '${json['tasterName'] ?? ''}',
      guestCount: _intValue(json['guestCount']),
      orderCount: _intValue(json['orderCount']),
      effectiveSalesAmountCents: _intValue(json['effectiveSalesAmountCents']),
      confirmedRefundAmountCents: _intValue(json['confirmedRefundAmountCents']),
      pendingRefundAmountCents: _intValue(json['pendingRefundAmountCents']),
      actualProductCostCents: _intValue(json['actualProductCostCents']),
      logisticsFeeCents: _intValue(json['logisticsFeeCents']),
      parkingFeeCents: _intValue(json['parkingFeeCents']),
      cigaretteFeeCents: json['cigaretteFeeCents'] == null
          ? null
          : _intValue(json['cigaretteFeeCents']),
      salesCommissionCents: _intValue(json['salesCommissionCents']),
      salesCommissionCalculated: json.containsKey('salesCommissionCalculated')
          ? _boolValue(json['salesCommissionCalculated'])
          : true,
      leaderCommissionCents: _intValue(json['leaderCommissionCents']),
      leaderCommissionCalculated: json.containsKey('leaderCommissionCalculated')
          ? _boolValue(json['leaderCommissionCalculated'])
          : true,
      outreachCommissionCents: _intValue(json['outreachCommissionCents']),
      outreachCommissionCalculated:
          json.containsKey('outreachCommissionCalculated')
              ? _boolValue(json['outreachCommissionCalculated'])
              : true,
      employeeCommissionCents: _intValue(json['employeeCommissionCents']),
      tasterCommissionCents: _intValue(json['tasterCommissionCents']),
      dailyAgencyRebateCents: _intValue(json['dailyAgencyRebateCents']),
      monthlyAgencyRebateCents: _intValue(json['monthlyAgencyRebateCents']),
      taxFeeCents: _nullableNewCentsField(json, 'taxFeeCents'),
      paymentServiceFeeCents:
          _nullableNewCentsField(json, 'paymentServiceFeeCents'),
      paymentMethodFeeBreakdown: _list(json['paymentMethodFeeBreakdown'])
          .map(PaymentMethodFeeBreakdownRecord.fromJson)
          .toList(),
      totalExpenseCents: _intValue(json['totalExpenseCents']),
      estimatedProfitCents: json['estimatedProfitCents'] == null
          ? null
          : _intValue(json['estimatedProfitCents']),
      estimatedProfitRate: json['estimatedProfitRate'] == null
          ? null
          : _doubleValue(json['estimatedProfitRate']),
      calculationStatus:
          _stringOrNull(json['calculationStatus']) ?? 'incomplete',
      warnings: _analyticsWarnings(json['warnings']),
    );
  }
}

class PaymentMethodFeeBreakdownRecord {
  const PaymentMethodFeeBreakdownRecord({
    required this.paymentMethodId,
    required this.paymentMethodNameSnapshot,
    required this.serviceFeeRateSnapshot,
    required this.originalPaymentAmountCents,
    required this.sameDayRefundAmountCents,
    required this.serviceFeeBaseAmountCents,
    required this.serviceFeeCents,
    required this.orderCount,
  });

  final String? paymentMethodId;
  final String paymentMethodNameSnapshot;
  final String? serviceFeeRateSnapshot;
  final int? originalPaymentAmountCents;
  final int sameDayRefundAmountCents;
  final int? serviceFeeBaseAmountCents;
  final int? serviceFeeCents;
  final int orderCount;

  factory PaymentMethodFeeBreakdownRecord.fromJson(
    Map<String, dynamic> json,
  ) {
    return PaymentMethodFeeBreakdownRecord(
      paymentMethodId: _stringOrNull(json['paymentMethodId']),
      paymentMethodNameSnapshot:
          _stringOrNull(json['paymentMethodNameSnapshot']) ?? '',
      serviceFeeRateSnapshot: _stringOrNull(json['serviceFeeRateSnapshot']),
      originalPaymentAmountCents: json['originalPaymentAmountCents'] == null
          ? null
          : _intValue(json['originalPaymentAmountCents']),
      sameDayRefundAmountCents: _intValue(json['sameDayRefundAmountCents']),
      serviceFeeBaseAmountCents: json['serviceFeeBaseAmountCents'] == null
          ? null
          : _intValue(json['serviceFeeBaseAmountCents']),
      serviceFeeCents: json['serviceFeeCents'] == null
          ? null
          : _intValue(json['serviceFeeCents']),
      orderCount: _intValue(json['orderCount']),
    );
  }
}

class ProfitAnalysisPagination {
  const ProfitAnalysisPagination({
    required this.page,
    required this.pageSize,
    required this.total,
    required this.totalPages,
  });

  final int page;
  final int pageSize;
  final int total;
  final int totalPages;

  factory ProfitAnalysisPagination.fromJson(Map<String, dynamic> json) {
    return ProfitAnalysisPagination(
      page: _intValue(json['page']),
      pageSize: _intValue(json['pageSize']),
      total: _intValue(json['total']),
      totalPages: _intValue(json['totalPages']),
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
    required this.agencyId,
    required this.travelAgency,
    required this.guideId,
    required this.guideName,
    required this.guidePhone,
    required this.licensePlate,
    required this.guestCount,
    required this.tasterId,
    required this.tasterName,
    required this.financeMark,
  });

  final String? id;
  final String? groupNo;
  final String? visitDate;
  final String? agencyId;
  final String? travelAgency;
  final String? guideId;
  final String? guideName;
  final String? guidePhone;
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
      agencyId: _stringOrNull(json['agencyId']),
      travelAgency: _stringOrNull(json['travelAgency']),
      guideId: _stringOrNull(json['guideId']),
      guideName: _stringOrNull(json['guideName']),
      guidePhone: _stringOrNull(json['guidePhone']),
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
    required this.venueName,
    required this.afterSalesPhone,
    required this.order,
    required this.customer,
    required this.travelGroup,
    required this.salesUser,
    required this.items,
    this.paymentDetails = const <SalesSheetPaymentDetailRecord>[],
    this.paymentSummary = const PaymentSummaryRecord.empty(),
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
  final String? venueName;
  final String? afterSalesPhone;
  final SalesSheetOrderRecord order;
  final SalesSheetCustomerRecord customer;
  final SalesSheetTravelGroupRecord? travelGroup;
  final SalesSheetSalesUserRecord? salesUser;
  final List<SalesSheetItemRecord> items;
  final List<SalesSheetPaymentDetailRecord> paymentDetails;
  final PaymentSummaryRecord paymentSummary;
  final SalesSheetAmountsRecord amounts;
  final SalesSheetStatusRecord status;
  final SalesSheetDeliveryRecord delivery;
  final SalesSheetLogisticsRecord logistics;
  final SalesSheetInvoiceRecord invoice;
  final SalesSheetQrCode? qrCode;
  final Map<String, dynamic> internalFields;
  final SalesSheetRecord? public;

  factory SalesSheetRecord.fromJson(Map<String, dynamic> json) {
    final paymentDetails = _list(json['paymentDetails'])
        .map(SalesSheetPaymentDetailRecord.fromJson)
        .toList();
    final amounts = SalesSheetAmountsRecord.fromJson(_map(json['amounts']));
    final paymentSummary = json['paymentSummary'] is Map
        ? PaymentSummaryRecord.fromJson(_map(json['paymentSummary']))
        : PaymentSummaryRecord.fromSalesSheetDetails(
            paymentDetails: paymentDetails,
            totalAmountCents: amounts.totalAmountCents,
            cashOnDeliveryAmountCents: amounts.cashOnDeliveryAmountCents,
          );
    return SalesSheetRecord(
      visibility: '${json['visibility'] ?? 'internal'}',
      companyName: '${json['companyName'] ?? ''}',
      venueName: _stringOrNull(json['venueName']),
      afterSalesPhone: _stringOrNull(json['afterSalesPhone']),
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
      paymentDetails: paymentDetails,
      paymentSummary: paymentSummary,
      amounts: amounts,
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
      venueName: venueName,
      afterSalesPhone: afterSalesPhone,
      order: order,
      customer: customer,
      travelGroup: travelGroup,
      salesUser: salesUser,
      items: items,
      paymentDetails: paymentDetails,
      paymentSummary: paymentSummary,
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
    required this.shippingDate,
    required this.remark,
  });

  final String? id;
  final String? orderNo;
  final String? orderType;
  final String? orderTypeLabel;
  final String? salesFormNo;
  final String? orderDate;
  final String? shippingDate;
  final String? remark;

  factory SalesSheetOrderRecord.fromJson(Map<String, dynamic> json) {
    return SalesSheetOrderRecord(
      id: _stringOrNull(json['id']),
      orderNo: _stringOrNull(json['orderNo']),
      orderType: _stringOrNull(json['orderType']),
      orderTypeLabel: _stringOrNull(json['orderTypeLabel']),
      salesFormNo: _stringOrNull(json['salesFormNo']),
      orderDate: _stringOrNull(json['orderDate']),
      shippingDate: _stringOrNull(json['shippingDate']),
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

class SalesSheetPaymentDetailRecord {
  const SalesSheetPaymentDetailRecord({
    required this.id,
    required this.paymentMethodId,
    required this.paymentMethodNameSnapshot,
    required this.paymentMethodCategorySnapshot,
    required this.paymentMethodCategoryLabel,
    required this.amountCents,
    required this.amountYuan,
    required this.requiresAgencyConfirmation,
    required this.agencyCollectionConfirmed,
    required this.agencyCollectionConfirmedAt,
    required this.agencyCollectionConfirmedById,
    required this.agencyCollectionConfirmedByName,
    required this.confirmationStatus,
    required this.confirmationStatusLabel,
  });

  final String? id;
  final String? paymentMethodId;
  final String paymentMethodNameSnapshot;
  final String paymentMethodCategorySnapshot;
  final String paymentMethodCategoryLabel;
  final int amountCents;
  final String? amountYuan;
  final bool requiresAgencyConfirmation;
  final bool agencyCollectionConfirmed;
  final String? agencyCollectionConfirmedAt;
  final String? agencyCollectionConfirmedById;
  final String? agencyCollectionConfirmedByName;
  final String confirmationStatus;
  final String confirmationStatusLabel;

  bool get isCollectOnDelivery =>
      paymentMethodCategorySnapshot == 'collect_on_delivery';

  bool get isAgencyCollection => isCollectOnDelivery;

  factory SalesSheetPaymentDetailRecord.fromJson(
    Map<String, dynamic> json,
  ) {
    final category = _normalizePaymentMethodCategory(
      json['paymentMethodCategorySnapshot'],
    );
    final requiresAgencyConfirmation =
        json.containsKey('requiresAgencyConfirmation')
            ? _boolValue(json['requiresAgencyConfirmation'])
            : category == 'collect_on_delivery';
    final agencyCollectionConfirmed = _boolValue(
      json['agencyCollectionConfirmed'] ?? json['collectionConfirmed'],
    );
    final confirmationStatus = _stringOrNull(json['confirmationStatus']) ??
        (!requiresAgencyConfirmation
            ? 'not_required'
            : agencyCollectionConfirmed
                ? 'confirmed'
                : 'pending');
    return SalesSheetPaymentDetailRecord(
      id: _stringOrNull(json['id']),
      paymentMethodId: _stringOrNull(json['paymentMethodId']),
      paymentMethodNameSnapshot: '${json['paymentMethodNameSnapshot'] ?? ''}',
      paymentMethodCategorySnapshot: category,
      paymentMethodCategoryLabel:
          _stringOrNull(json['paymentMethodCategoryLabel']) ??
              (category == 'collect_on_delivery' ? '代收营业款' : '即时收款'),
      amountCents: _intValue(json['amountCents']),
      amountYuan: _stringOrNull(json['amountYuan']),
      requiresAgencyConfirmation: requiresAgencyConfirmation,
      agencyCollectionConfirmed: agencyCollectionConfirmed,
      agencyCollectionConfirmedAt: _stringOrNull(
        json['agencyCollectionConfirmedAt'] ?? json['collectionConfirmedAt'],
      ),
      agencyCollectionConfirmedById: _stringOrNull(
        json['agencyCollectionConfirmedById'] ??
            json['collectionConfirmedById'],
      ),
      agencyCollectionConfirmedByName: _stringOrNull(
        json['agencyCollectionConfirmedByName'] ??
            json['collectionConfirmedByName'] ??
            _map(
              json['agencyCollectionConfirmedBy'] ??
                  json['collectionConfirmedBy'],
            )['name'],
      ),
      confirmationStatus: confirmationStatus,
      confirmationStatusLabel: _stringOrNull(json['confirmationStatusLabel']) ??
          (confirmationStatus == 'confirmed'
              ? '已确认到账'
              : confirmationStatus == 'pending'
                  ? '代收款（待确认）'
                  : '无需确认'),
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
    required this.providerCode,
    required this.providerName,
    required this.logisticsNo,
    required this.packingStatus,
    required this.packingStatusLabel,
    required this.packageCount,
    required this.trackingState,
    required this.trackingStateLabel,
    required this.trackingLatestLocation,
    required this.trackingLatestDescription,
    required this.trackingEventAt,
    required this.trackingCheckedAt,
    required this.trackingMessage,
  });

  final String? method;
  final String? providerCode;
  final String? providerName;
  final String? logisticsNo;
  final String? packingStatus;
  final String? packingStatusLabel;
  final int packageCount;
  final String? trackingState;
  final String? trackingStateLabel;
  final String? trackingLatestLocation;
  final String? trackingLatestDescription;
  final String? trackingEventAt;
  final String? trackingCheckedAt;
  final String? trackingMessage;

  factory SalesSheetLogisticsRecord.fromJson(Map<String, dynamic> json) {
    return SalesSheetLogisticsRecord(
      method: _stringOrNull(json['method']),
      providerCode: _stringOrNull(json['providerCode']),
      providerName: _stringOrNull(json['providerName']),
      logisticsNo: _stringOrNull(json['logisticsNo']),
      packingStatus: _stringOrNull(json['packingStatus']),
      packingStatusLabel: _stringOrNull(json['packingStatusLabel']),
      packageCount: _intValue(json['packageCount']),
      trackingState: _stringOrNull(json['trackingState']),
      trackingStateLabel: _stringOrNull(json['trackingStateLabel']),
      trackingLatestLocation: _stringOrNull(json['trackingLatestLocation']),
      trackingLatestDescription:
          _stringOrNull(json['trackingLatestDescription']),
      trackingEventAt: _stringOrNull(json['trackingEventAt']),
      trackingCheckedAt: _stringOrNull(json['trackingCheckedAt']),
      trackingMessage: _stringOrNull(json['trackingMessage']),
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

class SpecialOrderListPage {
  const SpecialOrderListPage({
    required this.orders,
    required this.total,
    required this.pendingCount,
  });

  final List<SpecialOrderRecord> orders;
  final int total;
  final int pendingCount;

  factory SpecialOrderListPage.fromJson(Map<String, dynamic> json) {
    return SpecialOrderListPage(
      orders: _list(json['orders']).map(SpecialOrderRecord.fromJson).toList(),
      total: _intValue(json['total']),
      pendingCount: _intValue(json['pendingCount']),
    );
  }
}

class SpecialOrderRecord {
  const SpecialOrderRecord({
    required this.id,
    required this.orderNo,
    required this.orderType,
    required this.workflowStatus,
    required this.workflowVersion,
    required this.orderDate,
    required this.customerId,
    required this.customerName,
    this.customerPhone,
    this.province,
    this.city,
    this.district,
    this.address,
    this.customerNotes,
    this.status,
    required this.hasOriginalPurchase,
    required this.sourceSalesOrderId,
    required this.sourceRemark,
    required this.internalEmployeeId,
    required this.internalEmployeeName,
    required this.externalPartyType,
    required this.externalPartyId,
    required this.externalPartyName,
    required this.totalAmountCents,
    required this.remark,
    required this.rejectionReason,
    required this.unapprovalReason,
    required this.createdById,
    required this.createdByName,
    required this.approvedByName,
    required this.createdAt,
    required this.approvedAt,
    required this.completedAt,
    required this.items,
    required this.workflowEvents,
    required this.settlement,
    required this.receivableTotalCents,
    required this.payableTotalCents,
    required this.netCashFlowCents,
  });

  final String id;
  final String orderNo;
  final String orderType;
  final String workflowStatus;
  final int workflowVersion;
  final String orderDate;
  final String? customerId;
  final String customerName;
  final String? customerPhone;
  final String? province;
  final String? city;
  final String? district;
  final String? address;
  final String? customerNotes;
  final String? status;
  final bool? hasOriginalPurchase;
  final String? sourceSalesOrderId;
  final String? sourceRemark;
  final String? internalEmployeeId;
  final String? internalEmployeeName;
  final String? externalPartyType;
  final String? externalPartyId;
  final String? externalPartyName;
  final int totalAmountCents;
  final String? remark;
  final String? rejectionReason;
  final String? unapprovalReason;
  final String? createdById;
  final String? createdByName;
  final String? approvedByName;
  final String? createdAt;
  final String? approvedAt;
  final String? completedAt;
  final List<SpecialOrderItemRecord> items;
  final List<SpecialOrderWorkflowEventRecord> workflowEvents;
  final SpecialOrderSettlementRecord? settlement;
  final int receivableTotalCents;
  final int payableTotalCents;
  final int netCashFlowCents;

  bool get isEditable =>
      workflowStatus == 'draft' || workflowStatus == 'rejected';

  factory SpecialOrderRecord.fromJson(Map<String, dynamic> json) {
    final financial = _map(json['financial']);
    final internalEmployee = _map(json['internalEmployee']);
    final createdBy = _map(json['createdBy']);
    final approvedBy = _map(json['approvedBy']);
    return SpecialOrderRecord(
      id: '${json['id'] ?? ''}',
      orderNo: '${json['orderNo'] ?? ''}',
      orderType: '${json['orderType'] ?? ''}'.toLowerCase(),
      workflowStatus: '${json['workflowStatus'] ?? ''}'.toLowerCase(),
      workflowVersion: _intValue(json['workflowVersion']),
      orderDate: '${json['orderDate'] ?? ''}',
      customerId: _stringOrNull(json['customerId']),
      customerName: '${json['customerName'] ?? ''}',
      customerPhone: _stringOrNull(json['customerPhone']),
      province: _stringOrNull(json['province']),
      city: _stringOrNull(json['city']),
      district: _stringOrNull(json['district']),
      address: _stringOrNull(json['address']),
      customerNotes: _stringOrNull(json['customerNotes']),
      status: _stringOrNull(json['status'])?.toLowerCase(),
      hasOriginalPurchase: json['hasOriginalPurchase'] == null
          ? null
          : _boolValue(json['hasOriginalPurchase']),
      sourceSalesOrderId: _stringOrNull(json['sourceSalesOrderId']),
      sourceRemark: _stringOrNull(json['sourceRemark']),
      internalEmployeeId: _stringOrNull(json['internalEmployeeId']),
      internalEmployeeName: _stringOrNull(internalEmployee['name']),
      externalPartyType: _stringOrNull(json['externalPartyType']),
      externalPartyId: _stringOrNull(json['externalPartyId']),
      externalPartyName: _stringOrNull(json['externalPartyNameSnapshot']),
      totalAmountCents: _intValue(json['totalAmountCents']),
      remark: _stringOrNull(json['remark']),
      rejectionReason: _stringOrNull(json['rejectionReason']),
      unapprovalReason: _stringOrNull(json['unapprovalReason']),
      createdById: _stringOrNull(json['createdById']),
      createdByName: _stringOrNull(createdBy['name']),
      approvedByName: _stringOrNull(approvedBy['name']),
      createdAt: _stringOrNull(json['createdAt']),
      approvedAt: _stringOrNull(json['approvedAt']),
      completedAt: _stringOrNull(json['completedAt']),
      items: _list(json['items']).map(SpecialOrderItemRecord.fromJson).toList(),
      workflowEvents: _list(json['workflowEvents'])
          .map(SpecialOrderWorkflowEventRecord.fromJson)
          .toList(),
      settlement: json['settlement'] is Map
          ? SpecialOrderSettlementRecord.fromJson(
              _map(json['settlement']),
            )
          : null,
      receivableTotalCents: _intValue(financial['receivableTotalCents']),
      payableTotalCents: _intValue(financial['payableTotalCents']),
      netCashFlowCents: _intValue(financial['netCashFlowCents']),
    );
  }
}

class SpecialOrderItemRecord {
  const SpecialOrderItemRecord({
    required this.id,
    required this.productId,
    required this.productName,
    required this.unit,
    required this.inventoryTrackingMode,
    required this.warehouseId,
    required this.warehouseName,
    required this.quantity,
    required this.listUnitPriceCents,
    required this.unitPriceCents,
    required this.discountAmountCents,
    required this.subtotalCents,
    required this.isGift,
    required this.priceOverrideReason,
    required this.adjustmentReason,
    required this.inventoryCondition,
    required this.deliveryType,
    required this.notes,
    required this.logisticsCodes,
  });

  final String id;
  final String productId;
  final String productName;
  final String unit;
  final String inventoryTrackingMode;
  final String? warehouseId;
  final String? warehouseName;
  final int quantity;
  final int listUnitPriceCents;
  final int unitPriceCents;
  final int discountAmountCents;
  final int subtotalCents;
  final bool isGift;
  final String? priceOverrideReason;
  final String? adjustmentReason;
  final String inventoryCondition;
  final String deliveryType;
  final String? notes;
  final List<String> logisticsCodes;

  factory SpecialOrderItemRecord.fromJson(Map<String, dynamic> json) {
    final warehouse = _map(json['warehouse']);
    return SpecialOrderItemRecord(
      id: '${json['id'] ?? ''}',
      productId: '${json['productId'] ?? ''}',
      productName: '${json['productName'] ?? ''}',
      unit: '${json['unit'] ?? ''}',
      inventoryTrackingMode:
          '${json['inventoryTrackingMode'] ?? 'none'}'.toLowerCase(),
      warehouseId: _stringOrNull(json['warehouseId']),
      warehouseName: _stringOrNull(warehouse['name']),
      quantity: _intValue(json['quantity']),
      listUnitPriceCents: _intValue(json['listUnitPriceCents']),
      unitPriceCents: _intValue(json['unitPriceCents']),
      discountAmountCents: _intValue(json['discountAmountCents']),
      subtotalCents: _intValue(json['subtotalCents']),
      isGift: _boolValue(json['isGift']),
      priceOverrideReason: _stringOrNull(json['priceOverrideReason']),
      adjustmentReason: _stringOrNull(json['adjustmentReason']),
      inventoryCondition:
          '${json['inventoryCondition'] ?? 'saleable'}'.toLowerCase(),
      deliveryType: '${json['deliveryType'] ?? 'shipping'}'.toLowerCase(),
      notes: _stringOrNull(json['notes']),
      logisticsCodes: _stringList(json['logisticsCodes']),
    );
  }
}

class SpecialOrderWorkflowEventRecord {
  const SpecialOrderWorkflowEventRecord({
    required this.eventType,
    required this.fromStatus,
    required this.toStatus,
    required this.workflowVersion,
    required this.reason,
    required this.actorName,
    required this.createdAt,
  });

  final String eventType;
  final String? fromStatus;
  final String toStatus;
  final int workflowVersion;
  final String? reason;
  final String? actorName;
  final String? createdAt;

  factory SpecialOrderWorkflowEventRecord.fromJson(
    Map<String, dynamic> json,
  ) {
    return SpecialOrderWorkflowEventRecord(
      eventType: '${json['eventType'] ?? ''}'.toLowerCase(),
      fromStatus: _stringOrNull(json['fromStatus']),
      toStatus: '${json['toStatus'] ?? ''}'.toLowerCase(),
      workflowVersion: _intValue(json['workflowVersion']),
      reason: _stringOrNull(json['reason']),
      actorName: _stringOrNull(_map(json['actor'])['name']),
      createdAt: _stringOrNull(json['createdAt']),
    );
  }
}

class SpecialOrderSettlementRecord {
  const SpecialOrderSettlementRecord({
    required this.direction,
    required this.totalAmountCents,
    required this.settledAmountCents,
    required this.paymentStatus,
    required this.payments,
  });

  final String direction;
  final int totalAmountCents;
  final int settledAmountCents;
  final String paymentStatus;
  final List<Map<String, dynamic>> payments;

  factory SpecialOrderSettlementRecord.fromJson(Map<String, dynamic> json) {
    return SpecialOrderSettlementRecord(
      direction: '${json['direction'] ?? ''}'.toLowerCase(),
      totalAmountCents: _intValue(json['totalAmountCents']),
      settledAmountCents: _intValue(json['settledAmountCents']),
      paymentStatus: '${json['paymentStatus'] ?? 'unpaid'}'.toLowerCase(),
      payments: _list(json['payments']),
    );
  }
}

class SpecialOrderCommissionRecord {
  const SpecialOrderCommissionRecord({
    required this.id,
    required this.recipientType,
    required this.targetUserId,
    required this.recipientName,
    required this.ratePercent,
    required this.originalBaseAmountCents,
    required this.effectiveBaseAmountCents,
    required this.originalAmountCents,
    required this.adjustmentAmountCents,
    required this.effectiveAmountCents,
    required this.attributionDate,
    required this.note,
    required this.manualVersion,
    required this.isActive,
    required this.createdAt,
    required this.updatedAt,
    required this.adjustments,
  });

  final String id;
  final String recipientType;
  final String? targetUserId;
  final String recipientName;
  final String ratePercent;
  final int originalBaseAmountCents;
  final int effectiveBaseAmountCents;
  final int originalAmountCents;
  final int adjustmentAmountCents;
  final int effectiveAmountCents;
  final String? attributionDate;
  final String? note;
  final int manualVersion;
  final bool isActive;
  final String? createdAt;
  final String? updatedAt;
  final List<Map<String, dynamic>> adjustments;

  factory SpecialOrderCommissionRecord.fromJson(Map<String, dynamic> json) {
    return SpecialOrderCommissionRecord(
      id: '${json['id'] ?? ''}',
      recipientType: '${json['recipientType'] ?? ''}'.toLowerCase(),
      targetUserId: _stringOrNull(json['targetUserId']),
      recipientName: '${json['recipientName'] ?? ''}',
      ratePercent: '${json['ratePercent'] ?? '0'}',
      originalBaseAmountCents: _intValue(json['originalBaseAmountCents']),
      effectiveBaseAmountCents: _intValue(json['effectiveBaseAmountCents']),
      originalAmountCents: _intValue(json['originalAmountCents']),
      adjustmentAmountCents: _intValue(json['adjustmentAmountCents']),
      effectiveAmountCents: _intValue(json['effectiveAmountCents']),
      attributionDate: _stringOrNull(json['attributionDate']),
      note: _stringOrNull(json['note']),
      manualVersion: _intValue(json['manualVersion']),
      isActive: _boolValue(json['isActive']),
      createdAt: _stringOrNull(json['createdAt']),
      updatedAt: _stringOrNull(json['updatedAt']),
      adjustments: _list(json['adjustments']),
    );
  }
}

class SpecialOrderReferenceData {
  const SpecialOrderReferenceData({
    required this.employees,
    required this.products,
    required this.warehouses,
    required this.defaultWarehouse,
    required this.guides,
    required this.travelAgencies,
    required this.paymentMethods,
    required this.customers,
    required this.sourceSalesOrders,
  });

  final List<SpecialOrderReferenceOption> employees;
  final List<SpecialOrderReferenceOption> products;
  final List<SpecialOrderReferenceOption> warehouses;
  final SpecialOrderReferenceOption? defaultWarehouse;
  final List<SpecialOrderReferenceOption> guides;
  final List<SpecialOrderReferenceOption> travelAgencies;
  final List<SpecialOrderReferenceOption> paymentMethods;
  final List<SpecialOrderReferenceOption> customers;
  final List<SpecialOrderSourceSalesOrderOption> sourceSalesOrders;

  factory SpecialOrderReferenceData.fromJson(Map<String, dynamic> json) {
    List<SpecialOrderReferenceOption> options(String key) =>
        _list(json[key]).map(SpecialOrderReferenceOption.fromJson).toList();
    return SpecialOrderReferenceData(
      employees: options('employees'),
      products: options('products'),
      warehouses: options('warehouses'),
      defaultWarehouse: json['defaultWarehouse'] is Map
          ? SpecialOrderReferenceOption.fromJson(
              _map(json['defaultWarehouse']),
            )
          : null,
      guides: options('guides'),
      travelAgencies: options('travelAgencies'),
      paymentMethods: options('paymentMethods'),
      customers: options('customers'),
      sourceSalesOrders: _list(json['sourceSalesOrders'])
          .map(SpecialOrderSourceSalesOrderOption.fromJson)
          .toList(),
    );
  }
}

class SpecialOrderReferenceOption {
  const SpecialOrderReferenceOption({
    required this.id,
    required this.name,
    required this.code,
    required this.unit,
    required this.role,
    required this.phone,
    required this.inventoryTrackingMode,
    required this.isDefault,
    this.province,
    this.city,
    this.district,
    this.address,
    this.notes,
    this.category,
  });

  final String id;
  final String name;
  final String? code;
  final String? unit;
  final String? role;
  final String? phone;
  final String inventoryTrackingMode;
  final bool isDefault;
  final String? province;
  final String? city;
  final String? district;
  final String? address;
  final String? notes;
  final String? category;

  factory SpecialOrderReferenceOption.fromJson(Map<String, dynamic> json) {
    return SpecialOrderReferenceOption(
      id: '${json['id'] ?? ''}',
      name: '${json['name'] ?? json['username'] ?? ''}',
      code: _stringOrNull(json['code']),
      unit: _stringOrNull(json['unit']),
      role: _stringOrNull(json['role']),
      phone: _stringOrNull(json['phone'] ?? json['contactPhone']),
      inventoryTrackingMode:
          '${json['inventoryTrackingMode'] ?? 'none'}'.toLowerCase(),
      isDefault: _boolValue(json['isDefault']),
      province: _stringOrNull(json['province']),
      city: _stringOrNull(json['city']),
      district: _stringOrNull(json['district']),
      address: _stringOrNull(json['address']),
      notes: _stringOrNull(json['notes']),
      category: _stringOrNull(json['category'])?.toLowerCase(),
    );
  }
}

class SpecialOrderSourceSalesOrderOption {
  const SpecialOrderSourceSalesOrderOption({
    required this.id,
    required this.orderNo,
    required this.orderDate,
    required this.totalAmountCents,
  });

  final String id;
  final String orderNo;
  final String orderDate;
  final int totalAmountCents;

  factory SpecialOrderSourceSalesOrderOption.fromJson(
    Map<String, dynamic> json,
  ) {
    return SpecialOrderSourceSalesOrderOption(
      id: '${json['id'] ?? ''}',
      orderNo: '${json['orderNo'] ?? ''}',
      orderDate: '${json['orderDate'] ?? ''}',
      totalAmountCents: _intValue(json['totalAmountCents']),
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
    required this.payableTotalCents,
    required this.netCashFlowCents,
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
  final int payableTotalCents;
  final int netCashFlowCents;
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
      payableTotalCents: json.containsKey('payableTotalCents')
          ? _intValue(json['payableTotalCents'])
          : _intValue(json['buybackCents']),
      netCashFlowCents: json.containsKey('netCashFlowCents')
          ? _intValue(json['netCashFlowCents'])
          : _intValue(json['receivableTotalCents']) -
              _intValue(json['buybackCents']),
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

Map<String, dynamic> _withRecalculation(
  Map<String, dynamic> data,
  String recordKey,
) {
  final record = _map(data[recordKey]);
  if (data['recalculation'] is Map) {
    record['recalculation'] = _map(data['recalculation']);
  }
  return record;
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

List<CommissionRecalculationWarning> _recalculationWarnings(Object? value) {
  if (value is! List) {
    return const <CommissionRecalculationWarning>[];
  }
  return value
      .map((item) {
        if (item is Map) {
          return CommissionRecalculationWarning.fromJson(_map(item));
        }
        final code = _stringOrNull(item) ?? '';
        return CommissionRecalculationWarning(
          code: code,
          message: code,
          context: null,
        );
      })
      .where((warning) => warning.code.isNotEmpty)
      .toList();
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

String _travelGroupEntryStatus(
  Object? value, {
  required String? arrivalTime,
  required String? notEnteredConfirmedAt,
}) {
  if (notEnteredConfirmedAt != null) {
    return 'not_entered';
  }
  if (arrivalTime != null) {
    return 'entered';
  }
  final normalized = _stringOrNull(value)?.toLowerCase();
  if (const {'pending_entry', 'entered', 'not_entered'}.contains(normalized)) {
    return normalized!;
  }
  return 'pending_entry';
}

String? _stringOrNull(Object? value) {
  final text = value == null ? '' : '$value'.trim();
  return text.isEmpty ? null : text;
}

String _normalizePaymentMethodCategory(Object? value) {
  final category = '${value ?? 'direct_receipt'}'.trim().toLowerCase();
  if (category == 'agency_collection' || category == 'collect_on_delivery') {
    return 'collect_on_delivery';
  }
  return category.isEmpty ? 'direct_receipt' : category;
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

int? _nullableNewCentsField(
  Map<String, dynamic> json,
  String field,
) {
  if (!json.containsKey(field)) {
    return 0;
  }
  final value = json[field];
  return value == null ? null : _intValue(value);
}

double _doubleValue(Object? value) {
  if (value is num) {
    return value.toDouble();
  }
  return double.tryParse('${value ?? 0}') ?? 0;
}

double? _doubleOrNull(Object? value) {
  if (value == null) {
    return null;
  }
  if (value is num) {
    return value.toDouble();
  }
  return double.tryParse('$value');
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
