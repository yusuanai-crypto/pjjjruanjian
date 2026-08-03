import 'dart:convert';

import 'package:crypto/crypto.dart';

const productInventoryTrackingActivationCommand =
    'PRODUCT_INVENTORY_TRACKING_ACTIVATE';

Map<String, dynamic> buildProductInventoryTrackingActivationRequest({
  required String productId,
  required DateTime effectiveAt,
  required String sourceKey,
  required String idempotencyKey,
}) {
  final normalizedEffectiveAt = DateTime.utc(
    effectiveAt.toUtc().year,
    effectiveAt.toUtc().month,
    effectiveAt.toUtc().day,
    effectiveAt.toUtc().hour,
    effectiveAt.toUtc().minute,
    effectiveAt.toUtc().second,
  ).toIso8601String();
  final body = <String, dynamic>{
    'expectedCurrentMode': 'NONE',
    'targetMode': 'QUANTITY',
    'effectiveAt': normalizedEffectiveAt,
    'sourceKey': sourceKey.trim().toLowerCase(),
    'idempotencyKey': idempotencyKey.trim().toLowerCase(),
  };
  body['requestHash'] = calculateProductInventoryTrackingActivationHash(
    productId: productId,
    body: body,
  );
  return body;
}

String calculateProductInventoryTrackingActivationHash({
  required String productId,
  required Map<String, dynamic> body,
}) {
  final normalized = <String, dynamic>{
    'commandType': productInventoryTrackingActivationCommand,
    'payload': <String, dynamic>{
      'effectiveAt': '${body['effectiveAt']}'.trim(),
      'expectedCurrentMode':
          '${body['expectedCurrentMode']}'.trim().toUpperCase(),
      'idempotencyKey': '${body['idempotencyKey']}'.trim().toLowerCase(),
      'productId': productId.trim(),
      'sourceKey': '${body['sourceKey']}'.trim().toLowerCase(),
      'targetMode': '${body['targetMode']}'.trim().toUpperCase(),
    },
  };
  return sha256.convert(utf8.encode(_canonicalJson(normalized))).toString();
}

String _canonicalJson(Object? value) {
  if (value == null) return 'null';
  if (value is bool || value is num || value is String) {
    return jsonEncode(value);
  }
  if (value is List) {
    return '[${value.map(_canonicalJson).join(',')}]';
  }
  if (value is Map) {
    final keys = value.keys.map((key) => key.toString()).toList()..sort();
    return '{${keys.map((key) => '${jsonEncode(key)}:${_canonicalJson(value[key])}').join(',')}}';
  }
  return jsonEncode(value);
}
