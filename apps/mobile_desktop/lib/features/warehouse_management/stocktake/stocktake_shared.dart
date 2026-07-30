part of '../inventory_workspace_tabs.dart';

StatusTone _stocktakeTone(String status) {
  return switch (status.toUpperCase()) {
    'POSTED' => StatusTone.success,
    'SUBMITTED' || 'APPROVED' => StatusTone.warning,
    'REJECTED' || 'REVERSED' => StatusTone.neutral,
    'DRAFT' => StatusTone.info,
    _ => StatusTone.neutral,
  };
}

IconData _stocktakeStatusIcon(String status) {
  return switch (status.toUpperCase()) {
    'DRAFT' => Icons.edit_note_rounded,
    'SUBMITTED' => Icons.schedule_rounded,
    'APPROVED' => Icons.sync_rounded,
    'REJECTED' => Icons.cancel_outlined,
    'POSTED' => Icons.check_circle_outline_rounded,
    'REVERSED' => Icons.undo_rounded,
    _ => Icons.help_outline_rounded,
  };
}

String _formatStocktakeDateTime(String? value) {
  if (value == null || value.trim().isEmpty) return '暂未提供';
  final parsed = DateTime.tryParse(value);
  if (parsed == null) return value;
  final local = parsed.toLocal();
  String two(int part) => part.toString().padLeft(2, '0');
  return '${local.year}-${two(local.month)}-${two(local.day)} '
      '${two(local.hour)}:${two(local.minute)}';
}

String _signedBottleQuantity(int? quantity) {
  if (quantity == null) return '暂未提供';
  if (quantity > 0) return '+$quantity 瓶';
  return '$quantity 瓶';
}

String _stocktakeTrackingModeLabel(String value) {
  return switch (value.toUpperCase()) {
    'QUANTITY' => '按数量',
    'SERIALIZED' => '逐瓶',
    _ => '未启用',
  };
}

class _StocktakeRecordCard extends StatelessWidget {
  const _StocktakeRecordCard({
    required this.record,
    required this.selected,
    required this.onTap,
    this.trailing,
  });

