import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/api/api_client.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/money_text.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/state_views.dart';
import '../../shared/widgets/status_tag.dart';

class QrSalesSheetPage extends StatefulWidget {
  const QrSalesSheetPage({
    super.key,
    required this.apiClient,
    required this.token,
  });

  final ApiClient apiClient;
  final String token;

  @override
  State<QrSalesSheetPage> createState() => _QrSalesSheetPageState();
}

class _QrSalesSheetPageState extends State<QrSalesSheetPage> {
  late BusinessApi _businessApi;
  late final TextEditingController _searchController;

  List<SalesOrderRecord> _orders = const <SalesOrderRecord>[];
  SalesOrderRecord? _selectedOrder;
  SalesSheetRecord? _salesSheet;
  int? _expiresInDays = 30;
  bool _regenerate = false;
  bool _searched = false;
  bool _searching = false;
  bool _loadingSheet = false;
  bool _generating = false;
  bool _revoking = false;
  String? _searchErrorMessage;
  String? _sheetErrorMessage;

  @override
  void initState() {
    super.initState();
    _businessApi =
        BusinessApi(apiClient: widget.apiClient, token: widget.token);
    _searchController = TextEditingController();
  }

  @override
  void didUpdateWidget(covariant QrSalesSheetPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token) {
      _businessApi =
          BusinessApi(apiClient: widget.apiClient, token: widget.token);
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _searchOrders() async {
    final keyword = _searchController.text.trim();
    if (keyword.isEmpty) {
      setState(() {
        _searched = true;
        _orders = const <SalesOrderRecord>[];
        _selectedOrder = null;
        _salesSheet = null;
        _searchErrorMessage = '请输入订单号或客户电话。';
        _sheetErrorMessage = null;
      });
      return;
    }

    setState(() {
      _searched = true;
      _searching = true;
      _searchErrorMessage = null;
    });

    try {
      final orders = await _businessApi.listSalesOrders(
        limit: 50,
        query: keyword,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _orders = orders;
        _searching = false;
        _selectedOrder = _selectedFrom(orders, _selectedOrder?.id);
        if (_selectedOrder == null) {
          _salesSheet = null;
          _sheetErrorMessage = null;
        }
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _orders = const <SalesOrderRecord>[];
        _selectedOrder = null;
        _salesSheet = null;
        _searching = false;
        _searchErrorMessage = _messageForError(error);
      });
    }
  }

  Future<void> _selectOrder(SalesOrderRecord order) async {
    setState(() {
      _selectedOrder = order;
      _salesSheet = null;
      _loadingSheet = true;
      _sheetErrorMessage = null;
    });

    try {
      final salesSheet = await _businessApi.getSalesOrderSalesSheet(order.id);
      if (!mounted) {
        return;
      }
      setState(() {
        _salesSheet = salesSheet;
        _loadingSheet = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _loadingSheet = false;
        _sheetErrorMessage = _messageForError(error);
      });
    }
  }

