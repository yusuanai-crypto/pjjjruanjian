import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/business/business_api.dart';
import '../../shared/widgets/product_option_picker.dart';

class TastingItemDraft {
  const TastingItemDraft({
    this.productId,
    this.productName = '',
    this.quantity = 1,
    this.unit = '',
    this.note,
  });

  final String? productId;
  final String productName;
  final int quantity;
  final String unit;
  final String? note;
}

class TastingItemsEditor extends StatefulWidget {
  const TastingItemsEditor({
    super.key,
    this.initialItems = const <TastingItemDraft>[],
    required this.businessApi,
    required this.onChanged,
  });

  final List<TastingItemDraft> initialItems;
  final BusinessApi businessApi;
  final ValueChanged<List<Map<String, dynamic>>> onChanged;

  @override
  State<TastingItemsEditor> createState() => TastingItemsEditorState();
}

class TastingItemsEditorState extends State<TastingItemsEditor> {
  final _formKey = GlobalKey<FormState>();
  final List<_TastingItemRowState> _rows = <_TastingItemRowState>[];
  List<ProductOptionRecord> _productOptions = const [];
  bool _loadingProductOptions = true;
  String? _productOptionsError;

  List<Map<String, dynamic>> get tastingItems {
    return [
      for (var index = 0; index < _rows.length; index += 1)
        {
          'productId': _rows[index].productId,
          'productName': _rows[index].productName,
          'quantity': _rows[index].quantity,
          'unit': _rows[index].unit,
          'note': _rows[index].note,
          'sortOrder': index + 1,
        },
    ];
  }

  bool validate() => _formKey.currentState?.validate() ?? false;

  void clear() {
    setState(() {
      for (final row in _rows) {
        row.dispose();
      }
      _rows.clear();
    });
    _notifyChanged();
  }

  @override
  void initState() {
    super.initState();
    for (final item in widget.initialItems) {
      _rows.add(_TastingItemRowState.fromDraft(item));
    }
    _loadProductOptions();
  }

  @override
  void didUpdateWidget(covariant TastingItemsEditor oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.initialItems != widget.initialItems) {
      _replaceRows(widget.initialItems);
      _notifyChanged();
    }
    if (oldWidget.businessApi != widget.businessApi) {
      _loadProductOptions();
    }
  }

  Future<void> _loadProductOptions() async {
    setState(() {
      _loadingProductOptions = true;
      _productOptionsError = null;
    });
    try {
      final options = await widget.businessApi.listProductOptions();
      if (!mounted) return;
      setState(() {
        _productOptions = options;
        _loadingProductOptions = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _productOptions = const [];
        _loadingProductOptions = false;
        _productOptionsError = error.toString();
      });
    }
  }

  @override
  void dispose() {
    for (final row in _rows) {
      row.dispose();
    }
    super.dispose();
  }

  void _replaceRows(List<TastingItemDraft> items) {
    for (final row in _rows) {
      row.dispose();
    }
    _rows
      ..clear()
      ..addAll(items.map(_TastingItemRowState.fromDraft));
  }

  void _addRow() {
    setState(() {
      _rows.add(_TastingItemRowState.empty());
    });
    _notifyChanged();
  }

  void _addCannedWineRow() {
    setState(() {
      _rows.add(_TastingItemRowState.cannedWine());
    });
    _notifyChanged();
  }

  void _deleteRow(int index) {
    setState(() {
      final row = _rows.removeAt(index);
      row.dispose();
    });
    _notifyChanged();
  }

  void _notifyChanged() {
    widget.onChanged(tastingItems);
  }

  @override
  Widget build(BuildContext context) {
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              FilledButton.icon(
                key: const ValueKey('tasting_items_add'),
                onPressed: _addRow,
                icon: const Icon(Icons.add_rounded),
                label: const Text('新增酒品'),
              ),
              OutlinedButton.icon(
                key: const ValueKey('tasting_items_add_canned_wine'),
                onPressed: _addCannedWineRow,
                icon: const Icon(Icons.local_drink_rounded),
                label: const Text('新增罐装酒（瓶）'),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (_rows.isEmpty)
            const _EmptyTastingItems()
          else
            for (var index = 0; index < _rows.length; index += 1) ...[
              _TastingItemRow(
                index: index,
                row: _rows[index],
                onChanged: _notifyChanged,
                onDelete: () => _deleteRow(index),
                productOptions: _productOptions,
                loadingProductOptions: _loadingProductOptions,
                productOptionsError: _productOptionsError,
                onRetryProductOptions: _loadProductOptions,
                onProductChanged: (product) {
                  setState(() => _rows[index].selectProduct(product));
                  _notifyChanged();
                },
              ),
              if (index != _rows.length - 1) const SizedBox(height: 12),
            ],
        ],
      ),
    );
  }
}

