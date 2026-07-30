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
  'STOCKTAKE_CREATE',
  'STOCKTAKE_SUBMIT',
  'STOCKTAKE_APPROVE',
  'STOCKTAKE_REJECT',
  'STOCKTAKE_REVERSE',
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

String calculateAfterSalesReceiptRequestHash(
  String action,
  Map<String, dynamic> input,
) {
  return calculateInventoryRequestHash(
    'AFTER_SALES_RECEIPT_${action.trim().toUpperCase()}',
    input,
  );
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
  final source =
      sourceKey ?? 'flutter-${DateTime.now().toUtc().toIso8601String()}';
  final idempotency =
      idempotencyKey ?? 'idem-${DateTime.now().microsecondsSinceEpoch}';
  final body = Map<String, dynamic>.from(payload);
  body['sourceKey'] = source;
  body['idempotencyKey'] = idempotency;
  body['requestHash'] = calculateInventoryRequestHash(commandType, body);
  return body;
}

/// 计算盘点命令的 requestHash。
///
/// 盘点服务使用独立的扁平 canonical payload：
/// `{commandType, sourceKey, idempotencyKey, ...payload}`，不能复用库存记账
/// 命令的 `{commandType, payload}` 包装。
String calculateStocktakeRequestHash(
  String commandType, {
  required String sourceKey,
  required String idempotencyKey,
  required Map<String, dynamic> payload,
}) {
  final hashPayload = <String, dynamic>{
    'commandType': commandType.trim().toUpperCase(),
    'sourceKey': _normalizeBusinessKey(sourceKey),
    'idempotencyKey': _normalizeBusinessKey(idempotencyKey),
    ...payload,
  };
  return sha256.convert(utf8.encode(canonicalJson(hashPayload))).toString();
}

Map<String, dynamic> buildStocktakeCommandEnvelope(
  String commandType, {
  required Map<String, dynamic> hashPayload,
  Map<String, dynamic> transportPayload = const {},
  String? sourceKey,
  String? idempotencyKey,
}) {
  final stamp = DateTime.now().microsecondsSinceEpoch;
  final source = _normalizeBusinessKey(
    sourceKey ?? 'flutter-stocktake-$stamp',
  );
  final idempotency = _normalizeBusinessKey(
    idempotencyKey ?? 'idem-stocktake-$stamp',
  );
  return <String, dynamic>{
    ...transportPayload,
    'sourceKey': source,
    'idempotencyKey': idempotency,
    'requestHash': calculateStocktakeRequestHash(
      commandType,
      sourceKey: source,
      idempotencyKey: idempotency,
      payload: hashPayload,
    ),
  };
}

List<Map<String, dynamic>> _normalizeStocktakeScans(
  List<StocktakeScanInput> scans,
) {
  return [
    for (final scan in scans)
      {
        'logisticsCode': scan.logisticsCode.trim(),
        'normalizedLogisticsCode': scan.logisticsCode.trim().toLowerCase(),
        'condition': scan.condition.trim().toUpperCase(),
      },
  ];
}

Map<String, dynamic> _buildAfterSalesReceiptEnvelope(
  String action, {
  required Map<String, dynamic> hashPayload,
  required Map<String, dynamic> transportPayload,
  String? sourceKey,
  String? idempotencyKey,
}) {
  final source = _normalizeBusinessKey(
    sourceKey ?? 'flutter-after-sales-${DateTime.now().microsecondsSinceEpoch}',
  );
  final idempotency = _normalizeBusinessKey(
    idempotencyKey ??
        'idem-after-sales-${DateTime.now().microsecondsSinceEpoch}',
  );
  final hashInput = <String, dynamic>{
    ...hashPayload,
    'sourceKey': source,
    'idempotencyKey': idempotency,
  };
  return <String, dynamic>{
    ...transportPayload,
    'sourceKey': source,
    'idempotencyKey': idempotency,
    'requestHash': calculateAfterSalesReceiptRequestHash(action, hashInput),
  };
}

List<Map<String, dynamic>> _normalizeAfterSalesReceiptLines(
  List<Map<String, dynamic>> lines,
) {
  return [
    for (var index = 0; index < lines.length; index++)
      _normalizeAfterSalesReceiptLine(lines[index], index),
  ];
}

Map<String, dynamic> _normalizeAfterSalesReceiptLine(
  Map<String, dynamic> line,
  int index,
) {
  final serializedUnits = _list(line['serializedUnits']);
  return <String, dynamic>{
    'afterSalesOrderItemId': _str(line['afterSalesOrderItemId']).trim(),
    'lineNo': _int(line['lineNo'], index + 1),
    'receivedQty': _int(line['receivedQty']),
    'condition': _str(line['condition']).trim().toUpperCase(),
    if (_strOrNull(line['inventoryBatchId'])?.trim().isNotEmpty == true)
      'inventoryBatchId': _str(line['inventoryBatchId']).trim(),
    if (_strOrNull(line['exceptionReason'])?.trim().isNotEmpty == true)
      'exceptionReason': _str(line['exceptionReason']).trim(),
    if (_strOrNull(line['notes'])?.trim().isNotEmpty == true)
      'notes': _str(line['notes']).trim(),
    'serializedUnits': [
      for (final item in serializedUnits)
        {
          if (_strOrNull(_map(item)['originalSerializedUnitId'])
                  ?.trim()
                  .isNotEmpty ==
              true)
            'originalSerializedUnitId':
                _str(_map(item)['originalSerializedUnitId']).trim(),
          'scannedLogisticsCode':
              _str(_map(item)['scannedLogisticsCode']).trim(),
          'normalizedScannedLogisticsCode':
              _str(_map(item)['scannedLogisticsCode']).trim().toLowerCase(),
        },
    ],
  };
}

Map<String, dynamic> _afterSalesReceiptTransportLine(
  Map<String, dynamic> normalized,
) {
  return <String, dynamic>{
    for (final entry in normalized.entries)
      if (entry.key != 'serializedUnits') entry.key: entry.value,
    'serializedUnits': [
      for (final item in _list(normalized['serializedUnits']))
        {
          if (_map(item).containsKey('originalSerializedUnitId'))
            'originalSerializedUnitId': _map(item)['originalSerializedUnitId'],
          'scannedLogisticsCode': _map(item)['scannedLogisticsCode'],
        },
    ],
  };
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

String _dateOnly(DateTime value) {
  final local = value.toLocal();
  final month = local.month.toString().padLeft(2, '0');
  final day = local.day.toString().padLeft(2, '0');
  return '${local.year}-$month-$day';
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
    this.managerUserId,
    required this.managerName,
    required this.isActive,
    required this.isDefault,
    this.createdAt,
    this.updatedAt,
  });

  final String id;
  final String code;
  final String name;
  final String address;
  final String? managerUserId;
  final String? managerName;
  final bool isActive;
  final bool isDefault;
  final String? createdAt;
  final String? updatedAt;

  factory WarehouseRecord.fromJson(Map<String, dynamic> json) {
    final manager = _map(json['manager']);
    return WarehouseRecord(
      id: _str(json['id']),
      code: _str(json['code']),
      name: _str(json['name']),
      address: _str(json['address']),
      managerUserId: _strOrNull(json['managerUserId']),
      managerName: _strOrNull(manager['name']),
      isActive: _bool(json['isActive'], true),
      isDefault: _bool(json['isDefault']),
      createdAt: _strOrNull(json['createdAt']),
      updatedAt: _strOrNull(json['updatedAt']),
    );
  }
}

class WarehousePage {
  const WarehousePage({
    required this.warehouses,
    required this.page,
    required this.pageSize,
    required this.total,
    required this.totalPages,
  });

  final List<WarehouseRecord> warehouses;
  final int page;
  final int pageSize;
  final int total;
  final int totalPages;

