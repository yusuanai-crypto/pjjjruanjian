import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/auth/role_access.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/responsive.dart';
import '../travel_groups/travel_group_picker_dialog.dart';
import 'order_form_page.dart';

class OrderFormEntryPage extends StatefulWidget {
  const OrderFormEntryPage({
    super.key,
    required this.apiClient,
    required this.token,
    required this.role,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;

  @override
  State<OrderFormEntryPage> createState() => _OrderFormEntryPageState();
}

class _OrderFormEntryPageState extends State<OrderFormEntryPage> {
  late BusinessApi _businessApi;
  TravelGroupRecord? _travelGroup;

  @override
  void initState() {
    super.initState();
    _businessApi = BusinessApi(
      apiClient: widget.apiClient,
      token: widget.token,
    );
  }

  @override
  void didUpdateWidget(covariant OrderFormEntryPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token) {
      _businessApi = BusinessApi(
        apiClient: widget.apiClient,
        token: widget.token,
      );
      _travelGroup = null;
    }
  }

  Future<void> _chooseTravelGroup() async {
    final selected = await showDialog<TravelGroupRecord>(
      context: context,
      builder: (context) => TravelGroupPickerDialog(
        businessApi: _businessApi,
        showFinanceMark: canViewFinanceMark(widget.role),
      ),
    );
    if (selected == null || !mounted) {
      return;
    }
    setState(() => _travelGroup = selected);
  }

  @override
  Widget build(BuildContext context) {
    final travelGroup = _travelGroup;
    if (travelGroup != null) {
      return OrderFormPage(
        apiClient: widget.apiClient,
        token: widget.token,
        role: widget.role,
        travelGroupId: travelGroup.id,
      );
    }

    return ResponsivePage(
      children: [
        FormSection(
          title: '订单录入',
          children: [
            const Text('订单必须关联旅行团。请先选择旅行团，再填写订单。'),
            const SizedBox(height: 16),
            Align(
              alignment: Alignment.centerLeft,
              child: FilledButton.icon(
                key: const ValueKey('choose-travel-group-for-order-button'),
                onPressed: _chooseTravelGroup,
                icon: const Icon(Icons.directions_bus_rounded),
                label: const Text('选择旅行团后录入'),
              ),
            ),
          ],
        ),
      ],
    );
  }
}
