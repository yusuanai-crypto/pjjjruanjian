import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../api/api_client.dart';
import '../auth/role_access.dart';

// ---------------------------------------------------------------------------
// 命令信封 requestHash（与后端 inventory-command.policy.ts 对齐）
// ---------------------------------------------------------------------------

const inventoryCommandTypes = <String>[
  'INBOUND',
  'RESERVE',
  'RELEASE',
  'OUTBOUND',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'TRANSFER_CREATE',
  'TRANSFER_CONFIRM_OUTBOUND',
  'TRANSFER_RECEIVE',
  'TRANSFER_RECEIPT_REVERSE',
  'TRANSFER_OUTBOUND_REVERSE',
  'MARK_UNAVAILABLE',
  'RESTORE_AVAILABLE',
  'UPDATE_BATCH_COST',
  'REVERSE',
];

/// 计算库存命令的 requestHash。
///
/// 算法必须与后端 `calculateInventoryRequestHash` 完全一致：
/// 1. 用 normalizedBusinessKey 规范化 sourceKey / idempotencyKey（trim + 小写）。
/// 2. normalizeHashValue：DateTime → ISO 字符串；String → trim；删除 null 值键；递归。
/// 3. 删除 requestHash / requestId / documentScope。
/// 4. 包裹为 `{commandType, payload}`。
/// 5. canonicalJson（递归键排序）。
/// 6. SHA-256 小写十六进制。
///
/// 注意：后端对字符串做 NFKC 规范化，Dart 没有内置 NFKC。库存命令的
/// payload 主要由 ASCII ID 和整数组成，NFKC 对它们是恒等操作；客户端
/// 生成的 sourceKey / idempotencyKey 只使用 ASCII 字符，因此可安全省略
/// NFKC。reason 等自由文本字段如包含全角字符会导致 hash 不匹配，调用方
/// 应避免在命令文本中使用全角 ASCII。
String calculateInventoryRequestHash(
  String commandType,
  Map<String, dynamic> input,
) {
  final payloadInput = Map<String, dynamic>.from(input);
  payloadInput['sourceKey'] =
      _normalizeBusinessKey(payloadInput['sourceKey'] as String);
  payloadInput['idempotencyKey'] =
      _normalizeBusinessKey(payloadInput['idempotencyKey'] as String);
  final payload = _normalizeHashPayload(commandType, payloadInput);
  return sha256.convert(utf8.encode(canonicalJson(payload))).toString();
}

Map<String, dynamic> _normalizeHashPayload(
  String commandType,
  Map<String, dynamic> input,
) {
  final normalized = _normalizeHashValue(input) as Map<String, dynamic>;
  normalized.remove('requestHash');
  normalized.remove('requestId');
  normalized.remove('documentScope');
  return {'commandType': commandType, 'payload': normalized};
}

Object? _normalizeHashValue(Object? value) {
  if (value is DateTime) return value.toUtc().toIso8601String();
  if (value is String) return value.trim();
  if (value is List) return value.map(_normalizeHashValue).toList();
  if (value is Map) {
    final result = <String, dynamic>{};
    for (final entry in value.entries) {
      if (entry.value != null) {
        result[entry.key.toString()] = _normalizeHashValue(entry.value);
      }
    }
    return result;
  }
  return value;
}

String _normalizeBusinessKey(String value) {
  return value.trim().toLowerCase();
}

String canonicalJson(Object? value) {
  if (value == null) return 'null';
  if (value is bool) return value.toString();
  if (value is int) return value.toString();
  if (value is double) {
    if (value == value.truncate() && !value.isNaN && !value.isInfinite) {
      return value.truncate().toString();
    }
    return value.toString();
  }
  if (value is String) return jsonEncode(value);
  if (value is List) {
    return '[${value.map(canonicalJson).join(',')}]';
  }
  if (value is Map) {
    final keys = value.keys.map((k) => k.toString()).toList()..sort();
    return '{${keys.map((k) => '${jsonEncode(k)}:${canonicalJson(value[k])}').join(',')}}';
  }
  return jsonEncode(value);
}

/// 生成幂等命令信封（sourceKey + idempotencyKey + requestHash）。
Map<String, dynamic> buildCommandEnvelope(
  String commandType,
  Map<String, dynamic> payload, {
  String? sourceKey,
  String? idempotencyKey,
}) {
  final source = sourceKey ??
      'flutter-${DateTime.now().toUtc().toIso8601String()}';
  final idempotency = idempotencyKey ??
      'idem-${DateTime.now().microsecondsSinceEpoch}';
  final body = Map<String, dynamic>.from(payload);
  body['sourceKey'] = source;
  body['idempotencyKey'] = idempotency;
  body['requestHash'] = calculateInventoryRequestHash(commandType, body);
  return body;
}

// ---------------------------------------------------------------------------
// 通用 JSON 辅助
// ---------------------------------------------------------------------------

Map<String, dynamic> _map(Object? value) =>
    value is Map ? Map<String, dynamic>.from(value) : const {};

List _list(Object? value) => value is List ? value : const [];

int _int(Object? value, [int fallback = 0]) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value) ?? fallback;
  return fallback;
}

int? _intOrNull(Object? value) {
  if (value == null) return null;
  if (value is int) return value;
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value);
  return null;
}

bool _bool(Object? value, [bool fallback = false]) {
  if (value is bool) return value;
  if (value is String) return value.toLowerCase() == 'true';
  return fallback;
}

