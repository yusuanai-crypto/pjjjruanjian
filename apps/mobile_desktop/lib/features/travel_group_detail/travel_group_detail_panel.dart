import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/auth/role_access.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/money_text.dart';
import '../../shared/widgets/status_tag.dart';

typedef TravelGroupAttachmentAction = void Function(
  TravelGroupAttachmentRecord attachment,
);

class TravelGroupDetailPanel extends StatelessWidget {
  const TravelGroupDetailPanel({
    super.key,
    required this.group,
    required this.role,
    this.marking = false,
    this.summarizing = false,
    this.updatingNotEntered = false,
    this.onCreateOrder,
    this.onEdit,
    this.onFinanceMark,
    this.onSummary,
    this.onConfirmNotEntered,
    this.onRevokeNotEntered,
    this.onPreviewAttachment,
    this.onDownloadAttachment,
    this.onDeleteAttachment,
    this.onUploadKeyCustomerPhotos,
    this.onUploadGuestInfoAttachments,
  });

  final TravelGroupRecord group;
  final UserRole role;
  final bool marking;
  final bool summarizing;
  final bool updatingNotEntered;
  final VoidCallback? onCreateOrder;
  final VoidCallback? onEdit;
  final VoidCallback? onFinanceMark;
  final VoidCallback? onSummary;
  final VoidCallback? onConfirmNotEntered;
  final VoidCallback? onRevokeNotEntered;
  final TravelGroupAttachmentAction? onPreviewAttachment;
  final TravelGroupAttachmentAction? onDownloadAttachment;
  final TravelGroupAttachmentAction? onDeleteAttachment;
  final VoidCallback? onUploadKeyCustomerPhotos;
  final VoidCallback? onUploadGuestInfoAttachments;

