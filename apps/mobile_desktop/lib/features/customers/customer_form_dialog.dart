import 'package:flutter/material.dart';

import '../../core/business/business_api.dart';

typedef CustomerCreator = Future<CustomerRecord> Function(
  Map<String, dynamic> body,
);

class CustomerFormDialog extends StatefulWidget {
  const CustomerFormDialog({
    super.key,
    this.businessApi,
    this.createCustomer,
    this.initialName,
    this.initialPhone,
    this.initialAddress,
  }) : assert(
          businessApi != null || createCustomer != null,
          'businessApi or createCustomer must be provided.',
        );

  final BusinessApi? businessApi;
  final CustomerCreator? createCustomer;
  final String? initialName;
  final String? initialPhone;
  final String? initialAddress;

  @override
  State<CustomerFormDialog> createState() => _CustomerFormDialogState();
}

class _CustomerFormDialogState extends State<CustomerFormDialog> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _nameController;
  late final TextEditingController _phoneController;
  final _provinceController = TextEditingController();
  final _cityController = TextEditingController();
  final _districtController = TextEditingController();
  late final TextEditingController _addressController;
  final _notesController = TextEditingController();
  bool _saving = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.initialName ?? '');
    _phoneController = TextEditingController(text: widget.initialPhone ?? '');
    _addressController =
        TextEditingController(text: widget.initialAddress ?? '');
  }

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    _provinceController.dispose();
    _cityController.dispose();
    _districtController.dispose();
    _addressController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    setState(() {
      _saving = true;
      _errorMessage = null;
    });

    try {
      final creator = widget.createCustomer;
      final customer = creator == null
          ? await widget.businessApi!.createCustomer(_payload())
          : await creator(_payload());
      if (mounted) {
        Navigator.of(context).pop(customer);
      }
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _saving = false;
        _errorMessage = _messageForError(error);
      });
    }
  }

  Map<String, dynamic> _payload() {
    final body = <String, dynamic>{
      'name': _nameController.text.trim(),
    };
    _putNonEmpty(body, 'phone', _phoneController.text);
    _putNonEmpty(body, 'province', _provinceController.text);
    _putNonEmpty(body, 'city', _cityController.text);
    _putNonEmpty(body, 'district', _districtController.text);
    _putNonEmpty(body, 'address', _addressController.text);
    _putNonEmpty(body, 'notes', _notesController.text);
    return body;
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('新建客户'),
      content: SizedBox(
        width: 560,
        child: SingleChildScrollView(
          child: Form(
            key: _formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextFormField(
                  key: const ValueKey('customer-name-field'),
                  controller: _nameController,
                  decoration: const InputDecoration(labelText: '客户姓名'),
                  textInputAction: TextInputAction.next,
                  validator: (value) {
                    if ((value ?? '').trim().isEmpty) {
                      return '客户姓名不能为空';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 10),
                TextFormField(
                  key: const ValueKey('customer-phone-field'),
                  controller: _phoneController,
                  decoration: const InputDecoration(labelText: '客户电话'),
                  keyboardType: TextInputType.phone,
                  textInputAction: TextInputAction.next,
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  children: [
                    SizedBox(
                      width: 170,
                      child: TextFormField(
                        controller: _provinceController,
                        decoration: const InputDecoration(labelText: '省份'),
                        textInputAction: TextInputAction.next,
                      ),
                    ),
                    SizedBox(
                      width: 170,
                      child: TextFormField(
                        controller: _cityController,
                        decoration: const InputDecoration(labelText: '城市'),
                        textInputAction: TextInputAction.next,
                      ),
                    ),
                    SizedBox(
                      width: 170,
                      child: TextFormField(
                        controller: _districtController,
                        decoration: const InputDecoration(labelText: '区县'),
                        textInputAction: TextInputAction.next,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                TextFormField(
                  key: const ValueKey('customer-address-field'),
                  controller: _addressController,
                  decoration: const InputDecoration(labelText: '详细地址'),
                  textInputAction: TextInputAction.next,
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _notesController,
                  decoration: const InputDecoration(labelText: '客户备注'),
                  minLines: 2,
                  maxLines: 3,
                ),
                if (_errorMessage != null) ...[
                  const SizedBox(height: 12),
                  _DialogNotice(message: _errorMessage!),
                ],
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        FilledButton.icon(
          key: const ValueKey('save-customer-button'),
          onPressed: _saving ? null : _save,
          icon: _saving
              ? const SizedBox.square(
                  dimension: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.check_rounded),
          label: const Text('保存客户'),
        ),
      ],
    );
  }
}

class _DialogNotice extends StatelessWidget {
  const _DialogNotice({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: scheme.errorContainer,
        borderRadius: const BorderRadius.all(Radius.circular(8)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Text(
          message,
          style: TextStyle(color: scheme.onErrorContainer),
        ),
      ),
    );
  }
}

void _putNonEmpty(Map<String, dynamic> body, String key, String value) {
  final text = value.trim();
  if (text.isNotEmpty) {
    body[key] = text;
  }
}

String _messageForError(Object error) {
  final text = error.toString();
  if (text.startsWith('Exception: ')) {
    return text.substring('Exception: '.length);
  }
  return text;
}