String _str(Object? value, [String fallback = '']) {
  if (value == null) return fallback;
  return value.toString();
}

String? _strOrNull(Object? value) {
  if (value == null) return null;
  return value.toString();
}

String _path(String base, Map<String, String> query) {
  if (query.isEmpty) return base;
  final pairs = query.entries
      .map((e) =>
          '${Uri.encodeQueryComponent(e.key)}=${Uri.encodeQueryComponent(e.value)}')
      .join('&');
  return '$base?$pairs';
}

void _putNonEmpty(Map<String, String> q, String key, String? value) {
  if (value != null && value.trim().isNotEmpty) q[key] = value.trim();
}

// ---------------------------------------------------------------------------
// 数据模型
// ---------------------------------------------------------------------------

class WarehouseRecord {
  const WarehouseRecord({
    required this.id,
    required this.code,
    required this.name,
    required this.address,
    required this.managerName,
    required this.isActive,
    required this.isDefault,
  });

  final String id;
  final String code;
  final String name;
  final String address;
  final String? managerName;
  final bool isActive;
  final bool isDefault;

  factory WarehouseRecord.fromJson(Map<String, dynamic> json) {
    final manager = _map(json['manager']);
    return WarehouseRecord(
      id: _str(json['id']),
      code: _str(json['code']),
      name: _str(json['name']),
      address: _str(json['address']),
      managerName: _strOrNull(manager['name']),
      isActive: _bool(json['isActive'], true),
      isDefault: _bool(json['isDefault']),
    );
  }
}

class StockRecord {
  const StockRecord({
    required this.id,
    required this.warehouseId,
    required this.productId,
    required this.warehouseName,
    required this.warehouseCode,
    required this.productName,
    required this.productUnit,
    required this.inventoryTrackingMode,
    required this.onHandQty,
    required this.reservedQty,
    required this.unavailableQty,
    required this.inTransitQty,
    required this.availableQty,
    required this.shortageQty,
    required this.lowStockEnabled,
    required this.minimumAvailableQty,
    required this.isLowStock,
    required this.inventoryCostAmountCents,
    required this.coverageStatus,
  });

  final String id;
  final String warehouseId;
  final String productId;
  final String warehouseName;
  final String warehouseCode;
  final String productName;
  final String productUnit;
  final String inventoryTrackingMode;
  final int onHandQty;
  final int reservedQty;
  final int unavailableQty;
  final int inTransitQty;
  final int availableQty;
  final int shortageQty;
  final bool lowStockEnabled;
  final int? minimumAvailableQty;
  final bool isLowStock;
  final int? inventoryCostAmountCents;
  final String coverageStatus;

  bool get hasShortage => shortageQty > 0;
  bool get isNegative => availableQty < 0;

  factory StockRecord.fromJson(Map<String, dynamic> json, {required bool canReadCost}) {
    final warehouse = _map(json['warehouse']);
    final product = _map(json['product']);
    final lowStock = _map(json['lowStock']);
    final cost = _map(json['inventoryCost']);
    return StockRecord(
      id: _str(json['id']),
      warehouseId: _str(json['warehouseId']),
      productId: _str(json['productId']),
      warehouseName: _str(warehouse['name']),
      warehouseCode: _str(warehouse['code']),
      productName: _str(product['name']),
      productUnit: _str(product['unit']),
      inventoryTrackingMode: _str(product['inventoryTrackingMode'], 'none').toLowerCase(),
      onHandQty: _int(json['onHandQty']),
      reservedQty: _int(json['reservedQty']),
      unavailableQty: _int(json['unavailableQty']),
      inTransitQty: _int(json['inTransitQty']),
      availableQty: _int(json['availableQty']),
      shortageQty: _int(json['shortageQty']),
      lowStockEnabled: _bool(lowStock['enabled']),
      minimumAvailableQty: _intOrNull(lowStock['minimumAvailableQty']),
      isLowStock: _bool(lowStock['isLowStock']),
      inventoryCostAmountCents:
          canReadCost ? _intOrNull(cost['inventoryAmountCents']) : null,
      coverageStatus: canReadCost
          ? _str(cost['coverageStatus'], 'not_applicable')
          : 'not_applicable',
    );
  }
}

class StockPage {
  const StockPage({
    required this.stocks,
    required this.page,
    required this.pageSize,
    required this.total,
    required this.totalPages,
  });

  final List<StockRecord> stocks;
  final int page;
  final int pageSize;
  final int total;
  final int totalPages;

  factory StockPage.fromJson(Map<String, dynamic> json,
      {required bool canReadCost}) {
    final pagination = _map(json['pagination']);
    return StockPage(
      stocks: _list(json['stocks'])
          .map((e) => StockRecord.fromJson(_map(e), canReadCost: canReadCost))
          .toList(),
      page: _int(pagination['page'], 1),
      pageSize: _int(pagination['pageSize'], 20),
      total: _int(pagination['total']),
      totalPages: _int(pagination['totalPages']),
    );
  }
}

class InboundDocumentLine {
  const InboundDocumentLine({
    required this.productId,
    required this.productName,
    required this.quantity,
    required this.condition,
    required this.purchaseUnitCostCents,
    required this.inventoryAmountCents,
  });

  final String productId;
  final String productName;
  final int quantity;
  final String condition;
  final int? purchaseUnitCostCents;
  final int? inventoryAmountCents;

