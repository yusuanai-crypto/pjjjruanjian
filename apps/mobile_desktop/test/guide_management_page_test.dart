import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/core/business/business_api.dart';
import 'package:jiangjiu_mobile_desktop/features/guide_management/guide_management_page.dart';
import 'package:jiangjiu_mobile_desktop/features/guide_management/remote_guide_picker_dialog.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  testWidgets(
      'guide management supports search, status, create, edit, disable, and enable',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(1280, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final api = _GuideApiClient([
      _guideJson('guide-1', '张导', '13900000001', isActive: true),
      _guideJson('guide-2', '李导', '13900000002', isActive: false),
    ]);

    await tester.pumpWidget(_page(api));
    await tester.pumpAndSettle();

    expect(find.text('导游管理'), findsOneWidget);
    expect(find.byKey(const ValueKey('guide-data-table')), findsOneWidget);
    expect(find.text('2 名导游'), findsOneWidget);

    await tester.enterText(
      find.byKey(const ValueKey('guide-search')),
      '13900000002',
    );
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();
    expect(find.text('李导'), findsOneWidget);
    expect(api.lastListUri!.queryParameters['keyword'], '13900000002');

    await tester.enterText(find.byKey(const ValueKey('guide-search')), '');
    await tester.tap(find.text('已停用').first);
    await tester.pumpAndSettle();
    expect(api.lastListUri!.queryParameters['isActive'], 'false');
    final enableButton = find.byKey(const ValueKey('guide-enable-guide-2'));
    expect(enableButton, findsOneWidget);

    await tester.ensureVisible(enableButton);
    await tester.tap(enableButton);
    await tester.pumpAndSettle();
    expect(api.records.singleWhere((row) => row['id'] == 'guide-2')['isActive'],
        isTrue);
    expect(find.text('导游已恢复。'), findsOneWidget);

    await tester.tap(find.text('全部').first);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('guide-add')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('guide-editor-name')),
      '王导',
    );
    await tester.enterText(
      find.byKey(const ValueKey('guide-editor-phone')),
      '13900000003',
    );
    await tester.tap(find.byKey(const ValueKey('guide-editor-submit')));
    await tester.pumpAndSettle();
    expect(api.records.any((row) => row['name'] == '王导'), isTrue);
    expect(find.text('导游已新增。'), findsOneWidget);

    final editButton = find.byKey(const ValueKey('guide-edit-guide-1'));
    await tester.ensureVisible(editButton);
    await tester.tap(editButton);
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('guide-editor-name')),
      '张导已更新',
    );
    await tester.tap(find.byKey(const ValueKey('guide-editor-submit')));
    await tester.pumpAndSettle();
    expect(find.text('张导已更新'), findsOneWidget);

    final disableButton = find.byKey(const ValueKey('guide-disable-guide-1'));
    await tester.ensureVisible(disableButton);
    await tester.tap(disableButton);
    await tester.pumpAndSettle();
    expect(find.text('确认停用导游'), findsOneWidget);
    expect(api.records.singleWhere((row) => row['id'] == 'guide-1')['isActive'],
        isTrue);
    await tester.tap(find.byKey(const ValueKey('guide-disable-confirm')));
    await tester.pumpAndSettle();
    expect(api.records.singleWhere((row) => row['id'] == 'guide-1')['isActive'],
        isFalse);
    expect(find.text('导游已停用。'), findsOneWidget);
  });

  testWidgets('guide management renders empty, error, and permission states',
      (tester) async {
    final emptyApi = _GuideApiClient([]);
    await tester.pumpWidget(_page(emptyApi));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('guide-empty-state')), findsOneWidget);

    final errorApi = _GuideApiClient([])..failList = true;
    await tester.pumpWidget(_page(errorApi));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('guide-error-state')), findsOneWidget);
    expect(find.text('模拟网络错误'), findsOneWidget);

    await tester.pumpWidget(_page(errorApi, role: UserRole.sales));
    await tester.pumpAndSettle();
    expect(find.text('当前账号没有导游管理权限。'), findsOneWidget);
  });

  testWidgets('remote guide search can select a guide after the first 200',
      (tester) async {
    final records = [
      for (var index = 1; index <= 201; index += 1)
        _guideJson(
          'guide-$index',
          index == 201 ? '第201名导游' : '导游$index',
          '139${index.toString().padLeft(8, '0')}',
          isActive: true,
        ),
    ];
    final apiClient = _GuideApiClient(records);
    final businessApi = BusinessApi(apiClient: apiClient, token: 'token');
    GuidePickerResult? selected;

    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: FilledButton(
                onPressed: () async {
                  selected = await showDialog<GuidePickerResult>(
                    context: context,
                    builder: (context) => RemoteGuidePickerDialog(
                      businessApi: businessApi,
                    ),
                  );
                },
                child: const Text('选择导游'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('选择导游'));
    await tester.pumpAndSettle();
    expect(find.text('第201名导游'), findsNothing);

    await tester.enterText(
      find.byKey(const ValueKey('remote-guide-search')),
      '13900000201',
    );
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();
    expect(find.text('第201名导游'), findsOneWidget);
    expect(apiClient.lastListUri!.queryParameters['isActive'], 'true');
    await tester.tap(find.byKey(const ValueKey('remote-guide-guide-201')));
    await tester.pumpAndSettle();
    expect(selected?.guide?.id, 'guide-201');
  });
}

