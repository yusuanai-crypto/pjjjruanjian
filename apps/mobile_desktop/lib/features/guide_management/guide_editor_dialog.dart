import 'package:flutter/material.dart';

import '../../core/business/business_api.dart';

class GuideEditorDialog extends StatefulWidget {
  const GuideEditorDialog({
    super.key,
    required this.businessApi,
    this.guide,
  });

  final BusinessApi businessApi;
  final GuideRecord? guide;

  @override
  State<GuideEditorDialog> createState() => _GuideEditorDialogState();
}

class _GuideEditorDialogState extends State<GuideEditorDialog> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _nameController;
  late final TextEditingController _phoneController;
  late final TextEditingController _remarksController;
  bool _submitting = false;
  String? _errorMessage;

  bool get _editing => widget.guide != null;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.guide?.name ?? '');
    _phoneController = TextEditingController(text: widget.guide?.phone ?? '');
    _remarksController =
        TextEditingController(text: widget.guide?.remarks ?? '');
  }

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    _remarksController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_submitting || !(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    setState(() {
      _submitting = true;
      _errorMessage = null;
    });
    final body = <String, dynamic>{
      'name': _nameController.text.trim(),
      'phone': _phoneController.text.trim(),
      'remarks': _remarksController.text.trim(),
    };
    try {
      final guide = _editing
          ? await widget.businessApi.updateGuide(widget.guide!.id, body)
          : await widget.businessApi.createGuide(body);
      if (mounted) {
        Navigator.of(context).pop(guide);
      }
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _submitting = false;
        _errorMessage = error.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(_editing ? '编辑导游' : '新增导游'),
      content: SizedBox(
        width: 480,
        child: SingleChildScrollView(
          child: Form(
            key: _formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextFormField(
                  key: const ValueKey('guide-editor-name'),
                  controller: _nameController,
                  maxLength: 80,
                  autofocus: true,
                  textInputAction: TextInputAction.next,
                  decoration: const InputDecoration(labelText: '姓名'),
                  validator: (value) {
                    final text = value?.trim() ?? '';
                    if (text.isEmpty) {
                      return '请输入导游姓名';
                    }
                    if (text.length > 80) {
                      return '姓名不能超过 80 个字符';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 8),
                TextFormField(
                  key: const ValueKey('guide-editor-phone'),
                  controller: _phoneController,
                  maxLength: 30,
                  keyboardType: TextInputType.phone,
                  textInputAction: TextInputAction.next,
                  decoration: const InputDecoration(labelText: '手机号'),
                  validator: (value) {
                    final text = value?.trim() ?? '';
                    if (text.isEmpty) {
                      return '请输入手机号';
                    }
                    if (text.length > 30) {
                      return '手机号不能超过 30 个字符';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 8),
                TextFormField(
                  key: const ValueKey('guide-editor-remarks'),
                  controller: _remarksController,
                  minLines: 2,
                  maxLines: 5,
                  decoration: const InputDecoration(
                    labelText: '备注（选填）',
                    alignLabelWithHint: true,
                  ),
                ),
                if (_errorMessage != null) ...[
                  const SizedBox(height: 12),
                  Text(
                    _errorMessage!,
                    key: const ValueKey('guide-editor-error'),
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _submitting ? null : () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        FilledButton.icon(
          key: const ValueKey('guide-editor-submit'),
          onPressed: _submitting ? null : _submit,
          icon: _submitting
              ? const SizedBox.square(
                  dimension: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.save_rounded),
          label: Text(_editing ? '保存' : '新增'),
        ),
      ],
    );
  }
}