  factory InboundDocumentLine.fromJson(Map<String, dynamic> json,
      {required bool canReadCost}) {
    return InboundDocumentLine(
      productId: _str(json['productId']),
      productName: _str(json['productName']),
      quantity: _int(json['quantity']),
      condition: _str(json['condition'], 'SALEABLE'),
      purchaseUnitCostCents:
          canReadCost ? _intOrNull(json['purchaseUnitCostCents']) : null,
      inventoryAmountCents:
          canReadCost ? _intOrNull(json['inventoryAmountCents']) : null,
    );
  }
}

class InboundDocumentRecord {
  const InboundDocumentRecord({
    required this.id,
    required this.type,
    required this.status,
    required this.warehouseName,
    required this.businessAt,
    required this.reason,
    required this.batchSupplierName,
    required this.batchPurchaseOrderNo,
    required this.batchProductionBatch,
    required this.batchCostStatus,
    required this.lines,
    required this.createdAt,
  });

  final String id;
  final String type;
  final String status;
  final String warehouseName;
  final String? businessAt;
  final String? reason;
  final String? batchSupplierName;
  final String? batchPurchaseOrderNo;
  final String? batchProductionBatch;
  final String batchCostStatus;
  final List<InboundDocumentLine> lines;
  final String? createdAt;

  String get typeLabel {
    switch (type) {
      case 'OPENING':
        return '期初';
      case 'PURCHASE_RECEIPT':
        return '采购入库';
      case 'OTHER_IN':
        return '其他入库';
      default:
        return type;
    }
  }

  factory InboundDocumentRecord.fromJson(Map<String, dynamic> json,
      {required bool canReadCost}) {
    final batch = _map(json['batch']);
    return InboundDocumentRecord(
      id: _str(json['id']),
      type: _str(json['type']),
      status: _str(json['status']),
      warehouseName: _str(_map(json['warehouse'])['name']),
      businessAt: _strOrNull(json['businessAt']),
      reason: _strOrNull(json['reason']),
      batchSupplierName: _strOrNull(batch['supplierName']),
      batchPurchaseOrderNo: _strOrNull(batch['purchaseOrderNo']),
      batchProductionBatch: _strOrNull(batch['productionBatch']),
      batchCostStatus: _str(batch['costStatus'], 'PENDING'),
      lines: _list(json['lines'])
          .map((e) =>
              InboundDocumentLine.fromJson(_map(e), canReadCost: canReadCost))
          .toList(),
      createdAt: _strOrNull(json['createdAt']),
    );
  }
}

class InboundDocumentPage {
  const InboundDocumentPage({
    required this.inbounds,
    required this.page,
    required this.pageSize,
    required this.total,
    required this.totalPages,
  });

  final List<InboundDocumentRecord> inbounds;
  final int page;
  final int pageSize;
  final int total;
  final int totalPages;

  factory InboundDocumentPage.fromJson(Map<String, dynamic> json,
      {required bool canReadCost}) {
    final pagination = _map(json['pagination']);
    return InboundDocumentPage(
      inbounds: _list(json['inbounds'])
          .map((e) => InboundDocumentRecord.fromJson(_map(e),
              canReadCost: canReadCost))
          .toList(),
      page: _int(pagination['page'], 1),
      pageSize: _int(pagination['pageSize'], 20),
      total: _int(pagination['total']),
      totalPages: _int(pagination['totalPages']),
    );
  }
}

class TransferLine {
  const TransferLine({
    required this.productId,
    required this.productName,
    required this.plannedQty,
    required this.receivedQty,
    required this.sourceAvailableQty,
    required this.targetAvailableQty,
  });

  final String productId;
  final String productName;
  final int plannedQty;
  final int receivedQty;
  final int sourceAvailableQty;
  final int targetAvailableQty;

  factory TransferLine.fromJson(Map<String, dynamic> json) {
    return TransferLine(
      productId: _str(json['productId']),
      productName: _str(json['productName']),
      plannedQty: _int(json['plannedQty']),
      receivedQty: _int(json['receivedQty']),
      sourceAvailableQty: _int(_map(json['sourceStock'])['availableQty']),
      targetAvailableQty: _int(_map(json['targetStock'])['availableQty']),
    );
  }
}

class TransferRecord {
  const TransferRecord({
    required this.id,
    required this.status,
    required this.fromWarehouseName,
    required this.toWarehouseName,
    required this.lines,
    required this.createdAt,
    required this.outboundAt,
  });

  final String id;
  final String status;
  final String fromWarehouseName;
  final String toWarehouseName;
  final List<TransferLine> lines;
  final String? createdAt;
  final String? outboundAt;

  String get statusLabel {
    switch (status) {
      case 'DRAFT':
        return '草稿';
      case 'OUTBOUND':
        return '已调出';
      case 'PARTIALLY_RECEIVED':
        return '部分到货';
      case 'RECEIVED':
        return '已到货';
      case 'CANCELLED':
        return '已取消';
      case 'REVERSED':
        return '已冲销';
      default:
        return status;
    }
  }

  factory TransferRecord.fromJson(Map<String, dynamic> json) {
    return TransferRecord(
      id: _str(json['id']),
      status: _str(json['status']),
      fromWarehouseName: _str(_map(json['fromWarehouse'])['name']),
      toWarehouseName: _str(_map(json['toWarehouse'])['name']),
      lines: _list(json['lines']).map((e) => TransferLine.fromJson(_map(e))).toList(),
      createdAt: _strOrNull(json['createdAt']),
      outboundAt: _strOrNull(_map(json['outboundDocument'])['businessAt']),
    );
  }
}