  Future<void> _generateQrCode() async {
    final order = _selectedOrder;
    if (order == null || _generating || _revoking) {
      return;
    }

    setState(() {
      _generating = true;
      _sheetErrorMessage = null;
    });

    try {
      final salesSheet = await _businessApi.generateSalesOrderQrCode(
        order.id,
        expiresInDays: _expiresInDays,
        regenerate: _regenerate,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _salesSheet = salesSheet;
        _generating = false;
      });
      final messenger = ScaffoldMessenger.of(context);
      messenger.hideCurrentSnackBar();
      messenger.showSnackBar(
        SnackBar(
            content:
                Text('${salesSheet.order.orderNo ?? order.orderNo} 二维码已生成。')),
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _generating = false;
        _sheetErrorMessage = _messageForError(error);
      });
    }
  }

  Future<void> _revokeQrCode() async {
    final order = _selectedOrder;
    if (order == null || _revoking) {
      return;
    }

    setState(() {
      _revoking = true;
      _sheetErrorMessage = null;
    });
    try {
      final salesSheet =
          await _businessApi.revokeSalesOrderQrCode(order.id);
      if (!mounted) {
        return;
      }
      setState(() {
        _salesSheet = salesSheet;
        _revoking = false;
        _regenerate = false;
      });
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          const SnackBar(content: Text('二维码已吊销，旧链接立即失效。')),
        );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _revoking = false;
        _sheetErrorMessage = _messageForError(error);
      });
    }
  }

  void _copyLink() {
    final url = _salesSheet?.qrCode?.url;
    if (url == null || url.trim().isEmpty) {
      return;
    }
    unawaited(Clipboard.setData(ClipboardData(text: url)));
    if (!mounted) {
      return;
    }
    final messenger = ScaffoldMessenger.of(context);
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      const SnackBar(content: Text('公开链接已复制。')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ResponsivePage(
      maxWidth: 1360,
      children: [
        _buildHeader(),
        ResponsiveTwoColumn(
          primary: _buildPreviewPane(),
          secondary: _buildControlPane(),
          primaryFlex: 3,
          secondaryFlex: 2,
        ),
      ],
    );
  }

  Widget _buildHeader() {
    final selected = _selectedOrder;
    final url = _salesSheet?.qrCode?.url;
    final qrCodeActive = _salesSheet?.qrCode?.active ?? false;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Wrap(
          spacing: 14,
          runSpacing: 10,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            DecoratedBox(
              decoration: BoxDecoration(
                color: Theme.of(context)
                    .colorScheme
                    .primary
                    .withValues(alpha: 0.09),
                borderRadius: const BorderRadius.all(Radius.circular(8)),
              ),
              child: const Padding(
                padding: EdgeInsets.all(10),
                child: Icon(Icons.qr_code_2_rounded),
              ),
            ),
            SizedBox(
              width: 260,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '二维码销售单',
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    selected == null ? '未选择订单' : '当前订单 ${selected.orderNo}',
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                  ),
                ],
              ),
            ),
            StatusTag(
              label: _searching
                  ? '搜索中'
                  : _searched
                      ? '${_orders.length} 条结果'
                      : '待搜索',
              tone: _searching ? StatusTone.warning : StatusTone.info,
            ),
            StatusTag(
              label: url != null && url.isNotEmpty
                  ? '可扫码'
                  : qrCodeActive
                      ? '二维码已生效'
                      : '未生成二维码',
              tone: qrCodeActive ? StatusTone.success : StatusTone.neutral,
            ),
            OutlinedButton.icon(
              onPressed: selected == null || _loadingSheet
                  ? null
                  : () => _selectOrder(selected),
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('刷新预览'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildControlPane() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        FormSection(
          title: '搜索订单',
          children: [
            TextField(
              key: const ValueKey('qr-sales-search-field'),
              controller: _searchController,
              decoration: InputDecoration(
                hintText: '订单号、客户电话',
                prefixIcon: const Icon(Icons.search_rounded),
                suffixIcon: IconButton(
                  tooltip: '清空',
                  onPressed: () {
                    _searchController.clear();
                    setState(() {
                      _orders = const <SalesOrderRecord>[];
                      _selectedOrder = null;
                      _salesSheet = null;
                      _searched = false;
                      _searchErrorMessage = null;
                      _sheetErrorMessage = null;
                    });
                  },
                  icon: const Icon(Icons.close_rounded),
                ),
              ),
              textInputAction: TextInputAction.search,
              onSubmitted: (_) => _searching ? null : _searchOrders(),
            ),
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton.icon(
                key: const ValueKey('qr-sales-search-button'),
                onPressed: _searching ? null : _searchOrders,
                icon: _searching
                    ? const SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.search_rounded),
                label: Text(_searching ? '查询中' : '查询'),
              ),
            ),
            if (_searchErrorMessage != null) ...[
              const SizedBox(height: 12),
              Align(
                alignment: Alignment.centerLeft,
                child: StatusTag(
                  label: _searchErrorMessage!,
                  tone: StatusTone.danger,
                ),
              ),
            ],
          ],
        ),
        const SizedBox(height: 12),
        _SearchResultsSection(
          searched: _searched,
          loading: _searching,
          orders: _orders,
          selectedId: _selectedOrder?.id,
          onSelect: _selectOrder,
        ),
        const SizedBox(height: 12),
        _QrActionSection(
          selectedOrder: _selectedOrder,
          salesSheet: _salesSheet,
          loadingSheet: _loadingSheet,
          generating: _generating,
          revoking: _revoking,
          expiresInDays: _expiresInDays,
          regenerate: _regenerate,
          errorMessage: _sheetErrorMessage,
          onExpiresChanged: (value) => setState(() => _expiresInDays = value),
          onRegenerateChanged: (value) {
            setState(() => _regenerate = value);
          },
          onGenerate: _generateQrCode,
          onRevoke: _revokeQrCode,
          onCopyLink: _copyLink,
        ),
      ],
    );
  }

  Widget _buildPreviewPane() {
    if (_loadingSheet) {
      return const LoadingState(title: '正在加载销售单预览');
    }
    if (_sheetErrorMessage != null && _salesSheet == null) {
      return ErrorState(
        title: _sheetErrorMessage!,
        onRetry:
            _selectedOrder == null ? null : () => _selectOrder(_selectedOrder!),
      );
    }
    final sheet = _salesSheet;
    if (sheet == null) {
      return EmptyState(
        title: _selectedOrder == null ? '请选择订单' : '销售单预览待加载',
      );
    }
    return _SalesSheetPreview(
      sheet: sheet,
      onCopyLink: _copyLink,
    );
  }
}