class _EmptyTastingItems extends StatelessWidget {
  const _EmptyTastingItems();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border.all(color: theme.colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Text(
          '暂无品酒明细',
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      ),
    );
  }
}

class _TastingItemRow extends StatelessWidget {
  const _TastingItemRow({
    required this.index,
    required this.row,
    required this.onChanged,
    required this.onDelete,
    required this.productOptions,
    required this.loadingProductOptions,
    required this.productOptionsError,
    required this.onRetryProductOptions,
    required this.onProductChanged,
  });

  final int index;
  final _TastingItemRowState row;
  final VoidCallback onChanged;
  final VoidCallback onDelete;
  final List<ProductOptionRecord> productOptions;
  final bool loadingProductOptions;
  final String? productOptionsError;
  final VoidCallback onRetryProductOptions;
  final ValueChanged<ProductOptionRecord> onProductChanged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border.all(color: theme.colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: LayoutBuilder(
          builder: (context, constraints) {
            final compact = constraints.maxWidth < 640;
            Widget productField() => ProductOptionPickerField(
                  key: ValueKey('tasting_product_$index'),
                  options: productOptions,
                  loading: loadingProductOptions,
                  loadError: productOptionsError,
                  productId: row.productId,
                  snapshotName: row.productName,
                  snapshotUnit: row.unit,
                  allowSnapshotWithoutProductId:
                      row.productId == null && row.productName == '罐装酒',
                  onRetry: onRetryProductOptions,
                  onChanged: onProductChanged,
                );
            Widget quantityField() => TextFormField(
                  key: ValueKey('tasting_quantity_$index'),
                  controller: row.quantityController,
                  decoration: const InputDecoration(labelText: '数量'),
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  textInputAction: TextInputAction.next,
                  validator: _quantityValidator,
                  onChanged: (_) => onChanged(),
                );
            Widget noteField() => TextFormField(
                  key: ValueKey('tasting_note_$index'),
                  controller: row.noteController,
                  decoration: const InputDecoration(labelText: '备注'),
                  onChanged: (_) => onChanged(),
                );

            final deleteButton = IconButton(
              key: ValueKey('tasting_delete_$index'),
              tooltip: '删除酒品',
              onPressed: onDelete,
              icon: const Icon(Icons.delete_outline_rounded),
            );

            if (compact) {
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          '品酒明细 ${index + 1}',
                          style: theme.textTheme.titleSmall,
                        ),
                      ),
                      deleteButton,
                    ],
                  ),
                  const SizedBox(height: 8),
                  productField(),
                  const SizedBox(height: 8),
                  quantityField(),
                  const SizedBox(height: 8),
                  noteField(),
                ],
              );
            }

            return Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(flex: 3, child: productField()),
                const SizedBox(width: 12),
                Expanded(child: quantityField()),
                const SizedBox(width: 12),
                Expanded(flex: 2, child: noteField()),
                const SizedBox(width: 12),
                deleteButton,
              ],
            );
          },
        ),
      ),
    );
  }
}

class _TastingItemRowState {
  _TastingItemRowState({
    required this.productId,
    required this.productName,
    required int quantity,
    required this.unit,
    required String? note,
  })  : quantityController = TextEditingController(
          text: quantity > 0 ? '$quantity' : '',
        ),
        noteController = TextEditingController(text: note ?? '');

  factory _TastingItemRowState.empty() {
    return _TastingItemRowState(
      productName: '',
      productId: null,
      quantity: 1,
      unit: '',
      note: null,
    );
  }

  factory _TastingItemRowState.cannedWine() {
    return _TastingItemRowState(
      productName: '罐装酒',
      productId: null,
      quantity: 1,
      unit: '瓶',
      note: null,
    );
  }

  factory _TastingItemRowState.fromDraft(TastingItemDraft item) {
    return _TastingItemRowState(
      productName: item.productName,
      productId: item.productId,
      quantity: item.quantity,
      unit: item.unit,
      note: item.note,
    );
  }

  String? productId;
  String productName;
  String unit;
  final TextEditingController quantityController;
  final TextEditingController noteController;

  int get quantity => int.tryParse(quantityController.text.trim()) ?? 0;

  void selectProduct(ProductOptionRecord product) {
    productId = product.id;
    productName = product.name;
    unit = product.unit;
  }

  String? get note {
    final text = noteController.text.trim();
    return text.isEmpty ? null : text;
  }

  void dispose() {
    quantityController.dispose();
    noteController.dispose();
  }
}

String? _quantityValidator(String? value) {
  final quantity = int.tryParse((value ?? '').trim()) ?? 0;
  if (quantity <= 0) {
    return '数量必须大于 0';
  }
  return null;
}