  @override
  Widget build(BuildContext context) {
    final showFinanceMark = canViewFinanceMark(role);
    final markAction = showFinanceMark ? onFinanceMark : null;
    final summaryAction = onSummary;
    final editAction = onEdit;
    final createOrderAction = onCreateOrder;
    final notEnteredAction = group.entryStatus == 'not_entered'
        ? onRevokeNotEntered
        : group.entryStatus == 'pending_entry'
            ? onConfirmNotEntered
            : null;

    return FormSection(
      title: '旅行团详情',
      trailing: showFinanceMark
          ? StatusTag(
              label: group.financeMark ? '已标记' : '未标记',
              tone: group.financeMark ? StatusTone.success : StatusTone.warning,
            )
          : null,
      children: [
        Wrap(
          alignment: WrapAlignment.end,
          spacing: 8,
          runSpacing: 8,
          children: [
            if (createOrderAction != null)
              FilledButton.icon(
                key: const ValueKey('create-order-for-travel-group-button'),
                onPressed: createOrderAction,
                icon: const Icon(Icons.receipt_long_rounded),
                label: const Text('录入订单'),
              ),
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
            if (notEnteredAction != null)
              _NotEnteredButton(
                confirmed: group.entryStatus == 'not_entered',
                busy: updatingNotEntered,
                onPressed: notEnteredAction,
              ),
            if (markAction != null)
              _FinanceMarkButton(
                marked: group.financeMark,
                busy: marking,
                onPressed: markAction,
              ),
            if (createOrderAction == null &&
                editAction == null &&
                summaryAction == null &&
                notEnteredAction == null &&
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
        _InfoRow(label: '进店日期', value: group.visitDate),
        _InfoRow(label: '旅行社', value: group.travelAgency),
        _InfoRow(label: '车牌号', value: group.licensePlate),
        _InfoRow(label: '品鉴馆', value: group.tastingRoomNo),
        _InfoRow(label: '团型', value: group.groupType),
        _InfoRow(
          label: '人数',
          value: group.guestCount > 0 ? '${group.guestCount} 人' : '未填写',
        ),
        _InfoRow(label: '预计进店时间', value: group.expectedArrivalTime),
        _InfoRow(label: '实际进店时间', value: group.arrivalTime),
        _InfoRow(
          label: '进店状态',
          value: _entryStatusLabel(group.entryStatus),
        ),
        _InfoRow(
          label: '未进店确认人',
          value: group.notEnteredConfirmedBy?.name,
        ),
        _InfoRow(
          label: '未进店确认时间',
          value: group.notEnteredConfirmedAt,
        ),
        _InfoRow(label: '离店', value: group.departureTime),
        _InfoRow(label: '损耗状态', value: _lossStatusLabel(group.lossStatus)),
        _InfoRow(label: '损耗确认人', value: group.lossConfirmedByName),
        _InfoRow(label: '损耗确认时间', value: group.lossConfirmedAt),
        _InfoRow(label: '备注', value: group.remarks),
        const Divider(height: 24),
        const _SectionTitle('导游快照'),
        _InfoRow(label: '姓名', value: group.guideName),
        _InfoRow(label: '手机号', value: group.guidePhone),
        _InfoRow(label: '旅行社', value: group.travelAgency),
        const Divider(height: 24),
        const _SectionTitle('客户补充信息'),
        _InfoRow(label: '客源地', value: group.sourceRegion),
        _InfoRow(label: '年龄描述', value: group.ageInfo),
        _InfoRow(
          label: '提及飞天',
          value: _mentionedFeitianLabel(group.mentionedFeitian),
        ),
        _InfoRow(label: '前站出单情况', value: group.previousStopOrderStatus),
        _InfoRow(label: '重点客户信息', value: group.keyCustomerInfo),
        const Divider(height: 24),
        const _SectionTitle('品鉴师'),
        _InfoRow(label: '对接品鉴师', value: group.liaisonTasterName),
        _InfoRow(label: '品鉴师', value: group.tasterName),
        _InfoRow(label: '总结', value: group.tasterSummary),
        _InfoRow(label: '总结时间', value: group.tasterSummaryAt),
        _InfoRow(label: '品鉴备注', value: group.wineDetails),
        const Divider(height: 24),
        _AttachmentSection(
          title: '重点客户照片',
          emptyText: '暂无重点客户照片',
          attachments: group.keyCustomerPhotos,
          onUpload: onUploadKeyCustomerPhotos,
          onPreview: onPreviewAttachment,
          onDownload: onDownloadAttachment,
          onDelete: onDeleteAttachment,
        ),
        const Divider(height: 24),
        _AttachmentSection(
          title: '客人信息附件',
          emptyText: '暂无客人信息附件',
          attachments: group.guestInfoAttachments,
          onUpload: onUploadGuestInfoAttachments,
          onPreview: onPreviewAttachment,
          onDownload: onDownloadAttachment,
          onDelete: onDeleteAttachment,
        ),
        const Divider(height: 24),
        const _SectionTitle('品酒明细'),
        if (group.tastingItems.isEmpty)
          const Text('暂无品酒明细')
        else
          for (final item in group.tastingItems)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Expanded(child: Text(item.productName)),
                      Text('${item.quantity} ${item.unit}'),
                    ],
                  ),
                  if ((item.note ?? '').trim().isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text('备注：${item.note!.trim()}'),
                    ),
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
                  label: _pendingReasonLabel(
                    reason,
                    showFinanceMark: showFinanceMark,
                  ),
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
        if (showFinanceMark) ...[
          const Divider(height: 24),
          const _SectionTitle('财务标记'),
          _InfoRow(label: '状态', value: group.financeMark ? '已标记' : '未标记'),
          _InfoRow(label: '标记人', value: group.markedById),
          _InfoRow(label: '标记时间', value: group.markedAt),
        ],
      ],
    );
  }
}

class _AttachmentSection extends StatelessWidget {
  const _AttachmentSection({
    required this.title,
    required this.emptyText,
    required this.attachments,
    required this.onUpload,
    required this.onPreview,
    required this.onDownload,
    required this.onDelete,
  });

  final String title;
  final String emptyText;
  final List<TravelGroupAttachmentRecord> attachments;
  final VoidCallback? onUpload;
  final TravelGroupAttachmentAction? onPreview;
  final TravelGroupAttachmentAction? onDownload;
  final TravelGroupAttachmentAction? onDelete;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(child: _SectionTitle(title)),
            if (onUpload != null)
              TextButton.icon(
                onPressed: onUpload,
                icon: const Icon(Icons.upload_file_rounded),
                label: const Text('上传'),
              ),
          ],
        ),
        if (attachments.isEmpty)
          Text(emptyText)
        else
          for (final attachment in attachments)
            _AttachmentTile(
              attachment: attachment,
              onPreview: onPreview,
              onDownload: onDownload,
              onDelete: onDelete,
            ),
      ],
    );
  }
}

class _AttachmentTile extends StatelessWidget {
  const _AttachmentTile({
    required this.attachment,
    required this.onPreview,
    required this.onDownload,
    required this.onDelete,
  });

  final TravelGroupAttachmentRecord attachment;
  final TravelGroupAttachmentAction? onPreview;
  final TravelGroupAttachmentAction? onDownload;
  final TravelGroupAttachmentAction? onDelete;