class _SearchResultsSection extends StatelessWidget {
  const _SearchResultsSection({
    required this.searched,
    required this.loading,
    required this.orders,
    required this.selectedId,
    required this.onSelect,
  });

  final bool searched;
  final bool loading;
  final List<SalesOrderRecord> orders;
  final String? selectedId;
  final ValueChanged<SalesOrderRecord> onSelect;

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const LoadingState(title: '正在查询订单');
    }
    if (!searched) {
      return const FormSection(
        title: '搜索结果',
        children: [
          _InlineState(
            icon: Icons.manage_search_rounded,
            title: '输入条件后查询订单',
          ),
        ],
      );
    }
    if (orders.isEmpty) {
      return const EmptyState(title: '暂无匹配订单');
    }

    return FormSection(
      title: '搜索结果',
      trailing: StatusTag(label: '${orders.length} 条', tone: StatusTone.info),
      children: [
        ListView.separated(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: orders.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (context, index) {
            final order = orders[index];
            final selected = selectedId == order.id;
            return ListTile(
              key: ValueKey('qr-sales-result-${order.id}'),
              selected: selected,
              selectedTileColor:
                  Theme.of(context).colorScheme.primary.withValues(alpha: 0.08),
              leading: CircleAvatar(
                child: Icon(
                  selected
                      ? Icons.radio_button_checked_rounded
                      : Icons.receipt_long_rounded,
                  size: 20,
                ),
              ),
              title: Text(
                order.orderNo,
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
              subtitle: Padding(
                padding: const EdgeInsets.only(top: 5),
                child: Wrap(
                  spacing: 8,
                  runSpacing: 4,
                  children: [
                    Text(
                        '${_display(order.customerName)} · ${_display(order.customerPhone)}'),
                    Text(_orderTravelGroupLabel(order)),
                  ],
                ),
              ),
              trailing: MoneyText(cents: order.totalAmountCents),
              onTap: () => onSelect(order),
            );
          },
        ),
      ],
    );
  }
}

class _QrActionSection extends StatelessWidget {
  const _QrActionSection({
    required this.selectedOrder,
    required this.salesSheet,
    required this.loadingSheet,
    required this.generating,
    required this.revoking,
    required this.expiresInDays,
    required this.regenerate,
    required this.errorMessage,
    required this.onExpiresChanged,
    required this.onRegenerateChanged,
    required this.onGenerate,
    required this.onRevoke,
    required this.onCopyLink,
  });

  final SalesOrderRecord? selectedOrder;
  final SalesSheetRecord? salesSheet;
  final bool loadingSheet;
  final bool generating;
  final bool revoking;
  final int? expiresInDays;
  final bool regenerate;
  final String? errorMessage;
  final ValueChanged<int?> onExpiresChanged;
  final ValueChanged<bool> onRegenerateChanged;
  final VoidCallback onGenerate;
  final VoidCallback onRevoke;
  final VoidCallback onCopyLink;

