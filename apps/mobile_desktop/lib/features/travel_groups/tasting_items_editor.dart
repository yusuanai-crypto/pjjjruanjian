import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class TastingItemDraft {
  const TastingItemDraft({
    this.productName = '',
    this.quantity = 1,
    this.unit = '',
    this.note,
  });

  final String productName;
  final int quantity;
  final String unit;
  final String? note;
}

class TastingItemsEditor extends StatefulWidget {
  const TastingItemsEditor({
    super.key,
    this.initialItems = const <TastingItemDraft>[],
    required this.onChanged,
  });

  final List<TastingItemDraft> initialItems;
  final ValueChanged<List<Map<String, dynamic>>> onChanged;

  @override
  State<TastingItemsEditor> createState() => TastingItemsEditorState();
}

class TastingItemsEditorState extends State<TastingItemsEditor> {
  final _formKey = GlobalKey<FormState>();
  final List<_TastingItemRowState> _rows = <_TastingItemRowState>[];

  List<Map<String, dynamic>> get tastingItems {
    return [
      for (var index = 0; index < _rows.length; index += 1)
        {
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
  }

  @override
  void didUpdateWidget(covariant TastingItemsEditor oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.initialItems != widget.initialItems) {
      _replaceRows(widget.initialItems);
      _notifyChanged();
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
          Align(
            alignment: Alignment.centerLeft,
            child: FilledButton.icon(
              key: const ValueKey('tasting_items_add'),
              onPressed: _addRow,
              icon: const Icon(Icons.add_rounded),
              label: const Text('新增酒品'),
            ),
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
  });

  final int index;
  final _TastingItemRowState row;
  final VoidCallback onChanged;
  final VoidCallback onDelete;

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
            Widget productField() => TextFormField(
                  key: ValueKey('tasting_product_$index'),
                  controller: row.productNameController,
                  decoration: const InputDecoration(labelText: '酒品'),
                  textInputAction: TextInputAction.next,
                  validator: _requiredValidator('酒品不能为空'),
                  onChanged: (_) => onChanged(),
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
            Widget unitField() => TextFormField(
                  key: ValueKey('tasting_unit_$index'),
                  controller: row.unitController,
                  decoration: const InputDecoration(labelText: '单位'),
                  textInputAction: TextInputAction.next,
                  validator: _requiredValidator('单位不能为空'),
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
                  unitField(),
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
                Expanded(child: unitField()),
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
    required String productName,
    required int quantity,
    required String unit,
    required String? note,
  })  : productNameController = TextEditingController(text: productName),
        quantityController = TextEditingController(
          text: quantity > 0 ? '$quantity' : '',
        ),
        unitController = TextEditingController(text: unit),
        noteController = TextEditingController(text: note ?? '');

  factory _TastingItemRowState.empty() {
    return _TastingItemRowState(
      productName: '',
      quantity: 1,
      unit: '',
      note: null,
    );
  }

  factory _TastingItemRowState.fromDraft(TastingItemDraft item) {
    return _TastingItemRowState(
      productName: item.productName,
      quantity: item.quantity,
      unit: item.unit,
      note: item.note,
    );
  }

  final TextEditingController productNameController;
  final TextEditingController quantityController;
  final TextEditingController unitController;
  final TextEditingController noteController;

  String get productName => productNameController.text.trim();

  int get quantity => int.tryParse(quantityController.text.trim()) ?? 0;

  String get unit => unitController.text.trim();

  String? get note {
    final text = noteController.text.trim();
    return text.isEmpty ? null : text;
  }

  void dispose() {
    productNameController.dispose();
    quantityController.dispose();
    unitController.dispose();
    noteController.dispose();
  }
}

FormFieldValidator<String> _requiredValidator(String message) {
  return (value) {
    if (value == null || value.trim().isEmpty) {
      return message;
    }
    return null;
  };
}

String? _quantityValidator(String? value) {
  final quantity = int.tryParse((value ?? '').trim()) ?? 0;
  if (quantity <= 0) {
    return '数量必须大于 0';
  }
  return null;
}
