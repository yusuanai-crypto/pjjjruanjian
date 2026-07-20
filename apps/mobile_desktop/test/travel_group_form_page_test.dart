import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_groups/travel_group_form_page.dart';

void main() {
  testWidgets('visit date starts empty and blocks submission when omitted',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpPage(tester, apiClient);

    final dateField = find.byKey(const ValueKey('visit-date-field'));
    expect(
      find.descendant(of: dateField, matching: find.text('请选择')),
      findsOneWidget,
    );
    expect(find.text('日期'), findsNothing);
    expect(find.text('进店日期'), findsOneWidget);
    expect(find.text('品鉴师（选填）'), findsOneWidget);
    expect(find.text('对接品鉴师（选填）'), findsOneWidget);
    expect(find.text('客源地（选填）'), findsOneWidget);
    expect(find.text('年龄文本（选填）'), findsOneWidget);
    expect(find.text('是否提及飞天（选填）'), findsOneWidget);
    expect(find.text('前站出单情况（选填）'), findsOneWidget);
    expect(find.text('均单'), findsOneWidget);
    expect(find.text('熊猫'), findsOneWidget);
    expect(find.text('重点客户信息（选填）'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('key-customer-photo-picker')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('guest-info-picker')), findsOneWidget);
    expect(find.textContaining('预计进店时间'), findsNothing);

    await _selectTravelAgency(tester);
    await _selectGuide(tester);
    await _submit(tester);

    expect(apiClient.createCalls, 0);
    expect(find.text('请选择进店日期。'), findsOneWidget);
  });

  testWidgets('travel agency is the only missing business field that blocks',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpPage(tester, apiClient);

    await _selectVisitDate(tester);
    await _selectGuide(tester);
    await _submit(tester);

    expect(apiClient.createCalls, 0);
    expect(find.text('请选择旅行社。'), findsOneWidget);
  });

  testWidgets('guide is the only missing business field that blocks',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpPage(tester, apiClient);

    await _selectVisitDate(tester);
    await _selectTravelAgency(tester);
    await _submit(tester);

    expect(apiClient.createCalls, 0);
    expect(find.text('请选择导游。'), findsOneWidget);
  });

  testWidgets('optional fields may stay empty and server group number is used',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpPage(tester, apiClient);

    await _selectVisitDate(tester);
    await _selectTravelAgency(tester);
    await _selectGuide(tester);
    await _submit(tester);

    expect(apiClient.createCalls, 1);
    final body = apiClient.lastCreateBody!;
    expect(body['visitDate'], isNotEmpty);
    expect(body['travelAgency'], '测试旅行社');
    expect(body['guideId'], 'guide-1');
    for (final optionalField in [
      'licensePlate',
      'guestCount',
      'tastingRoomNo',
      'tasterId',
      'liaisonTasterId',
      'arrivalTime',
      'groupType',
      'sourceRegion',
      'ageInfo',
      'mentionedFeitian',
      'previousStopOrderStatus',
      'keyCustomerInfo',
      'expectedArrivalTime',
      'groupNo',
    ]) {
      expect(body.containsKey(optionalField), isFalse, reason: optionalField);
    }
    expect(find.textContaining('SERVER-TG-001'), findsWidgets);
  });

  testWidgets('selected taster assignments are submitted by id',
      (tester) async {
    final apiClient = _FakeApiClient();
    await _pumpPage(tester, apiClient);

    await _selectVisitDate(tester);
    await _selectTravelAgency(tester);
    await _selectGuide(tester);
    await _selectTasterField(tester, const ValueKey('taster-field'));
    await _selectTasterField(tester, const ValueKey('liaison-taster-field'));
    await _submit(tester);

    expect(apiClient.createCalls, 1);
    expect(apiClient.lastCreateBody?['tasterId'], 'taster-1');
    expect(apiClient.lastCreateBody?['liaisonTasterId'], 'taster-1');
  });

  testWidgets('attachment failure retries upload without creating group again',
      (tester) async {
    final apiClient = _FakeApiClient()..failAttachmentUpload = true;
    final selectedFiles = <ApiMultipartFile>[
      ApiMultipartFile.fromBytes(
        fileName: 'vip.jpg',
        bytes: Uint8List.fromList(<int>[1, 2, 3]),
        contentType: 'image/jpeg',
      ),
    ];
    await _pumpPage(
      tester,
      apiClient,
      filePicker: () async => selectedFiles,
    );

    await _selectVisitDate(tester);
    await _selectTravelAgency(tester);
    await _selectGuide(tester);
    final picker = find.byKey(const ValueKey('key-customer-photo-picker'));
    await tester.ensureVisible(picker);
    await tester.tap(picker);
    await tester.pumpAndSettle();
    expect(find.text('vip.jpg'), findsOneWidget);

    await _submit(tester);

    expect(apiClient.createCalls, 1);
    expect(apiClient.uploadCalls, 1);
    expect(find.textContaining('重点客户照片（vip.jpg）'), findsOneWidget);
    expect(find.textContaining('不会重复创建旅行团'), findsOneWidget);
    expect(find.text('重试附件上传'), findsOneWidget);

    apiClient.failAttachmentUpload = false;
    await tester.tap(find.text('重试附件上传'));
    await tester.pumpAndSettle();

    expect(apiClient.createCalls, 1);
    expect(apiClient.uploadCalls, 2);
    expect(find.textContaining('SERVER-TG-001'), findsWidgets);
  });
}

