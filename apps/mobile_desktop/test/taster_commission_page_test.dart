import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/taster_commissions/taster_commission_page.dart';

void main() {
  testWidgets('loads current taster commission records as read-only',
      (tester) async {
    final apiClient = _FakeTasterCommissionApiClient(
      records: [_commissionRecordJson(isConfirmed: true)],
    );

    await _pumpTasterCommissionPage(tester, apiClient);

    final uri = Uri.parse(apiClient.paths.single);
    expect(uri.path, '/api/commission-records/me');
    expect(uri.queryParameters['limit'], '50');
    expect(uri.queryParameters['dateFrom'], isNotNull);
    expect(uri.queryParameters['dateTo'], isNotNull);

    expect(find.text('TG-TASTER-001'), findsOneWidget);
    expect(find.text('SO-TASTER-001'), findsOneWidget);
    expect(find.text('¥88.50'), findsOneWidget);
    expect(find.text('已确认'), findsOneWidget);
    expect(find.text('Smoke Finance'), findsOneWidget);
    expect(find.text('2026-07-03 10:00:00'), findsOneWidget);
    expect(find.text('Other Taster'), findsNothing);
    expect(find.byIcon(Icons.edit_note_rounded), findsNothing);
    expect(find.byIcon(Icons.verified_rounded), findsNothing);

    _pressFilledButton(
      tester,
      const ValueKey('taster-commission-refresh-button'),
    );
    await tester.pumpAndSettle();
    expect(apiClient.paths, hasLength(2));
    expect(Uri.parse(apiClient.paths.last).path, '/api/commission-records/me');
  });

  testWidgets('shows loading and empty states', (tester) async {
    final completer = Completer<Map<String, dynamic>>();
    final apiClient = _FakeTasterCommissionApiClient(
      pendingResponse: completer,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: TasterCommissionPage(
            apiClient: apiClient,
            token: 'test-token',
          ),
        ),
      ),
    );
    await tester.pump();
    expect(find.text('正在加载本人提成'), findsOneWidget);

    completer.complete({
      'data': {'commissionRecords': const []},
    });
    await tester.pumpAndSettle();
    expect(find.text('当前日期范围暂无本人提成记录'), findsOneWidget);
  });

  testWidgets('shows API error state', (tester) async {
    final apiClient = _FakeTasterCommissionApiClient(
      error: const ApiException(
        statusCode: 403,
        code: 'FORBIDDEN',
        message: '只能查看本人提成',
      ),
    );

    await _pumpTasterCommissionPage(tester, apiClient);

    expect(find.text('只能查看本人提成'), findsOneWidget);
    expect(find.text('当前日期范围暂无本人提成记录'), findsOneWidget);
  });
}

Future<void> _pumpTasterCommissionPage(
  WidgetTester tester,
  _FakeTasterCommissionApiClient apiClient,
) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: TasterCommissionPage(
          apiClient: apiClient,
          token: 'test-token',
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void _pressFilledButton(WidgetTester tester, Key key) {
  final button = tester.widget<FilledButton>(find.byKey(key));
  button.onPressed?.call();
}

class _FakeTasterCommissionApiClient extends ApiClient {
  _FakeTasterCommissionApiClient({
    this.records = const <Map<String, dynamic>>[],
    this.error,
    this.pendingResponse,
  }) : super(baseUrl: 'http://127.0.0.1:3000');

  final List<Map<String, dynamic>> records;
  final ApiException? error;
  final Completer<Map<String, dynamic>>? pendingResponse;
  final List<String> paths = <String>[];

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    if (!path.startsWith('/api/commission-records/me')) {
      throw StateError('Unexpected GET $path');
    }
    paths.add(path);
    if (error != null) {
      throw error!;
    }
    if (pendingResponse != null) {
      return pendingResponse!.future;
    }
    return {
      'data': {'commissionRecords': records},
    };
  }
}

Map<String, dynamic> _commissionRecordJson({required bool isConfirmed}) {
  return {
    'id': 'commission-taster-own-1',
    'salesOrderId': 'order-taster-1',
    'travelGroupId': 'group-taster-1',
    'targetType': 'taster_commission',
    'targetUserId': 'current-taster-1',
    'salesOrderNo': 'SO-TASTER-001',
    'salesOrder': {
      'id': 'order-taster-1',
      'orderNo': 'SO-TASTER-001',
      'orderDate': '2026-07-03',
      'status': 'valid',
      'customerName': 'Smoke Customer',
    },
    'travelGroup': {
      'id': 'group-taster-1',
      'groupNo': 'TG-TASTER-001',
      'visitDate': '2026-07-03',
      'travelAgency': 'Smoke Agency',
      'guideName': 'Smoke Guide',
      'tasterId': 'current-taster-1',
      'tasterName': 'Smoke Taster',
      'financeMark': true,
    },
    'targetUser': {
      'id': 'current-taster-1',
      'name': 'Smoke Taster',
      'username': 'smoke_taster',
      'role': 'taster',
    },
    'grossAmountCents': 100000,
    'confirmedRefundAmountCents': 10000,
    'baseAmountCents': 90000,
    'deductionAmountCents': 0,
    'amountCents': 8850,
    'pointsCents': 0,
    'manualInput': true,
    'isConfirmed': isConfirmed,
    'confirmedBy': isConfirmed
        ? {
            'id': 'finance-1',
            'name': 'Smoke Finance',
            'username': 'finance',
            'role': 'finance',
          }
        : null,
    'confirmedAt': isConfirmed ? '2026-07-03T10:00:00.000Z' : null,
    'calculationVersion': 'stage7-v1',
    'calculationNoteSummary': 'test own taster commission',
    'sourceSnapshot': {
      'travelGroup': {'id': 'group-taster-1'},
    },
  };
}