  @override
  Widget build(BuildContext context) {
    final url = salesSheet?.qrCode?.url;
    final hasUrl = url != null && url.trim().isNotEmpty;
    final isActive = salesSheet?.qrCode?.active ?? false;
    return FormSection(
      title: '二维码操作',
      trailing: selectedOrder == null
          ? null
          : StatusTag(label: selectedOrder!.orderNo, tone: StatusTone.info),
      children: [
        if (selectedOrder == null)
          const _InlineState(
            icon: Icons.touch_app_rounded,
            title: '请选择一笔订单',
          )
        else ...[
          _ExpiryChooser(
            value: expiresInDays,
            onChanged: onExpiresChanged,
          ),
          SwitchListTile(
            key: const ValueKey('qr-sales-regenerate-switch'),
            contentPadding: EdgeInsets.zero,
            value: regenerate,
            onChanged: generating || revoking ? null : onRegenerateChanged,
            title: const Text('重新生成二维码'),
          ),
          if (errorMessage != null) ...[
            Align(
              alignment: Alignment.centerLeft,
              child: StatusTag(label: errorMessage!, tone: StatusTone.danger),
            ),
            const SizedBox(height: 12),
          ],
          Wrap(
            spacing: 10,
            runSpacing: 10,
            alignment: WrapAlignment.end,
            children: [
              OutlinedButton.icon(
                key: const ValueKey('qr-sales-copy-link-button'),
                onPressed: hasUrl ? onCopyLink : null,
                icon: const Icon(Icons.copy_rounded),
                label: const Text('复制链接'),
              ),
              OutlinedButton.icon(
                key: const ValueKey('qr-sales-revoke-button'),
                onPressed:
                    isActive && !generating && !revoking ? onRevoke : null,
                icon: revoking
                    ? const SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.link_off_rounded),
                label: Text(revoking ? '吊销中' : '吊销二维码'),
              ),
              FilledButton.icon(
                key: const ValueKey('qr-sales-generate-button'),
                onPressed: loadingSheet || generating || revoking
                    ? null
                    : onGenerate,
                icon: generating
                    ? const SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.qr_code_2_rounded),
                label: Text(generating ? '生成中' : '生成二维码'),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            hasUrl
                ? '请客户拍照保存销售单和二维码。'
                : isActive
                    ? '二维码仍有效；Bearer 链接不会被再次显示，可选择吊销或显式重新生成。'
                    : '生成后可复制公开链接。',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
          ),
        ],
      ],
    );
  }
}

class _ExpiryChooser extends StatelessWidget {
  const _ExpiryChooser({
    required this.value,
    required this.onChanged,
  });

  final int? value;
  final ValueChanged<int?> onChanged;

  @override
  Widget build(BuildContext context) {
    const options = <MapEntry<int?, String>>[
      MapEntry(7, '7 天'),
      MapEntry(30, '30 天'),
      MapEntry(90, '90 天'),
    ];
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final option in options)
          ChoiceChip(
            key: ValueKey('qr-sales-expiry-${option.key ?? 'none'}'),
            selected: value == option.key,
            label: Text(option.value),
            onSelected: (_) => onChanged(option.key),
          ),
      ],
    );
  }
}

class _SalesSheetPreview extends StatelessWidget {
  const _SalesSheetPreview({
    required this.sheet,
    required this.onCopyLink,
  });

  final SalesSheetRecord sheet;
  final VoidCallback onCopyLink;

  @override
  Widget build(BuildContext context) {
    final qrCode = sheet.qrCode;
    final url = qrCode?.url;
    final hasUrl = url != null && url.trim().isNotEmpty;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
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
                        '${_display(sheet.companyName)}销售单',
                        style: Theme.of(context)
                            .textTheme
                            .headlineSmall
                            ?.copyWith(fontWeight: FontWeight.w900),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        _display(sheet.order.orderNo),
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                    ],
                  ),
                ),
                StatusTag(
                  label: hasUrl ? '可扫码' : '未生成二维码',
                  tone: hasUrl ? StatusTone.success : StatusTone.neutral,
                ),
              ],
            ),
            const SizedBox(height: 16),
            ResponsiveTwoColumn(
              breakpoint: 760,
              primary: _SalesSheetCoreInfo(sheet: sheet),
              secondary: _QrPanel(
                qrCode: qrCode,
                onCopyLink: onCopyLink,
              ),
            ),
            const Divider(height: 28),
            const _SectionTitle('明细'),
            if (sheet.items.isEmpty)
              const Text('暂无订单明细')
            else
              for (final item in _sortedItems(sheet.items))
                _SalesSheetItemLine(item: item),
            const Divider(height: 28),
            const _SectionTitle('物流与开票'),
            _InfoRow(label: '配送', value: _display(sheet.delivery.summaryLabel)),
            _InfoRow(label: '物流方式', value: _display(sheet.logistics.method)),
            _InfoRow(
                label: '物流单号', value: _display(sheet.logistics.logisticsNo)),
            _InfoRow(label: '开票状态', value: _invoiceLabel(sheet.invoice)),
            _InfoRow(label: '二维码有效期', value: _expiresLabel(qrCode)),
          ],
        ),
      ),
    );
  }
}