Future<void> _pumpPage(
  WidgetTester tester,
  _FakeApiClient apiClient, {
  TravelGroupFilePicker? filePicker,
}) async {
  tester.view.physicalSize = const Size(1440, 1200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: TravelGroupFormPage(
          apiClient: apiClient,
          token: 'test-token',
          filePicker: filePicker,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _selectVisitDate(WidgetTester tester) async {
  final field = find.byKey(const ValueKey('visit-date-field'));
  await tester.ensureVisible(field);
  await tester.tap(field);
  await tester.pumpAndSettle();
  await tester.tap(find.text('OK'));
  await tester.pumpAndSettle();
}

Future<void> _selectTravelAgency(WidgetTester tester) async {
  final field = find.byKey(const ValueKey('travel-agency-field'));
  await tester.ensureVisible(field);
  await tester.tap(field);
  await tester.pumpAndSettle();
  await tester.tap(find.text('测试旅行社').last);
  await tester.pumpAndSettle();
}

Future<void> _selectGuide(WidgetTester tester) async {
  final field = find.byKey(const ValueKey('guide-field'));
  await tester.ensureVisible(field);
  await tester.tap(field);
  await tester.pumpAndSettle();
  await tester.tap(find.text('测试导游').last);
  await tester.pumpAndSettle();
}

Future<void> _selectTasterField(WidgetTester tester, Key key) async {
  final field = find.byKey(key);
  await tester.ensureVisible(field);
  await tester.tap(field);
  await tester.pumpAndSettle();
  await tester.tap(find.byType(ListTile).last);
  await tester.pumpAndSettle();
}

Future<void> _submit(WidgetTester tester) async {
  final button = find.widgetWithText(FilledButton, '保存旅行团');
  await tester.ensureVisible(button);
  await tester.tap(button);
  await tester.pumpAndSettle();
}

class _FakeApiClient extends ApiClient {
  _FakeApiClient() : super(baseUrl: 'http://127.0.0.1:3000');

  int createCalls = 0;
  int uploadCalls = 0;
  bool failAttachmentUpload = false;
  Map<String, dynamic>? lastCreateBody;

  @override
  Future<Map<String, dynamic>> getJson(String path, {String? token}) async {
    if (path.startsWith('/api/travel-groups')) {
      return {
        'data': {'travelGroups': <Map<String, dynamic>>[]},
      };
    }
    if (path.startsWith('/api/guides')) {
      return {
        'data': {
          'guides': [_guideJson()],
        },
      };
    }
    if (path.startsWith('/api/travel-agencies')) {
      return {
        'data': {
          'travelAgencies': [_travelAgencyJson()],
        },
      };
    }
    if (path == '/api/users/tasters') {
      return {
        'data': {
          'tasters': const [
            {
              'id': 'taster-1',
              'name': '测试品鉴师',
              'username': 'taster.one',
            },
          ],
        },
      };
    }
    throw StateError('Unexpected GET $path');
  }

  @override
  Future<Map<String, dynamic>> postJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    if (path != '/api/travel-groups') {
      throw StateError('Unexpected POST $path');
    }
    createCalls += 1;
    lastCreateBody = Map<String, dynamic>.from(body ?? {});
    return {
      'data': {
        'travelGroup': {
          'id': 'group-created-1',
          'groupNo': 'SERVER-TG-001',
          'visitDate': body?['visitDate'],
          'travelAgency': body?['travelAgency'],
          'guideId': body?['guideId'],
          'guideName': '测试导游',
        },
      },
    };
  }

  @override
  Future<Map<String, dynamic>> postMultipartFiles(
    String path, {
    required List<ApiMultipartFile> files,
    String fieldName = 'files',
    Map<String, String> fields = const <String, String>{},
    int? maxFileSizeBytes,
    String? token,
  }) async {
    uploadCalls += 1;
    expect(
      path,
      '/api/travel-groups/group-created-1/attachments/key_customer_photo',
    );
    expect(files.map((file) => file.fileName), ['vip.jpg']);
    if (failAttachmentUpload) {
      throw const ApiException(
        statusCode: 500,
        code: 'ATTACHMENT_STORAGE_FAILED',
        message: '附件存储失败',
      );
    }
    return {
      'data': {
        'attachments': const [
          {
            'id': 'attachment-1',
            'category': 'key_customer_photo',
            'originalName': 'vip.jpg',
          },
        ],
        'travelGroup': const {
          'id': 'group-created-1',
          'groupNo': 'SERVER-TG-001',
        },
      },
    };
  }
}

Map<String, dynamic> _guideJson() {
  return const {
    'id': 'guide-1',
    'name': '测试导游',
    'phone': '13900001111',
    'travelAgency': '测试旅行社',
    'isActive': true,
  };
}

Map<String, dynamic> _travelAgencyJson() {
  return const {
    'id': 'agency-1',
    'name': '测试旅行社',
    'contactName': '联系人',
    'contactPhone': '13900002222',
  };
}