class TransferPage {
  const TransferPage({
    required this.transfers,
    required this.page,
    required this.pageSize,
    required this.total,
    required this.totalPages,
  });

  final List<TransferRecord> transfers;
  final int page;
  final int pageSize;
  final int total;
  final int totalPages;

  factory TransferPage.fromJson(Map<String, dynamic> json) {
    final pagination = _map(json['pagination']);
    return TransferPage(
      transfers: _list(json['transfers'])
          .map((e) => TransferRecord.fromJson(_map(e)))
          .toList(),
      page: _int(pagination['page'], 1),
      pageSize: _int(pagination['pageSize'], 20),
      total: _int(pagination['total']),
      totalPages: _int(pagination['totalPages']),
    );
  }
}

class StocktakeRecord {
  const StocktakeRecord({
    required this.id,
    required this.status,
    required this.warehouseName,
    required this.productName,
    required this.countedOnHandQty,
    required this.countedUnavailableQty,
    required this.systemOnHandQty,
    required this.varianceQty,
    required this.reason,
    required this.createdAt,
    required this.submittedAt,
    required this.approvedAt,
  });

  final String id;
  final String status;
  final String warehouseName;
  final String productName;
  final int? countedOnHandQty;
  final int? countedUnavailableQty;
  final int systemOnHandQty;
  final int? varianceQty;
  final String? reason;
  final String? createdAt;
  final String? submittedAt;
  final String? approvedAt;

  String get statusLabel {
    switch (status) {
      case 'DRAFT':
        return '草稿';
      case 'SUBMITTED':
        return '待审批';
      case 'APPROVED':
        return '已批准';
      case 'REJECTED':
        return '已驳回';
      case 'POSTED':
        return '已过账';
      case 'REVERSED':
        return '已冲销';
      default:
        return status;
    }
  }

  factory StocktakeRecord.fromJson(Map<String, dynamic> json) {
    return StocktakeRecord(
      id: _str(json['id']),
      status: _str(json['status']),
      warehouseName: _str(_map(json['warehouse'])['name']),
      productName: _str(_map(json['product'])['name']),
      countedOnHandQty: _intOrNull(json['countedOnHandQty']),
      countedUnavailableQty: _intOrNull(json['countedUnavailableQty']),
      systemOnHandQty: _int(json['systemOnHandQty']),
      varianceQty: _intOrNull(json['varianceQty']),
      reason: _strOrNull(json['reason']),
      createdAt: _strOrNull(json['createdAt']),
      submittedAt: _strOrNull(json['submittedAt']),
      approvedAt: _strOrNull(json['approvedAt']),
    );
  }
}

class StocktakePage {
  const StocktakePage({
    required this.stocktakes,
    required this.page,
    required this.pageSize,
    required this.total,
    required this.totalPages,
  });

  final List<StocktakeRecord> stocktakes;
  final int page;
  final int pageSize;
  final int total;
  final int totalPages;

  factory StocktakePage.fromJson(Map<String, dynamic> json) {
    final pagination = _map(json['pagination']);
    return StocktakePage(
      stocktakes: _list(json['data'])
          .map((e) => StocktakeRecord.fromJson(_map(e)))
          .toList(),
      page: _int(pagination['page'], 1),
      pageSize: _int(pagination['pageSize'], 20),
      total: _int(pagination['total']),
      totalPages: _int(pagination['totalPages']),
    );
  }
}

class AlertRecord {
  const AlertRecord({
    required this.id,
    required this.type,
    required this.status,
    required this.warehouseName,
    required this.productName,
    required this.message,
    required this.createdAt,
  });

  final String id;
  final String type;
  final String status;
  final String warehouseName;
  final String productName;
  final String message;
  final String? createdAt;

  String get typeLabel {
    switch (type) {
      case 'LOW_STOCK':
        return '低库存';
      case 'NEGATIVE_AVAILABLE':
        return '可售为负';
      case 'PENDING_COST':
        return '成本待定';
      case 'ORDER_SHORTAGE':
        return '订单短缺';
      case 'TRANSFER_OVERDUE':
        return '调拨超时';
      case 'STOCKTAKE_APPROVAL':
        return '盘点待审';
      default:
        return type;
    }
  }

  factory AlertRecord.fromJson(Map<String, dynamic> json) {
    return AlertRecord(
      id: _str(json['id']),
      type: _str(json['type']),
      status: _str(json['status']),
      warehouseName: _str(_map(json['warehouse'])['name']),
      productName: _str(_map(json['product'])['name']),
      message: _str(json['message']),
      createdAt: _strOrNull(json['createdAt']),
    );
  }
}

class AlertConfigRecord {
  const AlertConfigRecord({
    required this.id,
    required this.warehouseName,
    required this.productName,
    required this.minimumAvailableQty,
    required this.enabled,
  });

  final String id;
  final String warehouseName;
  final String productName;
  final int minimumAvailableQty;
  final bool enabled;

  factory AlertConfigRecord.fromJson(Map<String, dynamic> json) {
    return AlertConfigRecord(
      id: _str(json['id']),
      warehouseName: _str(_map(json['warehouse'])['name']),
      productName: _str(_map(json['product'])['name']),
      minimumAvailableQty: _int(json['minimumAvailableQty']),
      enabled: _bool(json['enabled'], true),
    );
  }
}