Widget _page(
  ApiClient apiClient, {
  UserRole role = UserRole.admin,
}) {
  return MaterialApp(
    home: Scaffold(
      body: GuideManagementPage(
        apiClient: apiClient,
        token: 'token',
        role: role,
      ),
    ),
  );
}

Map<String, dynamic> _guideJson(
  String id,
  String name,
  String phone, {
  required bool isActive,
}) {
  return {
    'id': id,
    'name': name,
    'phone': phone,
    'remarks': '$name备注',
    'isActive': isActive,
    'createdAt': '2026-07-25T08:00:00.000Z',
    'updatedAt': '2026-07-25T09:00:00.000Z',
  };
}

class _GuideApiClient extends ApiClient {
  _GuideApiClient(this.records) : super(baseUrl: 'http://127.0.0.1:3000');

  final List<Map<String, dynamic>> records;
  bool failList = false;
  Uri? lastListUri;

  @override
  Future<Map<String, dynamic>> getJson(
    String path, {
    String? token,
  }) async {
    final uri = Uri.parse(path);
    if (uri.path.startsWith('/api/guides/')) {
      final id = uri.pathSegments.last;
      return {
        'data': {
          'guide': Map<String, dynamic>.from(
            records.singleWhere((row) => row['id'] == id),
          ),
        },
      };
    }
    if (failList) {
      throw const ApiException(
        statusCode: 0,
        code: 'NETWORK_ERROR',
        message: '模拟网络错误',
      );
    }
    lastListUri = uri;
    final keyword = uri.queryParameters['keyword']?.trim() ?? '';
    final activeText = uri.queryParameters['isActive'];
    final page = int.tryParse(uri.queryParameters['page'] ?? '') ?? 1;
    final pageSize = int.tryParse(uri.queryParameters['pageSize'] ?? '') ?? 20;
    final filtered = records.where((row) {
      final keywordMatches = keyword.isEmpty ||
          ['name', 'phone', 'remarks']
              .any((key) => '${row[key] ?? ''}'.contains(keyword));
      final activeMatches =
          activeText == null || row['isActive'] == (activeText == 'true');
      return keywordMatches && activeMatches;
    }).toList();
    final start = (page - 1) * pageSize;
    final end = (start + pageSize).clamp(0, filtered.length);
    final pageRows = start >= filtered.length
        ? <Map<String, dynamic>>[]
        : filtered.sublist(start, end);
    return {
      'data': {
        'guides': pageRows.map(Map<String, dynamic>.from).toList(),
        'pagination': {
          'page': page,
          'pageSize': pageSize,
          'total': filtered.length,
          'totalPages':
              filtered.isEmpty ? 0 : (filtered.length / pageSize).ceil(),
        },
      },
    };
  }

  @override
  Future<Map<String, dynamic>> postJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    if (path == '/api/guides') {
      final row = _guideJson(
        'guide-${records.length + 1}',
        '${body?['name'] ?? ''}',
        '${body?['phone'] ?? ''}',
        isActive: true,
      )..['remarks'] = body?['remarks'];
      records.add(row);
      return {
        'data': {'guide': Map<String, dynamic>.from(row)},
      };
    }
    final segments = Uri.parse(path).pathSegments;
    final id = segments[2];
    final row = records.singleWhere((item) => item['id'] == id);
    row['isActive'] = segments.last == 'enable';
    return {
      'data': {'guide': Map<String, dynamic>.from(row)},
    };
  }

  @override
  Future<Map<String, dynamic>> patchJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    final id = Uri.parse(path).pathSegments.last;
    final row = records.singleWhere((item) => item['id'] == id);
    row.addAll(body ?? {});
    return {
      'data': {'guide': Map<String, dynamic>.from(row)},
    };
  }
}