  factory WarehousePage.fromJson(Map<String, dynamic> json) {
    final pagination = _map(json['pagination']);
    return WarehousePage(
      warehouses: _list(json['warehouses'])
          .map((e) => WarehouseRecord.fromJson(_map(e)))
          .toList(),
      page: _int(pagination['page'], 1),
      pageSize: _int(pagination['pageSize'], 20),
      total: _int(pagination['total']),
      totalPages: _int(pagination['totalPages']),
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
    required this.version,
    required this.lastMovementId,
    required this.rebuiltAt,
    required this.updatedAt,
    required this.inventoryCostBasis,
    required this.inventoryCostAmountCents,
    required this.inventoryCostCoveredQty,
    required this.inventoryCostUncoveredQty,
    required this.inventoryCostFactQty,
    required this.coverageStatus,
    required this.inventoryCostWarning,
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
  final int version;
  final String? lastMovementId;
  final String? rebuiltAt;
  final String? updatedAt;
  final String? inventoryCostBasis;
  final int? inventoryCostAmountCents;
  final int? inventoryCostCoveredQty;
  final int? inventoryCostUncoveredQty;
  final int? inventoryCostFactQty;
  final String coverageStatus;
  final String? inventoryCostWarning;

  bool get hasShortage => shortageQty > 0;
  bool get isNegative => availableQty < 0;

  factory StockRecord.fromJson(Map<String, dynamic> json,
      {required bool canReadCost}) {
    final warehouse = _map(json['warehouse']);
    final product = _map(json['product']);
    final lowStock = _map(json['lowStock']);
    final cost = _map(json['inventoryCost']);
    final warningValue = cost['warning'] ?? cost['warnings'];
    final costWarning = warningValue is List
        ? warningValue.map((item) => item.toString()).join('；')
        : _strOrNull(warningValue);
    return StockRecord(
      id: _str(json['id']),
      warehouseId: _str(json['warehouseId']),
      productId: _str(json['productId']),
      warehouseName: _str(warehouse['name']),
      warehouseCode: _str(warehouse['code']),
      productName: _str(product['name']),
      productUnit: _str(product['unit']),
      inventoryTrackingMode:
          _str(product['inventoryTrackingMode'], 'none').toLowerCase(),
      onHandQty: _int(json['onHandQty']),
      reservedQty: _int(json['reservedQty']),
      unavailableQty: _int(json['unavailableQty']),
      inTransitQty: _int(json['inTransitQty']),
      availableQty: _int(json['availableQty']),
      shortageQty: _int(json['shortageQty']),
      lowStockEnabled: _bool(lowStock['enabled']),
      minimumAvailableQty: _intOrNull(lowStock['minimumAvailableQty']),
      isLowStock: _bool(lowStock['isLowStock']),
      version: _int(json['version']),
      lastMovementId: _strOrNull(json['lastMovementId']),
      rebuiltAt: _strOrNull(json['rebuiltAt']),
      updatedAt: _strOrNull(json['updatedAt']),
      inventoryCostBasis:
          canReadCost ? _strOrNull(cost['basis'])?.toLowerCase() : null,
      inventoryCostAmountCents:
          canReadCost ? _intOrNull(cost['inventoryAmountCents']) : null,
      inventoryCostCoveredQty:
          canReadCost ? _intOrNull(cost['coveredQty']) : null,
      inventoryCostUncoveredQty:
          canReadCost ? _intOrNull(cost['uncoveredQty']) : null,
      inventoryCostFactQty: canReadCost ? _intOrNull(cost['factQty']) : null,
      coverageStatus: canReadCost
          ? _str(cost['coverageStatus'], 'not_applicable').toLowerCase()
          : 'not_applicable',
      inventoryCostWarning: canReadCost ? costWarning : null,
    );
  }
}

class InventoryBatchRecord {
  const InventoryBatchRecord({
    required this.id,
    required this.warehouseId,
    required this.productId,
    required this.supplierName,
    required this.purchaseOrderNo,
    required this.productionBatch,
    required this.productionDate,
    required this.receivedQty,
    required this.remainingQty,
    required this.unavailableQty,
    required this.fifoAt,
    required this.createdAt,
    required this.updatedAt,
    required this.purchaseUnitCostCents,
    required this.inventoryAmountCents,
    required this.costStatus,
    required this.costCompletedAt,
  });

  final String id;
  final String warehouseId;
  final String productId;
  final String? supplierName;
  final String? purchaseOrderNo;
  final String? productionBatch;
  final String? productionDate;
  final int receivedQty;
  final int remainingQty;
  final int unavailableQty;
  final String? fifoAt;
  final String? createdAt;
  final String? updatedAt;
  final int? purchaseUnitCostCents;
  final int? inventoryAmountCents;
  final String? costStatus;
  final String? costCompletedAt;

  factory InventoryBatchRecord.fromJson(
    Map<String, dynamic> json, {
    required bool canReadCost,
  }) {
    return InventoryBatchRecord(
      id: _str(json['id']),
      warehouseId: _str(json['warehouseId']),
      productId: _str(json['productId']),
      supplierName: _strOrNull(json['supplierName']),
      purchaseOrderNo: _strOrNull(json['purchaseOrderNo']),
      productionBatch: _strOrNull(json['productionBatch']),
      productionDate: _strOrNull(json['productionDate']),
      receivedQty: _int(json['receivedQty']),
      remainingQty: _int(json['remainingQty']),
      unavailableQty: _int(json['unavailableQty']),
      fifoAt: _strOrNull(json['fifoAt']),
      createdAt: _strOrNull(json['createdAt']),
      updatedAt: _strOrNull(json['updatedAt']),
      purchaseUnitCostCents:
          canReadCost ? _intOrNull(json['purchaseUnitCostCents']) : null,
      inventoryAmountCents:
          canReadCost ? _intOrNull(json['inventoryAmountCents']) : null,
      costStatus:
          canReadCost ? _strOrNull(json['costStatus'])?.toLowerCase() : null,
      costCompletedAt: canReadCost ? _strOrNull(json['costCompletedAt']) : null,
    );
  }
}

class StockDetailRecord {
  const StockDetailRecord({
    required this.stock,
    required this.batches,
    required this.serializedStatusSummary,
  });

  final StockRecord stock;
  final List<InventoryBatchRecord> batches;
  final Map<String, int> serializedStatusSummary;

  factory StockDetailRecord.fromJson(
    Map<String, dynamic> json, {
    required bool canReadCost,
  }) {
    final summary = <String, int>{};
    for (final entry in _map(json['serializedStatusSummary']).entries) {
      summary[entry.key.toLowerCase()] = _int(entry.value);
    }
    return StockDetailRecord(
      stock: StockRecord.fromJson(json, canReadCost: canReadCost),
      batches: _list(json['batches'])
          .map(
            (item) => InventoryBatchRecord.fromJson(
              _map(item),
              canReadCost: canReadCost,
            ),
          )
          .toList(),
      serializedStatusSummary: summary,
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
    required this.id,
    required this.lineNo,
    required this.productId,
    required this.productName,
    required this.unit,
    required this.batchId,
    required this.quantity,
    required this.condition,
    required this.notes,
    required this.batch,
    required this.purchaseUnitCostCents,
    required this.inventoryAmountCents,
    required this.createdAt,
  });

  final String id;
  final int lineNo;
  final String productId;
  final String productName;
  final String unit;
  final String? batchId;
  final int quantity;
  final String condition;
  final String? notes;
  final InboundBatchRecord? batch;
  final int? purchaseUnitCostCents;
  final int? inventoryAmountCents;
  final String? createdAt;

  factory InboundDocumentLine.fromJson(
    Map<String, dynamic> json, {
    required bool canReadCost,
  }) {
    final batchJson = _map(json['batch']);
    return InboundDocumentLine(
      id: _str(json['id']),
      lineNo: _int(json['lineNo'], 1),
      productId: _str(json['productId']),
      productName: _str(json['productNameSnapshot']),
      unit: _str(json['unitSnapshot'], '瓶'),
      batchId: _strOrNull(json['batchId']),
      quantity: _int(json['quantity']),
      condition: _str(json['condition'], 'saleable').toLowerCase(),
      notes: _strOrNull(json['notes']),
      batch: batchJson.isEmpty
          ? null
          : InboundBatchRecord.fromJson(
              batchJson,
              canReadCost: canReadCost,
            ),
      purchaseUnitCostCents:
          canReadCost ? _intOrNull(json['purchaseUnitCostCents']) : null,
      inventoryAmountCents:
          canReadCost ? _intOrNull(json['inventoryAmountCents']) : null,
      createdAt: _strOrNull(json['createdAt']),
    );
  }
}

class InboundBatchRecord {
  const InboundBatchRecord({
    required this.id,
    required this.supplierName,
    required this.purchaseOrderNo,
    required this.productionBatch,
    required this.productionDate,
    required this.receivedQty,
    required this.remainingQty,
    required this.unavailableQty,
    required this.fifoAt,
    required this.purchaseUnitCostCents,
    required this.costStatus,
    required this.costCompletedAt,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String? supplierName;
  final String? purchaseOrderNo;
  final String? productionBatch;
  final String? productionDate;
  final int receivedQty;
  final int remainingQty;
  final int unavailableQty;
  final String? fifoAt;
  final int? purchaseUnitCostCents;
  final String? costStatus;
  final String? costCompletedAt;
  final String? createdAt;
  final String? updatedAt;

  factory InboundBatchRecord.fromJson(
    Map<String, dynamic> json, {
    required bool canReadCost,
  }) {
    return InboundBatchRecord(
      id: _str(json['id']),
      supplierName: _strOrNull(json['supplierName']),
      purchaseOrderNo: _strOrNull(json['purchaseOrderNo']),
      productionBatch: _strOrNull(json['productionBatch']),
      productionDate: _strOrNull(json['productionDate']),
      receivedQty: _int(json['receivedQty']),
      remainingQty: _int(json['remainingQty']),
      unavailableQty: _int(json['unavailableQty']),
      fifoAt: _strOrNull(json['fifoAt']),
      purchaseUnitCostCents:
          canReadCost ? _intOrNull(json['purchaseUnitCostCents']) : null,
      costStatus:
          canReadCost ? _strOrNull(json['costStatus'])?.toLowerCase() : null,
      costCompletedAt: canReadCost ? _strOrNull(json['costCompletedAt']) : null,
      createdAt: _strOrNull(json['createdAt']),
      updatedAt: _strOrNull(json['updatedAt']),
    );
  }
}

class InboundPostedByRecord {
  const InboundPostedByRecord({
    required this.userId,
    required this.name,
    required this.role,
  });

  final String? userId;
  final String? name;
  final String? role;

  factory InboundPostedByRecord.fromJson(Map<String, dynamic> json) {
    return InboundPostedByRecord(
      userId: _strOrNull(json['userId']),
      name: _strOrNull(json['name']),
      role: _strOrNull(json['role']),
    );
  }
}

class InboundAttachmentRecord {
  const InboundAttachmentRecord({
    required this.fileName,
    required this.contentType,
    required this.sizeBytes,
    required this.checksumSha256,
  });

  final String fileName;
  final String contentType;
  final int sizeBytes;
  final String checksumSha256;

  factory InboundAttachmentRecord.fromJson(Map<String, dynamic> json) {
    return InboundAttachmentRecord(
      fileName: _str(json['fileName']),
      contentType: _str(json['contentType']),
      sizeBytes: _int(json['sizeBytes']),
      checksumSha256: _str(json['checksumSha256']),
    );
  }
}

class InboundDocumentRecord {
  const InboundDocumentRecord({
    required this.id,
    required this.documentNo,
    required this.type,
    required this.status,
    required this.warehouseId,
    required this.warehouseCode,
    required this.warehouseName,
    required this.sourceType,
    required this.sourceId,
    required this.sourceKey,
    required this.businessAt,
    required this.postedBy,
    required this.postedAt,
    required this.reversedAt,
    required this.reversalOfDocumentId,
    required this.reason,
    required this.attachments,
    required this.lines,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String documentNo;
  final String type;
  final String status;
  final String warehouseId;
  final String warehouseCode;
  final String warehouseName;
  final String sourceType;
  final String? sourceId;
  final String sourceKey;
  final String? businessAt;
  final InboundPostedByRecord postedBy;
  final String? postedAt;
  final String? reversedAt;
  final String? reversalOfDocumentId;
  final String? reason;
  final List<InboundAttachmentRecord> attachments;
  final List<InboundDocumentLine> lines;
  final String? createdAt;
  final String? updatedAt;

  int get totalQuantity =>
      lines.fold(0, (total, line) => total + line.quantity);

  int get productKinds => lines.map((line) => line.productId).toSet().length;

  InboundBatchRecord? get firstBatch =>
      lines.isEmpty ? null : lines.first.batch;

  String? get batchSupplierName => firstBatch?.supplierName;

  String? get batchPurchaseOrderNo => firstBatch?.purchaseOrderNo;

  String? get batchProductionBatch => firstBatch?.productionBatch;

  String? get batchCostStatus => firstBatch?.costStatus;

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
    final warehouse = _map(json['warehouse']);
    return InboundDocumentRecord(
      id: _str(json['id']),
      documentNo: _str(json['documentNo']),
      type: _str(json['type']).toUpperCase(),
      status: _str(json['status']).toUpperCase(),
      warehouseId: _str(json['warehouseId']),
      warehouseCode: _str(warehouse['code']),
      warehouseName: _str(warehouse['name']),
      sourceType: _str(json['sourceType']),
      sourceId: _strOrNull(json['sourceId']),
      sourceKey: _str(json['sourceKey']),
      businessAt: _strOrNull(json['businessAt']),
      postedBy: InboundPostedByRecord.fromJson(_map(json['postedBy'])),
      postedAt: _strOrNull(json['postedAt']),
      reversedAt: _strOrNull(json['reversedAt']),
      reversalOfDocumentId: _strOrNull(json['reversalOfDocumentId']),
      reason: _strOrNull(json['reason']),
      attachments: _list(json['attachmentMetadata'])
          .map((item) => InboundAttachmentRecord.fromJson(_map(item)))
          .toList(),
      lines: _list(json['lines'])
          .map((e) =>
              InboundDocumentLine.fromJson(_map(e), canReadCost: canReadCost))
          .toList(),
      createdAt: _strOrNull(json['createdAt']),
      updatedAt: _strOrNull(json['updatedAt']),
    );
  }
}

class InventoryCommandResult {
  const InventoryCommandResult({
    required this.documentId,
    required this.documentNo,
    required this.replayed,
  });

  final String documentId;
  final String documentNo;
  final bool replayed;

  factory InventoryCommandResult.fromJson(Map<String, dynamic> json) {
    return InventoryCommandResult(
      documentId: _str(json['documentId']),
      documentNo: _str(json['documentNo']),
      replayed: _bool(json['replayed']),
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
          .map((e) =>
              InboundDocumentRecord.fromJson(_map(e), canReadCost: canReadCost))
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
    required this.id,
    required this.lineNo,
    required this.sourceLineKey,
    required this.productId,
    required this.productName,
    required this.productUnit,
    required this.trackingMode,
    required this.plannedQty,
    required this.outboundQty,
    required this.receivedQty,
    required this.unavailableQty,
    required this.differenceQty,
    required this.remainingInTransitQty,
    required this.serializedUnitCount,
    required this.serializedUnitIds,
    required this.sourceAvailableQty,
    required this.targetAvailableQty,
    required this.shortageWarning,
    required this.companyQuantity,
    required this.notes,
    required this.version,
  });

  final String id;
  final int lineNo;
  final String sourceLineKey;
  final String productId;
  final String productName;
  final String productUnit;
  final String trackingMode;
  final int plannedQty;
  final int outboundQty;
  final int receivedQty;
  final int unavailableQty;
  final int differenceQty;
  final int remainingInTransitQty;
  final int serializedUnitCount;
  final List<String> serializedUnitIds;
  final int sourceAvailableQty;
  final int targetAvailableQty;
  final bool shortageWarning;
  final int companyQuantity;
  final String? notes;
  final int version;

  bool get isSerialized => trackingMode == 'SERIALIZED';

  factory TransferLine.fromJson(Map<String, dynamic> json) {
    final product = _map(json['product']);
    return TransferLine(
      id: _str(json['id']),
      lineNo: _int(json['lineNo']),
      sourceLineKey: _str(json['sourceLineKey']),
      productId: _str(product['id']),
      productName: _str(product['name']),
      productUnit: _str(product['unit']),
      trackingMode: _str(
        json['trackingMode'] ?? product['inventoryTrackingMode'],
      ).toUpperCase(),
      plannedQty: _int(json['plannedQty']),
      outboundQty: _int(json['outboundQty']),
      receivedQty: _int(json['receivedQty']),
      unavailableQty: _int(json['unavailableQty']),
      differenceQty: _int(json['differenceQty']),
      remainingInTransitQty: _int(json['remainingInTransitQty']),
      serializedUnitCount: _int(json['serializedUnitCount']),
      serializedUnitIds: _list(json['serializedUnitIds'])
          .map(_str)
          .where((value) => value.isNotEmpty)
          .toList(),
      sourceAvailableQty: _int(_map(json['sourceStock'])['availableQty']),
      targetAvailableQty: _int(_map(json['targetStock'])['availableQty']),
      shortageWarning: _bool(json['shortageWarning']),
      companyQuantity: _int(json['companyQuantity']),
      notes: _strOrNull(json['notes']),
      version: _int(json['version']),
    );
  }
}

class TransferActorRecord {
  const TransferActorRecord({
    required this.userId,
    required this.name,
    required this.role,
  });

  final String? userId;
  final String? name;
  final String? role;

  factory TransferActorRecord.fromJson(Map<String, dynamic> json) {
    return TransferActorRecord(
      userId: _strOrNull(json['userId']),
      name: _strOrNull(json['name']),
      role: _strOrNull(json['role']),
    );
  }
}

class TransferDocumentRecord {
  const TransferDocumentRecord({
    required this.id,
    required this.documentNo,
    required this.type,
    required this.status,
    required this.businessAt,
  });

  final String id;
  final String documentNo;
  final String? type;
  final String status;
  final String? businessAt;

  factory TransferDocumentRecord.fromJson(Map<String, dynamic> json) {
    return TransferDocumentRecord(
      id: _str(json['id']),
      documentNo: _str(json['documentNo']),
      type: _strOrNull(json['type'])?.toUpperCase(),
      status: _str(json['status']).toUpperCase(),
      businessAt: _strOrNull(json['businessAt']),
    );
  }
}

class TransferReceiptLineRecord {
  const TransferReceiptLineRecord({
    required this.id,
    required this.transferLineId,
    required this.lineNo,
    required this.receivedQty,
    required this.unavailableQty,
    required this.differenceQty,
    required this.notes,
  });

  final String id;
  final String transferLineId;
  final int lineNo;
  final int receivedQty;
  final int unavailableQty;
  final int differenceQty;
  final String? notes;

  factory TransferReceiptLineRecord.fromJson(Map<String, dynamic> json) {
    return TransferReceiptLineRecord(
      id: _str(json['id']),
      transferLineId: _str(json['transferLineId']),
      lineNo: _int(json['lineNo']),
      receivedQty: _int(json['receivedQty']),
      unavailableQty: _int(json['unavailableQty']),
      differenceQty: _int(json['differenceQty']),
      notes: _strOrNull(json['notes']),
    );
  }
}

class TransferReceiptRecord {
  const TransferReceiptRecord({
    required this.id,
    required this.receiptNo,
    required this.sourceKey,
    required this.status,
    required this.resultDocumentId,
    required this.confirmedBy,
    required this.confirmedAt,
    required this.reversalOfReceiptId,
    required this.notes,
    required this.lines,
    required this.resultDocument,
    required this.version,
    required this.createdAt,
  });

  final String id;
  final String receiptNo;
  final String sourceKey;
  final String status;
  final String? resultDocumentId;
  final TransferActorRecord? confirmedBy;
  final String? confirmedAt;
  final String? reversalOfReceiptId;
  final String? notes;
  final List<TransferReceiptLineRecord> lines;
  final TransferDocumentRecord? resultDocument;
  final int version;
  final String? createdAt;

  bool get isReversed => status == 'REVERSED' || reversalOfReceiptId != null;

  factory TransferReceiptRecord.fromJson(Map<String, dynamic> json) {
    final confirmedBy = _map(json['confirmedBy']);
    final resultDocument = _map(json['resultDocument']);
    return TransferReceiptRecord(
      id: _str(json['id']),
      receiptNo: _str(json['receiptNo']),
      sourceKey: _str(json['sourceKey']),
      status: _str(json['status']).toUpperCase(),
      resultDocumentId: _strOrNull(json['resultDocumentId']),
      confirmedBy: confirmedBy.isEmpty
          ? null
          : TransferActorRecord.fromJson(confirmedBy),
      confirmedAt: _strOrNull(json['confirmedAt']),
      reversalOfReceiptId: _strOrNull(json['reversalOfReceiptId']),
      notes: _strOrNull(json['notes']),
      lines: _list(json['lines'])
          .map((value) => TransferReceiptLineRecord.fromJson(_map(value)))
          .toList(),
      resultDocument: resultDocument.isEmpty
          ? null
          : TransferDocumentRecord.fromJson(resultDocument),
      version: _int(json['version']),
      createdAt: _strOrNull(json['createdAt']),
    );
  }
}

class TransferRecord {
  const TransferRecord({
    required this.id,
    required this.transferNo,
    required this.sourceKey,
    required this.status,
    required this.fromWarehouseId,
    required this.fromWarehouseCode,
    required this.fromWarehouseName,
    required this.toWarehouseId,
    required this.toWarehouseCode,
    required this.toWarehouseName,
    required this.outboundDocumentId,
    required this.outboundAt,
    required this.outboundBy,
    required this.notes,
    required this.version,
    required this.lines,
    required this.outboundDocument,
    required this.receipts,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String transferNo;
  final String sourceKey;
  final String status;
  final String fromWarehouseId;
  final String fromWarehouseCode;
  final String fromWarehouseName;
  final String toWarehouseId;
  final String toWarehouseCode;
  final String toWarehouseName;
  final String? outboundDocumentId;
  final String? outboundAt;
  final TransferActorRecord? outboundBy;
  final String? notes;
  final int version;
  final List<TransferLine> lines;
  final TransferDocumentRecord? outboundDocument;
  final List<TransferReceiptRecord> receipts;
  final String? createdAt;
  final String? updatedAt;

  int get plannedQty => lines.fold(0, (total, line) => total + line.plannedQty);

  int get outboundQty =>
      lines.fold(0, (total, line) => total + line.outboundQty);

  int get receivedQty =>
      lines.fold(0, (total, line) => total + line.receivedQty);

  int get unavailableQty =>
      lines.fold(0, (total, line) => total + line.unavailableQty);

  int get differenceQty =>
      lines.fold(0, (total, line) => total + line.differenceQty);

  int get remainingInTransitQty =>
      lines.fold(0, (total, line) => total + line.remainingInTransitQty);

  bool get hasDifference => differenceQty > 0;

  String get statusLabel {
    switch (status) {
      case 'DRAFT':
        return '待调出';
      case 'OUTBOUND':
        return '在途';
      case 'PARTIALLY_RECEIVED':
        return '部分收货';
      case 'RECEIVED':
        return '已收货';
      case 'CANCELLED':
        return '已取消';
      case 'REVERSED':
        return '已冲销';
      default:
        return status;
    }
  }

  factory TransferRecord.fromJson(Map<String, dynamic> json) {
    final fromWarehouse = _map(json['fromWarehouse']);
    final toWarehouse = _map(json['toWarehouse']);
    final outboundBy = _map(json['outboundBy']);
    final outboundDocument = _map(json['outboundDocument']);
    return TransferRecord(
      id: _str(json['id']),
      transferNo: _str(json['transferNo']),
      sourceKey: _str(json['sourceKey']),
      status: _str(json['status']).toUpperCase(),
      fromWarehouseId: _str(fromWarehouse['id']),
      fromWarehouseCode: _str(fromWarehouse['code']),
      fromWarehouseName: _str(fromWarehouse['name']),
      toWarehouseId: _str(toWarehouse['id']),
      toWarehouseCode: _str(toWarehouse['code']),
      toWarehouseName: _str(toWarehouse['name']),
      outboundDocumentId: _strOrNull(json['outboundDocumentId']),
      outboundAt: _strOrNull(json['outboundAt']),
      outboundBy:
          outboundBy.isEmpty ? null : TransferActorRecord.fromJson(outboundBy),
      notes: _strOrNull(json['notes']),
      version: _int(json['version']),
      lines: _list(json['lines'])
          .map((e) => TransferLine.fromJson(_map(e)))
          .toList(),
      outboundDocument: outboundDocument.isEmpty
          ? null
          : TransferDocumentRecord.fromJson(outboundDocument),
      receipts: _list(json['receipts'])
          .map((value) => TransferReceiptRecord.fromJson(_map(value)))
          .toList(),
      createdAt: _strOrNull(json['createdAt']),
      updatedAt: _strOrNull(json['updatedAt']),
    );
  }
}

class TransferCommandResult {
  const TransferCommandResult({
    required this.transferId,
    required this.receiptId,
    required this.documentIds,
    required this.replayed,
  });

  final String transferId;
  final String? receiptId;
  final List<String> documentIds;
  final bool replayed;

  factory TransferCommandResult.fromJson(Map<String, dynamic> json) {
    return TransferCommandResult(
      transferId: _str(json['transferId']),
      receiptId: _strOrNull(json['receiptId']),
      documentIds: _list(json['documentIds'])
          .map(_str)
          .where((value) => value.isNotEmpty)
          .toList(),
      replayed: _bool(json['replayed']),
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

class StocktakeLineRecord {
  const StocktakeLineRecord({
    required this.snapshotStockVersion,
    required this.snapshotLastMovementId,
    required this.snapshotOnHandQty,
    required this.snapshotUnavailableQty,
    required this.countedOnHandQty,
    required this.countedUnavailableQty,
    required this.onHandDifferenceQty,
    required this.unavailableDifferenceQty,
  });

  final int? snapshotStockVersion;
  final String? snapshotLastMovementId;
  final int? snapshotOnHandQty;
  final int? snapshotUnavailableQty;
  final int? countedOnHandQty;
  final int? countedUnavailableQty;
  final int? onHandDifferenceQty;
  final int? unavailableDifferenceQty;

  bool get hasSnapshot =>
      snapshotStockVersion != null &&
      snapshotOnHandQty != null &&
      snapshotUnavailableQty != null;

  factory StocktakeLineRecord.fromJson(Map<String, dynamic> json) {
    return StocktakeLineRecord(
      snapshotStockVersion: _intOrNull(json['snapshotStockVersion']),
      snapshotLastMovementId: _strOrNull(json['snapshotLastMovementId']),
      snapshotOnHandQty: _intOrNull(json['snapshotOnHandQty']),
      snapshotUnavailableQty: _intOrNull(json['snapshotUnavailableQty']),
      countedOnHandQty: _intOrNull(json['countedOnHandQty']),
      countedUnavailableQty: _intOrNull(json['countedUnavailableQty']),
      onHandDifferenceQty: _intOrNull(json['onHandDifferenceQty']),
      unavailableDifferenceQty: _intOrNull(json['unavailableDifferenceQty']),
    );
  }
}

class StocktakeSerializedScanRecord {
  const StocktakeSerializedScanRecord({
    required this.id,
    required this.lineNo,
    required this.logisticsCode,
    required this.matchStatus,
    required this.countedCondition,
    required this.expectedUnitStatus,
    required this.actionMovementId,
  });

  final String id;
  final int lineNo;
  final String logisticsCode;
  final String matchStatus;
  final String? countedCondition;
  final String? expectedUnitStatus;
  final String? actionMovementId;

  factory StocktakeSerializedScanRecord.fromJson(Map<String, dynamic> json) {
    return StocktakeSerializedScanRecord(
      id: _str(json['id']),
      lineNo: _int(json['lineNo']),
      logisticsCode: _str(json['scannedLogisticsCodeSnapshot']),
      matchStatus: _str(json['matchStatus']).toUpperCase(),
      countedCondition: _strOrNull(json['countedCondition'])?.toUpperCase(),
      expectedUnitStatus: _strOrNull(json['expectedUnitStatus'])?.toUpperCase(),
      actionMovementId: _strOrNull(json['actionMovementId']),
    );
  }
}

class StocktakeRecord {
  const StocktakeRecord({
    required this.id,
    required this.stocktakeNo,
    required this.status,
    required this.warehouseId,
    required this.warehouseCode,
    required this.warehouseName,
    required this.productId,
    required this.productName,
    required this.productUnit,
    required this.trackingMode,
    required this.active,
    required this.reason,
    required this.rejectionReason,
    required this.reversalReason,
    required this.line,
    required this.serializedScans,
    required this.submittedByName,
    required this.submittedByRole,
    required this.createdAt,
    required this.submittedAt,
    required this.approvedByName,
    required this.approvedAt,
    required this.rejectedByName,
    required this.rejectedAt,
    required this.postedByName,
    required this.postedAt,
    required this.reversedByName,
    required this.reversedAt,
    required this.updatedAt,
  });

  final String id;
  final String stocktakeNo;
  final String status;
  final String warehouseId;
  final String warehouseCode;
  final String warehouseName;
  final String productId;
  final String productName;
  final String productUnit;
  final String trackingMode;
  final bool active;
  final String? reason;
  final String? rejectionReason;
  final String? reversalReason;
  final StocktakeLineRecord? line;
  final List<StocktakeSerializedScanRecord> serializedScans;
  final String? submittedByName;
  final String? submittedByRole;
  final String? createdAt;
  final String? submittedAt;
  final String? approvedByName;
  final String? approvedAt;
  final String? rejectedByName;
  final String? rejectedAt;
  final String? postedByName;
  final String? postedAt;
  final String? reversedByName;
  final String? reversedAt;
  final String? updatedAt;

  bool get isSerialized => trackingMode == 'SERIALIZED';
  int get systemOnHandQty => line?.snapshotOnHandQty ?? 0;
  int? get countedOnHandQty => line?.countedOnHandQty;
  int? get countedUnavailableQty => line?.countedUnavailableQty;
  int? get varianceQty => line?.onHandDifferenceQty;

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
    final warehouse = _map(json['warehouse']);
    final product = _map(json['product']);
    final lineJson = _map(json['line']);
    return StocktakeRecord(
      id: _str(json['id']),
      stocktakeNo: _str(json['stocktakeNo']),
      status: _str(json['status']).toUpperCase(),
      warehouseId: _str(warehouse['id']),
      warehouseCode: _str(warehouse['code']),
      warehouseName: _str(warehouse['name']),
      productId: _str(product['id']),
      productName: _str(product['name']),
      productUnit: _str(product['unit'], '瓶'),
      trackingMode: _str(
        json['trackingMode'] ?? product['inventoryTrackingMode'],
        'NONE',
      ).toUpperCase(),
      active: _bool(json['active']),
      reason: _strOrNull(json['reason']),
      rejectionReason: _strOrNull(json['rejectionReason']),
      reversalReason: _strOrNull(json['reversalReason']),
      line: lineJson.isEmpty ? null : StocktakeLineRecord.fromJson(lineJson),
      serializedScans: _list(json['serializedScans'])
          .map((item) => StocktakeSerializedScanRecord.fromJson(_map(item)))
          .toList(),
      submittedByName: _strOrNull(json['submittedByName']),
      submittedByRole: _strOrNull(json['submittedByRole']),
      createdAt: _strOrNull(json['createdAt']),
      submittedAt: _strOrNull(json['submittedAt']),
      approvedByName: _strOrNull(json['approvedByName']),
      approvedAt: _strOrNull(json['approvedAt']),
      rejectedByName: _strOrNull(json['rejectedByName']),
      rejectedAt: _strOrNull(json['rejectedAt']),
      postedByName: _strOrNull(json['postedByName']),
      postedAt: _strOrNull(json['postedAt']),
      reversedByName: _strOrNull(json['reversedByName']),
      reversedAt: _strOrNull(json['reversedAt']),
      updatedAt: _strOrNull(json['updatedAt']),
    );
  }
}

class StocktakeScanInput {
  const StocktakeScanInput({
    required this.logisticsCode,
    required this.condition,
  });

  final String logisticsCode;
  final String condition;
}

class StocktakeCommandResult {
  const StocktakeCommandResult({
    required this.stocktake,
    required this.replayed,
  });

  final StocktakeRecord stocktake;
  final bool replayed;

  factory StocktakeCommandResult.fromJson(Map<String, dynamic> json) {
    return StocktakeCommandResult(
      stocktake: StocktakeRecord.fromJson(_map(json['stocktake'])),
      replayed: _bool(json['replayed']),
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
    required this.warehouseCode,
    required this.warehouseName,
    required this.productName,
    required this.trackingMode,
    required this.availableQty,
    required this.shortageQty,
    required this.minimumAvailableQty,
    required this.firstDetectedAt,
    required this.lastDetectedAt,
    required this.resolvedAt,
  });

  final String id;
  final String type;
  final String status;
  final String warehouseCode;
  final String warehouseName;
  final String productName;
  final String trackingMode;
  final int? availableQty;
  final int? shortageQty;
  final int? minimumAvailableQty;
  final String? firstDetectedAt;
  final String? lastDetectedAt;
  final String? resolvedAt;

  String get typeLabel {
    switch (type) {
      case 'LOW_STOCK':
        return '低库存';
      case 'NEGATIVE_AVAILABLE':
        return '可售为负';
      case 'PENDING_COST':
        return '待补成本';
      case 'ORDER_SHORTAGE':
        return '待配货';
      case 'TRANSFER_OVERDUE':
        return '调拨超时';
      case 'STOCKTAKE_APPROVAL':
        return '盘点待审';
      default:
        return type;
    }
  }

  factory AlertRecord.fromJson(Map<String, dynamic> json) {
    final warehouse = _map(json['warehouse']);
    final product = _map(json['product']);
    return AlertRecord(
      id: _str(json['id']),
      type: _str(json['type']).toUpperCase(),
      status: _str(json['status']).toUpperCase(),
      warehouseCode: _str(warehouse['code']),
      warehouseName: _str(warehouse['name']),
      productName: _str(product['name']),
      trackingMode: _str(product['inventoryTrackingMode']).toUpperCase(),
      availableQty: _intOrNull(json['availableQty']),
      shortageQty: _intOrNull(json['shortageQty']),
      minimumAvailableQty: _intOrNull(json['minimumAvailableQty']),
      firstDetectedAt: _strOrNull(json['firstDetectedAt']),
      lastDetectedAt: _strOrNull(json['lastDetectedAt']),
      resolvedAt: _strOrNull(json['resolvedAt']),
    );
  }

  factory AlertRecord.fromReportRow(Map<String, dynamic> row) {
    final type = _str(row['alertType']).toUpperCase();
    final warehouseCode = _str(row['warehouseCode']);
    final warehouseName = _str(row['warehouseName']);
    final productName = _str(row['productName']);
    final firstDetectedAt = _strOrNull(row['firstDetectedAt']);
    return AlertRecord(
      id: '$type:$warehouseCode:$productName:${firstDetectedAt ?? ''}',
      type: type,
      status: _str(row['status']).toUpperCase(),
      warehouseCode: warehouseCode,
      warehouseName: warehouseName,
      productName: productName,
      trackingMode: _str(row['trackingMode']).toUpperCase(),
      availableQty: _intOrNull(row['availableQty']),
      shortageQty: _intOrNull(row['shortageQty']),
      minimumAvailableQty: _intOrNull(row['minimumAvailableQty']),
      firstDetectedAt: firstDetectedAt,
      lastDetectedAt: _strOrNull(row['lastDetectedAt']),
      resolvedAt: _strOrNull(row['resolvedAt']),
    );
  }
}

class AlertConfigRecord {
  const AlertConfigRecord({
    required this.id,
    required this.warehouseId,
    required this.productId,
    required this.warehouseName,
    required this.productName,
    required this.minimumAvailableQty,
    required this.enabled,
    required this.updatedAt,
  });

  final String id;
  final String warehouseId;
  final String productId;
  final String warehouseName;
  final String productName;
  final int minimumAvailableQty;
  final bool enabled;
  final String? updatedAt;

  factory AlertConfigRecord.fromJson(Map<String, dynamic> json) {
    return AlertConfigRecord(
      id: _str(json['id']),
      warehouseId: _str(json['warehouseId']),
      productId: _str(json['productId']),
      warehouseName: _str(_map(json['warehouse'])['name']),
      productName: _str(_map(json['product'])['name']),
      minimumAvailableQty: _int(json['minimumAvailableQty']),
      enabled: _bool(json['enabled'], true),
      updatedAt: _strOrNull(json['updatedAt']),
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
    required this.sourceKey,
    required this.warehouseId,
    required this.productId,
    required this.batchId,
    required this.serializedUnitId,
    required this.reservationId,
    required this.reversalOfMovementId,
    required this.movementType,
    required this.warehouseCode,
    required this.warehouseName,
    required this.productName,
    required this.trackingMode,
    required this.onHandDelta,
    required this.reservedDelta,
    required this.unavailableDelta,
    required this.inTransitDelta,
    required this.businessAt,
    required this.operatorName,
    required this.operatorRole,
    required this.purchaseOrderNo,
    required this.productionBatch,
    required this.reason,
    required this.createdAt,
    required this.purchaseUnitCostCents,
    required this.inventoryAmountCents,
  });

  final String id;
  final String sourceKey;
  final String warehouseId;
  final String productId;
  final String? batchId;
  final String? serializedUnitId;
  final String? reservationId;
  final String? reversalOfMovementId;
  final String movementType;
  final String warehouseCode;
  final String warehouseName;
  final String productName;
  final String trackingMode;
  final int onHandDelta;
  final int reservedDelta;
  final int unavailableDelta;
  final int inTransitDelta;
  final String? businessAt;
  final String? operatorName;
  final String? operatorRole;
  final String? purchaseOrderNo;
  final String? productionBatch;
  final String? reason;
  final String? createdAt;
  final int? purchaseUnitCostCents;
  final int? inventoryAmountCents;

  /// 兼容列表主数量展示；实际详情应分别展示四类真实变化字段。
  int get quantity {
    if (onHandDelta != 0) return onHandDelta;
    if (reservedDelta != 0) return reservedDelta;
    if (unavailableDelta != 0) return unavailableDelta;
    return inTransitDelta;
  }

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
    final warehouse = _map(json['warehouse']);
    final product = _map(json['product']);
    final operator = _map(json['operator']);
    final batch = _map(json['batch']);
    return MovementRecord(
      id: _str(json['id']),
      sourceKey: _str(json['sourceKey']),
      warehouseId: _str(json['warehouseId']),
      productId: _str(json['productId']),
      batchId: _strOrNull(json['batchId']),
      serializedUnitId: _strOrNull(json['serializedUnitId']),
      reservationId: _strOrNull(json['reservationId']),
      reversalOfMovementId: _strOrNull(json['reversalOfMovementId']),
      movementType: _str(json['movementType']).toUpperCase(),
      warehouseCode: _str(warehouse['code']),
      warehouseName: _str(warehouse['name']),
      productName: _str(product['name']),
      trackingMode: _str(product['inventoryTrackingMode']).toUpperCase(),
      onHandDelta: _int(json['onHandDelta'], _int(json['quantity'])),
      reservedDelta: _int(json['reservedDelta']),
      unavailableDelta: _int(json['unavailableDelta']),
      inTransitDelta: _int(json['inTransitDelta']),
      businessAt: _strOrNull(json['businessAt']),
      operatorName: _strOrNull(operator['name']),
      operatorRole: _strOrNull(operator['role']),
      purchaseOrderNo: _strOrNull(batch['purchaseOrderNo']),
      productionBatch: _strOrNull(batch['productionBatch']),
      reason: _strOrNull(json['reason']),
      createdAt: _strOrNull(json['createdAt']),
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
          .map(
              (e) => MovementRecord.fromJson(_map(e), canReadCost: canReadCost))
          .toList(),
      page: _int(pagination['page'], 1),
      pageSize: _int(pagination['pageSize'], 20),
      total: _int(pagination['total']),
      totalPages: _int(pagination['totalPages']),
    );
  }
}

class ReportColumn {
  const ReportColumn(
      {required this.key, required this.label, required this.type});
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

class InventoryAfterSalesSerializedSummary {
  const InventoryAfterSalesSerializedSummary({
    required this.total,
    required this.matched,
    required this.unknown,
    required this.conflict,
  });

  final int total;
  final int matched;
  final int unknown;
  final int conflict;

  bool get hasException => unknown > 0 || conflict > 0;

  factory InventoryAfterSalesSerializedSummary.fromJson(
    Map<String, dynamic> json,
  ) {
    return InventoryAfterSalesSerializedSummary(
      total: _int(json['total']),
      matched: _int(json['matched']),
      unknown: _int(json['unknown']),
      conflict: _int(json['conflict']),
    );
  }
}

class InventoryAfterSalesSerializedUnitRecord {
  const InventoryAfterSalesSerializedUnitRecord({
    required this.id,
    required this.originalSerializedUnitId,
    required this.scannedLogisticsCode,
    required this.matchStatus,
  });

  final String id;
  final String? originalSerializedUnitId;
  final String scannedLogisticsCode;
  final String matchStatus;

  factory InventoryAfterSalesSerializedUnitRecord.fromJson(
    Map<String, dynamic> json,
  ) {
    return InventoryAfterSalesSerializedUnitRecord(
      id: _str(json['id']),
      originalSerializedUnitId: _strOrNull(json['originalSerializedUnitId']),
      scannedLogisticsCode: _str(json['scannedLogisticsCode']),
      matchStatus: _str(json['matchStatus']).toLowerCase(),
    );
  }
}

class InventoryAfterSalesReceiptLineRecord {
  const InventoryAfterSalesReceiptLineRecord({
    required this.id,
    required this.lineNo,
    required this.afterSalesOrderItemId,
    required this.productId,
    required this.productName,
    required this.receivedQty,
    required this.condition,
    required this.exceptionReason,
    required this.batchId,
    required this.productionBatch,
    required this.serializedSummary,
    required this.serializedUnits,
  });

  final String id;
  final int lineNo;
  final String afterSalesOrderItemId;
  final String? productId;
  final String productName;
  final int receivedQty;
  final String condition;
  final String? exceptionReason;
  final String? batchId;
  final String? productionBatch;
  final InventoryAfterSalesSerializedSummary serializedSummary;
  final List<InventoryAfterSalesSerializedUnitRecord> serializedUnits;

  bool get hasException =>
      condition == 'exception' || serializedSummary.hasException;

  factory InventoryAfterSalesReceiptLineRecord.fromJson(
    Map<String, dynamic> json,
  ) {
    final batch = _map(json['batch']);
    return InventoryAfterSalesReceiptLineRecord(
      id: _str(json['id']),
      lineNo: _int(json['lineNo']),
      afterSalesOrderItemId: _str(json['afterSalesOrderItemId']),
      productId: _strOrNull(json['productId']),
      productName: _str(json['productName']),
      receivedQty: _int(json['receivedQty']),
      condition: _str(json['condition']).toLowerCase(),
      exceptionReason: _strOrNull(json['exceptionReason']),
      batchId: _strOrNull(batch['id']),
      productionBatch: _strOrNull(batch['productionBatch']),
      serializedSummary: InventoryAfterSalesSerializedSummary.fromJson(
        _map(json['serializedSummary']),
      ),
      serializedUnits: _list(json['serializedUnits'])
          .map(
            (item) => InventoryAfterSalesSerializedUnitRecord.fromJson(
              _map(item),
            ),
          )
          .toList(),
    );
  }
}

class InventoryAfterSalesReceiptRecord {
  const InventoryAfterSalesReceiptRecord({
    required this.id,
    required this.afterSalesOrderId,
    required this.afterSalesNo,
    required this.warehouseId,
    required this.warehouseCode,
    required this.warehouseName,
    required this.status,
    required this.notes,
    required this.reversalReason,
    required this.confirmedAt,
    required this.reversedAt,
    required this.createdAt,
    required this.updatedAt,
    required this.lines,
  });

  final String id;
  final String afterSalesOrderId;
  final String? afterSalesNo;
  final String warehouseId;
  final String? warehouseCode;
  final String? warehouseName;
  final String status;
  final String? notes;
  final String? reversalReason;
  final String? confirmedAt;
  final String? reversedAt;
  final String? createdAt;
  final String? updatedAt;
  final List<InventoryAfterSalesReceiptLineRecord> lines;

  int get receivedQty => lines.fold(0, (sum, line) => sum + line.receivedQty);
  bool get hasException => lines.any((line) => line.hasException);
  bool get isDraft => status == 'draft';
  bool get isPosted => status == 'posted';
  bool get isReversed => status == 'reversed';

  factory InventoryAfterSalesReceiptRecord.fromJson(
    Map<String, dynamic> json,
  ) {
    final warehouse = _map(json['warehouse']);
    return InventoryAfterSalesReceiptRecord(
      id: _str(json['id']),
      afterSalesOrderId: _str(json['afterSalesOrderId']),
      afterSalesNo: _strOrNull(json['afterSalesNo']),
      warehouseId: _str(warehouse['id']),
      warehouseCode: _strOrNull(warehouse['code']),
      warehouseName: _strOrNull(warehouse['name']),
      status: _str(json['status']).toLowerCase(),
      notes: _strOrNull(json['notes']),
      reversalReason: _strOrNull(json['reversalReason']),
      confirmedAt: _strOrNull(json['confirmedAt']),
      reversedAt: _strOrNull(json['reversedAt']),
      createdAt: _strOrNull(json['createdAt']),
      updatedAt: _strOrNull(json['updatedAt']),
      lines: _list(json['lines'])
          .map(
            (item) => InventoryAfterSalesReceiptLineRecord.fromJson(_map(item)),
          )
          .toList(),
    );
  }
}

class InventoryAfterSalesReceiptCommandResult {
  const InventoryAfterSalesReceiptCommandResult({
    required this.receipt,
    required this.replayed,
  });

  final InventoryAfterSalesReceiptRecord receipt;
  final bool replayed;

  factory InventoryAfterSalesReceiptCommandResult.fromJson(
    Map<String, dynamic> json,
  ) {
    return InventoryAfterSalesReceiptCommandResult(
      receipt: InventoryAfterSalesReceiptRecord.fromJson(
        _map(json['afterSalesReceipt']),
      ),
      replayed: _bool(json['replayed']),
    );
  }
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

  bool get canReadAfterSalesReceipts => const {
        UserRole.superAdmin,
        UserRole.admin,
        UserRole.warehouse,
        UserRole.finance,
        UserRole.boss,
        UserRole.afterSales,
      }.contains(role);

  bool get canWriteAfterSalesReceipts => const {
        UserRole.superAdmin,
        UserRole.admin,
        UserRole.warehouse,
      }.contains(role);

  // 角色绑定缓存：切换账号/角色时必须清除，防止成本/数量残留。
  final Map<String, dynamic> _cache = {};

  /// 清除所有库存与成本缓存。角色变化时调用。
  void clearCache() => _cache.clear();

  Map<String, dynamic> _data(Map<String, dynamic> payload) =>
      _map(payload['data']);

  // --- 仓库 ---

  Future<WarehousePage> listWarehousePage({
    int page = 1,
    int pageSize = 20,
    String? q,
    bool? isActive,
    bool? isDefault,
  }) async {
    final query = <String, String>{
      'page': '$page',
      'pageSize': '$pageSize',
    };
    _putNonEmpty(query, 'q', q);
    if (isActive != null) query['isActive'] = isActive.toString();
    if (isDefault != null) query['isDefault'] = isDefault.toString();
    final payload = await _apiClient
        .getJson(_path('/api/inventory/warehouses', query), token: _token);
    return WarehousePage.fromJson(_data(payload));
  }

  Future<List<WarehouseRecord>> listWarehouses({
    String? q,
    bool? isActive,
  }) async {
    final first = await listWarehousePage(
      q: q,
      isActive: isActive,
      pageSize: 100,
    );
    if (first.totalPages <= 1) return first.warehouses;
    final warehouses = <WarehouseRecord>[...first.warehouses];
    for (var page = 2; page <= first.totalPages; page++) {
      final next = await listWarehousePage(
        page: page,
        pageSize: 100,
        q: q,
        isActive: isActive,
      );
      warehouses.addAll(next.warehouses);
    }
    return warehouses;
  }

  Future<WarehouseRecord> createWarehouse({
    required String code,
    required String name,
    String? address,
    String? managerUserId,
    bool isActive = true,
    bool isDefault = false,
  }) async {
    if (!canManageWarehouse(role)) {
      throw const ApiException(
        statusCode: 403,
        code: 'PERMISSION_DENIED',
        message: 'Only administrators can manage warehouses.',
      );
    }
    final body = <String, dynamic>{
      'code': code.trim(),
      'name': name.trim(),
      'isActive': isActive,
      'isDefault': isDefault,
    };
    if (address != null) body['address'] = address.trim();
    if (managerUserId != null) {
      body['managerUserId'] =
          managerUserId.trim().isEmpty ? null : managerUserId.trim();
    }
    final result = await _apiClient.postJson(
      '/api/inventory/warehouses',
      body: body,
      token: _token,
    );
    return WarehouseRecord.fromJson(_data(result));
  }

  Future<WarehouseRecord> updateWarehouse({
    required String warehouseId,
    String? code,
    String? name,
    String? address,
    String? managerUserId,
    bool includeManagerUserId = false,
    bool? isActive,
    bool? isDefault,
  }) async {
    if (!canManageWarehouse(role)) {
      throw const ApiException(
        statusCode: 403,
        code: 'PERMISSION_DENIED',
        message: 'Only administrators can manage warehouses.',
      );
    }
    final body = <String, dynamic>{};
    if (code != null) body['code'] = code.trim();
    if (name != null) body['name'] = name.trim();
    if (address != null) body['address'] = address.trim();
    if (includeManagerUserId) {
      body['managerUserId'] =
          managerUserId == null || managerUserId.trim().isEmpty
              ? null
              : managerUserId.trim();
    }
    if (isActive != null) body['isActive'] = isActive;
    if (isDefault != null) body['isDefault'] = isDefault;
    final result = await _apiClient.patchJson(
      '/api/inventory/warehouses/$warehouseId',
      body: body,
      token: _token,
    );
    return WarehouseRecord.fromJson(_data(result));
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
    if (hasUnavailable != null) {
      query['hasUnavailable'] = hasUnavailable.toString();
    }
    final payload = await _apiClient
        .getJson(_path('/api/inventory/stocks', query), token: _token);
    return StockPage.fromJson(_data(payload), canReadCost: canReadCost);
  }

  Future<StockDetailRecord> getStock({
    required String warehouseId,
    required String productId,
  }) async {
    final payload = await _apiClient.getJson(
      '/api/inventory/stocks/${Uri.encodeComponent(warehouseId)}/'
      '${Uri.encodeComponent(productId)}',
      token: _token,
    );
    return StockDetailRecord.fromJson(
      _map(_data(payload)['stock']),
      canReadCost: canReadCost,
    );
  }

  // --- 入库 ---

  Future<InboundDocumentPage> listInbounds({
    int page = 1,
    int pageSize = 20,
    String? warehouseId,
    String? productId,
    String? type,
    String? status,
    String? batch,
    DateTime? dateFrom,
    DateTime? dateTo,
  }) async {
    final query = <String, String>{
      'page': '$page',
      'pageSize': '$pageSize',
    };
    _putNonEmpty(query, 'warehouseId', warehouseId);
    _putNonEmpty(query, 'productId', productId);
    _putNonEmpty(query, 'type', type);
    _putNonEmpty(query, 'status', status);
    _putNonEmpty(query, 'batch', batch);
    if (dateFrom != null) {
      query['dateFrom'] = dateFrom.toUtc().toIso8601String();
    }
    if (dateTo != null) {
      query['dateTo'] = dateTo.toUtc().toIso8601String();
    }
    final payload = await _apiClient
        .getJson(_path('/api/inventory/inbounds', query), token: _token);
    return InboundDocumentPage.fromJson(_data(payload),
        canReadCost: canReadCost);
  }

  Future<InboundDocumentRecord> getInbound(String documentId) async {
    final payload = await _apiClient.getJson(
      '/api/inventory/inbounds/${Uri.encodeComponent(documentId)}',
      token: _token,
    );
    return InboundDocumentRecord.fromJson(
      _map(_data(payload)['inbound']),
      canReadCost: canReadCost,
    );
  }

  Future<InventoryCommandResult> createInbound({
    required String kind,
    required String warehouseId,
    required String productId,
    required int quantity,
    required String sourceLineKey,
    DateTime? businessAt,
    String? supplierName,
    String? purchaseOrderNo,
    String? productionBatch,
    DateTime? productionDate,
    String? notes,
    int? purchaseUnitCostCents,
  }) async {
    final batch = <String, dynamic>{
      'sourceLineKey': sourceLineKey,
    };
    if (supplierName != null) batch['supplierName'] = supplierName;
    if (purchaseOrderNo != null) batch['purchaseOrderNo'] = purchaseOrderNo;
    if (productionBatch != null) batch['productionBatch'] = productionBatch;
    if (productionDate != null) {
      batch['productionDate'] = _dateOnly(productionDate);
    }
    // 仅 admin/super_admin 可在入库时携带成本
    if (purchaseUnitCostCents != null &&
        (role == UserRole.superAdmin || role == UserRole.admin)) {
      batch['purchaseUnitCostCents'] = purchaseUnitCostCents;
    }
    final payload = <String, dynamic>{
      'kind': kind,
      'warehouseId': warehouseId,
      'productId': productId,
      'quantity': quantity,
      'batch': batch,
    };
    if (businessAt != null) {
      payload['businessAt'] = businessAt.toUtc().toIso8601String();
    }
    if (notes != null) payload['notes'] = notes;
    final body = buildCommandEnvelope('INBOUND', payload);
    final result = await _apiClient.postJson('/api/inventory/inbounds',
        body: body, token: _token);
    return InventoryCommandResult.fromJson(_data(result));
  }

  Future<InventoryCommandResult> reverseInbound(
    String documentId,
    String reason,
  ) async {
    final body = buildCommandEnvelope('REVERSE', {
      'documentId': documentId,
      'reason': reason,
    });
    final result = await _apiClient.postJson(
        '/api/inventory/inbounds/${Uri.encodeComponent(documentId)}/reverse',
        body: body,
        token: _token);
    return InventoryCommandResult.fromJson(_data(result));
  }

  Future<InventoryCommandResult> updateBatchCost({
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
    final result = await _apiClient.patchJson(
        '/api/inventory/batches/${Uri.encodeComponent(batchId)}/cost',
        body: body,
        token: _token);
    return InventoryCommandResult.fromJson(_data(result));
  }

  // --- 调拨 ---

  Future<TransferPage> listTransfers({
    int page = 1,
    int pageSize = 20,
    String? fromWarehouseId,
    String? toWarehouseId,
    String? productId,
    String? status,
    DateTime? dateFrom,
    DateTime? dateTo,
  }) async {
    final query = <String, String>{
      'page': '$page',
      'pageSize': '$pageSize',
    };
    _putNonEmpty(query, 'fromWarehouseId', fromWarehouseId);
    _putNonEmpty(query, 'toWarehouseId', toWarehouseId);
    _putNonEmpty(query, 'productId', productId);
    _putNonEmpty(query, 'status', status);
    if (dateFrom != null) {
      _putNonEmpty(query, 'dateFrom', _dateOnly(dateFrom));
    }
    if (dateTo != null) {
      _putNonEmpty(query, 'dateTo', _dateOnly(dateTo));
    }
    final payload = await _apiClient
        .getJson(_path('/api/inventory/transfers', query), token: _token);
    return TransferPage.fromJson(_data(payload));
  }

  Future<TransferRecord> getTransfer(String transferId) async {
    final payload = await _apiClient.getJson(
      '/api/inventory/transfers/${Uri.encodeComponent(transferId)}',
      token: _token,
    );
    return TransferRecord.fromJson(_map(_data(payload)['transfer']));
  }

  Future<TransferCommandResult> createTransfer({
    required String fromWarehouseId,
    required String toWarehouseId,
    required List<Map<String, dynamic>> lines,
    String? notes,
  }) async {
    final payload = <String, dynamic>{
      'fromWarehouseId': fromWarehouseId,
      'toWarehouseId': toWarehouseId,
      'lines': lines,
    };
    if (notes != null) payload['notes'] = notes;
    final body = buildCommandEnvelope('TRANSFER_CREATE', payload);
    final result = await _apiClient.postJson('/api/inventory/transfers',
        body: body, token: _token);
    return TransferCommandResult.fromJson(_data(result));
  }

  Future<TransferCommandResult> confirmTransferOutbound({
    required String transferId,
    DateTime? businessAt,
    String? reason,
  }) async {
    final payload = <String, dynamic>{
      'transferId': transferId,
    };
    if (businessAt != null) {
      payload['businessAt'] = businessAt.toUtc().toIso8601String();
    }
    if (reason != null) payload['reason'] = reason;
    final body = buildCommandEnvelope('TRANSFER_CONFIRM_OUTBOUND', payload);
    final result = await _apiClient.postJson(
        '/api/inventory/transfers/${Uri.encodeComponent(transferId)}/outbound',
        body: body,
        token: _token);
    return TransferCommandResult.fromJson(_data(result));
  }

  Future<TransferCommandResult> receiveTransfer({
    required String transferId,
    required List<Map<String, dynamic>> lines,
    DateTime? businessAt,
    String? reason,
    String? notes,
  }) async {
    final payload = <String, dynamic>{
      'transferId': transferId,
      'lines': lines,
    };
    if (businessAt != null) {
      payload['businessAt'] = businessAt.toUtc().toIso8601String();
    }
    if (reason != null) payload['reason'] = reason;
    if (notes != null) payload['notes'] = notes;
    final body = buildCommandEnvelope('TRANSFER_RECEIVE', payload);
    final result = await _apiClient.postJson(
        '/api/inventory/transfers/${Uri.encodeComponent(transferId)}/receipts',
        body: body,
        token: _token);
    return TransferCommandResult.fromJson(_data(result));
  }

  Future<TransferCommandResult> reverseTransferReceipt({
    required String receiptId,
    required String reason,
    DateTime? businessAt,
  }) async {
    final payload = <String, dynamic>{
      'receiptId': receiptId,
      'reason': reason,
    };
    if (businessAt != null) {
      payload['businessAt'] = businessAt.toUtc().toIso8601String();
    }
    final body = buildCommandEnvelope('TRANSFER_RECEIPT_REVERSE', payload);
    final result = await _apiClient.postJson(
      '/api/inventory/transfers/receipts/'
      '${Uri.encodeComponent(receiptId)}/reverse',
      body: body,
      token: _token,
    );
    return TransferCommandResult.fromJson(_data(result));
  }

  Future<TransferCommandResult> reverseTransferOutbound({
    required String transferId,
    required String reason,
    DateTime? businessAt,
  }) async {
    final payload = <String, dynamic>{
      'transferId': transferId,
      'reason': reason,
    };
    if (businessAt != null) {
      payload['businessAt'] = businessAt.toUtc().toIso8601String();
    }
    final body = buildCommandEnvelope('TRANSFER_OUTBOUND_REVERSE', payload);
    final result = await _apiClient.postJson(
        '/api/inventory/transfers/'
        '${Uri.encodeComponent(transferId)}/outbound/reverse',
        body: body,
        token: _token);
    return TransferCommandResult.fromJson(_data(result));
  }

  // --- 不可售 ---

  Future<InventoryCommandResult> markUnavailable({
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
    final result = await _apiClient.postJson('/api/inventory/unavailable/mark',
        body: body, token: _token);
    return InventoryCommandResult.fromJson(_data(result));
  }

  Future<InventoryCommandResult> restoreAvailable({
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
    final result = await _apiClient.postJson(
        '/api/inventory/unavailable/restore',
        body: body,
        token: _token);
    return InventoryCommandResult.fromJson(_data(result));
  }

  // --- 售后实际收货 ---

  Future<List<InventoryAfterSalesReceiptRecord>> listAfterSalesReceipts(
    String afterSalesOrderId,
  ) async {
    if (!canReadAfterSalesReceipts) {
      throw const ApiException(
        statusCode: 403,
        code: 'PERMISSION_DENIED',
        message: 'The current role cannot read after-sales receipt progress.',
      );
    }
    final result = await _apiClient.getJson(
      '/api/after-sales-orders/'
      '${Uri.encodeComponent(afterSalesOrderId)}/receipts',
      token: _token,
    );
    return _list(_data(result)['afterSalesReceipts'])
        .map(
          (item) => InventoryAfterSalesReceiptRecord.fromJson(_map(item)),
        )
        .toList();
  }

  Future<InventoryAfterSalesReceiptCommandResult> createAfterSalesReceipt({
    required String afterSalesOrderId,
    required String warehouseId,
    required List<Map<String, dynamic>> lines,
    String? notes,
    String? sourceKey,
    String? idempotencyKey,
  }) async {
    _requireAfterSalesReceiptWrite();
    final normalizedLines = _normalizeAfterSalesReceiptLines(lines);
    final transportPayload = <String, dynamic>{
      'warehouseId': warehouseId.trim(),
      'lines': [
        for (final line in normalizedLines)
          _afterSalesReceiptTransportLine(line),
      ],
      if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
    };
    final hashPayload = <String, dynamic>{
      'afterSalesOrderId': afterSalesOrderId.trim(),
      ...transportPayload,
      'lines': normalizedLines,
    };
    final body = _buildAfterSalesReceiptEnvelope(
      'CREATE',
      hashPayload: hashPayload,
      transportPayload: transportPayload,
      sourceKey: sourceKey,
      idempotencyKey: idempotencyKey,
    );
    final result = await _apiClient.postJson(
      '/api/after-sales-orders/'
      '${Uri.encodeComponent(afterSalesOrderId)}/receipts',
      body: body,
      token: _token,
    );
    return InventoryAfterSalesReceiptCommandResult.fromJson(_data(result));
  }

  Future<InventoryAfterSalesReceiptCommandResult> postAfterSalesReceipt({
    required String receiptId,
    DateTime? businessAt,
    String? sourceKey,
    String? idempotencyKey,
  }) async {
    _requireAfterSalesReceiptWrite();
    final transportPayload = <String, dynamic>{
      if (businessAt != null)
        'businessAt': businessAt.toUtc().toIso8601String(),
    };
    final body = _buildAfterSalesReceiptEnvelope(
      'POST',
      hashPayload: {
        'receiptId': receiptId.trim(),
        ...transportPayload,
      },
      transportPayload: transportPayload,
      sourceKey: sourceKey,
      idempotencyKey: idempotencyKey,
    );
    final result = await _apiClient.postJson(
      '/api/after-sales-orders/receipts/'
      '${Uri.encodeComponent(receiptId)}/post',
      body: body,
      token: _token,
    );
    return InventoryAfterSalesReceiptCommandResult.fromJson(_data(result));
  }

  Future<InventoryAfterSalesReceiptCommandResult> reverseAfterSalesReceipt({
    required String receiptId,
    required String reason,
    DateTime? businessAt,
    String? sourceKey,
    String? idempotencyKey,
  }) async {
    _requireAfterSalesReceiptWrite();
    final transportPayload = <String, dynamic>{
      'reason': reason.trim(),
      if (businessAt != null)
        'businessAt': businessAt.toUtc().toIso8601String(),
    };
    final body = _buildAfterSalesReceiptEnvelope(
      'REVERSE',
      hashPayload: {
        'receiptId': receiptId.trim(),
        ...transportPayload,
      },
      transportPayload: transportPayload,
      sourceKey: sourceKey,
      idempotencyKey: idempotencyKey,
    );
    final result = await _apiClient.postJson(
      '/api/after-sales-orders/receipts/'
      '${Uri.encodeComponent(receiptId)}/reverse',
      body: body,
      token: _token,
    );
    return InventoryAfterSalesReceiptCommandResult.fromJson(_data(result));
  }

  void _requireAfterSalesReceiptWrite() {
    if (!canWriteAfterSalesReceipts) {
      throw const ApiException(
        statusCode: 403,
        code: 'PERMISSION_DENIED',
        message:
            'Only warehouse operators and administrators can confirm physical receipts.',
      );
    }
  }

  // --- 盘点 ---

  Future<StocktakePage> listStocktakes({
    int page = 1,
    int pageSize = 20,
    String? warehouseId,
    String? productId,
    String? status,
  }) async {
    final query = <String, String>{
      'page': '$page',
      'pageSize': '$pageSize',
    };
    _putNonEmpty(query, 'warehouseId', warehouseId);
    _putNonEmpty(query, 'productId', productId);
    _putNonEmpty(query, 'status', status);
    final payload = await _apiClient
        .getJson(_path('/api/inventory/stocktakes', query), token: _token);
    return StocktakePage.fromJson(_data(payload));
  }

  Future<StocktakeRecord> getStocktake(String id) async {
    final payload = await _apiClient.getJson(
      '/api/inventory/stocktakes/${Uri.encodeComponent(id)}',
      token: _token,
    );
    return StocktakeRecord.fromJson(_map(_data(payload)['stocktake']));
  }

  Future<StocktakeCommandResult> createStocktake({
    required String warehouseId,
    required String productId,
  }) async {
    _requireStocktakeWrite();
    final hashPayload = <String, dynamic>{
      'warehouseId': warehouseId,
      'productId': productId,
    };
    final body = buildStocktakeCommandEnvelope(
      'STOCKTAKE_CREATE',
      hashPayload: hashPayload,
      transportPayload: hashPayload,
    );
    final result = await _apiClient.postJson(
      '/api/inventory/stocktakes',
      body: body,
      token: _token,
    );
    return StocktakeCommandResult.fromJson(_data(result));
  }

  Future<StocktakeCommandResult> submitStocktake({
    required String id,
    required String reason,
    int? countedOnHandQty,
    int? countedUnavailableQty,
    List<StocktakeScanInput>? scans,
  }) async {
    _requireStocktakeWrite();
    final cleanReason = reason.trim();
    final transportPayload = <String, dynamic>{'reason': cleanReason};
    if (countedOnHandQty != null) {
      transportPayload['countedOnHandQty'] = countedOnHandQty;
    }
    if (countedUnavailableQty != null) {
      transportPayload['countedUnavailableQty'] = countedUnavailableQty;
    }
    if (scans != null) {
      transportPayload['scans'] = [
        for (final scan in scans)
          {
            'logisticsCode': scan.logisticsCode.trim(),
            'condition': scan.condition.trim().toUpperCase(),
          },
      ];
    }
    final normalizedScans = _normalizeStocktakeScans(scans ?? const []);
    final body = buildStocktakeCommandEnvelope(
      'STOCKTAKE_SUBMIT',
      hashPayload: {
        'stocktakeId': id,
        'reason': cleanReason,
        'countedOnHandQty': countedOnHandQty,
        'countedUnavailableQty': countedUnavailableQty,
        'scans': normalizedScans,
      },
      transportPayload: transportPayload,
    );
    final result = await _apiClient.postJson(
      '/api/inventory/stocktakes/${Uri.encodeComponent(id)}/submit',
      body: body,
      token: _token,
    );
    return StocktakeCommandResult.fromJson(_data(result));
  }

  Future<StocktakeCommandResult> approveStocktake(String id) async {
    _requireStocktakeApprove();
    final body = buildStocktakeCommandEnvelope(
      'STOCKTAKE_APPROVE',
      hashPayload: {'stocktakeId': id},
    );
    final result = await _apiClient.postJson(
      '/api/inventory/stocktakes/${Uri.encodeComponent(id)}/approve',
      body: body,
      token: _token,
    );
    return StocktakeCommandResult.fromJson(_data(result));
  }

  Future<StocktakeCommandResult> rejectStocktake({
    required String id,
    required String reason,
  }) async {
    _requireStocktakeApprove();
    final cleanReason = reason.trim();
    final body = buildStocktakeCommandEnvelope(
      'STOCKTAKE_REJECT',
      hashPayload: {
        'stocktakeId': id,
        'reason': cleanReason,
      },
      transportPayload: {'reason': cleanReason},
    );
    final result = await _apiClient.postJson(
      '/api/inventory/stocktakes/${Uri.encodeComponent(id)}/reject',
      body: body,
      token: _token,
    );
    return StocktakeCommandResult.fromJson(_data(result));
  }

  Future<StocktakeCommandResult> reverseStocktake({
    required String id,
    required String reason,
  }) async {
    _requireStocktakeReverse();
    final cleanReason = reason.trim();
    final body = buildStocktakeCommandEnvelope(
      'STOCKTAKE_REVERSE',
      hashPayload: {
        'stocktakeId': id,
        'reason': cleanReason,
      },
      transportPayload: {'reason': cleanReason},
    );
    final result = await _apiClient.postJson(
      '/api/inventory/stocktakes/${Uri.encodeComponent(id)}/reverse',
      body: body,
      token: _token,
    );
    return StocktakeCommandResult.fromJson(_data(result));
  }

  void _requireStocktakeWrite() {
    if (!canStocktakeWrite(role)) {
      throw const ApiException(
        statusCode: 403,
        code: 'PERMISSION_DENIED',
        message: 'Only warehouse operators and administrators can count stock.',
      );
    }
  }

  void _requireStocktakeApprove() {
    if (!canStocktakeApprove(role)) {
      throw const ApiException(
        statusCode: 403,
        code: 'PERMISSION_DENIED',
        message: 'Only bosses and administrators can approve stocktakes.',
      );
    }
  }

  void _requireStocktakeReverse() {
    if (role != UserRole.superAdmin && role != UserRole.admin) {
      throw const ApiException(
        statusCode: 403,
        code: 'PERMISSION_DENIED',
        message: 'Only administrators can reverse posted stocktakes.',
      );
    }
  }

  // --- 预警 ---

  Future<AlertConfigPage> listAlertConfigs({
    int page = 1,
    int pageSize = 20,
    String? warehouseId,
    String? productId,
    bool? enabled,
  }) async {
    final query = <String, String>{
      'page': '$page',
      'pageSize': '$pageSize',
    };
    _putNonEmpty(query, 'warehouseId', warehouseId);
    _putNonEmpty(query, 'productId', productId);
    if (enabled != null) query['enabled'] = enabled.toString();
    final payload = await _apiClient
        .getJson(_path('/api/inventory/alert-configs', query), token: _token);
    return AlertConfigPage.fromJson(_data(payload));
  }

  Future<void> updateAlertConfig({
    required String warehouseId,
    required String productId,
    int? minimumAvailableQty,
    bool? enabled,
  }) async {
    if (!canManageWarehouse(role)) {
      throw const ApiException(
        statusCode: 403,
        code: 'PERMISSION_DENIED',
        message: 'Only administrators can maintain stock alert rules.',
      );
    }
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
    final payload = await _apiClient
        .getJson(_path('/api/inventory/movements', query), token: _token);
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
    _requireReportAccess(reportType);
    final query = <String, String>{
      'page': '$page',
      'pageSize': '$pageSize',
    };
    query.addAll(_roleScopedReportFilters(reportType, filters));
    final payload = await _apiClient.getJson(
        _path('/api/inventory/reports/$reportType', query),
        token: _token);
    return ReportResult.fromJson(_data(payload));
  }

  Future<ApiDownloadedFile> exportReport({
    required String reportType,
    Map<String, String>? filters,
  }) {
    _requireReportAccess(reportType);
    final query = _roleScopedReportFilters(reportType, filters);
    return _apiClient.getBytes(
        _path('/api/inventory/reports/$reportType/export.xlsx', query),
        token: _token,
        defaultFileName: 'inventory-$reportType.xlsx');
  }

  void _requireReportAccess(String reportType) {
    if (!reportTypes.contains(reportType)) {
      throw const ApiException(
        statusCode: 400,
        code: 'INVENTORY_VALIDATION_FAILED',
        message: '不支持的库存报表类型。',
      );
    }
    if (reportType == 'inventory-valuation' && !canReadCost) {
      throw const ApiException(
        statusCode: 403,
        code: 'INVENTORY_COST_REPORT_FORBIDDEN',
        message: '当前角色不可查看库存估值报表。',
      );
    }
  }

  Map<String, String> _roleScopedReportFilters(
    String reportType,
    Map<String, String>? filters,
  ) {
    final result = <String, String>{...?filters};
    if (reportType != 'alerts') return result;
    final requestedType = result['alertType']?.trim().toUpperCase();
    if (role == UserRole.finance) {
      if (requestedType != null &&
          requestedType.isNotEmpty &&
          requestedType != 'PENDING_COST') {
        throw const ApiException(
          statusCode: 403,
          code: 'PERMISSION_DENIED',
          message: 'Finance can only read pending-cost inventory alerts.',
        );
      }
      result['alertType'] = 'PENDING_COST';
    }
    if (role == UserRole.warehouse) {
      const allowed = {
        'LOW_STOCK',
        'NEGATIVE_AVAILABLE',
        'ORDER_SHORTAGE',
        'TRANSFER_OVERDUE',
      };
      if (requestedType == null ||
          requestedType.isEmpty ||
          !allowed.contains(requestedType)) {
        throw const ApiException(
          statusCode: 403,
          code: 'PERMISSION_DENIED',
          message:
              'Warehouse operators must select an allowed quantity alert type.',
        );
      }
      result['alertType'] = requestedType;
    }
    return result;
  }
}
