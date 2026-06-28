import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/business/business_api.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/money_text.dart';
import '../../shared/widgets/status_tag.dart';

class TravelGroupDetailPanel extends StatelessWidget {
  const TravelGroupDetailPanel({
    super.key,
    required this.group,
    required this.role,
    this.marking = false,
    this.summarizing = false,
    this.onEdit,
    this.onFinanceMark,
    this.onSummary,
  });

  final TravelGroupRecord group;
  final UserRole role;
  final bool marking;
  final bool summarizing;
  final VoidCallback? onEdit;
  final VoidCallback? onFinanceMark;
  final VoidCallback? onSummary;

  @override
  Widget build(BuildContext context) {
    final markAction = onFinanceMark;
    final summaryAction = onSummary;
    final editAction = onEdit;

    return FormSection(
      title: '旅行团详情',
      trailing: StatusTag(
        label: group.financeMark ? '已标记' : '未标记',
        tone: group.financeMark ? StatusTone.success : StatusTone.warning,
      ),
      children: [
        Wrap(
          alignment: WrapAlignment.end,
          spacing: 8,
          runSpacing: 8,
          children: [
            if (editAction != null)
              OutlinedButton.icon(
                onPressed: editAction,
                icon: const Icon(Icons.edit_rounded),
                label: const Text('编辑'),
              ),
            if (summaryAction != null)
              OutlinedButton.icon(
                onPressed: summarizing ? null : summaryAction,
                icon: summarizing
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.rate_review_rounded),
                label: const Text('总结'),
              ),
            if (markAction != null)
              _FinanceMarkButton(
                marked: group.financeMark,
                busy: marking,
                onPressed: markAction,
              ),
            if (editAction == null &&
                summaryAction == null &&
                markAction == null)
              StatusTag(
                label: '${_roleLabel(role)}只读',
                tone: StatusTone.neutral,
              ),
          ],
        ),
        const Divider(height: 24),
        const _SectionTitle('基础信息'),
        _InfoRow(label: '团号', value: group.groupNo),
        _InfoRow(label: '日期', value: group.visitDate),
        _InfoRow(label: '旅行社', value: group.travelAgency),
        _InfoRow(label: '车牌号', value: group.licensePlate),
        _InfoRow(label: '品鉴馆', value: group.tastingRoomNo),
        _InfoRow(label: '团型', value: group.groupType),
        _InfoRow(label: '人数', value: '${group.guestCount} 人'),
        _InfoRow(label: '进店', value: group.arrivalTime),
        _InfoRow(label: '离店', value: group.departureTime),
        _InfoRow(label: '备注', value: group.remarks),
        const Divider(height: 24),
        const _SectionTitle('导游快照'),
        _InfoRow(label: '导游ID', value: group.guideId),
        _InfoRow(label: '姓名', value: group.guideName),
        _InfoRow(label: '手机号', value: group.guidePhone),
        _InfoRow(label: '旅行社', value: group.travelAgency),
        const Divider(height: 24),
        const _SectionTitle('品鉴师'),
        _InfoRow(label: '品鉴师ID', value: group.tasterId),
        _InfoRow(label: '姓名', value: group.tasterName),
        _InfoRow(label: '总结', value: group.tasterSummary),
        _InfoRow(label: '总结时间', value: group.tasterSummaryAt),
        _InfoRow(label: '品鉴备注', value: group.wineDetails),
        const Divider(height: 24),
        const _SectionTitle('品酒明细'),
        if (group.tastingItems.isEmpty)
          const Text('暂无品酒明细')
        else
          for (final item in group.tastingItems)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                children: [
                  Expanded(child: Text(item.productName)),
                  Text('${item.quantity} ${item.unit}'),
                ],
              ),
            ),
        const Divider(height: 24),
        const _SectionTitle('待处理'),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            StatusTag(
              label: _groupStatusLabel(group.status),
              tone: _groupStatusTone(group.status),
            ),
            StatusTag(
              label: _pendingStatusLabel(group.pendingStatus),
              tone: _pendingStatusTone(group.pendingStatus),
            ),
          ],
        ),
        if (group.pendingReasons.isNotEmpty) ...[
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final reason in group.pendingReasons)
                StatusTag(
                  label: _pendingReasonLabel(reason),
                  tone: StatusTone.info,
                ),
            ],
          ),
        ],
        const Divider(height: 24),
        const _SectionTitle('订单概要'),
        _InfoRow(label: '订单数', value: '${group.orderSummary.orderCount} 笔'),
        Row(
          children: [
            const Expanded(child: Text('订单金额')),
            MoneyText(
                cents: group.orderSummary.totalAmountCents, prominent: true),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            const Expanded(child: Text('货到付款')),
            MoneyText(
              cents: group.orderSummary.cashOnDeliveryAmountCents,
              prominent: true,
            ),
          ],
        ),
        const SizedBox(height: 12),
        if (group.salesOrders.isEmpty)
          const Text('暂无关联订单')
        else
          for (final order in group.salesOrders)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      '${order.orderNo} · ${_display(order.customerName)}',
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  MoneyText(cents: order.totalAmountCents),
                ],
              ),
            ),
        const Divider(height: 24),
        const _SectionTitle('财务标记'),
        _InfoRow(label: '状态', value: group.financeMark ? '已标记' : '未标记'),
        _InfoRow(label: '标记人', value: group.markedById),
        _InfoRow(label: '标记时间', value: group.markedAt),
      ],
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        text,
        style: Theme.of(context)
            .textTheme
            .titleSmall
            ?.copyWith(fontWeight: FontWeight.w800),
      ),
    );
  }
}