  @override
  Widget build(BuildContext context) {
    final isImage = isTravelGroupImageAttachment(attachment);
    final scheme = Theme.of(context).colorScheme;
    return Card(
      key: ValueKey('travel-group-attachment-${attachment.id}'),
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 52,
              height: 52,
              decoration: BoxDecoration(
                color: scheme.surfaceContainerHighest,
                borderRadius: const BorderRadius.all(Radius.circular(8)),
              ),
              child: Icon(
                isImage ? Icons.image_rounded : Icons.description_rounded,
                color: scheme.primary,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    attachment.originalName,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${_display(attachment.contentType)} · '
                    '${_formatFileSize(attachment.size)}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      if (isImage && onPreview != null)
                        TextButton.icon(
                          onPressed: () => onPreview!(attachment),
                          icon: const Icon(Icons.visibility_rounded),
                          label: const Text('预览'),
                        ),
                      if (onDownload != null)
                        TextButton.icon(
                          onPressed: () => onDownload!(attachment),
                          icon: const Icon(Icons.download_rounded),
                          label: const Text('下载'),
                        ),
                      if (onDelete != null)
                        TextButton.icon(
                          onPressed: () => onDelete!(attachment),
                          icon: const Icon(Icons.delete_outline_rounded),
                          label: const Text('删除'),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
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

class _NotEnteredButton extends StatelessWidget {
  const _NotEnteredButton({
    required this.confirmed,
    required this.busy,
    required this.onPressed,
  });

  final bool confirmed;
  final bool busy;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      key: ValueKey(
        confirmed
            ? 'revoke-travel-group-not-entered-button'
            : 'confirm-travel-group-not-entered-button',
      ),
      onPressed: busy ? null : onPressed,
      icon: busy
          ? const SizedBox.square(
              dimension: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : Icon(
              confirmed
                  ? Icons.undo_rounded
                  : Icons.person_off_outlined,
            ),
      label: Text(confirmed ? '撤销未进店' : '确认未进店'),
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

String _mentionedFeitianLabel(bool? value) {
  if (value == null) {
    return '未填写';
  }
  return value ? '是' : '否';
}

bool isTravelGroupImageAttachment(TravelGroupAttachmentRecord attachment) {
  if ((attachment.contentType ?? '').toLowerCase().startsWith('image/')) {
    return true;
  }
  final name = attachment.originalName.toLowerCase();
  return const [
    '.jpg',
    '.jpeg',
    '.png',
    '.gif',
    '.webp',
    '.bmp',
    '.tif',
    '.tiff',
    '.avif',
  ].any(name.endsWith);
}

String _formatFileSize(int bytes) {
  if (bytes < 1024) {
    return '$bytes B';
  }
  final kilobytes = bytes / 1024;
  if (kilobytes < 1024) {
    return '${kilobytes.toStringAsFixed(kilobytes >= 10 ? 0 : 1)} KB';
  }
  final megabytes = kilobytes / 1024;
  return '${megabytes.toStringAsFixed(megabytes >= 10 ? 0 : 1)} MB';
}

String _roleLabel(UserRole role) {
  switch (role) {
    case UserRole.superAdmin:
      return '超级管理员';
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

String _entryStatusLabel(String status) {
  switch (status) {
    case 'not_entered':
      return '未进店';
    case 'entered':
      return '已进店';
    case 'pending_entry':
    default:
      return '待进店';
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
    case 'pending_sales':
      return '待销售';
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
    case 'pending_sales':
      return StatusTone.info;
    case 'pending_taster':
      return StatusTone.info;
    default:
      return StatusTone.success;
  }
}

String _pendingReasonLabel(String reason, {bool showFinanceMark = true}) {
  switch (reason) {
    case 'missing_taster':
      return '缺少品鉴师';
    case 'missing_license_plate':
      return '缺少车牌号';
    case 'missing_guide_name':
      return '缺少导游姓名';
    case 'missing_guide_phone':
      return '缺少导游手机号';
    case 'missing_travel_agency':
      return '缺少旅行社';
    case 'missing_cigarette_fee':
      return '缺少香烟费用';
    case 'missing_guest_count':
      return '缺少人数';
    case 'missing_tasting_room_no':
      return '缺少品鉴馆号';
    case 'missing_arrival_time':
      return '缺少进店时间';
    case 'missing_group_type':
      return '缺少团型';
    case 'missing_departure_time':
      return '缺少离店时间';
    case 'loss_not_confirmed':
      return '损耗尚未确认';
    case 'invalid_guest_count_zero':
      return '人数为 0';
    case 'no_order_and_missing_taster_summary':
      return '无订单且未总结';
    case 'finance_unmarked_after_day_end':
      return showFinanceMark ? '超过当日未标记' : '超过当日待处理';
    case 'duplicate_group_no':
      return '团号重复';
    case 'departure_before_arrival':
      return '离店早于进店';
    default:
      return reason;
  }
}

String _lossStatusLabel(String status) {
  switch (status) {
    case 'RECORDED':
      return '已记录损耗';
    case 'NO_LOSS':
      return '已确认无损耗';
    case 'PENDING':
    default:
      return '待确认';
  }
}
