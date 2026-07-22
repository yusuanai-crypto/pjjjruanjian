import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/auth/role_access.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/app_record_list.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/mark_info_button.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/search_filter_bar.dart';
import '../../shared/widgets/status_tag.dart';
import '../../shared/widgets/time_picker_field.dart';

typedef TravelGroupFilePicker = Future<List<ApiMultipartFile>> Function();

class TravelGroupFormPage extends StatefulWidget {
  const TravelGroupFormPage({
    super.key,
    required this.apiClient,
    required this.token,
    this.role = UserRole.frontDesk,
    this.filePicker,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;
  final TravelGroupFilePicker? filePicker;

  @override
  State<TravelGroupFormPage> createState() => _TravelGroupFormPageState();
}

class _TravelGroupFormPageState extends State<TravelGroupFormPage> {
  final _formKey = GlobalKey<FormState>();

  late BusinessApi _businessApi;
  late final TextEditingController _travelAgencyController;
  late final TextEditingController _licensePlateController;
  late final TextEditingController _guestCountController;
  late final TextEditingController _tastingRoomNoController;
  late final TextEditingController _arrivalTimeController;
  late final TextEditingController _sourceRegionController;
  late final TextEditingController _ageInfoController;
  late final TextEditingController _previousStopOrderStatusController;
  late final TextEditingController _keyCustomerInfoController;

  DateTime? _visitDate;
  String? _groupType;
  String _mentionedFeitianSelection = 'unset';
  String _selectedFilter = '今日';
  bool _loading = true;
  bool _saving = false;
  String? _errorMessage;
  String? _successMessage;
  GuideRecord? _selectedGuide;
  TasterOption? _selectedTaster;
  TasterOption? _selectedLiaisonTaster;
  TravelGroupRecord? _createdGroupAwaitingAttachments;
  List<ApiMultipartFile> _keyCustomerPhotoFiles = <ApiMultipartFile>[];
  List<ApiMultipartFile> _guestInfoFiles = <ApiMultipartFile>[];
  final Set<String> _markingGroupIds = <String>{};
  List<TravelGroupRecord> _groups = const <TravelGroupRecord>[];
  List<GuideRecord> _guides = const <GuideRecord>[];
  List<TravelAgencyRecord> _travelAgencies = const <TravelAgencyRecord>[];
  List<TasterOption> _tasters = const <TasterOption>[];

  @override
  void initState() {
    super.initState();
    _businessApi =
        BusinessApi(apiClient: widget.apiClient, token: widget.token);
    _travelAgencyController = TextEditingController();
    _licensePlateController = TextEditingController();
    _guestCountController = TextEditingController();
    _tastingRoomNoController = TextEditingController();
    _arrivalTimeController = TextEditingController();
    _sourceRegionController = TextEditingController();
    _ageInfoController = TextEditingController();
    _previousStopOrderStatusController = TextEditingController();
    _keyCustomerInfoController = TextEditingController();
    _loadData();
  }

  @override
  void didUpdateWidget(covariant TravelGroupFormPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token) {
      _businessApi =
          BusinessApi(apiClient: widget.apiClient, token: widget.token);
      _loadData();
    }
  }

  @override
  void dispose() {
    _travelAgencyController.dispose();
    _licensePlateController.dispose();
    _guestCountController.dispose();
    _tastingRoomNoController.dispose();
    _arrivalTimeController.dispose();
    _sourceRegionController.dispose();
    _ageInfoController.dispose();
    _previousStopOrderStatusController.dispose();
    _keyCustomerInfoController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    try {
      final results = await Future.wait<Object>([
        _businessApi.listTravelGroups(),
        _businessApi.listGuides(isActive: true, limit: 100),
        _businessApi.listTravelAgencies(limit: 100),
        _businessApi.listTasters(),
      ]);
      if (!mounted) {
        return;
      }
      setState(() {
        _groups = results[0] as List<TravelGroupRecord>;
        _guides = results[1] as List<GuideRecord>;
        _travelAgencies = results[2] as List<TravelAgencyRecord>;
        _tasters = results[3] as List<TasterOption>;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _loading = false;
        _errorMessage = _messageForError(error);
      });
    }
  }

  Future<void> _saveTravelGroup() async {
    if (_visitDate == null) {
      await _showSaveFailure('请选择进店日期。');
      return;
    }
    if (_travelAgencyController.text.trim().isEmpty) {
      await _showSaveFailure('请选择旅行社。');
      return;
    }
    if (_selectedGuide == null) {
      await _showSaveFailure('请选择导游。');
      return;
    }
    final formValid = _formKey.currentState?.validate() ?? false;
    if (!formValid) {
      await _showSaveFailure(_formValidationFailureMessage());
      return;
    }

    setState(() {
      _saving = true;
      _errorMessage = null;
      _successMessage = null;
    });

    TravelGroupRecord created;
    try {
      created = await _businessApi.createTravelGroup(
        _buildTravelGroupCreateBody(),
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      await _showSaveFailure(_messageForError(error));
      return;
    }
    if (!mounted) {
      return;
    }
    setState(() {
      _createdGroupAwaitingAttachments = created;
    });

    final attachmentFailures = await _uploadSelectedAttachments(created);
    if (!mounted) {
      return;
    }
    await _loadData();
    if (!mounted) {
      return;
    }
    if (attachmentFailures.isNotEmpty) {
      final failureMessage = _attachmentFailureMessage(
        created,
        attachmentFailures,
      );
      setState(() {
        _saving = false;
        _successMessage = '旅行团已创建，系统团号：${created.groupNo}';
        _errorMessage = failureMessage;
      });
      await _showTravelGroupResultDialog(
        title: '录入失败',
        message: failureMessage,
      );
      return;
    }

    _clearForm();
    setState(() {
      _saving = false;
      _successMessage = '旅行团已保存，系统团号：${created.groupNo}';
    });
    await _showTravelGroupResultDialog(
      title: '录入成功',
      message: '旅行团录入成功。系统团号：${created.groupNo}',
    );
  }

  String _formValidationFailureMessage() {
    final guestCount = _guestCountController.text.trim();
    if (guestCount.isNotEmpty &&
        (int.tryParse(guestCount) == null || int.parse(guestCount) <= 0)) {
      return '人数必须大于 0';
    }
    return '请检查已填写的信息。';
  }

  Future<void> _showSaveFailure(String message) async {
    if (!mounted) {
      return;
    }
    setState(() {
      _saving = false;
      _errorMessage = message;
      _successMessage = null;
    });
    await _showTravelGroupResultDialog(
      title: '录入失败',
      message: message,
    );
  }

  Future<void> _showTravelGroupResultDialog({
    required String title,
    required String message,
  }) async {
    if (!mounted) {
      return;
    }
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('确定'),
          ),
        ],
      ),
    );
  }

  Map<String, dynamic> _buildTravelGroupCreateBody() {
    final body = <String, dynamic>{
      'visitDate': formatDate(_visitDate!),
      'travelAgency': _travelAgencyController.text.trim(),
      'guideId': _selectedGuide!.id,
    };
    _putNonEmpty(body, 'licensePlate', _licensePlateController.text);
    _putNonEmpty(body, 'tastingRoomNo', _tastingRoomNoController.text);
    _putNonEmpty(
      body,
      'arrivalTime',
      normalizeTimeText(_arrivalTimeController.text),
    );
    _putNonEmpty(body, 'sourceRegion', _sourceRegionController.text);
    _putNonEmpty(body, 'ageInfo', _ageInfoController.text);
    _putNonEmpty(
      body,
      'previousStopOrderStatus',
      _previousStopOrderStatusController.text,
    );
    _putNonEmpty(body, 'keyCustomerInfo', _keyCustomerInfoController.text);

    final guestCount = _guestCountController.text.trim();
    if (guestCount.isNotEmpty) {
      body['guestCount'] = int.parse(guestCount);
    }
    if (_selectedTaster != null) {
      body['tasterId'] = _selectedTaster!.id;
    }
    if (_selectedLiaisonTaster != null) {
      body['liaisonTasterId'] = _selectedLiaisonTaster!.id;
    }
    if (_groupType != null) {
      body['groupType'] = _groupType;
    }
    if (_mentionedFeitianSelection == 'yes') {
      body['mentionedFeitian'] = true;
    } else if (_mentionedFeitianSelection == 'no') {
      body['mentionedFeitian'] = false;
    }
    return body;
  }

  Future<List<String>> _uploadSelectedAttachments(
    TravelGroupRecord created,
  ) async {
    final failures = <String>[];
    final keyCustomerPhotoFiles =
        List<ApiMultipartFile>.from(_keyCustomerPhotoFiles);
    final guestInfoFiles = List<ApiMultipartFile>.from(_guestInfoFiles);

    if (keyCustomerPhotoFiles.isNotEmpty) {
      try {
        await _businessApi.uploadTravelGroupAttachments(
          created.id,
          category: TravelGroupAttachmentCategory.keyCustomerPhoto,
          files: keyCustomerPhotoFiles,
        );
        _keyCustomerPhotoFiles = <ApiMultipartFile>[];
      } catch (error) {
        failures.add(
          _attachmentCategoryFailure(
            '重点客户照片',
            keyCustomerPhotoFiles,
            error,
          ),
        );
      }
    }
    if (guestInfoFiles.isNotEmpty) {
      try {
        await _businessApi.uploadTravelGroupAttachments(
          created.id,
          category: TravelGroupAttachmentCategory.guestInfo,
          files: guestInfoFiles,
        );
        _guestInfoFiles = <ApiMultipartFile>[];
      } catch (error) {
        failures.add(
          _attachmentCategoryFailure('客人信息附件', guestInfoFiles, error),
        );
      }
    }
    return failures;
  }

  Future<void> _retryAttachmentUploads() async {
    final created = _createdGroupAwaitingAttachments;
    if (created == null) {
      return;
    }
    setState(() {
      _saving = true;
      _errorMessage = null;
      _successMessage = '正在为旅行团 ${created.groupNo} 重试附件上传。';
    });
    final attachmentFailures = await _uploadSelectedAttachments(created);
    if (!mounted) {
      return;
    }
    if (attachmentFailures.isNotEmpty) {
      final failureMessage = _attachmentFailureMessage(
        created,
        attachmentFailures,
      );
      setState(() {
        _saving = false;
        _errorMessage = failureMessage;
        _successMessage = '旅行团已创建，系统团号：${created.groupNo}';
      });
      await _showTravelGroupResultDialog(
        title: '录入失败',
        message: failureMessage,
      );
      return;
    }
    _clearForm();
    await _loadData();
    if (!mounted) {
      return;
    }
    setState(() {
      _saving = false;
      _successMessage = '旅行团附件已上传，系统团号：${created.groupNo}';
    });
    await _showTravelGroupResultDialog(
      title: '录入成功',
      message: '旅行团附件上传成功。系统团号：${created.groupNo}',
    );
  }

  void _clearForm() {
    _formKey.currentState?.reset();
    _travelAgencyController.clear();
    _licensePlateController.clear();
    _guestCountController.clear();
    _tastingRoomNoController.clear();
    _arrivalTimeController.clear();
    _sourceRegionController.clear();
    _ageInfoController.clear();
    _previousStopOrderStatusController.clear();
    _keyCustomerInfoController.clear();
    setState(() {
      _visitDate = null;
      _groupType = null;
      _mentionedFeitianSelection = 'unset';
      _selectedGuide = null;
      _selectedTaster = null;
      _selectedLiaisonTaster = null;
      _createdGroupAwaitingAttachments = null;
      _keyCustomerPhotoFiles = <ApiMultipartFile>[];
      _guestInfoFiles = <ApiMultipartFile>[];
    });
  }

  Future<void> _selectGuide() async {
    final selected = await showDialog<GuideRecord>(
      context: context,
      builder: (context) => _GuidePickerDialog(
        businessApi: _businessApi,
        guides: _guides,
        initialAgency: _travelAgencyController.text.trim(),
      ),
    );
    if (selected == null || !mounted) {
      return;
    }
    setState(() {
      _selectedGuide = selected;
      if (!_guides.any((guide) => guide.id == selected.id)) {
        _guides = [..._guides, selected];
      }
    });
  }

  Future<void> _selectTaster() async {
    final selected = await showDialog<TasterOption>(
      context: context,
      builder: (context) => _TasterPickerDialog(
        title: '选择品鉴师',
        tasters: _tasters,
      ),
    );
    if (selected == null || !mounted) {
      return;
    }
    setState(() {
      _selectedTaster = selected;
    });
  }

  Future<void> _selectLiaisonTaster() async {
    final selected = await showDialog<TasterOption>(
      context: context,
      builder: (context) => _TasterPickerDialog(
        title: '选择对接品鉴师',
        tasters: _tasters,
      ),
    );
    if (selected == null || !mounted) {
      return;
    }
    setState(() {
      _selectedLiaisonTaster = selected;
    });
  }

  Future<void> _pickAttachmentFiles({required bool keyCustomerPhotos}) async {
    try {
      final picker = widget.filePicker;
      final selectedFiles =
          picker == null ? await _pickFilesFromDevice() : await picker();
      if (!mounted || selectedFiles.isEmpty) {
        return;
      }
      setState(() {
        if (keyCustomerPhotos) {
          _keyCustomerPhotoFiles = [
            ..._keyCustomerPhotoFiles,
            ...selectedFiles,
          ];
        } else {
          _guestInfoFiles = [..._guestInfoFiles, ...selectedFiles];
        }
        _errorMessage = null;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _errorMessage = '文件选择失败：${_messageForError(error)}';
        _successMessage = null;
      });
    }
  }

  Future<List<ApiMultipartFile>> _pickFilesFromDevice() async {
    final result = await FilePicker.pickFiles(
      allowMultiple: true,
      type: FileType.custom,
      allowedExtensions: const [
        'jpg',
        'jpeg',
        'png',
        'gif',
        'webp',
        'bmp',
        'tif',
        'tiff',
        'avif',
        'pdf',
        'doc',
        'docx',
        'xls',
        'xlsx',
        'csv',
        'txt',
        'log',
        'md',
      ],
    );
    return result?.files.map(ApiMultipartFile.fromPlatformFile).toList() ??
        const <ApiMultipartFile>[];
  }

  bool _isGroupMarked(TravelGroupRecord group) {
    return group.financeMark;
  }

  Future<void> _toggleGroupMark(TravelGroupRecord group) async {
    if (!canViewFinanceMark(widget.role)) {
      return;
    }
    setState(() {
      _markingGroupIds.add(group.id);
      _errorMessage = null;
      _successMessage = null;
    });
    try {
      final updated = await _businessApi.setTravelGroupFinanceMark(
        group.id,
        !group.financeMark,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _groups = [
          for (final item in _groups)
            if (item.id == updated.id) updated else item,
        ];
        _markingGroupIds.remove(group.id);
        _successMessage = updated.financeMark ? '标记信息已保存。' : '标记信息已取消。';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _markingGroupIds.remove(group.id);
        _errorMessage = _messageForError(error);
      });
    }
  }

  List<TravelGroupRecord> get _visibleGroups {
    if (_selectedFilter == '今日') {
      final today = formatDate(DateTime.now());
      return _groups.where((group) => group.visitDate == today).toList();
    }
    if (_selectedFilter == '未标记') {
      return _groups.where((group) => group.status == 'unmarked').toList();
    }
    if (_selectedFilter == '待总结') {
      return _groups
          .where((group) => group.status == 'pending_summary')
          .toList();
    }
    if (_selectedFilter == '已出单') {
      return _groups.where((group) => group.status == 'ordered').toList();
    }
    return _groups;
  }

  Future<void> _selectTravelAgency() async {
    final selected = await showDialog<TravelAgencyRecord>(
      context: context,
      builder: (context) => _TravelAgencyPickerDialog(
        businessApi: _businessApi,
        agencies: _travelAgencies,
        initialAgency: _travelAgencyController.text.trim(),
      ),
    );
    if (selected == null || !mounted) {
      return;
    }
    setState(() {
      _travelAgencyController.text = selected.name;
      if (!_travelAgencies.any((agency) => agency.id == selected.id)) {
        _travelAgencies = [..._travelAgencies, selected]..sort(
            (left, right) => left.name.toLowerCase().compareTo(
                  right.name.toLowerCase(),
                ),
          );
      }
      _successMessage = null;
      _errorMessage = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return ResponsivePage(
      children: [
        if (_errorMessage != null)
          _InlineNotice(message: _errorMessage!, tone: StatusTone.danger),
        if (_successMessage != null)
          _InlineNotice(message: _successMessage!, tone: StatusTone.success),
        ResponsiveTwoColumn(
          primary: Form(
            key: _formKey,
            child: Column(
              children: [
                FormSection(
                  title: '旅行团基础信息',
                  children: [
                    ResponsiveFormGrid(
                      children: [
                        _DateField(
                          fieldKey: const ValueKey('visit-date-field'),
                          label: '进店日期',
                          value: _visitDate,
                          errorText: _visitDate == null ? '必选' : null,
                          onTap: () async {
                            final result = await showDatePicker(
                              context: context,
                              initialDate: _visitDate ?? DateTime.now(),
                              firstDate: DateTime(2024),
                              lastDate: DateTime(2030),
                            );
                            if (result != null) {
                              setState(() => _visitDate = result);
                            }
                          },
                        ),
                        _SelectionField(
                          fieldKey: const ValueKey('travel-agency-field'),
                          label: '旅行社',
                          value: _travelAgencyController.text.trim().isEmpty
                              ? null
                              : _travelAgencyController.text.trim(),
                          errorText: _travelAgencyController.text.trim().isEmpty
                              ? '必选'
                              : null,
                          onTap: _selectTravelAgency,
                        ),
                        TextFormField(
                          controller: _licensePlateController,
                          decoration:
                              const InputDecoration(labelText: '车牌号（选填）'),
                        ),
                        _SelectionField(
                          fieldKey: const ValueKey('guide-field'),
                          label: '导游',
                          value: _selectedGuide == null
                              ? null
                              : '${_selectedGuide!.name} · ${_selectedGuide!.phone}',
                          errorText: _selectedGuide == null ? '必选' : null,
                          onTap: _selectGuide,
                        ),
                        TextFormField(
                          controller: _guestCountController,
                          keyboardType: TextInputType.number,
                          inputFormatters: [
                            FilteringTextInputFormatter.digitsOnly,
                          ],
                          decoration:
                              const InputDecoration(labelText: '人数（选填）'),
                          validator: _optionalPositiveIntValidator('人数必须大于 0'),
                        ),
                        TextFormField(
                          controller: _tastingRoomNoController,
                          decoration:
                              const InputDecoration(labelText: '品鉴馆号（选填）'),
                        ),
                        _SelectionField(
                          label: '品鉴师（选填）',
                          value: _selectedTaster == null
                              ? null
                              : '${_selectedTaster!.name} · ${_selectedTaster!.username}',
                          fieldKey: const ValueKey('taster-field'),
                          onTap: _selectTaster,
                          onClear: _selectedTaster == null
                              ? null
                              : () => setState(() => _selectedTaster = null),
                        ),
                        _SelectionField(
                          label: '对接品鉴师（选填）',
                          value: _selectedLiaisonTaster == null
                              ? null
                              : '${_selectedLiaisonTaster!.name} · ${_selectedLiaisonTaster!.username}',
                          fieldKey: const ValueKey('liaison-taster-field'),
                          onTap: _selectLiaisonTaster,
                          onClear: _selectedLiaisonTaster == null
                              ? null
                              : () => setState(
                                    () => _selectedLiaisonTaster = null,
                                  ),
                        ),
                        AppTimePickerField(
                          key: const ValueKey('arrival-time-field'),
                          controller: _arrivalTimeController,
                          label: '进店时间（选填）',
                        ),
                        DropdownButtonFormField<String>(
                          initialValue: _groupType ?? '',
                          decoration:
                              const InputDecoration(labelText: '团型（选填）'),
                          items: [
                            const DropdownMenuItem(
                              value: '',
                              child: Text('未选择'),
                            ),
                            for (final type in groupTypes)
                              DropdownMenuItem(value: type, child: Text(type)),
                          ],
                          onChanged: (value) {
                            setState(() => _groupType =
                                value == null || value.isEmpty ? null : value);
                          },
                        ),
                        TextFormField(
                          controller: _sourceRegionController,
                          decoration:
                              const InputDecoration(labelText: '客源地（选填）'),
                        ),
                        TextFormField(
                          controller: _ageInfoController,
                          decoration:
                              const InputDecoration(labelText: '年龄文本（选填）'),
                        ),
                        DropdownButtonFormField<String>(
                          initialValue: _mentionedFeitianSelection,
                          decoration: const InputDecoration(
                            labelText: '是否提及飞天（选填）',
                          ),
                          items: const [
                            DropdownMenuItem(
                              value: 'unset',
                              child: Text('未填写'),
                            ),
                            DropdownMenuItem(value: 'yes', child: Text('是')),
                            DropdownMenuItem(value: 'no', child: Text('否')),
                          ],
                          onChanged: (value) => setState(
                            () => _mentionedFeitianSelection = value ?? 'unset',
                          ),
                        ),
                        _PreviousStopOrderField(
                          controller: _previousStopOrderStatusController,
                          onChanged: () => setState(() {}),
                        ),
                        TextFormField(
                          controller: _keyCustomerInfoController,
                          maxLines: 3,
                          decoration: const InputDecoration(
                            labelText: '重点客户信息（选填）',
                            alignLabelWithHint: true,
                          ),
                        ),
                        _AttachmentPickerField(
                          fieldKey: const ValueKey('key-customer-photo-picker'),
                          label: '重点客户照片（选填，可多选）',
                          files: _keyCustomerPhotoFiles,
                          onPick: () => _pickAttachmentFiles(
                            keyCustomerPhotos: true,
                          ),
                          onRemove: (index) => setState(
                            () => _keyCustomerPhotoFiles.removeAt(index),
                          ),
                        ),
                        _AttachmentPickerField(
                          fieldKey: const ValueKey('guest-info-picker'),
                          label: '客人信息附件（选填，可多选）',
                          files: _guestInfoFiles,
                          onPick: () => _pickAttachmentFiles(
                            keyCustomerPhotos: false,
                          ),
                          onRemove: (index) => setState(
                            () => _guestInfoFiles.removeAt(index),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                FormSection(
                  title: '提交录入',
                  trailing:
                      const StatusTag(label: '系统自动生成团号', tone: StatusTone.info),
                  children: [
                    SectionActions(
                      primaryLabel: _saving
                          ? '保存中...'
                          : _createdGroupAwaitingAttachments == null
                              ? '保存旅行团'
                              : '重试附件上传',
                      secondaryLabel: '清空',
                      onPrimaryPressed: _saving
                          ? null
                          : _createdGroupAwaitingAttachments == null
                              ? _saveTravelGroup
                              : _retryAttachmentUploads,
                      onSecondaryPressed: () {
                        _clearForm();
                        setState(() {
                          _successMessage = null;
                          _errorMessage = null;
                        });
                      },
                    ),
                  ],
                ),
              ],
            ),
          ),
          secondary: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const AppSearchField(hintText: '搜索团号、旅行社、导游'),
              const SizedBox(height: 12),
              AppFilterBar(
                filters: const ['今日', '未标记', '待总结', '已出单'],
                selected: _selectedFilter,
                onSelected: (value) => setState(() => _selectedFilter = value),
              ),
              const SizedBox(height: 12),
              if (_loading)
                const Center(child: CircularProgressIndicator())
              else
                AppRecordList(
                  items: [
                    for (final group in _visibleGroups)
                      AppRecordItem(
                        title: group.groupNo,
                        subtitle:
                            '${group.travelAgency ?? '未填旅行社'} · ${group.guideName ?? '未填导游'} · ${group.guestCount} 人',
                        meta: [
                          if (group.tastingRoomNo != null) group.tastingRoomNo!,
                          if (group.arrivalTime != null)
                            '${group.arrivalTime} 进店',
                          if (group.salesAmountCents > 0)
                            formatMoneyCents(group.salesAmountCents),
                        ],
                        icon: Icons.directions_bus_rounded,
                        trailing: Wrap(
                          spacing: 8,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            StatusTag(
                              label: _groupStatusLabel(group.status),
                              tone: _groupStatusTone(group.status),
                            ),
                            if (canViewFinanceMark(widget.role))
                              MarkInfoButton(
                                marked: _isGroupMarked(group),
                                label: '标记',
                                compact: true,
                                busy: _markingGroupIds.contains(group.id),
                                onPressed: _markingGroupIds.contains(group.id)
                                    ? null
                                    : () => _toggleGroupMark(group),
                              ),
                          ],
                        ),
                      ),
                  ],
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _SelectionField extends StatelessWidget {
  const _SelectionField({
    required this.label,
    required this.value,
    required this.onTap,
    this.fieldKey,
    this.errorText,
    this.onClear,
  });

  final Key? fieldKey;
  final String label;
  final String? value;
  final VoidCallback onTap;
  final String? errorText;
  final VoidCallback? onClear;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      key: fieldKey,
      borderRadius: BorderRadius.circular(8),
      onTap: onTap,
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          errorText: errorText,
          suffixIcon: onClear == null
              ? const Icon(Icons.arrow_drop_down_rounded)
              : IconButton(
                  tooltip: '清除选择',
                  onPressed: onClear,
                  icon: const Icon(Icons.close_rounded),
                ),
        ),
        child: Text(value ?? '请选择'),
      ),
    );
  }
}

class _PreviousStopOrderField extends StatelessWidget {
  const _PreviousStopOrderField({
    required this.controller,
    required this.onChanged,
  });

  final TextEditingController controller;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextFormField(
          controller: controller,
          decoration: const InputDecoration(
            labelText: '前站出单情况（选填）',
            hintText: '可输入任意自定义文本',
          ),
          onChanged: (_) => onChanged(),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          children: [
            for (final option in const ['均单', '熊猫'])
              ChoiceChip(
                label: Text(option),
                selected: controller.text.trim() == option,
                onSelected: (selected) {
                  controller.text = selected ? option : '';
                  onChanged();
                },
              ),
          ],
        ),
      ],
    );
  }
}

class _AttachmentPickerField extends StatelessWidget {
  const _AttachmentPickerField({
    required this.fieldKey,
    required this.label,
    required this.files,
    required this.onPick,
    required this.onRemove,
  });

  final Key fieldKey;
  final String label;
  final List<ApiMultipartFile> files;
  final VoidCallback onPick;
  final ValueChanged<int> onRemove;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        OutlinedButton.icon(
          key: fieldKey,
          onPressed: onPick,
          icon: const Icon(Icons.attach_file_rounded),
          label: Text(label),
        ),
        if (files.isNotEmpty) ...[
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (var index = 0; index < files.length; index += 1)
                InputChip(
                  label: Text(files[index].fileName),
                  onDeleted: () => onRemove(index),
                ),
            ],
          ),
        ],
      ],
    );
  }
}

