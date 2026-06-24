import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/app/destinations.dart';
import 'package:jiangjiu_mobile_desktop/app/page_factory.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/core/auth/auth_models.dart';
import 'package:jiangjiu_mobile_desktop/features/pending_travel_groups/pending_travel_group_table_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  test('maps backend pending travel group menu to Flutter destination', () {
    final destinations = destinationsForBackendMenus(
      const [
        AuthMenu(
          id: 'pending_travel_groups',
          title: '待处理旅行团',
          phase: 3,
        ),
      ],
      UserRole.admin,
    );

    expect(destinations, hasLength(1));
    expect(destinations.single.id, 'pending_travel_groups');
    expect(destinations.single.label, '待处理旅行团');
  });

  test('builds pending travel group page for destination id', () {
    final page = buildPageForDestination(
      destinationId: 'pending_travel_groups',
      apiClient: ApiClient(baseUrl: 'http://127.0.0.1:3000'),
      token: 'test-token',
      role: UserRole.admin,
      allowedDestinations: const [],
      onOpenDestination: (_) {},
    );

    expect(page, isA<PendingTravelGroupTablePage>());
  });
}