class AlertConfigPage {
  const AlertConfigPage({
    required this.configs,
    required this.page,
    required this.pageSize,
    required this.total,
    required this.totalPages,
  });

  final List<AlertConfigRecord> configs;
  final int page;
  final int pageSize;
  final int total;
  final int totalPages;

  factory AlertConfigPage.fromJson(Map<String, dynamic> json) {
    final pagination = _map(json['pagination']);
    return AlertConfigPage(
      configs: _list(json['alertConfigs'])
          .map((e) => AlertConfigRecord.fromJson(_map(e)))
          .toList(),
      page: _int(pagination['page'], 1),
      pageSize: _int(pagination['pageSize'], 20),
      total: _int(pagination['total']),
      totalPages: _int(pagination['totalPages']),
    );
  }
}

class MovementRecord {
  const MovementRecord({
    required this.id,
    required this.movementType,
    required this.warehouseName,
    required this.productName,
    required this.quantity,
    required this.businessAt,
    required this.purchaseUnitCostCents,
    required this.inventoryAmountCents,
  });

  final String id;
  final String movementType;
  final String warehouseName;
  final String productName;
  final int quantity;
  final String? businessAt;
  final int? purchaseUnitCostCents;
  final int? inventoryAmountCents;

  String get movementTypeLabel {
    switch (movementType) {
      case 'OPENING_IN':
        return '期初入库';
      case 'PURCHASE_IN':
        return '采购入库';
      case 'CUSTOMER_RETURN':
        return '客户退货';
      case 'RESERVE':
        return '占用';
      case 'RELEASE':
        return '释放占用';
      case 'SALES_OUT':
        return '销售出库';
      case 'TRANSFER_OUT':
        return '调拨出';
      case 'TRANSFER_IN':
        return '调拨入';
      case 'STOCK_GAIN':
        return '盘盈';
      case 'STOCK_LOSS':
        return '盘亏';
      case 'OTHER_IN':
        return '其他入库';
      case 'OTHER_OUT':
        return '其他出库';
      case 'UNAVAILABLE_IN':
        return '转入不可售';
      case 'UNAVAILABLE_OUT':
        return '转出不可售';
      default:
        return movementType;
    }
  }

  factory MovementRecord.fromJson(Map<String, dynamic> json,
      {required bool canReadCost}) {
    return MovementRecord(
      id: _str(json['id']),
      movementType: _str(json['movementType']),
      warehouseName: _str(_map(json['warehouse'])['name']),
      productName: _str(_map(json['product'])['name']),
      quantity: _int(json['quantity']),
      businessAt: _strOrNull(json['businessAt']),
      purchaseUnitCostCents:
          canReadCost ? _intOrNull(json['purchaseUnitCostCents']) : null,
      inventoryAmountCents:
          canReadCost ? _intOrNull(json['inventoryAmountCents']) : null,
    );
  }
}

class MovementPage {
  const MovementPage({
    required this.movements,
    required this.page,
    required this.pageSize,
    required this.total,
    required this.totalPages,
  });

  final List<MovementRecord> movements;
  final int page;
  final int pageSize;
  final int total;
  final int totalPages;

  factory MovementPage.fromJson(Map<String, dynamic> json,
      {required bool canReadCost}) {
    final pagination = _map(json['pagination']);
    return MovementPage(
      movements: _list(json['movements'])
          .map((e) =>
              MovementRecord.fromJson(_map(e), canReadCost: canReadCost))
          .toList(),
      page: _int(pagination['page'], 1),
      pageSize: _int(pagination['pageSize'], 20),
      total: _int(pagination['total']),
      totalPages: _int(pagination['totalPages']),
    );
  }
}

class ReportColumn {
  const ReportColumn({required this.key, required this.label, required this.type});
  final String key;
  final String label;
  final String type;
}

class ReportResult {
  const ReportResult({
    required this.reportType,
    required this.columns,
    required this.rows,
    required this.page,
    required this.pageSize,
    required this.total,
    required this.totalPages,
  });

  final String reportType;
  final List<ReportColumn> columns;
  final List<Map<String, dynamic>> rows;
  final int page;
  final int pageSize;
  final int total;
  final int totalPages;

  factory ReportResult.fromJson(Map<String, dynamic> json) {
    final pagination = _map(json['pagination']);
    return ReportResult(
      reportType: _str(json['reportType']),
      columns: _list(json['columns'])
          .map((e) => ReportColumn(
                key: _str(_map(e)['key']),
                label: _str(_map(e)['label']),
                type: _str(_map(e)['type'], 'text'),
              ))
          .toList(),
      rows: _list(json['rows'])
          .map((e) => Map<String, dynamic>.from(_map(e)))
          .toList(),
      page: _int(pagination['page'], 1),
      pageSize: _int(pagination['pageSize'], 20),
      total: _int(pagination['total']),
      totalPages: _int(pagination['totalPages']),
    );
  }
}

class InventoryOverview {
  const InventoryOverview({
    required this.warehouseCount,
    required this.productStockCount,
    required this.activeAlertCount,
    required this.pendingStocktakeCount,
    required this.inTransitCount,
    required this.negativeAvailableCount,
  });

  final int warehouseCount;
  final int productStockCount;
  final int activeAlertCount;
  final int pendingStocktakeCount;
  final int inTransitCount;
  final int negativeAvailableCount;
}

// ---------------------------------------------------------------------------
// InventoryApi
// ---------------------------------------------------------------------------