class _TravelAgencyPickerDialog extends StatefulWidget {
  const _TravelAgencyPickerDialog({
    required this.businessApi,
    required this.agencies,
    required this.initialAgency,
  });

  final BusinessApi businessApi;
  final List<TravelAgencyRecord> agencies;
  final String initialAgency;

  @override
  State<_TravelAgencyPickerDialog> createState() =>
      _TravelAgencyPickerDialogState();
}

class _TravelAgencyPickerDialogState extends State<_TravelAgencyPickerDialog> {
  late final TextEditingController _searchController;
  late final TextEditingController _newAgencyController;
  bool _creating = false;
  String _agencyQuery = '';
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _searchController = TextEditingController();
    _newAgencyController = TextEditingController(text: widget.initialAgency);
  }

  @override
  void dispose() {
    _searchController.dispose();
    _newAgencyController.dispose();
    super.dispose();
  }

  List<TravelAgencyRecord> get _filteredAgencies {
    final query = _agencyQuery.trim().toLowerCase();
    if (query.isEmpty) {
      return widget.agencies;
    }
    return widget.agencies
        .where((agency) => agency.name.toLowerCase().contains(query))
        .toList();
  }

  Future<void> _createAndSelect() async {
    final name = _newAgencyController.text.trim();
    if (name.isEmpty) {
      return;
    }
    setState(() {
      _creating = true;
      _errorMessage = null;
    });
    try {
      final agency = await widget.businessApi.createTravelAgency({
        'name': name,
      });
      if (mounted) {
        Navigator.of(context).pop(agency);
      }
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _creating = false;
        _errorMessage = _messageForError(error);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final filteredAgencies = _filteredAgencies;
    return AlertDialog(
      title: const Text('选择旅行社'),
      content: SizedBox(
        width: 520,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: _searchController,
                decoration: InputDecoration(
                  labelText: '搜索旅行社',
                  hintText: '输入旅行社名称查询',
                  prefixIcon: const Icon(Icons.search_rounded),
                  suffixIcon: _agencyQuery.isEmpty
                      ? null
                      : IconButton(
                          tooltip: '清空搜索',
                          onPressed: () {
                            _searchController.clear();
                            setState(() => _agencyQuery = '');
                          },
                          icon: const Icon(Icons.close_rounded),
                        ),
                ),
                textInputAction: TextInputAction.search,
                onChanged: (value) => setState(() => _agencyQuery = value),
              ),
              const SizedBox(height: 12),
              if (widget.agencies.isEmpty)
                const Text('暂无已录入旅行社，可在下方新建。')
              else if (filteredAgencies.isEmpty)
                const Text('未找到匹配旅行社，可调整关键词或在下方新建。')
              else
                ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 260),
                  child: ListView(
                    shrinkWrap: true,
                    children: [
                      for (final agency in filteredAgencies)
                        ListTile(
                          title: Text(agency.name),
                          subtitle: agency.contactPhone == null
                              ? null
                              : Text(agency.contactPhone!),
                          trailing: const Icon(Icons.check_circle_outline),
                          onTap: () => Navigator.of(context).pop(agency),
                        ),
                    ],
                  ),
                ),
              const Divider(height: 28),
              TextField(
                controller: _newAgencyController,
                decoration: const InputDecoration(labelText: '新建旅行社名称'),
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => _createAndSelect(),
              ),
              if (_errorMessage != null) ...[
                const SizedBox(height: 12),
                _InlineNotice(message: _errorMessage!, tone: StatusTone.danger),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        FilledButton.icon(
          onPressed: _creating ? null : _createAndSelect,
          icon: _creating
              ? const SizedBox.square(
                  dimension: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.add_rounded),
          label: const Text('新建并选择'),
        ),
      ],
    );
  }
}

