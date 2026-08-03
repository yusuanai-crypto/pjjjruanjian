import 'package:flutter/material.dart';

import '../../core/business/business_api.dart';

class ProductOptionPickerField extends StatelessWidget {
  const ProductOptionPickerField({
    super.key,
    required this.options,
    required this.loading,
    required this.loadError,
    required this.productId,
    required this.snapshotName,
    required this.snapshotUnit,
    required this.onChanged,
    this.onRetry,
    this.enabled = true,
    this.label = '商品',
    this.allowSnapshotWithoutProductId = false,
    this.emptyMessage,
  });

  final List<ProductOptionRecord> options;
  final bool loading;
  final String? loadError;
  final String? productId;
  final String? snapshotName;
  final String? snapshotUnit;
  final ValueChanged<ProductOptionRecord> onChanged;
  final VoidCallback? onRetry;
  final bool enabled;
  final String label;
  final bool allowSnapshotWithoutProductId;
  final String? emptyMessage;

  ProductOptionRecord? get _activeSelection {
    for (final option in options) {
      if (option.id == productId) return option;
    }
    return null;
  }

  bool get _hasSnapshot => (snapshotName ?? '').trim().isNotEmpty;

  @override
  Widget build(BuildContext context) {
    final activeSelection = _activeSelection;
    final historicalId = (productId ?? '').trim();
    final missingAssociation = historicalId.isEmpty && _hasSnapshot;
    final inactiveHistorical =
        historicalId.isNotEmpty && activeSelection == null;
    final canOpen =
        enabled && !loading && loadError == null && options.isNotEmpty;

    String displayText;
    if (activeSelection != null) {
      displayText = activeSelection.label;
    } else if (_hasSnapshot) {
      displayText = _snapshotLabel(snapshotName, snapshotUnit);
    } else {
      displayText = '请选择启用商品';
    }

    late String helperText;
    Color? helperColor;
    if (loading) {
      helperText = '正在加载启用商品...';
    } else if (loadError != null) {
      helperText = '商品选项加载失败：$loadError';
      helperColor = Theme.of(context).colorScheme.error;
    } else if (options.isEmpty) {
      helperText = emptyMessage ?? '暂无启用商品，无法新增或更换商品。';
      helperColor = Theme.of(context).colorScheme.error;
    } else if (missingAssociation && allowSnapshotWithoutProductId) {
      helperText = '内置损耗项，无需关联商品档案。';
    } else if (missingAssociation) {
      helperText = '历史记录缺少 productId，原快照仅供展示，请重新选择。';
      helperColor = Theme.of(context).colorScheme.error;
    } else if (inactiveHistorical) {
      helperText = '原商品已停用，历史快照仍保留；如需更换只能选择启用商品。';
      helperColor = const Color(0xFF8A5B00);
    } else {
      helperText = '仅显示启用商品，选项不包含任何成本信息。';
    }

    return FormField<String>(
      initialValue: productId,
      validator: (_) {
        if (loading) return '请等待商品选项加载完成';
        if (loadError != null) return '商品选项加载失败';
        if ((productId ?? '').trim().isEmpty &&
            !(allowSnapshotWithoutProductId && _hasSnapshot)) {
          return '请选择商品';
        }
        if (options.isEmpty && !_hasSnapshot) {
          return emptyMessage ?? '暂无可选的启用商品';
        }
        return null;
      },
      builder: (field) {
        Future<void> openPicker() async {
          final selected = await showDialog<ProductOptionRecord>(
            context: context,
            builder: (context) => _ProductOptionDialog(
              options: options,
              selectedId: productId,
            ),
          );
          if (selected != null) {
            field.didChange(selected.id);
            onChanged(selected);
          }
        }

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            InkWell(
              onTap: canOpen ? openPicker : null,
              borderRadius: BorderRadius.circular(4),
              child: InputDecorator(
                decoration: InputDecoration(
                  labelText: label,
                  errorText: field.errorText,
                  suffixIcon: loading
                      ? const Padding(
                          padding: EdgeInsets.all(14),
                          child: SizedBox.square(
                            dimension: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                        )
                      : const Icon(Icons.search_rounded),
                ),
                child: Text(
                  displayText,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ),
            const SizedBox(height: 5),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    helperText,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: helperColor ??
                              Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                  ),
                ),
                if (loadError != null && onRetry != null)
                  TextButton(
                    key: const ValueKey('product-options-retry'),
                    onPressed: onRetry!,
                    child: const Text('重试'),
                  ),
              ],
            ),
          ],
        );
      },
    );
  }
}

class _ProductOptionDialog extends StatefulWidget {
  const _ProductOptionDialog({
    required this.options,
    required this.selectedId,
  });

  final List<ProductOptionRecord> options;
  final String? selectedId;

  @override
  State<_ProductOptionDialog> createState() => _ProductOptionDialogState();
}

class _ProductOptionDialogState extends State<_ProductOptionDialog> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final query = _query.trim().toLowerCase();
    final visible = widget.options.where((option) {
      if (query.isEmpty) return true;
      return option.name.toLowerCase().contains(query) ||
          option.unit.toLowerCase().contains(query);
    }).toList();

    return AlertDialog(
      title: const Text('选择商品'),
      content: SizedBox(
        width: 520,
        height: 480,
        child: Column(
          children: [
            TextField(
              key: const ValueKey('product-option-search-field'),
              autofocus: true,
              decoration: const InputDecoration(
                hintText: '搜索商品名称或单位',
                prefixIcon: Icon(Icons.search_rounded),
              ),
              onChanged: (value) => setState(() => _query = value),
            ),
            const SizedBox(height: 12),
            Expanded(
              child: visible.isEmpty
                  ? const Center(child: Text('没有匹配的启用商品。'))
                  : ListView.builder(
                      itemCount: visible.length,
                      itemBuilder: (context, index) {
                        final option = visible[index];
                        return ListTile(
                          key: ValueKey('product-option-${option.id}'),
                          selected: option.id == widget.selectedId,
                          leading: const Icon(Icons.inventory_2_outlined),
                          title: Text(option.name),
                          subtitle: Text('单位：${option.unit}'),
                          trailing: option.id == widget.selectedId
                              ? const Icon(Icons.check_rounded)
                              : null,
                          onTap: () => Navigator.pop(context, option),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('取消'),
        ),
      ],
    );
  }
}

String _snapshotLabel(String? name, String? unit) {
  final cleanName = (name ?? '').trim();
  final cleanUnit = (unit ?? '').trim();
  return cleanUnit.isEmpty ? cleanName : '$cleanName · $cleanUnit';
}