class _SalesSheetCoreInfo extends StatelessWidget {
  const _SalesSheetCoreInfo({required this.sheet});

  final SalesSheetRecord sheet;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _SectionTitle('核心信息'),
        _InfoRow(label: '系统单号', value: _display(sheet.order.orderNo)),
        _InfoRow(label: '订单日期', value: _display(sheet.order.orderDate)),
        _InfoRow(label: '订单状态', value: _statusLabel(sheet.status)),
        _InfoRow(label: '客户', value: _customerLabel(sheet.customer)),
        _InfoRow(label: '旅行团', value: _travelGroupLabel(sheet.travelGroup)),
        _InfoRow(label: '销售', value: _salesUserLabel(sheet.salesUser)),
        const SizedBox(height: 8),
        Row(
          children: [
            const Expanded(child: Text('订单总额')),
            MoneyText(cents: sheet.amounts.totalAmountCents, prominent: true),
          ],
        ),
        const SizedBox(height: 6),
        Row(
          children: [
            const Expanded(child: Text('货到付款')),
            MoneyText(cents: sheet.amounts.cashOnDeliveryAmountCents),
          ],
        ),
      ],
    );
  }
}

class _QrPanel extends StatelessWidget {
  const _QrPanel({
    required this.qrCode,
    required this.onCopyLink,
  });

  final SalesSheetQrCode? qrCode;
  final VoidCallback onCopyLink;

  @override
  Widget build(BuildContext context) {
    final url = qrCode?.url;
    final hasUrl = url != null && url.trim().isNotEmpty;
    final localUrl = hasUrl && _isLocalhostUrl(url);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        DecoratedBox(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: const BorderRadius.all(Radius.circular(8)),
            border: Border.all(color: Theme.of(context).dividerColor),
          ),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: AspectRatio(
              aspectRatio: 1,
              child: Center(
                child: hasUrl
                    ? QrImageView(
                        data: url,
                        version: QrVersions.auto,
                        errorCorrectionLevel: QrErrorCorrectLevel.M,
                        backgroundColor: Colors.white,
                      )
                    : Icon(
                        Icons.qr_code_2_rounded,
                        size: 96,
                        color: Theme.of(context)
                            .colorScheme
                            .primary
                            .withValues(alpha: 0.45),
                      ),
              ),
            ),
          ),
        ),
        const SizedBox(height: 12),
        const _SectionTitle('公开链接'),
        SelectableText(
          hasUrl ? url : '生成二维码后显示',
          style: TextStyle(
            fontWeight: FontWeight.w700,
            color: hasUrl
                ? Theme.of(context).colorScheme.primary
                : Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
        if (localUrl) ...[
          const SizedBox(height: 10),
          const StatusTag(
            label: '当前二维码链接为本机地址，手机无法直接打开，请配置 PUBLIC_SALES_SHEET_BASE_URL 为公网地址。',
            tone: StatusTone.warning,
          ),
        ],
        const SizedBox(height: 10),
        OutlinedButton.icon(
          onPressed: hasUrl ? onCopyLink : null,
          icon: const Icon(Icons.copy_rounded),
          label: const Text('复制链接'),
        ),
      ],
    );
  }
}

class _SalesSheetItemLine extends StatelessWidget {
  const _SalesSheetItemLine({required this.item});