  final StocktakeRecord record;
  final bool selected;
  final VoidCallback onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final line = record.line;
    return Card(
      key: ValueKey('warehouse-stocktake-tile-${record.id}'),
      margin: EdgeInsets.zero,
      color: selected
          ? Theme.of(context)
              .colorScheme
              .secondaryContainer
              .withValues(alpha: .45)
          : null,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${record.warehouseName} · ${record.productName}',
                          style: Theme.of(context)
                              .textTheme
                              .titleSmall
                              ?.copyWith(fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          record.stocktakeNo.isEmpty
                              ? record.id
                              : record.stocktakeNo,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  InventoryStatusTag(
                    label: record.statusLabel,
                    tone: _stocktakeTone(record.status),
                    icon: _stocktakeStatusIcon(record.status),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 12,
                runSpacing: 6,
                children: [
                  Text(
                    '模式：${_stocktakeTrackingModeLabel(record.trackingMode)}',
                  ),
                  Text(
                    '账面：${line?.snapshotOnHandQty == null ? '未冻结' : '${line!.snapshotOnHandQty} 瓶'}',
                  ),
                  Text(
                    '实盘：${line?.countedOnHandQty == null ? '未提交' : '${line!.countedOnHandQty} 瓶'}',
                  ),
                  Text(
                      '差异：${_signedBottleQuantity(line?.onHandDifferenceQty)}'),
                ],
              ),
              if (trailing != null) ...[
                const SizedBox(height: 10),
                Align(alignment: Alignment.centerRight, child: trailing),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _StocktakeDetailView extends StatelessWidget {
  const _StocktakeDetailView({
    required this.record,
    this.loading = false,
    this.error,
    this.onRetry,
    this.notice,
    this.actions = const [],
  });

  final StocktakeRecord record;
  final bool loading;
  final String? error;
  final VoidCallback? onRetry;
  final String? notice;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final line = record.line;
    if (loading) {
      return const LoadingState(title: '正在加载盘点详情');
    }
    if (error != null) {
      return ErrorState(title: error!, onRetry: onRetry);
    }
    return SingleChildScrollView(
      key: ValueKey('warehouse-stocktake-detail-${record.id}'),
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (notice != null) ...[
            InventoryInlineNotice(
              message: notice!,
              tone: notice!.contains('过期') || notice!.contains('冲突')
                  ? StatusTone.danger
                  : StatusTone.info,
            ),
            const SizedBox(height: 12),
          ],
          if (actions.isNotEmpty) ...[
            Wrap(
              alignment: WrapAlignment.end,
              spacing: 8,
              runSpacing: 8,
              children: actions,
            ),
            const SizedBox(height: 12),
          ],
          FormSection(
            title: '盘点单',
            children: [
              _StocktakeDetailRow(
                label: '盘点单号',
                value:
                    record.stocktakeNo.isEmpty ? record.id : record.stocktakeNo,
              ),
              _StocktakeDetailRow(
                label: '状态',
                child: InventoryStatusTag(
                  label: record.statusLabel,
                  tone: _stocktakeTone(record.status),
                  icon: _stocktakeStatusIcon(record.status),
                ),
              ),
              _StocktakeDetailRow(
                label: '仓库',
                value: [
                  record.warehouseCode,
                  record.warehouseName,
                ].where((item) => item.isNotEmpty).join(' · '),
              ),
              _StocktakeDetailRow(
                label: '商品',
                value: '${record.productName} · '
                    '${_stocktakeTrackingModeLabel(record.trackingMode)}',
              ),
              _StocktakeDetailRow(
                label: '创建时间',
                value: _formatStocktakeDateTime(record.createdAt),
              ),
            ],
          ),
          const SizedBox(height: 12),
          FormSection(
            title: '账面快照与实盘',
            children: [
              if (line == null || !line.hasSnapshot)
                const InventoryInlineNotice(
                  message: '草稿尚未提交，服务端还没有冻结库存快照；此时不会改变库存。',
                  tone: StatusTone.info,
                )
              else ...[
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    BottleQuantitySummary(
                      label: '账面现存',
                      quantity: line.snapshotOnHandQty!,
                    ),
                    BottleQuantitySummary(
                      label: '账面不可售',
                      quantity: line.snapshotUnavailableQty!,
                      tone: line.snapshotUnavailableQty! > 0
                          ? StatusTone.warning
                          : StatusTone.neutral,
                    ),
                    BottleQuantitySummary(
                      label: '实盘现存',
                      quantity: line.countedOnHandQty ?? 0,
                      tone: StatusTone.info,
                    ),
                    BottleQuantitySummary(
                      label: '实盘不可售',
                      quantity: line.countedUnavailableQty ?? 0,
                      tone: StatusTone.info,
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                _StocktakeDetailRow(
                  label: '现存差异',
                  value: _signedBottleQuantity(line.onHandDifferenceQty),
                ),
                _StocktakeDetailRow(
                  label: '不可售差异',
                  value: _signedBottleQuantity(line.unavailableDifferenceQty),
                ),
                _StocktakeDetailRow(
                  label: '快照版本',
                  value: line.snapshotStockVersion?.toString() ?? '暂未提供',
                ),
                _StocktakeDetailRow(
                  label: '快照流水',
                  value: line.snapshotLastMovementId ?? '无历史流水',
                ),
                _StocktakeDetailRow(
                  label: '快照时间',
                  value: _formatStocktakeDateTime(record.submittedAt),
                ),
              ],
            ],
          ),
          const SizedBox(height: 12),
          FormSection(
            title: '原因与审计',
            children: [
              _StocktakeDetailRow(
                  label: '盘点原因', value: record.reason ?? '暂未提供'),
              _StocktakeDetailRow(
                label: '提交人',
                value: record.submittedByName ?? '暂未提供',
              ),
              _StocktakeDetailRow(
                label: '提交时间',
                value: _formatStocktakeDateTime(record.submittedAt),
              ),
              if (record.rejectionReason != null)
                _StocktakeDetailRow(
                  label: '驳回原因',
                  value: record.rejectionReason!,
                ),
              if (record.rejectedAt != null)
                _StocktakeDetailRow(
                  label: '驳回',
                  value: '${record.rejectedByName ?? '暂未提供'} · '
                      '${_formatStocktakeDateTime(record.rejectedAt)}',
                ),
              if (record.postedAt != null)
                _StocktakeDetailRow(
                  label: '过账',
                  value:
                      '${record.postedByName ?? record.approvedByName ?? '暂未提供'} · '
                      '${_formatStocktakeDateTime(record.postedAt)}',
                ),
              if (record.reversalReason != null)
                _StocktakeDetailRow(
                  label: '冲销原因',
                  value: record.reversalReason!,
                ),
              if (record.reversedAt != null)
                _StocktakeDetailRow(
                  label: '冲销',
                  value: '${record.reversedByName ?? '暂未提供'} · '
                      '${_formatStocktakeDateTime(record.reversedAt)}',
                ),
            ],
          ),
          if (record.isSerialized) ...[
            const SizedBox(height: 12),
            FormSection(
              title: '逐瓶盘点证据',
              children: [
                if (record.serializedScans.isEmpty)
                  const InventoryInlineNotice(
                    message: '当前响应没有可展示的逐瓶扫描证据；不会用汇总数量替代。',
                    tone: StatusTone.warning,
                  )
                else
                  for (final scan in record.serializedScans)
                    ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      leading: Icon(
                        scan.matchStatus == 'MATCHED'
                            ? Icons.qr_code_2_rounded
                            : Icons.warning_amber_rounded,
                      ),
                      title: Text(scan.logisticsCode),
                      subtitle: Text(
                        '匹配：${scan.matchStatus} · '
                        '实盘状态：${scan.countedCondition ?? '未确认'}',
                      ),
                    ),
              ],
            ),
          ],
          if (record.status == 'APPROVED') ...[
            const SizedBox(height: 12),
            const InventoryInlineNotice(
              message: '该记录处于服务端恢复中间态，正常审批会直接进入“已生效”。'
                  '前端不提供强制过账按钮。',
              tone: StatusTone.warning,
            ),
          ],
        ],
      ),
    );
  }
}

class _StocktakeDetailRow extends StatelessWidget {
  const _StocktakeDetailRow({
    required this.label,
    this.value,
    this.child,
  });

  final String label;
  final String? value;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 92,
            child: Text(
              label,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(child: child ?? SelectableText(value ?? '暂未提供')),
        ],
      ),
    );
  }
}