class InventoryApi {
  InventoryApi({
    required ApiClient apiClient,
    required String token,
    required this.role,
  })  : _apiClient = apiClient,
        _token = token;

  final ApiClient _apiClient;
  final String _token;
  final UserRole role;

  bool get canReadCost => canReadInventoryCost(role);

  // 角色绑定缓存：切换账号/角色时必须清除，防止成本/数量残留。
  final Map<String, dynamic> _cache = {};

  /// 清除所有库存与成本缓存。角色变化时调用。
  void clearCache() => _cache.clear();

  Map<String, dynamic> _data(Map<String, dynamic> payload) =>
      _map(payload['data']);

  // --- 仓库 ---

  Future<List<WarehouseRecord>> listWarehouses({
    String? q,
    bool? isActive,
  }) async {
    final query = <String, String>{};
    _putNonEmpty(query, 'q', q);
    if (isActive != null) query['isActive'] = isActive.toString();
    final payload =
        await _apiClient.getJson(_path('/api/inventory/warehouses', query), token: _token);
    final data = _data(payload);
    return _list(data['warehouses'])
        .map((e) => WarehouseRecord.fromJson(_map(e)))
        .toList();
  }

  // --- 库存总览 ---

  Future<InventoryOverview> fetchOverview() async {
    final warehouses = await listWarehouses();
    final stocks = await listStocks(pageSize: 100);
    var activeAlerts = 0;
    var pendingStocktakes = 0;
    var negativeAvailable = 0;
    var inTransit = 0;
    try {
      final stocktakes = await listStocktakes(status: 'SUBMITTED', pageSize: 100);
      pendingStocktakes = stocktakes.total;
    } catch (_) {}
    for (final s in stocks.stocks) {
      if (s.isNegative) negativeAvailable++;
      if (s.inTransitQty > 0) inTransit++;
    }
    return InventoryOverview(
      warehouseCount: warehouses.where((w) => w.isActive).length,
      productStockCount: stocks.total,
      activeAlertCount: activeAlerts,
      pendingStocktakeCount: pendingStocktakes,
      inTransitCount: inTransit,
      negativeAvailableCount: negativeAvailable,
    );
  }

  // --- 商品库存 ---

  Future<StockPage> listStocks({
    int page = 1,
    int pageSize = 20,
    String? warehouseId,
    String? productId,
    String? warehouse,
    String? product,
    String? inventoryTrackingMode,
    bool? hasShortage,
    bool? isLowStock,
    bool? hasUnavailable,
  }) async {
    final query = <String, String>{
      'page': '$page',
      'pageSize': '$pageSize',
    };
    _putNonEmpty(query, 'warehouseId', warehouseId);
    _putNonEmpty(query, 'productId', productId);
    _putNonEmpty(query, 'warehouse', warehouse);
    _putNonEmpty(query, 'product', product);
    _putNonEmpty(query, 'inventoryTrackingMode', inventoryTrackingMode);
    if (hasShortage != null) query['hasShortage'] = hasShortage.toString();
    if (isLowStock != null) query['isLowStock'] = isLowStock.toString();
    if (hasUnavailable != null) query['hasUnavailable'] = hasUnavailable.toString();
    final payload =
        await _apiClient.getJson(_path('/api/inventory/stocks', query), token: _token);
    return StockPage.fromJson(_data(payload), canReadCost: canReadCost);
  }

  // --- 入库 ---

  Future<InboundDocumentPage> listInbounds({
    int page = 1,
    int pageSize = 20,
    String? warehouseId,
    String? type,
    String? status,
    String? batch,
  }) async {
    final query = <String, String>{
      'page': '$page',
      'pageSize': '$pageSize',
    };
    _putNonEmpty(query, 'warehouseId', warehouseId);
    _putNonEmpty(query, 'type', type);
    _putNonEmpty(query, 'status', status);
    _putNonEmpty(query, 'batch', batch);
    final payload = await _apiClient.getJson(
        _path('/api/inventory/inbounds', query), token: _token);
    return InboundDocumentPage.fromJson(_data(payload), canReadCost: canReadCost);
  }

  Future<InboundDocumentRecord> createInbound({
    required String kind,
    required String warehouseId,
    required String sourceLineKey,
    required List<Map<String, dynamic>> lines,
    String? supplierName,
    String? purchaseOrderNo,
    String? productionBatch,
    String? reason,
    int? purchaseUnitCostCents,
  }) async {
    final batch = <String, dynamic>{
      'sourceLineKey': sourceLineKey,
    };
    if (supplierName != null) batch['supplierName'] = supplierName;
    if (purchaseOrderNo != null) batch['purchaseOrderNo'] = purchaseOrderNo;
    if (productionBatch != null) batch['productionBatch'] = productionBatch;
    // 仅 admin/super_admin 可在入库时携带成本
    if (purchaseUnitCostCents != null &&
        (role == UserRole.superAdmin || role == UserRole.admin)) {
      batch['purchaseUnitCostCents'] = purchaseUnitCostCents;
    }
    final payload = <String, dynamic>{
      'kind': kind,
      'warehouseId': warehouseId,
      'batch': batch,
      'lines': lines,
    };
    if (reason != null) payload['reason'] = reason;
    final body = buildCommandEnvelope('INBOUND', payload);
    final result =
        await _apiClient.postJson('/api/inventory/inbounds', body: body, token: _token);
    return InboundDocumentRecord.fromJson(_data(result), canReadCost: canReadCost);
  }