  final SalesSheetItemRecord item;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: DecoratedBox(
        decoration: BoxDecoration(
          border:
              Border.all(color: Theme.of(context).colorScheme.outlineVariant),
          borderRadius: const BorderRadius.all(Radius.circular(8)),
        ),
        child: Padding(
          padding: const EdgeInsets.all(10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      _display(item.productName),
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                  ),
                  StatusTag(
                    label: _display(item.deliveryTypeLabel),
                    tone: StatusTone.neutral,
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Wrap(
                spacing: 12,
                runSpacing: 6,
                children: [
                  Text('数量 x${item.quantity}'),
                  Text('单价 ${formatMoneyCents(item.unitPriceCents)}'),
                  Text('小计 ${formatMoneyCents(item.subtotalCents)}'),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _InlineState extends StatelessWidget {
  const _InlineState({
    required this.icon,
    required this.title,
  });

  final IconData icon;
  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 34, color: Theme.of(context).colorScheme.primary),
          const SizedBox(height: 12),
          Text(
            title,
            textAlign: TextAlign.center,
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.title);

  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        title,
        style: Theme.of(context)
            .textTheme
            .titleSmall
            ?.copyWith(fontWeight: FontWeight.w800),
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({
    required this.label,
    required this.value,
  });

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 86,
            child: Text(label, style: Theme.of(context).textTheme.bodySmall),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }
}

SalesOrderRecord? _selectedFrom(List<SalesOrderRecord> orders, String? id) {
  if (id != null) {
    for (final order in orders) {
      if (order.id == id) {
        return order;
      }
    }
  }
  return null;
}

List<SalesSheetItemRecord> _sortedItems(List<SalesSheetItemRecord> items) {
  return [...items]..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
}

String _orderTravelGroupLabel(SalesOrderRecord order) {
  final group = order.travelGroup;
  if (group == null) {
    return order.travelGroupId == null ? '无旅行团' : order.travelGroupId!;
  }
  final agency = group.travelAgency?.trim();
  if (agency == null || agency.isEmpty) {
    return group.groupNo;
  }
  return '${group.groupNo} · $agency';
}

String _customerLabel(SalesSheetCustomerRecord customer) {
  final name = _display(customer.name);
  final phone = customer.phoneMasked ?? customer.phone;
  return '$name · ${_display(phone)}';
}

String _travelGroupLabel(SalesSheetTravelGroupRecord? group) {
  if (group == null) {
    return '无旅行团';
  }
  final parts = [
    group.groupNo,
    group.travelAgency,
    group.guideName,
    group.tasterName,
  ].whereType<String>().where((part) => part.trim().isNotEmpty).toList();
  return parts.isEmpty ? '无旅行团' : parts.join(' · ');
}

String _salesUserLabel(SalesSheetSalesUserRecord? salesUser) {
  if (salesUser == null) {
    return '未填写';
  }
  return _display(salesUser.name ?? salesUser.username);
}

String _statusLabel(SalesSheetStatusRecord status) {
  return _display(status.label ?? status.value);
}

String _invoiceLabel(SalesSheetInvoiceRecord invoice) {
  final required =
      invoice.requiredLabel ?? (invoice.required ? '需要开票' : '无需开票');
  final issued = invoice.issuedLabel ?? (invoice.issued ? '已开票' : '未开票');
  return '$required · $issued';
}

String _expiresLabel(SalesSheetQrCode? qrCode) {
  if (qrCode == null) {
    return '未生成';
  }
  if (_hasText(qrCode.revokedAt)) {
    return '已吊销';
  }
  final expiresAt = qrCode.expiresAt?.trim();
  if (expiresAt == null || expiresAt.isEmpty) {
    return '有效期配置异常';
  }
  return expiresAt;
}

String _display(String? value) {
  final text = value?.trim() ?? '';
  return text.isEmpty ? '未填写' : text;
}

bool _hasText(String? value) {
  return value != null && value.trim().isNotEmpty;
}

bool _isLocalhostUrl(String value) {
  final uri = Uri.tryParse(value.trim());
  final host = uri?.host.toLowerCase() ?? '';
  if (host == 'localhost' ||
      host == '::1' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local')) {
    return true;
  }
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) {
    return true;
  }
  final octets = host.split('.').map(int.tryParse).toList();
  if (octets.length != 4 || octets.any((part) => part == null)) {
    return false;
  }
  final a = octets[0]!;
  final b = octets[1]!;
  return a == 0 ||
      a == 10 ||
      a == 127 ||
      (a == 169 && b == 254) ||
      (a == 172 && b >= 16 && b <= 31) ||
      (a == 192 && b == 168) ||
      (a == 100 && b >= 64 && b <= 127) ||
      (a == 198 && (b == 18 || b == 19));
}

String _messageForError(Object error) {
  if (error is ApiException) {
    return error.message;
  }
  return '操作失败，请稍后重试。';
}
