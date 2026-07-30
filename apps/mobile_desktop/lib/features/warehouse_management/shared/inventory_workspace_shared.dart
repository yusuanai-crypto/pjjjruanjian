import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/api/api_client.dart';
import '../../../shared/widgets/form_section.dart';
import '../../../shared/widgets/status_tag.dart';

class InventorySelectionContext {
  const InventorySelectionContext({
    required this.warehouseId,
    required this.productId,
  });

  final String warehouseId;
  final String productId;
}

class InventoryPageScaffold extends StatelessWidget {
  const InventoryPageScaffold({
    super.key,
    required this.groupLabel,
    required this.title,
    required this.child,
    this.description,
    this.actions = const [],
  });

  final String groupLabel;
  final String title;
  final String? description;
  final List<Widget> actions;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 0, 4, 12),
          child: Wrap(
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 12,
            runSpacing: 8,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    groupLabel,
                    style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          color: Theme.of(context).colorScheme.primary,
                          fontWeight: FontWeight.w700,
                        ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    title,
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                  ),
                  if (description != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      description!,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color:
                                Theme.of(context).colorScheme.onSurfaceVariant,
                          ),
                    ),
                  ],
                ],
              ),
              if (actions.isNotEmpty)
                Wrap(spacing: 8, runSpacing: 8, children: actions),
            ],
          ),
        ),
        Expanded(child: child),
      ],
    );
  }
}

class InventoryFilterBar extends StatelessWidget {
  const InventoryFilterBar({
    super.key,
    required this.children,
    this.actions = const [],
  });

  final List<Widget> children;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: LayoutBuilder(
          builder: (context, constraints) => Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 10,
            runSpacing: 10,
            children: [
              for (final child in [...children, ...actions])
                ConstrainedBox(
                  constraints: BoxConstraints(maxWidth: constraints.maxWidth),
                  child: child,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class BottleQuantitySummary extends StatelessWidget {
  const BottleQuantitySummary({
    super.key,
    required this.label,
    required this.quantity,
    this.icon = Icons.inventory_2_outlined,
    this.tone = StatusTone.neutral,
  });

  final String label;
  final int quantity;
  final IconData icon;
  final StatusTone tone;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '$label，$quantity 瓶',
      child: Card(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 20),
              const SizedBox(width: 8),
              Text('$label  '),
              Text(
                '$quantity 瓶',
                style: const TextStyle(
                  fontWeight: FontWeight.w700,
                  fontFeatures: [FontFeature.tabularFigures()],
                ),
              ),
              const SizedBox(width: 8),
              InventoryStatusTag(label: _toneLabel(tone), tone: tone),
            ],
          ),
        ),
      ),
    );
  }

  String _toneLabel(StatusTone tone) {
    return switch (tone) {
      StatusTone.success => '正常',
      StatusTone.warning => '需关注',
      StatusTone.danger => '异常',
      StatusTone.info => '处理中',
      StatusTone.neutral => '库存',
    };
  }
}

class BottleQuantityText extends StatelessWidget {
  const BottleQuantityText(
    this.quantity, {
    super.key,
    this.labelPrefix = '',
    this.style,
  });

  final int quantity;
  final String labelPrefix;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '$labelPrefix$quantity 瓶',
      child: ExcludeSemantics(
        child: Text(
          '$labelPrefix$quantity 瓶',
          style: const TextStyle(
            fontWeight: FontWeight.w600,
            fontFeatures: [FontFeature.tabularFigures()],
          ).merge(style),
        ),
      ),
    );
  }
}

class InventoryStatusTag extends StatelessWidget {
  const InventoryStatusTag({
    super.key,
    required this.label,
    required this.tone,
    this.icon,
  });

  final String label;
  final StatusTone tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final effectiveIcon = icon ??
        switch (tone) {
          StatusTone.success => Icons.check_circle_outline_rounded,
          StatusTone.warning => Icons.warning_amber_rounded,
          StatusTone.danger => Icons.error_outline_rounded,
          StatusTone.info => Icons.info_outline_rounded,
          StatusTone.neutral => Icons.circle_outlined,
        };
    return Semantics(
      label: label,
      child: ExcludeSemantics(
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(effectiveIcon, size: 16),
            const SizedBox(width: 4),
            StatusTag(label: label, tone: tone),
          ],
        ),
      ),
    );
  }
}