class _GuidePickerDialog extends StatefulWidget {
  const _GuidePickerDialog({
    required this.businessApi,
    required this.guides,
    required this.initialAgency,
  });

  final BusinessApi businessApi;
  final List<GuideRecord> guides;
  final String initialAgency;

  @override
  State<_GuidePickerDialog> createState() => _GuidePickerDialogState();
}

class _GuidePickerDialogState extends State<_GuidePickerDialog> {
  final _formKey = GlobalKey<FormState>();
  final _searchController = TextEditingController();
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();
  late final TextEditingController _agencyController;
  final _remarksController = TextEditingController();
  bool _creating = false;
  String _guideQuery = '';
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _agencyController = TextEditingController(text: widget.initialAgency);
  }

  @override
  void dispose() {
    _searchController.dispose();
    _nameController.dispose();
    _phoneController.dispose();
    _agencyController.dispose();
    _remarksController.dispose();
    super.dispose();
  }

  Future<void> _createGuide() async {
    if (!(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    setState(() {
      _creating = true;
      _errorMessage = null;
    });
    try {
      final guide = await widget.businessApi.createGuide({
        'name': _nameController.text.trim(),
        'phone': _phoneController.text.trim(),
        'travelAgency': _agencyController.text.trim(),
        'remarks': _remarksController.text.trim(),
      });
      if (mounted) {
        Navigator.of(context).pop(guide);
      }
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _creating = false;
        _errorMessage = _messageForError(error);
      });
    }
  }

  List<GuideRecord> get _filteredGuides {
    final query = _guideQuery.trim().toLowerCase();
    if (query.isEmpty) {
      return widget.guides;
    }
    return widget.guides.where((guide) {
      return [
        guide.name,
        guide.phone,
        guide.travelAgency,
      ].any((value) => value.toLowerCase().contains(query));
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final filteredGuides = _filteredGuides;
    return AlertDialog(
      title: const Text('选择导游'),
      content: SizedBox(
        width: 560,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: _searchController,
                decoration: InputDecoration(
                  labelText: '搜索导游',
                  hintText: '输入导游姓名查询',
                  prefixIcon: const Icon(Icons.search_rounded),
                  suffixIcon: _guideQuery.isEmpty
                      ? null
                      : IconButton(
                          tooltip: '清空搜索',
                          onPressed: () {
                            _searchController.clear();
                            setState(() => _guideQuery = '');
                          },
                          icon: const Icon(Icons.close_rounded),
                        ),
                ),
                textInputAction: TextInputAction.search,
                onChanged: (value) => setState(() => _guideQuery = value),
              ),
              const SizedBox(height: 12),
              if (widget.guides.isEmpty)
                const Text('暂无导游，可在下方新建。')
              else if (filteredGuides.isEmpty)
                const Text('未找到匹配导游，可调整关键词或在下方新建。')
              else
                ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 280),
                  child: ListView(
                    shrinkWrap: true,
                    children: [
                      for (final guide in filteredGuides)
                        ListTile(
                          title: Text(guide.name),
                          subtitle:
                              Text('${guide.phone} · ${guide.travelAgency}'),
                          trailing: const Icon(Icons.check_circle_outline),
                          onTap: () => Navigator.of(context).pop(guide),
                        ),
                    ],
                  ),
                ),
              const Divider(height: 28),
              Form(
                key: _formKey,
                child: Column(
                  children: [
                    TextFormField(
                      controller: _nameController,
                      decoration: const InputDecoration(labelText: '导游姓名'),
                      validator: _requiredValidator('导游姓名不能为空'),
                    ),
                    const SizedBox(height: 8),
                    TextFormField(
                      controller: _phoneController,
                      keyboardType: TextInputType.phone,
                      decoration: const InputDecoration(labelText: '导游电话'),
                      validator: _requiredValidator('导游电话不能为空'),
                    ),
                    const SizedBox(height: 8),
                    TextFormField(
                      controller: _agencyController,
                      decoration: const InputDecoration(labelText: '常用旅行社（选填）'),
                    ),
                    const SizedBox(height: 8),
                    TextFormField(
                      controller: _remarksController,
                      decoration: const InputDecoration(labelText: '备注'),
                    ),
                  ],
                ),
              ),
              if (_errorMessage != null) ...[
                const SizedBox(height: 12),
                _InlineNotice(message: _errorMessage!, tone: StatusTone.danger),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        FilledButton.icon(
          onPressed: _creating ? null : _createGuide,
          icon: _creating
              ? const SizedBox.square(
                  dimension: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.add_rounded),
          label: const Text('新建并选择'),
        ),
      ],
    );
  }
}