class _FinanceMarkButton extends StatelessWidget {
  const _FinanceMarkButton({
    required this.marked,
    required this.busy,
    required this.onPressed,
  });

  final bool marked;
  final bool busy;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final icon = busy
        ? const SizedBox.square(
            dimension: 18,
            child: CircularProgressIndicator(strokeWidth: 2),
          )
        : Icon(marked
            ? Icons.bookmark_added_rounded
            : Icons.bookmark_add_outlined);
    final label = marked ? '取消标记' : '财务标记';
    if (marked) {
      return FilledButton.icon(
        onPressed: busy ? null : onPressed,
        icon: icon,
        label: Text(label),
      );
    }
    return OutlinedButton.icon(
      onPressed: busy ? null : onPressed,
      icon: icon,
      label: Text(label),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value});

  final String label;
  final String? value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 76,
            child: Text(label, style: Theme.of(context).textTheme.bodySmall),
          ),
          Expanded(
            child: Text(
              _display(value),
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }
}

String _display(String? value) {
  final text = value?.trim() ?? '';
  return text.isEmpty ? '-' : text;
}

String _roleLabel(UserRole role) {
  switch (role) {
    case UserRole.admin:
      return '管理员';
    case UserRole.boss:
      return '老板';
    case UserRole.frontDesk:
      return '前台';
    case UserRole.sales:
      return '销售';
    case UserRole.finance:
      return '财务';
    case UserRole.warehouse:
      return '库管';
    case UserRole.afterSales:
      return '售后';
    case UserRole.taster:
      return '品鉴师';
  }
}

String _groupStatusLabel(String status) {
  switch (status) {
    case 'ordered':
      return '已出单';
    case 'pending_summary':
      return '待总结';
    case 'unmarked':
    default:
      return '未出单';
  }
}

StatusTone _groupStatusTone(String status) {
  switch (status) {
    case 'ordered':
      return StatusTone.success;
    case 'pending_summary':
      return StatusTone.info;
    case 'unmarked':
    default:
      return StatusTone.neutral;
  }
}

String _pendingStatusLabel(String? status) {
  switch (status) {
    case 'pending_front_desk':
      return '待前台';
    case 'pending_taster':
      return '待品鉴师';
    case 'pending_finance':
      return '待财务';
    case 'abnormal':
      return '异常';
    default:
      return '无待处理';
  }
}

StatusTone _pendingStatusTone(String? status) {
  switch (status) {
    case 'abnormal':
      return StatusTone.danger;
    case 'pending_front_desk':
    case 'pending_finance':
      return StatusTone.warning;
    case 'pending_taster':
      return StatusTone.info;
    default:
      return StatusTone.success;
  }
}

String _pendingReasonLabel(String reason) {
  switch (reason) {
    case 'missing_taster':
      return '缺少品鉴师';
    case 'missing_guide_name':
      return '缺少导游姓名';
    case 'missing_guide_phone':
      return '缺少导游手机号';
    case 'missing_travel_agency':
      return '缺少旅行社';
    case 'missing_guest_count':
      return '缺少人数';
    case 'invalid_guest_count_zero':
      return '人数为 0';
    case 'no_order_and_missing_taster_summary':
      return '无订单且未总结';
    case 'finance_unmarked_after_day_end':
      return '超过当日未标记';
    case 'duplicate_group_no':
      return '团号重复';
    case 'departure_before_arrival':
      return '离店早于进店';
    default:
      return reason;
  }
}