class InventoryPagination extends StatelessWidget {
  const InventoryPagination({
    super.key,
    required this.page,
    required this.totalPages,
    required this.onPrevious,
    required this.onNext,
  });

  final int page;
  final int totalPages;
  final VoidCallback? onPrevious;
  final VoidCallback? onNext;

  @override
  Widget build(BuildContext context) {
    final safeTotalPages = totalPages < 1 ? 1 : totalPages;
    return Semantics(
      container: true,
      label: '分页，第 $page 页，共 $safeTotalPages 页',
      child: Row(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          IconButton(
            key: const ValueKey('inventory-page-previous'),
            tooltip: '上一页',
            onPressed: onPrevious,
            icon: const Icon(Icons.chevron_left_rounded),
          ),
          ExcludeSemantics(
            child: Text(
              '第 $page / $safeTotalPages 页',
              style:
                  const TextStyle(fontFeatures: [FontFeature.tabularFigures()]),
            ),
          ),
          IconButton(
            key: const ValueKey('inventory-page-next'),
            tooltip: '下一页',
            onPressed: onNext,
            icon: const Icon(Icons.chevron_right_rounded),
          ),
        ],
      ),
    );
  }
}

/// 为仓库管理中的表单弹窗提供一致的键盘焦点顺序和 Escape 关闭行为。
///
/// 关闭回调仍由具体表单负责，因此提交中禁用、未保存确认等业务规则不会被绕过。
class InventoryKeyboardScope extends StatelessWidget {
  const InventoryKeyboardScope({
    super.key,
    required this.child,
    this.onEscape,
  });

  final Widget child;
  final VoidCallback? onEscape;

  @override
  Widget build(BuildContext context) {
    return FocusTraversalGroup(
      child: CallbackShortcuts(
        bindings: {
          if (onEscape != null)
            const SingleActivator(LogicalKeyboardKey.escape): onEscape!,
        },
        child: child,
      ),
    );
  }
}

/// 键盘安全的手机底部表单壳，避免固定高度与 viewInsets 相加后超出屏幕。
class InventoryKeyboardSafeSheet extends StatelessWidget {
  const InventoryKeyboardSafeSheet({
    super.key,
    required this.child,
    this.heightFactor = .92,
    this.onEscape,
    this.horizontalPadding = 0,
    this.topPadding = 0,
    this.bottomPadding = 0,
  });

  final Widget child;
  final double heightFactor;
  final VoidCallback? onEscape;
  final double horizontalPadding;
  final double topPadding;
  final double bottomPadding;

  @override
  Widget build(BuildContext context) {
    final viewInsets = MediaQuery.viewInsetsOf(context);
    return SafeArea(
      child: AnimatedPadding(
        duration: const Duration(milliseconds: 160),
        curve: Curves.easeOut,
        padding: EdgeInsets.fromLTRB(
          horizontalPadding,
          topPadding,
          horizontalPadding,
          viewInsets.bottom + bottomPadding,
        ),
        child: FractionallySizedBox(
          widthFactor: 1,
          heightFactor: heightFactor,
          child: InventoryKeyboardScope(
            onEscape: onEscape,
            child: child,
          ),
        ),
      ),
    );
  }
}

class InventoryInlineNotice extends StatelessWidget {
  const InventoryInlineNotice({
    super.key,
    required this.message,
    required this.tone,
  });

  final String message;
  final StatusTone tone;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final (background, foreground, icon) = switch (tone) {
      StatusTone.danger => (
          scheme.errorContainer,
          scheme.onErrorContainer,
          Icons.error_outline_rounded
        ),
      StatusTone.warning => (
          Colors.orange.shade50,
          Colors.orange.shade900,
          Icons.warning_amber_rounded
        ),
      StatusTone.success => (
          scheme.primaryContainer,
          scheme.onPrimaryContainer,
          Icons.check_circle_outline_rounded
        ),
      StatusTone.info => (
          scheme.secondaryContainer,
          scheme.onSecondaryContainer,
          Icons.info_outline_rounded
        ),
      StatusTone.neutral => (
          scheme.surfaceContainerHighest,
          scheme.onSurface,
          Icons.info_outline_rounded
        ),
    };
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Icon(icon, color: foreground, size: 18),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: TextStyle(color: foreground, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}

class InventoryUnavailableCard extends StatelessWidget {
  const InventoryUnavailableCard({
    super.key,
    required this.title,
    required this.message,
    this.keyPrefix,
  });