  Future<void> reverseInbound(String documentId, String reason) async {
    final body = buildCommandEnvelope('REVERSE', {
      'documentId': documentId,
      'reason': reason,
    });
    await _apiClient.postJson('/api/inventory/inbounds/$documentId/reverse',
        body: body, token: _token);
  }

  Future<void> updateBatchCost({
    required String batchId,
    required int purchaseUnitCostCents,
    String? reason,
  }) async {
    final payload = <String, dynamic>{
      'batchId': batchId,
      'purchaseUnitCostCents': purchaseUnitCostCents,
    };
    if (reason != null) payload['reason'] = reason;
    final body = buildCommandEnvelope('UPDATE_BATCH_COST', payload);
    await _apiClient.patchJson('/api/inventory/batches/$batchId/cost',
        body: body, token: _token);
  }

  // --- 调拨 ---

  Future<TransferPage> listTransfers({
    int page = 1,
    int pageSize = 20,
    String? fromWarehouseId,
    String? toWarehouseId,
    String? status,
  }) async {
    final query = <String, String>{
      'page': '$page',
      'pageSize': '$pageSize',
    };
    _putNonEmpty(query, 'fromWarehouseId', fromWarehouseId);
    _putNonEmpty(query, 'toWarehouseId', toWarehouseId);
    _putNonEmpty(query, 'status', status);
    final payload = await _apiClient.getJson(
        _path('/api/inventory/transfers', query), token: _token);
    return TransferPage.fromJson(_data(payload));
  }

  Future<Map<String, dynamic>> createTransfer({
    required String fromWarehouseId,
    required String toWarehouseId,
    required List<Map<String, dynamic>> lines,
    String? reason,
  }) async {
    final payload = <String, dynamic>{
      'fromWarehouseId': fromWarehouseId,
      'toWarehouseId': toWarehouseId,
      'lines': lines,
    };
    if (reason != null) payload['reason'] = reason;
    final body = buildCommandEnvelope('TRANSFER_CREATE', payload);
    final result = await _apiClient.postJson('/api/inventory/transfers',
        body: body, token: _token);
    return _data(result);
  }

  Future<Map<String, dynamic>> confirmTransferOutbound({
    required String transferId,
    required List<Map<String, dynamic>> lines,
    String? reason,
  }) async {
    final payload = <String, dynamic>{
      'transferId': transferId,
      'lines': lines,
    };
    if (reason != null) payload['reason'] = reason;
    final body = buildCommandEnvelope('TRANSFER_CONFIRM_OUTBOUND', payload);
    final result = await _apiClient.postJson(
        '/api/inventory/transfers/$transferId/outbound',
        body: body, token: _token);
    return _data(result);
  }

  Future<Map<String, dynamic>> receiveTransfer({
    required String transferId,
    required String warehouseId,
    required List<Map<String, dynamic>> lines,
    String? notes,
  }) async {
    final payload = <String, dynamic>{
      'transferId': transferId,
      'warehouseId': warehouseId,
      'lines': lines,
    };
    if (notes != null) payload['notes'] = notes;
    final body = buildCommandEnvelope('TRANSFER_RECEIVE', payload);
    final result = await _apiClient.postJson(
        '/api/inventory/transfers/$transferId/receipts',
        body: body, token: _token);
    return _data(result);
  }

  Future<Map<String, dynamic>> reverseTransferOutbound({
    required String transferId,
    required String reason,
  }) async {
    final body = buildCommandEnvelope('TRANSFER_OUTBOUND_REVERSE', {
      'transferId': transferId,
      'reason': reason,
    });
    final result = await _apiClient.postJson(
        '/api/inventory/transfers/$transferId/outbound/reverse',
        body: body, token: _token);
    return _data(result);
  }

  // --- 不可售 ---

  Future<void> markUnavailable({
    required String warehouseId,
    required String productId,
    required int quantity,
    required String reason,
  }) async {
    final body = buildCommandEnvelope('MARK_UNAVAILABLE', {
      'warehouseId': warehouseId,
      'productId': productId,
      'quantity': quantity,
      'reason': reason,
    });
    await _apiClient.postJson('/api/inventory/unavailable/mark',
        body: body, token: _token);
  }

  Future<void> restoreAvailable({
    required String warehouseId,
    required String productId,
    required int quantity,
    required String reason,
  }) async {
    final body = buildCommandEnvelope('RESTORE_AVAILABLE', {
      'warehouseId': warehouseId,
      'productId': productId,
      'quantity': quantity,
      'reason': reason,
    });
    await _apiClient.postJson('/api/inventory/unavailable/restore',
        body: body, token: _token);
  }

  // --- 盘点 ---

  Future<StocktakePage> listStocktakes({
    int page = 1,
    int pageSize = 20,
    String? warehouseId,
    String? status,
  }) async {
    final query = <String, String>{
      'page': '$page',
      'pageSize': '$pageSize',
    };
    _putNonEmpty(query, 'warehouseId', warehouseId);
    _putNonEmpty(query, 'status', status);
    final payload = await _apiClient.getJson(
        _path('/api/inventory/stocktakes', query), token: _token);
    return StocktakePage.fromJson(_data(payload));
  }

  Future<Map<String, dynamic>> createStocktake({
    required String warehouseId,
    required String productId,
  }) async {
    final body = buildCommandEnvelope('STOCKTAKE_CREATE', {
      'warehouseId': warehouseId,
      'productId': productId,
    });
    final result = await _apiClient.postJson('/api/inventory/stocktakes',
        body: body, token: _token);
    return _data(result);
  }