class _TasterPickerDialog extends StatelessWidget {
  const _TasterPickerDialog({
    required this.title,
    required this.tasters,
  });

  final String title;
  final List<TasterOption> tasters;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(title),
      content: SizedBox(
        width: 420,
        child: tasters.isEmpty
            ? const Text('暂无可选品鉴师。')
            : ListView(
                shrinkWrap: true,
                children: [
                  for (final taster in tasters)
                    ListTile(
                      title: Text(taster.name),
                      subtitle: Text(taster.username),
                      onTap: () => Navigator.of(context).pop(taster),
                    ),
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
}

class _DateField extends StatelessWidget {
  const _DateField({
    required this.fieldKey,
    required this.label,
    required this.value,
    required this.onTap,
    this.errorText,
  });

  final Key fieldKey;
  final String label;
  final DateTime? value;
  final VoidCallback onTap;
  final String? errorText;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      key: fieldKey,
      borderRadius: BorderRadius.circular(8),
      onTap: onTap,
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          errorText: errorText,
          suffixIcon: const Icon(Icons.calendar_month_rounded),
        ),
        child: Text(value == null ? '请选择' : formatDate(value!)),
      ),
    );
  }
}

class _InlineNotice extends StatelessWidget {
  const _InlineNotice({
    required this.message,
    required this.tone,
  });