  final String title;
  final String message;
  final String? keyPrefix;

  @override
  Widget build(BuildContext context) {
    return FormSection(
      key: keyPrefix == null ? null : ValueKey('$keyPrefix-card'),
      title: title,
      children: [
        InventoryInlineNotice(message: message, tone: StatusTone.warning),
        const SizedBox(height: 8),
        const Text('此处不会使用演示数据或本地内存模拟业务成功。'),
      ],
    );
  }
}

class InventoryDestinationLinkCard extends StatelessWidget {
  const InventoryDestinationLinkCard({
    super.key,
    required this.title,
    required this.message,
    required this.buttonLabel,
    required this.buttonKey,
    required this.icon,
    required this.onOpen,
  });

  final String title;
  final String message;
  final String buttonLabel;
  final Key buttonKey;
  final IconData icon;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    return FormSection(
      title: title,
      children: [
        InventoryInlineNotice(message: message, tone: StatusTone.info),
        const SizedBox(height: 12),
        Align(
          alignment: Alignment.centerLeft,
          child: FilledButton.icon(
            key: buttonKey,
            onPressed: onOpen,
            icon: Icon(icon),
            label: Text(buttonLabel),
          ),
        ),
      ],
    );
  }
}

String inventoryErrorMessage(Object e) {
  if (e is ApiException) {
    return switch (e.code) {
      'PERMISSION_DENIED' || 'FIELD_PERMISSION_DENIED' => '没有此操作权限。',
      'INVENTORY_REQUEST_HASH_MISMATCH' => '请求校验失败，请重试。',
      'INVENTORY_VALIDATION_FAILED' => '数据校验失败：${e.message}',
      'INVENTORY_WAREHOUSE_NOT_FOUND' => '仓库不存在。',
      'INVENTORY_PRODUCT_NOT_FOUND' => '商品不存在。',
      'INVENTORY_STOCK_NOT_FOUND' => '库存记录不存在。',
      'INVENTORY_INBOUND_DOCUMENT_NOT_FOUND' => '入库单不存在。',
      'INVENTORY_TRANSFER_NOT_FOUND' => '调拨单不存在。',
      'INVENTORY_TRANSFER_NOT_DRAFT' => '调拨单已不是待调出状态，请刷新后重试。',
      'INVENTORY_TRANSFER_NOT_RECEIVABLE' => '调拨单当前不可收货，请刷新查看真实状态。',
      'INVENTORY_TRANSFER_LINE_NOT_FOUND' => '调拨明细不存在或已变化，请刷新后重试。',
      'INVENTORY_TRANSFER_RECEIPT_NOT_FOUND' => '调拨收货记录不存在。',
      'INVENTORY_TRANSFER_RECEIPT_REVERSED' => '该收货记录已经冲销。',
      'INVENTORY_TRANSFER_RECEIPT_EXCEEDS_TRANSIT' => '收货与差异数量超过当前在途数量。',
      'INVENTORY_TRANSFER_HAS_ACTIVE_RECEIPTS' => '存在未冲销的收货记录，不能冲销调出。',
      'INVENTORY_CONCURRENT_UPDATE' => '数据已被其他人更新，请刷新后重试。',
      'INVENTORY_STOCKTAKE_NOT_FOUND' => '盘点单不存在或已被移除。',
      'INVENTORY_STOCKTAKE_ACTIVE_EXISTS' => '该仓库与商品已有草稿或待审批盘点，请先处理原盘点单。',
      'INVENTORY_STOCKTAKE_VALIDATION_FAILED' => '盘点数据校验失败：${e.message}',
      'INVENTORY_STOCKTAKE_STATE_CONFLICT' => '盘点单状态已变化，请刷新后查看真实状态。',
      'INVENTORY_STOCKTAKE_SNAPSHOT_MISSING' => '盘点快照不完整，不能审批；请重新发起盘点。',
      'INVENTORY_STOCKTAKE_SNAPSHOT_STALE' =>
        '快照已过期：提交后发生了入库、出库或其他库存变化。请驳回并重新盘点，不能强制覆盖。',
      'INVENTORY_STOCKTAKE_DUPLICATE_SCAN' => '同一物流码不能重复扫描。',
      'INVENTORY_STOCKTAKE_SERIALIZED_UNRESOLVED' =>
        '存在未知或冲突物流码，必须先解决异常，不能强制批准。',
      'INVENTORY_STOCKTAKE_SERIALIZED_AGGREGATE_MISMATCH' =>
        '逐瓶明细与库存汇总不一致，请先完成数据核对后重新盘点。',
      'INVENTORY_STOCKTAKE_SERIALIZED_STATE_CONFLICT' => '逐瓶库存状态已变化，请重新盘点。',
      'INVENTORY_STOCKTAKE_RESERVED_UNIT_MISSING' => '盘点缺失的瓶码仍被订单占用，请先处理履约冲突。',
      'INVENTORY_STOCKTAKE_RESERVED_UNIT_CONDITION_CONFLICT' =>
        '已占用瓶码不能通过盘点直接改为不可售。',
      'INVENTORY_STOCKTAKE_ALLOCATED_REVIEW_REQUIRED' =>
        '存在历史已分配瓶码，需要数据迁移核对，暂不能审批。',
      'INVENTORY_STOCKTAKE_REVERSAL_CONFLICT' => '盘点过账后的逐瓶状态已变化，当前不能冲销。',
      'INVENTORY_COMMAND_IN_PROGRESS' => '相同操作正在处理中，请稍后刷新。',
      'INVENTORY_IDEMPOTENCY_KEY_CONFLICT' => '重复操作参数不一致，请刷新后重试。',
      'INVENTORY_RESERVED_QTY_NEGATIVE' => '操作会导致占用数量为负。',
      'INVENTORY_UNAVAILABLE_QTY_NEGATIVE' => '操作会导致不可售数量为负。',
      'INVENTORY_IN_TRANSIT_QTY_NEGATIVE' => '操作会导致在途数量为负。',
      'INVENTORY_TRACKING_DISABLED' => '该商品未启用库存跟踪。',
      'INVENTORY_COST_FIELD_FORBIDDEN' => '当前角色不可在入库时填写成本。',
      'INVENTORY_COST_REPORT_FORBIDDEN' => '当前角色不可查看库存估值报表。',
      'INVENTORY_DEFAULT_WAREHOUSE_CANNOT_DISABLE' =>
        '请先将另一个已启用仓库设为默认仓库，再停用当前默认仓库。',
      'INVENTORY_WAREHOUSE_HAS_ACTIVE_BUSINESS' =>
        '仓库仍有现存库存、占用、在途库存、未完成单据或进行中的盘点，无法停用。',
      'INVENTORY_REPORT_EXPORT_LIMIT_EXCEEDED' => '导出行数超限（上限 10 万行）。',
      'INVENTORY_REPORT_EXPORT_DATA_CHANGED' => '导出期间数据发生变化，请刷新报表后重新导出。',
      'LOGISTICS_CODE_DUPLICATE' => '物流码已存在。',
      'INVENTORY_UNIT_UNAVAILABLE' => '所选物流码已被并发占用、不属于当前仓库，或资料/成本不完整，请刷新后重选。',
      'SERIALIZED_ASSIGNMENT_EXCEEDS_REQUESTED' => '已选瓶数超过剩余需求。',
      'INVENTORY_SERIALIZED_ADAPTER_REQUIRED' => '逐瓶库存操作能力暂不可用，不能退化为汇总数量操作。',
      'AFTER_SALES_ORDER_NOT_FOUND' => '售后单不存在或已被移除。',
      'AFTER_SALES_RECEIPT_NOT_FOUND' => '实际收货记录不存在，请刷新后重试。',
      'AFTER_SALES_RECEIPT_NOT_DRAFT' => '该收货草稿已被处理，请刷新查看真实状态。',
      'AFTER_SALES_RECEIPT_NOT_POSTED' => '只有已确认的收货记录才能冲销。',
      'AFTER_SALES_RECEIPT_ITEM_MISMATCH' => '收货明细与当前售后单不匹配。',
      'AFTER_SALES_RECEIPT_BATCH_MISMATCH' => '所选批次不属于当前收货仓库或商品。',
      'AFTER_SALES_RECEIPT_QUANTITY_EXCEEDED' => '本次收货会超过应退数量，请刷新后重新核对。',
      'AFTER_SALES_RECEIPT_CONCURRENT_UPDATE' => '该售后收货已被其他人更新，请刷新后重试。',
      'AFTER_SALES_RETURN_NOT_REQUIRED' => '该商品没有服务端明确的应退数量，不能返库存。',
      'AFTER_SALES_SERIALIZED_MATCH_REQUIRED' =>
        '存在非原瓶、重复瓶码或无法确认的瓶码，请按“异常待处理”登记。',
      'AFTER_SALES_SERIALIZED_UNIT_ALREADY_RECEIVED' => '该原瓶已经收货，不能重复返库。',
      'AFTER_SALES_RECEIPT_VALIDATION_FAILED' => '收货信息校验失败：${e.message}',
      'AFTER_SALES_SOURCE_ORDER_INVALID' => '财务负向售后订单不能作为实际退货来源。',
      'NETWORK_ERROR' => '无法连接服务器，请检查网络。',
      _ => _inventoryApiFallbackMessage(e),
    };
  }
  return '操作失败，请稍后重试。';
}

