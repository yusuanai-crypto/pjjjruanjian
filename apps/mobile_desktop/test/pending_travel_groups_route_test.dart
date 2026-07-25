import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/app/destinations.dart';
import 'package:jiangjiu_mobile_desktop/app/page_factory.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/core/auth/auth_models.dart';
import 'package:jiangjiu_mobile_desktop/features/dashboard/dashboard_page.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

void main() {
  test('does not expose the retired pending travel group destination', () {
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

    expect(
      destinations.any((item) => item.id == 'pending_travel_groups'),
      isFalse,
    );
  });

  test('unknown retired destination falls back to the dashboard', () {
    final page = buildPageForDestination(
      destinationId: 'pending_travel_groups',
      apiClient: ApiClient(baseUrl: 'http://127.0.0.1:3000'),
      token: 'test-token',
      role: UserRole.admin,
      allowedDestinations: const [],
      onOpenDestination: (_) {},
    );

    expect(page, isA<DashboardPage>());
  });
}
