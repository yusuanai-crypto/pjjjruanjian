import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/warehouse_management/shared/inventory_workspace_shared.dart';
import 'package:jiangjiu_mobile_desktop/shared/widgets/status_tag.dart';

void main() {
  group('inventory error presentation', () {
    test('maps generic HTTP failures to stable Chinese states', () {
      expect(
        inventoryErrorMessage(
          const ApiException(
            statusCode: 403,
            code: 'HTTP_ERROR',
            message: 'Forbidden',
          ),
        ),
        '没有此操作权限，请联系管理员确认角色授权。',
      );
      expect(
        inventoryErrorMessage(
          const ApiException(
            statusCode: 409,
            code: 'HTTP_ERROR',
            message: 'Conflict',
          ),
        ),
        '数据已被其他人更新或状态已变化，请刷新后重试。',
      );
      expect(
        inventoryErrorMessage(
          const ApiException(
            statusCode: 422,
            code: 'HTTP_ERROR',
            message: '数量格式错误',
          ),
        ),
        '数据校验失败：数量格式错误',
      );
      expect(
        inventoryErrorMessage(
          const ApiException(
            statusCode: 503,
            code: 'HTTP_ERROR',
            message: 'Unavailable',
          ),
        ),
        '功能暂不可用，等待后端接口就绪。',
      );
    });
  });

  testWidgets('shared controls fit common phone widths without overflow',
      (tester) async {
    for (final width in <double>[320, 360, 390, 412]) {
      tester.view.physicalSize = Size(width, 640);
      tester.view.devicePixelRatio = 1;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                children: [
                  InventoryFilterBar(
                    actions: [
                      FilledButton.icon(
                        onPressed: () {},
                        icon: const Icon(Icons.refresh_rounded),
                        label: const Text('刷新'),
                      ),
                    ],
                    children: const [
                      SizedBox(
                        width: 420,
                        child: TextField(
                          decoration: InputDecoration(
                            labelText: '不会撑破手机的筛选项',
                          ),
                        ),
                      ),
                    ],
                  ),
                  const BottleQuantityText(-3, labelPrefix: '实际可售 '),
                  const InventoryStatusTag(
                    label: '短缺',
                    tone: StatusTone.danger,
                  ),
                  const InventoryPagination(
                    page: 1,
                    totalPages: 3,
                    onPrevious: null,
                    onNext: null,
                  ),
                ],
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      expect(tester.takeException(), isNull, reason: 'width=$width');
    }
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
  });

  testWidgets('quantity status and pagination expose non-color semantics',
      (tester) async {
    final semantics = tester.ensureSemantics();
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: Column(
            children: [
              BottleQuantityText(-8, labelPrefix: '实际可售 '),
              InventoryStatusTag(
                label: '短缺',
                tone: StatusTone.danger,
              ),
              InventoryPagination(
                page: 2,
                totalPages: 5,
                onPrevious: null,
                onNext: null,
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.bySemanticsLabel('实际可售 -8 瓶'), findsOneWidget);
    expect(find.bySemanticsLabel('短缺'), findsWidgets);
    expect(find.bySemanticsLabel('分页，第 2 页，共 5 页'), findsOneWidget);
    semantics.dispose();
  });
}
