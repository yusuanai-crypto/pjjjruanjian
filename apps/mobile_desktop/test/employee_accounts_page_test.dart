import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/employee_accounts/employee_accounts_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  const defaultPassword = 'A12345678';

  setUp(() {
    TestWidgetsFlutterBinding.ensureInitialized();
  });

  testWidgets(
    'new employee defaults both password fields and submits forced-change data',
    (tester) async {
      final apiClient = _FakeEmployeeApiClient(users: [_ordinaryEmployee]);
      await _pumpPage(tester, apiClient);

      await tester.tap(find.text('新增员工'));
      await tester.pumpAndSettle();

      final passwordField = tester.widget<TextField>(
        _textFieldWithLabel('初始密码'),
      );
      final confirmField = tester.widget<TextField>(
        _textFieldWithLabel('确认初始密码'),
      );
      expect(passwordField.controller?.text, defaultPassword);
      expect(confirmField.controller?.text, defaultPassword);
      expect(passwordField.obscureText, isTrue);
      expect(confirmField.obscureText, isTrue);

      await tester.tap(_iconButtonWithTooltip('显示初始密码'));
      await tester.pump();
      expect(
        tester.widget<TextField>(_textFieldWithLabel('初始密码')).obscureText,
        isFalse,
      );

      await tester.enterText(_textFieldWithLabel('姓名'), '新员工');
      await tester.enterText(
        _textFieldWithLabel('手机号'),
        '13800000991',
      );
      await tester.tap(find.widgetWithText(FilledButton, '创建'));
      await tester.pumpAndSettle();

      final createCall = apiClient.calls.singleWhere(
        (call) => call.path == '/api/users',
      );
      expect(createCall.body, {
        'name': '新员工',
        'phone': '13800000991',
        'role': 'front_desk',
        'password': defaultPassword,
        'mustChangePassword': true,
      });
      expect(apiClient.listRequests, 2);
      expect(
        find.text('员工账号已创建，员工首次登录必须修改密码。'),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'page exposes separate change and reset actions with hierarchy guards',
    (tester) async {
      final apiClient = _FakeEmployeeApiClient(
        users: [
          _user(
            id: 'current-admin',
            name: '当前管理员',
            username: 'current-admin',
            role: 'admin',
          ),
          _ordinaryEmployee,
          _user(
            id: 'peer-admin',
            name: '同级管理员',
            username: 'peer-admin',
            role: 'admin',
          ),
          _user(
            id: 'protected-super-admin',
            name: '超级管理员',
            username: 'protected-super-admin',
            role: 'super_admin',
          ),
        ],
      );
      await _pumpPage(
        tester,
        apiClient,
        role: UserRole.admin,
        currentUserId: 'current-admin',
      );

      final changeButtons = tester
          .widgetList<IconButton>(_iconButtonsWithTooltip('修改密码'))
          .toList();
      final resetButtons = tester
          .widgetList<IconButton>(_iconButtonsWithTooltip('重置密码'))
          .toList();
      expect(changeButtons, hasLength(4));
      expect(resetButtons, hasLength(4));
      expect(
        changeButtons.where((button) => button.onPressed != null),
        hasLength(1),
      );
      expect(
        resetButtons.where((button) => button.onPressed != null),
        hasLength(1),
      );

      final noPermissionClient = _FakeEmployeeApiClient(
        users: [_ordinaryEmployee],
      );
      await _pumpPage(
        tester,
        noPermissionClient,
        role: UserRole.sales,
        currentUserId: 'another-user',
      );
      expect(
        tester
            .widgetList<IconButton>(_iconButtonsWithTooltip('修改密码'))
            .every((button) => button.onPressed == null),
        isTrue,
      );
      expect(
        tester
            .widgetList<IconButton>(_iconButtonsWithTooltip('重置密码'))
            .every((button) => button.onPressed == null),
        isTrue,
      );
    },
  );

  testWidgets(
    'change password keeps SMS verification and custom password flow',
    (tester) async {
      final apiClient = _FakeEmployeeApiClient(users: [_ordinaryEmployee]);
      await _pumpPage(tester, apiClient);

      await tester.tap(_iconButtonWithTooltip('修改密码'));
      await tester.pumpAndSettle();
      expect(find.text('修改 张三 的密码'), findsOneWidget);

      await tester.tap(find.text('发送验证码'));
      await tester.pumpAndSettle();
      expect(
        find.text('验证码已发送至 138****0043。'),
        findsOneWidget,
      );

      await tester.enterText(
        _textFieldWithLabel('员工设置的新密码'),
        'ChangedPassword123',
      );
      await tester.enterText(
        _textFieldWithLabel('确认新密码'),
        'ChangedPassword123',
      );
      await tester.enterText(_textFieldWithLabel('短信验证码'), '123456');
      await tester.enterText(_textFieldWithLabel('备注原因'), '员工确认修改');
      await tester.tap(find.widgetWithText(FilledButton, '确认修改'));
      await tester.pumpAndSettle();

      expect(
        apiClient.calls.map((call) => call.path),
        containsAllInOrder([
          '/api/users/employee-1/reset-password-code',
          '/api/users/employee-1/reset-password',
        ]),
      );
      final changeCall = apiClient.calls.singleWhere(
        (call) => call.path == '/api/users/employee-1/reset-password',
      );
      expect(changeCall.body, {
        'verificationCode': '123456',
        'newPassword': 'ChangedPassword123',
        'reason': '员工确认修改',
      });
      expect(apiClient.listRequests, 2);
      expect(
        find.text('修改密码成功：员工密码已修改，原登录已失效。'),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'default reset shows warning, surfaces errors, then refreshes on success',
    (tester) async {
      final apiClient = _FakeEmployeeApiClient(
        users: [_ordinaryEmployee],
        failDefaultReset: true,
      );
      await _pumpPage(tester, apiClient);

      final resetButton = tester.widget<IconButton>(
        _iconButtonWithTooltip('重置密码'),
      );
      expect(resetButton.onPressed, isNotNull);
      resetButton.onPressed!();
      await tester.pumpAndSettle();
      expect(find.text('重置密码'), findsWidgets);
      expect(find.text('员工姓名：张三'), findsOneWidget);
      expect(
        find.text('手机号/登录账号：13800000043'),
        findsOneWidget,
      );
      expect(
        find.text('密码将重置为 $defaultPassword'),
        findsOneWidget,
      );
      expect(
        find.text('员工当前登录将失效，下次登录必须修改密码。'),
        findsOneWidget,
      );

      await tester.tap(find.widgetWithText(FilledButton, '确认重置'));
      await tester.pump();
      expect(find.text('请填写重置原因。'), findsOneWidget);

      await tester.enterText(
        _textFieldWithLabel('重置原因（必填）'),
        '员工遗忘密码',
      );
      await tester.tap(find.widgetWithText(FilledButton, '确认重置'));
      await tester.pumpAndSettle();
      expect(find.text('后端拒绝了本次重置'), findsOneWidget);
      expect(apiClient.listRequests, 1);

      apiClient.failDefaultReset = false;
      await tester.tap(find.widgetWithText(FilledButton, '确认重置'));
      await tester.pumpAndSettle();

      final resetCalls = apiClient.calls
          .where(
            (call) =>
                call.path == '/api/users/employee-1/reset-password-to-default',
          )
          .toList();
      expect(resetCalls, hasLength(2));
      expect(resetCalls.last.body, {'reason': '员工遗忘密码'});
      expect(apiClient.listRequests, 2);
      expect(
        find.text(
          '重置密码成功：密码已重置为 $defaultPassword，员工下次登录必须修改密码。',
        ),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'action buttons stay on one non-overlapping row at 1440x900',
    (tester) async {
      final apiClient = _FakeEmployeeApiClient(users: [_ordinaryEmployee]);

      await _pumpPage(tester, apiClient);

      _expectActionButtonsInOneNonOverlappingRow(tester, 'employee-1');
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'action buttons stay aligned and table scrolls at 800x600 with text scaling',
    (tester) async {
      final apiClient = _FakeEmployeeApiClient(
        users: [
          <String, dynamic>{
            ..._ordinaryEmployee,
            'statusReason': '这是用于验证高字体缩放下两行最近原因布局的较长说明',
          },
        ],
      );

      await _pumpPage(
        tester,
        apiClient,
        surfaceSize: const Size(800, 600),
        textScaleFactor: 1.25,
      );

      _expectActionButtonsInOneNonOverlappingRow(tester, 'employee-1');
      expect(tester.takeException(), isNull);

      final horizontalScrollView = find.byWidgetPredicate(
        (widget) =>
            widget is SingleChildScrollView &&
            widget.scrollDirection == Axis.horizontal,
      );
      expect(horizontalScrollView, findsOneWidget);

      final horizontalScrollable = find.descendant(
        of: horizontalScrollView,
        matching: find.byType(Scrollable),
      );
      expect(horizontalScrollable, findsOneWidget);
      final scrollableState =
          tester.state<ScrollableState>(horizontalScrollable);
      expect(scrollableState.position.maxScrollExtent, greaterThan(0));
      expect(scrollableState.position.pixels, 0);

      await tester.drag(horizontalScrollView, const Offset(-300, 0));
      await tester.pumpAndSettle();

      expect(scrollableState.position.pixels, greaterThan(0));
      expect(tester.takeException(), isNull);
    },
  );
}

Future<void> _pumpPage(
  WidgetTester tester,
  _FakeEmployeeApiClient apiClient, {
  UserRole role = UserRole.admin,
  String currentUserId = 'current-admin',
  Size surfaceSize = const Size(1440, 900),
  double textScaleFactor = 1,
}) async {
  await tester.binding.setSurfaceSize(surfaceSize);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    MaterialApp(
      builder: (context, child) {
        return MediaQuery(
          data: MediaQuery.of(context).copyWith(
            textScaler: TextScaler.linear(textScaleFactor),
          ),
          child: child!,
        );
      },
      home: Scaffold(
        body: EmployeeAccountsPage(
          apiClient: apiClient,
          token: 'test-token',
          role: role,
          currentUserId: currentUserId,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void _expectActionButtonsInOneNonOverlappingRow(
  WidgetTester tester,
  String userId,
) {
  final buttonFinders = [
    find.byKey(ValueKey('employee-action-toggle-$userId')),
    find.byKey(ValueKey('employee-action-change-password-$userId')),
    find.byKey(ValueKey('employee-action-reset-password-$userId')),
  ];
  for (final finder in buttonFinders) {
    expect(finder, findsOneWidget);
  }

  final rects = buttonFinders.map(tester.getRect).toList();
  expect(rects[0].center.dy, rects[1].center.dy);
  expect(rects[1].center.dy, rects[2].center.dy);
  for (var first = 0; first < rects.length; first += 1) {
    for (var second = first + 1; second < rects.length; second += 1) {
      expect(rects[first].overlaps(rects[second]), isFalse);
    }
  }
  expect(rects[0].right, lessThan(rects[1].left));
  expect(rects[1].right, lessThan(rects[2].left));
}

Finder _textFieldWithLabel(String label) {
  return find.byWidgetPredicate(
    (widget) => widget is TextField && widget.decoration?.labelText == label,
  );
}

Finder _iconButtonsWithTooltip(String tooltip) {
  return find.byWidgetPredicate(
    (widget) => widget is IconButton && widget.tooltip == tooltip,
  );
}

Finder _iconButtonWithTooltip(String tooltip) {
  return _iconButtonsWithTooltip(tooltip).first;
}

const _ordinaryEmployee = <String, dynamic>{
  'id': 'employee-1',
  'name': '张三',
  'username': '13800000043',
  'phone': '13800000043',
  'role': 'sales',
  'isActive': true,
  'mustChangePassword': false,
};

Map<String, dynamic> _user({
  required String id,
  required String name,
  required String username,
  required String role,
}) {
  return <String, dynamic>{
    'id': id,
    'name': name,
    'username': username,
    'phone': null,
    'role': role,
    'isActive': true,
    'mustChangePassword': false,
  };
}

class _ApiCall {
  const _ApiCall({
    required this.path,
    required this.body,
  });

  final String path;
  final Map<String, dynamic>? body;
}

class _FakeEmployeeApiClient extends ApiClient {
  _FakeEmployeeApiClient({
    required this.users,
    this.failDefaultReset = false,
  }) : super(baseUrl: 'http://127.0.0.1:3000');

  final List<Map<String, dynamic>> users;
  final List<_ApiCall> calls = <_ApiCall>[];
  bool failDefaultReset;
  int listRequests = 0;

  @override
  Future<Map<String, dynamic>> getJson(
    String path, {
    String? token,
  }) async {
    if (Uri.parse(path).path == '/api/users') {
      listRequests += 1;
      return <String, dynamic>{
        'data': <String, dynamic>{
          'users': users,
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
    calls.add(_ApiCall(path: path, body: body));
    if (path.endsWith('/reset-password-code')) {
      return <String, dynamic>{
        'data': <String, dynamic>{
          'verification': <String, dynamic>{
            'phoneMasked': '138****0043',
          },
        },
      };
    }
    if (path.endsWith('/reset-password-to-default')) {
      if (failDefaultReset) {
        throw const ApiException(
          statusCode: 403,
          code: 'ACCOUNT_MANAGEMENT_FORBIDDEN',
          message: '后端拒绝了本次重置',
        );
      }
      return _userResponse;
    }
    if (path.endsWith('/reset-password') || path == '/api/users') {
      return _userResponse;
    }
    throw StateError('Unexpected POST $path');
  }
}

const _userResponse = <String, dynamic>{
  'data': <String, dynamic>{
    'user': _ordinaryEmployee,
  },
};
