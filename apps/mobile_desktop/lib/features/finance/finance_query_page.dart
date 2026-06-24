import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/app_record_list.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/money_text.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/search_filter_bar.dart';
import '../../shared/widgets/status_tag.dart';

class FinanceQueryPage extends StatefulWidget {
  const FinanceQueryPage({
    super.key,
    required this.apiClient,
    required this.token,
  });

  final ApiClient apiClient;
  final String token;

  @override
  State<FinanceQueryPage> createState() => _FinanceQueryPageState();
}

class _FinanceQueryPageState extends State<FinanceQueryPage> {
  late BusinessApi _businessApi;

  DateTime _start = DateTime(DateTime.now().year, DateTime.now().month, 1);
  DateTime _end = DateTime.now();
  String _filter = '订单金额';
  bool _loading = true;
  String? _errorMessage;
  FinanceOverview? _overview;

  @override
  void initState() {
    super.initState();
    _businessApi =
        BusinessApi(apiClient: widget.apiClient, token: widget.token);
    _loadData();
  }

  @override
  void didUpdateWidget(covariant FinanceQueryPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token) {
      _businessApi =
          BusinessApi(apiClient: widget.apiClient, token: widget.token);
      _loadData();
    }
  }

  Future<void> _loadData() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    try {
      final overview =
          await _businessApi.getFinanceOverview(start: _start, end: _end);
      if (!mounted) {
        return;
      }
      setState(() {
        _overview = overview;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _loading = false;
        _errorMessage = _messageForError(error);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final overview = _overview;
    final recentOrders = overview?.recentOrders ?? const <SalesOrderRecord>[];

    return ResponsivePage(
      children: [
        if (_errorMessage != null)
          _InlineNotice(message: _errorMessage!, tone: StatusTone.danger),
        FormSection(
          title: '财务查询范围',
          trailing: StatusTag(
            label: _loading ? '加载中' : '${recentOrders.length} 笔订单',
            tone: _loading ? StatusTone.warning : StatusTone.info,
          ),
          children: [
            AppDateRangeButton(
              start: _start,
              end: _end,
              onChanged: (range) {
                setState(() {
                  _start = range.start;
                  _end = range.end;
                });
                _loadData();
              },
            ),
          ],
        ),
        MetricGrid(
          metrics: [
            MetricData(
              label: '出单销售额',
              value: formatMoneyCents(overview?.salesAmountCents ?? 0),
              icon: Icons.trending_up_rounded,
            ),
            MetricData(
              label: '退单金额',
              value: formatMoneyCents(overview?.refundAmountCents ?? 0),
              icon: Icons.assignment_return_rounded,
            ),
            MetricData(
              label: '货到付款',
              value: formatMoneyCents(overview?.cashOnDeliveryAmountCents ?? 0),
              icon: Icons.local_shipping_rounded,
            ),
            MetricData(
              label: '旅行团数',
              value: '${overview?.travelGroupCount ?? 0}',
              icon: Icons.directions_bus_rounded,
            ),
          ],
        ),
        FormSection(
          title: '订单财务明细',
          trailing: TextButton.icon(
            onPressed: _loadData,
            icon: const Icon(Icons.refresh_rounded),
            label: const Text('刷新'),
          ),
          children: [
            const AppSearchField(hintText: '搜索订单号、客户、旅行团'),
            const SizedBox(height: 12),
            AppFilterBar(
              filters: const ['订单金额', '退款退单', '物流费用', '标记信息', '提成核对'],
              selected: _filter,
              onSelected: (value) => setState(() => _filter = value),
            ),
            const SizedBox(height: 12),
            if (_loading)
              const Center(child: CircularProgressIndicator())
            else if (recentOrders.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Center(child: Text('当前范围暂无订单财务记录')),
              )
            else
              AppRecordList(
                items: [
                  for (final order in recentOrders)
                    AppRecordItem(
                      title: order.orderNo,
                      subtitle:
                          '${order.customerName} · ${order.travelGroup?.groupNo ?? _orderTypeLabel(order.orderType)}',
                      meta: [
                        _orderTypeLabel(order.orderType),
                        order.status == 'valid' ? '有效' : order.status,
                      ],
                      icon: Icons.receipt_long_rounded,
                      trailing: MoneyText(cents: order.totalAmountCents),
                    ),
                ],
              ),
          ],
        ),
      ],
    );
  }
}

class _InlineNotice extends StatelessWidget {
  const _InlineNotice({
    required this.message,
    required this.tone,
  });

  final String message;
  final StatusTone tone;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: StatusTag(label: message, tone: tone),
    );
  }
}

String _messageForError(Object error) {
  if (error is ApiException) {
    return error.message;
  }
  return '操作失败，请稍后重试。';
}

String _orderTypeLabel(String type) {
  switch (type) {
    case 'buyback':
      return '回购订单';
    case 'external':
      return '外销订单';
    case 'internal':
      return '内购订单';
    case 'after_sales':
      return '售后订单';
    case 'travel_group':
    default:
      return '旅行团订单';
  }
}
