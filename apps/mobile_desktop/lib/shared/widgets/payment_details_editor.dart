import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/business/business_api.dart';
import 'money_text.dart';

class PaymentDetailDraft {
  PaymentDetailDraft({
    this.id,
    required this.paymentMethodId,
    required int amountCents,
    this.paymentMethodNameSnapshot,
    this.paymentMethodCategorySnapshot,
  }) : amountController = TextEditingController(
          text: moneyInputText(amountCents),
        );

  factory PaymentDetailDraft.fromRecord(
    SalesOrderPaymentDetailRecord record,
  ) {
    return PaymentDetailDraft(
      id: record.id,
      paymentMethodId: record.paymentMethodId,
      amountCents: record.amountCents,
      paymentMethodNameSnapshot: record.paymentMethodNameSnapshot,
      paymentMethodCategorySnapshot: record.paymentMethodCategorySnapshot,
    );
  }

  final String? id;
  String paymentMethodId;
  final TextEditingController amountController;
  final String? paymentMethodNameSnapshot;
  final String? paymentMethodCategorySnapshot;

  int? get amountCents => moneyCentsOrNull(amountController.text);

  Map<String, dynamic>? toPayload() {
    final cents = amountCents;
    if (cents == null || paymentMethodId.trim().isEmpty) {
      return null;
    }
    return {
      if (id != null && id!.trim().isNotEmpty) 'id': id,
      'paymentMethodId': paymentMethodId,
      'amountCents': cents,
    };
  }

  void setAmountCents(int value) {
    amountController.text = moneyInputText(value);
  }

  void dispose() => amountController.dispose();
}

class PaymentDetailsEditor extends StatelessWidget {
  const PaymentDetailsEditor({
    super.key,
    required this.methods,
    required this.details,
    required this.totalAmountCents,
    required this.onAdd,
    required this.onRemove,
    required this.onMove,
    required this.onChanged,
    this.loading = false,
    this.errorMessage,
    this.onRetry,
    this.locked = false,
  });

  final List<SalesPaymentMethodRecord> methods;
  final List<PaymentDetailDraft> details;
  final int totalAmountCents;
  final VoidCallback onAdd;
  final ValueChanged<int> onRemove;
  final void Function(int fromIndex, int toIndex) onMove;
  final VoidCallback onChanged;
  final bool loading;
  final String? errorMessage;
  final VoidCallback? onRetry;
  final bool locked;