String _inventoryApiFallbackMessage(ApiException error) {
  final detail = error.message.trim();
  return switch (error.statusCode) {
    0 => '无法连接服务器，请检查网络。',
    403 => '没有此操作权限，请联系管理员确认角色授权。',
    409 => '数据已被其他人更新或状态已变化，请刷新后重试。',
    422 => detail.isEmpty ? '提交内容未通过服务端校验，请检查后重试。' : '数据校验失败：$detail',
    501 || 503 => '功能暂不可用，等待后端接口就绪。',
    _ => detail.isEmpty ? '操作失败，请稍后重试。' : detail,
  };
}

Future<bool> confirmInventoryAction(
  BuildContext context, {
  required String title,
  required String content,
  String confirmLabel = '确认',
  String cancelLabel = '取消',
  bool danger = false,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      scrollable: true,
      title: Text(title),
      content: Text(content),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx, false),
          child: Text(cancelLabel),
        ),
        FilledButton(
          style: danger
              ? FilledButton.styleFrom(
                  backgroundColor: Theme.of(ctx).colorScheme.error,
                )
              : null,
          onPressed: () => Navigator.pop(ctx, true),
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
  return result ?? false;
}

int? parseBottleQuantity(String value) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) return null;
  if (!RegExp(r'^[1-9][0-9]*$').hasMatch(trimmed)) return null;
  return int.tryParse(trimmed);
}

