import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../travel_group_query/travel_group_query_page.dart';

class TasterSummaryPage extends StatelessWidget {
  const TasterSummaryPage({
    super.key,
    required this.apiClient,
    required this.token,
    required this.role,
    required this.currentUserId,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;
  final String currentUserId;

  @override
  Widget build(BuildContext context) {
    return TravelGroupQueryPage(
      apiClient: apiClient,
      token: token,
      role: role,
      currentUserId: currentUserId,
      initialTasterScope: role == UserRole.taster
          ? TravelGroupQueryPage.tasterScopeReception
          : TravelGroupQueryPage.tasterScopeAll,
    );
  }
}
