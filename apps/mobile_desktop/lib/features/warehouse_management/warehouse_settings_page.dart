import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/auth/role_access.dart';
import '../../core/business/inventory_api.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/state_views.dart';
import '../../shared/widgets/status_tag.dart';
import 'shared/inventory_workspace_shared.dart';

class WarehouseSettingsPage extends StatefulWidget {
  const WarehouseSettingsPage({
    super.key,
    required this.api,
    required this.role,
    this.onDirtyChanged,
  });

  final InventoryApi api;
  final UserRole role;
  final ValueChanged<bool>? onDirtyChanged;

  @override
  State<WarehouseSettingsPage> createState() => _WarehouseSettingsPageState();
}

class _WarehouseSettingsPageState extends State<WarehouseSettingsPage> {
  final _searchController = TextEditingController();
  WarehousePage? _page;
  WarehouseRecord? _selected;
  bool _loading = true;
  String? _error;
  String? _operationError;
  bool? _activeFilter;
  int _pageNumber = 1;
  int _requestGeneration = 0;
  final Set<String> _busyIds = {};
  bool _editorDirty = false;

  bool get _canManage => canManageWarehouse(widget.role);

  @override
  void initState() {
    super.initState();
    if (_canManage) _load();
  }

  @override
  void dispose() {
    _requestGeneration++;
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _load({bool preserveSelection = true}) async {
    final generation = ++_requestGeneration;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await widget.api.listWarehousePage(
        page: _pageNumber,
        pageSize: 20,
        q: _searchController.text,
        isActive: _activeFilter,
      );
      if (!mounted || generation != _requestGeneration) return;
      WarehouseRecord? selected;
      if (preserveSelection && _selected != null) {
        final matches =
            page.warehouses.where((item) => item.id == _selected!.id);
        if (matches.isNotEmpty) selected = matches.first;
      }
      setState(() {
        _page = page;
        _selected = selected;
        _loading = false;
        _operationError = null;
        _editorDirty = false;
      });
      widget.onDirtyChanged?.call(false);
    } catch (error) {
      if (!mounted || generation != _requestGeneration) return;
      setState(() {
        _loading = false;
        _error = inventoryErrorMessage(error);
      });
    }
  }

  Future<bool> _confirmDiscardChanges() async {
    if (!_editorDirty) return true;
    return confirmInventoryAction(
      context,
      title: '放弃未保存修改？',
      content: '当前仓库资料尚未保存，继续将丢失这些修改。',
      confirmLabel: '放弃修改',
      danger: true,
    );
  }

  Future<void> _selectForEdit(WarehouseRecord warehouse) async {
    if (!await _confirmDiscardChanges() || !mounted) return;
    setState(() {
      _selected = warehouse;
      _editorDirty = false;
    });
    widget.onDirtyChanged?.call(false);
  }

  Future<void> _startCreate() async {
    if (!await _confirmDiscardChanges() || !mounted) return;
    final availableWidth =
        context.size?.width ?? MediaQuery.sizeOf(context).width;
    final wide = isDesktopWidth(availableWidth);
    if (wide) {
      setState(() {
        _selected = null;
        _editorDirty = false;
      });
      widget.onDirtyChanged?.call(false);
      return;
    }
    await _showMobileEditor();
  }