  @override
  Widget build(BuildContext context) {
    final sum = details.fold<int>(
      0,
      (value, detail) => value + (detail.amountCents ?? 0),
    );
    final difference = sum - totalAmountCents;
    final hasInvalidDetail = details.isEmpty ||
        details.any(
          (detail) =>
              detail.paymentMethodId.trim().isEmpty ||
              detail.amountCents == null,
        );
    final isBalanced = !hasInvalidDetail && difference == 0;
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border.all(
          color: isBalanced
              ? Theme.of(context).colorScheme.outlineVariant
              : Theme.of(context).colorScheme.error,
        ),
        borderRadius: const BorderRadius.all(Radius.circular(8)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    locked ? '收款明细（已锁定）' : '收款明细',
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                ),
                TextButton.icon(
                  key: const ValueKey('payment-detail-add-button'),
                  onPressed:
                      locked || loading || methods.isEmpty ? null : onAdd,
                  icon: const Icon(Icons.add_rounded),
                  label: const Text('添加收款'),
                ),
              ],
            ),
            if (loading) const LinearProgressIndicator(),
            if (errorMessage != null) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      errorMessage!,
                      key: const ValueKey('payment-methods-error'),
                      style:
                          TextStyle(color: Theme.of(context).colorScheme.error),
                    ),
                  ),
                  if (onRetry != null)
                    OutlinedButton.icon(
                      key: const ValueKey('payment-methods-retry-button'),
                      onPressed: loading ? null : onRetry,
                      icon: const Icon(Icons.refresh_rounded),
                      label: const Text('重试'),
                    ),
                ],
              ),
            ],
            if (details.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Text('至少需要一条收款明细。'),
              )
            else
              for (var index = 0; index < details.length; index += 1) ...[
                if (index > 0) const Divider(height: 20),
                _PaymentDetailRow(
                  key: ObjectKey(details[index]),
                  index: index,
                  methods: methods,
                  detail: details[index],
                  locked: locked,
                  canMoveUp: index > 0,
                  canMoveDown: index < details.length - 1,
                  onRemove: () => onRemove(index),
                  onMoveUp: () => onMove(index, index - 1),
                  onMoveDown: () => onMove(index, index + 1),
                  onChanged: onChanged,
                ),
              ],
            const Divider(height: 22),
            Wrap(
              spacing: 18,
              runSpacing: 6,
              children: [
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text('明细合计：'),
                    MoneyText(cents: sum),
                  ],
                ),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text('订单总额：'),
                    MoneyText(cents: totalAmountCents),
                  ],
                ),
                if (hasInvalidDetail)
                  Text(
                    '存在无效明细，不能提交',
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                      fontWeight: FontWeight.w700,
                    ),
                  )
                else if (difference == 0)
                  Text(
                    '金额一致',
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.primary,
                      fontWeight: FontWeight.w700,
                    ),
                  )
                else
                  Row(
                    key: const ValueKey('payment-detail-difference'),
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        '差额（明细合计 - 订单总额）：',
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      MoneyText(cents: difference),
                    ],
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _PaymentDetailRow extends StatelessWidget {
  const _PaymentDetailRow({
    super.key,
    required this.index,
    required this.methods,
    required this.detail,
    required this.locked,
    required this.canMoveUp,
    required this.canMoveDown,
    required this.onRemove,
    required this.onMoveUp,
    required this.onMoveDown,
    required this.onChanged,
  });

  final int index;
  final List<SalesPaymentMethodRecord> methods;
  final PaymentDetailDraft detail;
  final bool locked;
  final bool canMoveUp;
  final bool canMoveDown;
  final VoidCallback onRemove;
  final VoidCallback onMoveUp;
  final VoidCallback onMoveDown;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final availableMethods = [...methods];
    if (!availableMethods.any(
      (method) => method.id == detail.paymentMethodId,
    )) {
      availableMethods.add(
        SalesPaymentMethodRecord(
          id: detail.paymentMethodId,
          code: 'historical',
          name: detail.paymentMethodNameSnapshot ?? '历史收款方式',
          category: detail.paymentMethodCategorySnapshot ?? 'direct_receipt',
          isActive: false,
          sortOrder: 999999,
          isDefault: false,
        ),
      );
    }
    final methodField = DropdownButtonFormField<String>(
      key: ValueKey('payment-detail-method-$index'),
      initialValue: detail.paymentMethodId,
      isExpanded: true,
      decoration: const InputDecoration(labelText: '收款方式'),
      items: [
        for (final method in availableMethods)
          DropdownMenuItem(
            value: method.id,
            child: Text(
              method.isActive ? method.name : '${method.name}（已停用）',
            ),
          ),
      ],
      onChanged: locked
          ? null
          : (value) {
              if (value != null) {
                detail.paymentMethodId = value;
                onChanged();
              }
            },
    );
    final amountField = TextField(
      key: ValueKey('payment-detail-amount-$index'),
      controller: detail.amountController,
      enabled: !locked,
      keyboardType: const TextInputType.numberWithOptions(
        decimal: true,
        signed: true,
      ),
      inputFormatters: [
        TextInputFormatter.withFunction((oldValue, newValue) {
          return RegExp(r'^-?\d*(?:\.\d{0,2})?$').hasMatch(newValue.text)
              ? newValue
              : oldValue;
        }),
      ],
      onChanged: (_) => onChanged(),
      decoration: InputDecoration(
        labelText: '金额',
        prefixText: '¥ ',
        errorText: detail.amountCents == null ? '请输入最多两位小数的金额' : null,
      ),
    );
    final actions = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton(
          key: ValueKey('payment-detail-up-$index'),
          tooltip: '上移收款明细',
          onPressed: locked || !canMoveUp ? null : onMoveUp,
          icon: const Icon(Icons.arrow_upward_rounded),
        ),
        IconButton(
          key: ValueKey('payment-detail-down-$index'),
          tooltip: '下移收款明细',
          onPressed: locked || !canMoveDown ? null : onMoveDown,
          icon: const Icon(Icons.arrow_downward_rounded),
        ),
        IconButton(
          key: ValueKey('payment-detail-remove-$index'),
          tooltip: '删除收款明细',
          onPressed: locked ? null : onRemove,
          icon: const Icon(Icons.delete_outline_rounded),
        ),
      ],
    );
    return LayoutBuilder(
      builder: (context, constraints) {
        final compact = constraints.maxWidth < 560;
        if (compact) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                '收款 ${index + 1}',
                style: Theme.of(context).textTheme.titleSmall,
              ),
              const SizedBox(height: 8),
              methodField,
              const SizedBox(height: 10),
              amountField,
              Align(alignment: Alignment.centerRight, child: actions),
            ],
          );
        }
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(flex: 3, child: methodField),
            const SizedBox(width: 10),
            Expanded(flex: 2, child: amountField),
            actions,
          ],
        );
      },
    );
  }
}

int? moneyCentsOrNull(String value) {
  final normalized = value.trim();
  if (normalized.isEmpty) {
    return null;
  }
  final match = RegExp(r'^(-?)(\d+)(?:\.(\d{1,2}))?$').firstMatch(normalized);
  if (match == null) {
    return null;
  }
  final whole = int.tryParse(match.group(2)!);
  if (whole == null) {
    return null;
  }
  final fractionText = match.group(3) ?? '';
  final fraction =
      fractionText.isEmpty ? 0 : int.parse(fractionText.padRight(2, '0'));
  final absoluteCents = whole * 100 + fraction;
  final cents = match.group(1) == '-' ? -absoluteCents : absoluteCents;
  if (cents < -2147483648 || cents > 2147483647) {
    return null;
  }
  return cents;
}

String moneyInputText(int cents) {
  if (cents % 100 == 0) {
    return '${cents ~/ 100}';
  }
  return (cents / 100).toStringAsFixed(2);
}