  Future<Map<String, dynamic>> submitStocktake({
    required String id,
    int? countedOnHandQty,
    int? countedUnavailableQty,
    String? reason,
  }) async {
    final payload = <String, dynamic>{};
    if (countedOnHandQty != null) payload['countedOnHandQty'] = countedOnHandQty;
    if (countedUnavailableQty != null) {
      payload['countedUnavailableQty'] = countedUnavailableQty;
    }
    if (reason != null) payload['reason'] = reason;
    final result = await _apiClient.postJson(
        '/api/inventory/stocktakes/$id/submit',
        body: payload, token: _token);
    return _data(result);
  }

  Future<Map<String, dynamic>> approveStocktake(String id, {String? reason}) async {
    final payload = <String, dynamic>{};
    if (reason != null) payload['reason'] = reason;
    final result = await _apiClient.postJson(
        '/api/inventory/stocktakes/$id/approve',
        body: payload, token: _token);
    return _data(result);
  }

  Future<Map<String, dynamic>> rejectStocktake({
    required String id,
    required String reason,
  }) async {
    final result = await _apiClient.postJson(
        '/api/inventory/stocktakes/$id/reject',
        body: {'reason': reason}, token: _token);
    return _data(result);
  }

  Future<Map<String, dynamic>> reverseStocktake({
    required String id,
    required String reason,
  }) async {
    final result = await _apiClient.postJson(
        '/api/inventory/stocktakes/$id/reverse',
        body: {'reason': reason}, token: _token);
    return _data(result);
  }

  // --- 预警 ---

  Future<AlertConfigPage> listAlertConfigs({
    int page = 1,
    int pageSize = 20,
    String? warehouseId,
    bool? enabled,
  }) async {
    final query = <String, String>{
      'page': '$page',
      'pageSize': '$pageSize',
    };
    _putNonEmpty(query, 'warehouseId', warehouseId);
    if (enabled != null) query['enabled'] = enabled.toString();
    final payload = await _apiClient.getJson(
        _path('/api/inventory/alert-configs', query), token: _token);
    return AlertConfigPage.fromJson(_data(payload));
  }

  Future<void> updateAlertConfig({
    required String warehouseId,
    required String productId,
    int? minimumAvailableQty,
    bool? enabled,
  }) async {
    final body = <String, dynamic>{
      'warehouseId': warehouseId,
      'productId': productId,
    };
    if (minimumAvailableQty != null) {
      body['minimumAvailableQty'] = minimumAvailableQty;
    }
    if (enabled != null) body['enabled'] = enabled;
    await _apiClient.patchJson('/api/inventory/alert-configs',
        body: body, token: _token);
  }

  // --- 出入库流水 ---

  Future<MovementPage> listMovements({
    int page = 1,
    int pageSize = 20,
    String? warehouseId,
    String? productId,
    String? movementType,
    String? dateFrom,
    String? dateTo,
  }) async {
    final query = <String, String>{
      'page': '$page',
      'pageSize': '$pageSize',
    };
    _putNonEmpty(query, 'warehouseId', warehouseId);
    _putNonEmpty(query, 'productId', productId);
    _putNonEmpty(query, 'movementType', movementType);
    _putNonEmpty(query, 'dateFrom', dateFrom);
    _putNonEmpty(query, 'dateTo', dateTo);
    final payload = await _apiClient.getJson(
        _path('/api/inventory/movements', query), token: _token);
    return MovementPage.fromJson(_data(payload), canReadCost: canReadCost);
  }

  // --- 报表 ---

  static const reportTypes = <String>[
    'warehouse-balances',
    'period-summary',
    'movements',
    'sales-outbound',
    'purchase-inbound',
    'batch-balances',
    'alerts',
    'stocktake-variances',
    'transfers',
    'inventory-valuation',
  ];

  static String reportLabel(String type) {
    switch (type) {
      case 'warehouse-balances':
        return '仓库余额';
      case 'period-summary':
        return '期间汇总';
      case 'movements':
        return '出入库流水';
      case 'sales-outbound':
        return '销售出库';
      case 'purchase-inbound':
        return '采购入库';
      case 'batch-balances':
        return '批次余额';
      case 'alerts':
        return '预警记录';
      case 'stocktake-variances':
        return '盘点差异';
      case 'transfers':
        return '调拨记录';
      case 'inventory-valuation':
        return '库存估值';
      default:
        return type;
    }
  }

  Future<ReportResult> fetchReport({
    required String reportType,
    int page = 1,
    int pageSize = 20,
    Map<String, String>? filters,
  }) async {
    final query = <String, String>{
      'page': '$page',
      'pageSize': '$pageSize',
    };
    if (filters != null) query.addAll(filters);
    final payload = await _apiClient.getJson(
        _path('/api/inventory/reports/$reportType', query), token: _token);
    return ReportResult.fromJson(_data(payload));
  }

  Future<ApiDownloadedFile> exportReport({
    required String reportType,
    Map<String, String>? filters,
  }) {
    final query = <String, String>{};
    if (filters != null) query.addAll(filters);
    return _apiClient.getBytes(
        _path('/api/inventory/reports/$reportType/export.xlsx', query),
        token: _token,
        defaultFileName: 'inventory-$reportType.xlsx');
  }
}