  Future<void> _showMobileEditor([WarehouseRecord? warehouse]) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      isDismissible: false,
      enableDrag: false,
      useSafeArea: true,
      builder: (sheetContext) => InventoryKeyboardSafeSheet(
        heightFactor: .9,
        horizontalPadding: 16,
        topPadding: 16,
        bottomPadding: 16,
        child: _WarehouseEditor(
          key: ValueKey('warehouse-mobile-editor-${warehouse?.id ?? 'new'}'),
          warehouse: warehouse,
          onSave: (input) => _save(input, warehouse: warehouse),
          onCancel: () => Navigator.pop(sheetContext),
        ),
      ),
    );
  }

  Future<bool> _save(
    _WarehouseFormInput input, {
    WarehouseRecord? warehouse,
  }) async {
    try {
      if (warehouse == null) {
        await widget.api.createWarehouse(
          code: input.code,
          name: input.name,
          address: input.address,
          managerUserId: input.managerUserId,
        );
      } else {
        await widget.api.updateWarehouse(
          warehouseId: warehouse.id,
          code: input.code,
          name: input.name,
          address: input.address,
          managerUserId: input.managerUserId,
          includeManagerUserId: true,
        );
      }
      if (!mounted) return false;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(warehouse == null ? '仓库已新增。' : '仓库资料已更新。')),
      );
      await _load(preserveSelection: warehouse != null);
      return true;
    } catch (error) {
      if (!mounted) return false;
      setState(() => _operationError = inventoryErrorMessage(error));
      return false;
    }
  }

  Future<void> _setDefault(WarehouseRecord warehouse) async {
    final confirmed = await confirmInventoryAction(
      context,
      title: '设置默认仓库',
      content: '将“${warehouse.name}”设为默认仓库？原默认仓库将自动取消。',
      confirmLabel: '设置默认',
    );
    if (!confirmed || !mounted) return;
    await _runWarehouseAction(
      warehouse,
      () => widget.api.updateWarehouse(
        warehouseId: warehouse.id,
        isDefault: true,
      ),
      successMessage: '默认仓库已更新。',
    );
  }

  Future<void> _toggleActive(WarehouseRecord warehouse) async {
    if (warehouse.isActive) {
      final confirmed = await confirmInventoryAction(
        context,
        title: '停用仓库',
        content:
            '停用“${warehouse.name}”后将不能用于新业务。若仍有库存、占用、在途、未完成单据或进行中的盘点，后端会拒绝停用。',
        confirmLabel: '确认停用',
        danger: true,
      );
      if (!confirmed || !mounted) return;
    }
    await _runWarehouseAction(
      warehouse,
      () => widget.api.updateWarehouse(
        warehouseId: warehouse.id,
        isActive: !warehouse.isActive,
      ),
      successMessage: warehouse.isActive ? '仓库已停用。' : '仓库已启用。',
    );
  }

  Future<void> _runWarehouseAction(
    WarehouseRecord warehouse,
    Future<WarehouseRecord> Function() action, {
    required String successMessage,
  }) async {
    if (_busyIds.contains(warehouse.id)) return;
    setState(() {
      _busyIds.add(warehouse.id);
      _operationError = null;
    });
    try {
      await action();
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(successMessage)));
      await _load();
    } catch (error) {
      if (!mounted) return;
      setState(() => _operationError = inventoryErrorMessage(error));
    } finally {
      if (mounted) setState(() => _busyIds.remove(warehouse.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_canManage) {
      return const InventoryUnavailableCard(
        title: '仓库设置',
        message: '仅 admin / super_admin 可进入并调用仓库写接口。',
        keyPrefix: 'warehouse-settings-permission',
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _buildFilters(),
        if (_operationError != null) ...[
          InventoryInlineNotice(
            key: const ValueKey('warehouse-settings-operation-error'),
            message: _operationError!,
            tone: StatusTone.danger,
          ),
          const SizedBox(height: 10),
        ],
        Expanded(child: _buildBody()),
      ],
    );
  }

  Widget _buildFilters() {
    return InventoryFilterBar(
      actions: [
        OutlinedButton.icon(
          onPressed: _loading ? null : _load,
          icon: const Icon(Icons.refresh_rounded),
          label: const Text('刷新'),
        ),
        FilledButton.icon(
          key: const ValueKey('warehouse-settings-create'),
          onPressed: _startCreate,
          icon: const Icon(Icons.add_rounded),
          label: const Text('新增仓库'),
        ),
      ],
      children: [
        SizedBox(
          width: 220,
          child: TextField(
            key: const ValueKey('warehouse-settings-search'),
            controller: _searchController,
            decoration: const InputDecoration(
              labelText: '搜索编号或名称',
              border: OutlineInputBorder(),
              isDense: true,
            ),
            onSubmitted: (_) {
              _pageNumber = 1;
              _load(preserveSelection: false);
            },
          ),
        ),
        SizedBox(
          width: 150,
          child: DropdownButtonFormField<bool?>(
            key: const ValueKey('warehouse-settings-status-filter'),
            initialValue: _activeFilter,
            decoration: const InputDecoration(
              labelText: '启用状态',
              border: OutlineInputBorder(),
              isDense: true,
            ),
            items: const [
              DropdownMenuItem(value: null, child: Text('全部')),
              DropdownMenuItem(value: true, child: Text('已启用')),
              DropdownMenuItem(value: false, child: Text('已停用')),
            ],
            onChanged: (value) {
              setState(() {
                _activeFilter = value;
                _pageNumber = 1;
              });
              _load(preserveSelection: false);
            },
          ),
        ),
      ],
    );
  }

  Widget _buildBody() {
    if (_loading && _page == null) {
      return const LoadingState(title: '正在加载仓库设置');
    }
    if (_error != null && _page == null) {
      return ErrorState(title: _error!, onRetry: _load);
    }
    final page = _page;
    if (page == null || page.warehouses.isEmpty) {
      return EmptyState(
        title: _searchController.text.trim().isNotEmpty || _activeFilter != null
            ? '当前筛选无结果'
            : '暂无仓库',
        action: FilledButton.icon(
          onPressed: _startCreate,
          icon: const Icon(Icons.add_rounded),
          label: const Text('新增仓库'),
        ),
      );
    }
    return LayoutBuilder(
      builder: (context, constraints) {
        if (isDesktopWidth(constraints.maxWidth)) {
          return _buildWideLayout(page);
        }
        return _buildMobileLayout(page);
      },
    );
  }

  Widget _buildWideLayout(WarehousePage page) {
    return Row(
      key: const ValueKey('warehouse-settings-wide-layout'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(
          flex: 2,
          child: Column(
            children: [
              Expanded(
                child: Card(
                  margin: EdgeInsets.zero,
                  child: SingleChildScrollView(
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: DataTable(
                        key: const ValueKey('warehouse-settings-table'),
                        showCheckboxColumn: false,
                        columns: const [
                          DataColumn(label: Text('操作')),
                          DataColumn(label: Text('仓库编号')),
                          DataColumn(label: Text('名称')),
                          DataColumn(label: Text('地址')),
                          DataColumn(label: Text('负责人')),
                          DataColumn(label: Text('状态')),
                          DataColumn(label: Text('默认仓库')),
                          DataColumn(label: Text('最近修改')),
                        ],
                        rows: [
                          for (final warehouse in page.warehouses)
                            DataRow(
                              selected: _selected?.id == warehouse.id,
                              onSelectChanged: (_) => _selectForEdit(warehouse),
                              cells: [
                                DataCell(_rowActions(warehouse)),
                                DataCell(Text(warehouse.code)),
                                DataCell(Text(warehouse.name)),
                                DataCell(Text(
                                  warehouse.address.isEmpty
                                      ? '—'
                                      : warehouse.address,
                                )),
                                DataCell(Text(warehouse.managerName ?? '未指定')),
                                DataCell(_activeTag(warehouse)),
                                DataCell(_defaultTag(warehouse)),
                                DataCell(
                                  Text(
                                    formatInventoryDateTime(
                                      warehouse.updatedAt,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              _pagination(page),
            ],
          ),
        ),
        const SizedBox(width: 14),
        SizedBox(
          width: 380,
          child: Card(
            margin: EdgeInsets.zero,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: _WarehouseEditor(
                key: ValueKey(
                  'warehouse-wide-editor-${_selected?.id ?? 'new'}',
                ),
                warehouse: _selected,
                onDirtyChanged: (dirty) {
                  _editorDirty = dirty;
                  widget.onDirtyChanged?.call(dirty);
                },
                onSave: (input) => _save(input, warehouse: _selected),
                onCancel: _selected == null
                    ? null
                    : () {
                        setState(() {
                          _selected = null;
                          _editorDirty = false;
                        });
                        widget.onDirtyChanged?.call(false);
                      },
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildMobileLayout(WarehousePage page) {
    return Column(
      key: const ValueKey('warehouse-settings-mobile-layout'),
      children: [
        Expanded(
          child: ListView.separated(
            itemCount: page.warehouses.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (context, index) {
              final warehouse = page.warehouses[index];
              return Card(
                key: ValueKey('warehouse-settings-card-${warehouse.id}'),
                margin: EdgeInsets.zero,
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              '${warehouse.code} · ${warehouse.name}',
                              style:
                                  const TextStyle(fontWeight: FontWeight.w700),
                            ),
                          ),
                          _activeTag(warehouse),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(
                        warehouse.address.isEmpty ? '未填写地址' : warehouse.address,
                      ),
                      Text('负责人：${warehouse.managerName ?? '未指定'}'),
                      Text(
                        '最近修改：'
                        '${formatInventoryDateTime(warehouse.updatedAt)}',
                      ),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          if (warehouse.isDefault) _defaultTag(warehouse),
                          OutlinedButton(
                            onPressed: () => _showMobileEditor(warehouse),
                            child: const Text('编辑'),
                          ),
                          if (!warehouse.isDefault)
                            OutlinedButton(
                              onPressed: _busyIds.contains(warehouse.id)
                                  ? null
                                  : () => _setDefault(warehouse),
                              child: const Text('设为默认'),
                            ),
                          FilledButton.tonal(
                            onPressed: _busyIds.contains(warehouse.id)
                                ? null
                                : () => _toggleActive(warehouse),
                            child: Text(warehouse.isActive ? '停用' : '启用'),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
        _pagination(page),
      ],
    );
  }

  Widget _rowActions(WarehouseRecord warehouse) {
    final busy = _busyIds.contains(warehouse.id);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton(
          tooltip: '编辑',
          onPressed: busy ? null : () => _selectForEdit(warehouse),
          icon: const Icon(Icons.edit_outlined),
        ),
        if (!warehouse.isDefault)
          IconButton(
            key: ValueKey('warehouse-settings-default-${warehouse.id}'),
            tooltip: '设为默认',
            onPressed: busy ? null : () => _setDefault(warehouse),
            icon: const Icon(Icons.star_outline_rounded),
          ),
        IconButton(
          key: ValueKey('warehouse-settings-active-${warehouse.id}'),
          tooltip: warehouse.isActive ? '停用' : '启用',
          onPressed: busy ? null : () => _toggleActive(warehouse),
          icon: Icon(
            warehouse.isActive
                ? Icons.pause_circle_outline_rounded
                : Icons.play_circle_outline_rounded,
          ),
        ),
      ],
    );
  }

  Widget _activeTag(WarehouseRecord warehouse) {
    return InventoryStatusTag(
      label: warehouse.isActive ? '已启用' : '已停用',
      tone: warehouse.isActive ? StatusTone.success : StatusTone.neutral,
    );
  }

  Widget _defaultTag(WarehouseRecord warehouse) {
    if (!warehouse.isDefault) return const Text('—');
    return const InventoryStatusTag(
      label: '默认',
      tone: StatusTone.info,
      icon: Icons.star_rounded,
    );
  }

  Widget _pagination(WarehousePage page) {
    if (page.totalPages <= 1) return const SizedBox.shrink();
    return InventoryPagination(
      page: page.page,
      totalPages: page.totalPages,
      onPrevious: page.page > 1
          ? () {
              setState(() => _pageNumber--);
              _load(preserveSelection: false);
            }
          : null,
      onNext: page.page < page.totalPages
          ? () {
              setState(() => _pageNumber++);
              _load(preserveSelection: false);
            }
          : null,
    );
  }
}

class _WarehouseEditor extends StatefulWidget {
  const _WarehouseEditor({
    super.key,
    required this.warehouse,
    required this.onSave,
    this.onCancel,
    this.onDirtyChanged,
  });

  final WarehouseRecord? warehouse;
  final Future<bool> Function(_WarehouseFormInput input) onSave;
  final VoidCallback? onCancel;
  final ValueChanged<bool>? onDirtyChanged;

  @override
  State<_WarehouseEditor> createState() => _WarehouseEditorState();
}

class _WarehouseEditorState extends State<_WarehouseEditor> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _codeController;
  late final TextEditingController _nameController;
  late final TextEditingController _addressController;
  late final TextEditingController _managerController;
  bool _submitting = false;
  bool _dirty = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _codeController = TextEditingController(text: widget.warehouse?.code ?? '');
    _nameController = TextEditingController(text: widget.warehouse?.name ?? '');
    _addressController =
        TextEditingController(text: widget.warehouse?.address ?? '');
    _managerController =
        TextEditingController(text: widget.warehouse?.managerUserId ?? '');
    for (final controller in [
      _codeController,
      _nameController,
      _addressController,
      _managerController,
    ]) {
      controller.addListener(_markDirty);
    }
  }

  @override
  void dispose() {
    _codeController.dispose();
    _nameController.dispose();
    _addressController.dispose();
    _managerController.dispose();
    super.dispose();
  }

  void _markDirty() {
    if (_dirty) return;
    setState(() => _dirty = true);
    widget.onDirtyChanged?.call(true);
  }

  Future<void> _save() async {
    if (_submitting || !_formKey.currentState!.validate()) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    final succeeded = await widget.onSave(
      _WarehouseFormInput(
        code: _codeController.text.trim(),
        name: _nameController.text.trim(),
        address: _addressController.text.trim(),
        managerUserId: _managerController.text.trim(),
      ),
    );
    if (!mounted) return;
    setState(() {
      _submitting = false;
      if (!succeeded) _error = '保存失败，请查看页面上方错误信息。';
      if (succeeded) _dirty = false;
    });
    if (succeeded) {
      widget.onDirtyChanged?.call(false);
      widget.onCancel?.call();
    }
  }

  Future<void> _cancel() async {
    if (_submitting) return;
    if (_dirty) {
      final confirmed = await confirmInventoryAction(
        context,
        title: '放弃未保存修改？',
        content: '当前仓库资料尚未保存。',
        confirmLabel: '放弃修改',
        danger: true,
      );
      if (!confirmed || !mounted) return;
    }
    widget.onDirtyChanged?.call(false);
    widget.onCancel?.call();
  }

  @override
  Widget build(BuildContext context) {
    return InventoryKeyboardScope(
      onEscape: widget.onCancel == null
          ? null
          : () {
              _cancel();
            },
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    widget.warehouse == null ? '新增仓库' : '编辑仓库',
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                if (widget.onCancel != null)
                  IconButton(
                    tooltip: '关闭',
                    onPressed: _cancel,
                    icon: const Icon(Icons.close_rounded),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            Expanded(
              child: SingleChildScrollView(
                child: Column(
                  children: [
                    TextFormField(
                      key: const ValueKey('warehouse-settings-code'),
                      controller: _codeController,
                      enabled: !_submitting,
                      decoration: const InputDecoration(
                        labelText: '仓库编号',
                        border: OutlineInputBorder(),
                      ),
                      validator: (value) =>
                          value == null || value.trim().isEmpty
                              ? '请输入仓库编号'
                              : null,
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      key: const ValueKey('warehouse-settings-name'),
                      controller: _nameController,
                      enabled: !_submitting,
                      decoration: const InputDecoration(
                        labelText: '仓库名称',
                        border: OutlineInputBorder(),
                      ),
                      validator: (value) =>
                          value == null || value.trim().isEmpty
                              ? '请输入仓库名称'
                              : null,
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      key: const ValueKey('warehouse-settings-address'),
                      controller: _addressController,
                      enabled: !_submitting,
                      maxLines: 2,
                      decoration: const InputDecoration(
                        labelText: '地址（可选）',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      key: const ValueKey('warehouse-settings-manager'),
                      controller: _managerController,
                      enabled: !_submitting,
                      decoration: const InputDecoration(
                        labelText: '负责人账号 ID（可选）',
                        helperText: '当前接口只接受真实用户 ID，不使用本地模拟人员。',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 12),
                      InventoryInlineNotice(
                        message: _error!,
                        tone: StatusTone.danger,
                      ),
                    ],
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                if (widget.onCancel != null)
                  TextButton(
                    onPressed: _submitting ? null : _cancel,
                    child: const Text('取消'),
                  ),
                const SizedBox(width: 8),
                FilledButton.icon(
                  key: const ValueKey('warehouse-settings-save'),
                  onPressed: _submitting ? null : _save,
                  icon: _submitting
                      ? const SizedBox.square(
                          dimension: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.save_outlined),
                  label: Text(_submitting ? '保存中' : '保存'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _WarehouseFormInput {
  const _WarehouseFormInput({
    required this.code,
    required this.name,
    required this.address,
    required this.managerUserId,
  });

  final String code;
  final String name;
  final String address;
  final String managerUserId;
}