  final String message;
  final StatusTone tone;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: StatusTag(label: message, tone: tone),
    );
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

FormFieldValidator<String> _optionalPositiveIntValidator(String message) {
  return (value) {
    final text = (value ?? '').trim();
    if (text.isEmpty) {
      return null;
    }
    final number = int.tryParse(text);
    if (number == null || number <= 0) {
      return message;
    }
    return null;
  };
}

void _putNonEmpty(
  Map<String, dynamic> body,
  String key,
  String value,
) {
  final text = value.trim();
  if (text.isNotEmpty) {
    body[key] = text;
  }
}

String _attachmentCategoryFailure(
  String category,
  List<ApiMultipartFile> files,
  Object error,
) {
  final names = files.map((file) => file.fileName).join('、');
  return '$category（$names）：${_messageForError(error)}';
}

String _attachmentFailureMessage(
  TravelGroupRecord group,
  List<String> failures,
) {
  return '旅行团主记录已经创建。系统团号：${group.groupNo}。以下附件上传失败：'
      '${failures.join('；')}。请点击“重试附件上传”，不会重复创建旅行团。';
}

String _messageForError(Object error) {
  if (error is ApiException) {
    final message = error.message.trim();
    if (message.isEmpty) {
      return '操作失败，请稍后重试。';
    }
    if (_containsSensitiveInternalDetails(message)) {
      return '服务暂时无法处理该请求，请稍后重试或联系管理员。';
    }
    return message;
  }
  return '操作失败，请稍后重试。';
}

bool _containsSensitiveInternalDetails(String message) {
  final normalized = message.toLowerCase();
  return normalized.contains('prisma') ||
      normalized.contains('stack trace') ||
      normalized.contains('node_modules') ||
      normalized.contains('sqlstate') ||
      normalized.contains(' at /') ||
      normalized.contains(r' at c:\');
}

String _groupStatusLabel(String status) {
  switch (status) {
    case 'ordered':
      return '已出单';
    case 'pending_summary':
      return '待总结';
    case 'unmarked':
    default:
      return '未标记';
  }
}

StatusTone _groupStatusTone(String status) {
  switch (status) {
    case 'ordered':
      return StatusTone.success;
    case 'pending_summary':
      return StatusTone.warning;
    case 'unmarked':
    default:
      return StatusTone.neutral;
  }
}