int? parseNonNegativeInt(String value) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) return null;
  if (!RegExp(r'^(0|[1-9][0-9]*)$').hasMatch(trimmed)) return null;
  return int.tryParse(trimmed);
}

int? parseNonNegativeYuanCents(String value) {
  final trimmed = value.trim();
  if (!RegExp(r'^(0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$').hasMatch(trimmed)) {
    return null;
  }
  final parts = trimmed.split('.');
  final yuan = int.tryParse(parts.first);
  if (yuan == null) return null;
  final fraction = parts.length == 1 ? '' : parts[1];
  final cents = fraction.isEmpty ? 0 : int.tryParse(fraction.padRight(2, '0'));
  if (cents == null) return null;
  final result = yuan * 100 + cents;
  return result.isNegative ? null : result;
}

String inventoryDisplayText(String? value, {String emptyText = '—'}) {
  final text = value?.trim() ?? '';
  return text.isEmpty ? emptyText : text;
}

String formatInventoryDateTime(String? value) {
  final raw = value?.trim();
  if (raw == null || raw.isEmpty) return '暂未提供';
  final parsed = DateTime.tryParse(raw);
  if (parsed == null) return raw;
  final local = parsed.toLocal();
  String two(int number) => number.toString().padLeft(2, '0');
  return '${local.year}-${two(local.month)}-${two(local.day)} '
      '${two(local.hour)}:${two(local.minute)}';
}

String inventoryDateText(DateTime? value) {
  if (value == null) return '';
  String two(int number) => number.toString().padLeft(2, '0');
  return '${value.year}-${two(value.month)}-${two(value.day)}';
}
