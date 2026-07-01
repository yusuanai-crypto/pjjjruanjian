import 'package:flutter/material.dart';

import '../../core/business/business_api.dart';
import '../../shared/widgets/state_views.dart';
import '../../shared/widgets/status_tag.dart';
import 'customer_form_dialog.dart';

typedef CustomerListLoader = Future<List<CustomerRecord>> Function(
  String query,
  int limit,
);

class CustomerPickerDialog extends StatefulWidget {
  const CustomerPickerDialog({
    super.key,
    this.businessApi,
    this.loadCustomers,
    this.createCustomer,
    this.initialQuery,
    this.limit = 30,
  }) : assert(
          businessApi != null || loadCustomers != null,
          'businessApi or loadCustomers must be provided.',
        );

  final BusinessApi? businessApi;
  final CustomerListLoader? loadCustomers;
  final CustomerCreator? createCustomer;
  final String? initialQuery;
  final int limit;

  @override
  State<CustomerPickerDialog> createState() => _CustomerPickerDialogState();
}

class _CustomerPickerDialogState extends State<CustomerPickerDialog> {
  late final TextEditingController _searchController;
  List<CustomerRecord> _customers = const <CustomerRecord>[];
  bool _loading = true;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _searchController = TextEditingController(text: widget.initialQuery ?? '');
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    try {
      final query = _searchController.text.trim();
      final loader = widget.loadCustomers;
      final customers = loader == null
          ? await widget.businessApi!.listCustomers(
              query: query,
              limit: widget.limit,
            )
          : await loader(query, widget.limit);
      if (!mounted) {
        return;
      }
      setState(() {
        _customers = customers;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _customers = const <CustomerRecord>[];
        _loading = false;
        _errorMessage = _messageForError(error);
      });
    }
  }

  Future<void> _openCreateDialog() async {
    final created = await showDialog<CustomerRecord>(
      context: context,
      builder: (context) => CustomerFormDialog(
        businessApi: widget.businessApi,
        createCustomer: widget.createCustomer,
        initialName: _searchController.text.trim(),
      ),
    );
    if (created != null && mounted) {
      Navigator.of(context).pop(created);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('选择客户'),
      content: SizedBox(
        width: 680,
        height: 540,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: TextField(
                    key: const ValueKey('customer-search-field'),
                    controller: _searchController,
                    decoration: InputDecoration(
                      labelText: '搜索客户',
                      hintText: '输入姓名、电话或地址',
                      prefixIcon: const Icon(Icons.search_rounded),
                      suffixIcon: _searchController.text.trim().isEmpty
                          ? null
                          : IconButton(
                              tooltip: '清空搜索',
                              onPressed: () {
                                _searchController.clear();
                                _load();
                              },
                              icon: const Icon(Icons.close_rounded),
                            ),
                    ),
                    textInputAction: TextInputAction.search,
                    onChanged: (_) => setState(() {}),
                    onSubmitted: (_) => _load(),
                  ),
                ),
                const SizedBox(width: 10),
                FilledButton.icon(
                  key: const ValueKey('customer-search-button'),
                  onPressed: _loading ? null : _load,
                  icon: const Icon(Icons.search_rounded),
                  label: const Text('搜索'),
                ),
                const SizedBox(width: 10),
                OutlinedButton.icon(
                  key: const ValueKey('open-create-customer-button'),
                  onPressed: widget.businessApi == null &&
                          widget.createCustomer == null
                      ? null
                      : _openCreateDialog,
                  icon: const Icon(Icons.add_rounded),
                  label: const Text('新建客户'),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Expanded(child: _buildResult()),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
      ],
    );
  }

  Widget _buildResult() {
    if (_loading) {
      return const LoadingState(title: '正在加载客户');
    }
    if (_errorMessage != null) {
      return ErrorState(title: _errorMessage!, onRetry: _load);
    }
    if (_customers.isEmpty) {
      return const EmptyState(
        key: ValueKey('customer-empty-state'),
        title: '暂无匹配客户',
      );
    }

    return ListView.separated(
      key: const ValueKey('customer-result-list'),
      itemCount: _customers.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (context, index) {
        final customer = _customers[index];
        return _CustomerListTile(
          customer: customer,
          onTap: () => Navigator.of(context).pop(customer),
        );
      },
    );
  }
}

class _CustomerListTile extends StatelessWidget {
  const _CustomerListTile({
    required this.customer,
    required this.onTap,
  });

  final CustomerRecord customer;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final address = _customerAddress(customer);
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      leading: CircleAvatar(
        child: Text(_initial(customer.name)),
      ),
      title: Wrap(
        spacing: 8,
        runSpacing: 6,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Text(
            customer.name,
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(fontWeight: FontWeight.w700),
          ),
          StatusTag(
            label: customer.financeMark ? '已标记' : '未标记',
            tone:
                customer.financeMark ? StatusTone.success : StatusTone.neutral,
          ),
        ],
      ),
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(customer.phone == null ? '未填写电话' : '电话：${customer.phone}'),
            const SizedBox(height: 2),
            Text(address.isEmpty ? '未填写地址' : '地址：$address'),
          ],
        ),
      ),
      trailing: const Icon(Icons.check_circle_outline_rounded),
      onTap: onTap,
    );
  }
}

String _customerAddress(CustomerRecord customer) {
  return [
    customer.province,
    customer.city,
    customer.district,
    customer.address,
  ].whereType<String>().where((part) => part.trim().isNotEmpty).join('');
}

String _initial(String name) {
  final text = name.trim();
  if (text.isEmpty) {
    return '?';
  }
  return text.substring(0, 1);
}

String _messageForError(Object error) {
  final text = error.toString();
  if (text.startsWith('Exception: ')) {
    return text.substring('Exception: '.length);
  }
  return text;
}
