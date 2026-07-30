import 'dart:async';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/auth/role_access.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/app_record_list.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/search_filter_bar.dart';
import '../../shared/widgets/state_views.dart';
import '../../shared/widgets/status_tag.dart';
import '../../shared/widgets/time_picker_field.dart';
import '../guide_management/remote_guide_picker_dialog.dart';
import '../sales_orders/order_form_page.dart';
import '../travel_group_attachments/attachment_picker_service.dart';
import '../travel_group_attachments/downloaded_file_service.dart';
import '../travel_group_attachments/fullscreen_photo_preview_page.dart';
import '../travel_group_attachments/incoming_attachment_service.dart';
import '../travel_group_detail/travel_group_detail_panel.dart';
import '../travel_groups/tasting_items_editor.dart';

const _allFilter = '__all__';
const _tasterScopeAll = 'all';
const _tasterScopeLiaison = 'liaison';
const _tasterScopeReception = 'reception';

const _editableStatuses = <String>{'unmarked', 'pending_summary', 'ordered'};

class TravelGroupQueryPage extends StatefulWidget {
  static const tasterScopeAll = _tasterScopeAll;
  static const tasterScopeLiaison = _tasterScopeLiaison;
  static const tasterScopeReception = _tasterScopeReception;

  const TravelGroupQueryPage({
    super.key,
    required this.apiClient,
    required this.token,
    required this.role,
    required this.currentUserId,
    this.initialTasterScope = tasterScopeAll,
    this.attachmentPickerService,
    this.incomingAttachmentService,
    this.downloadedFileService,
    this.photoPreviewOrientationService,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;
  final String currentUserId;
  final String initialTasterScope;
  final AttachmentPickerService? attachmentPickerService;
  final IncomingAttachmentService? incomingAttachmentService;
  final DownloadedFileService? downloadedFileService;
  final PhotoPreviewOrientationService? photoPreviewOrientationService;

  @override
  State<TravelGroupQueryPage> createState() => _TravelGroupQueryPageState();
}

class _TravelGroupQueryPageState extends State<TravelGroupQueryPage> {
  late BusinessApi _businessApi;
  late final AttachmentPickerService _attachmentPickerService;
  late final IncomingAttachmentService _incomingAttachmentService;
  late final DownloadedFileService _downloadedFileService;
  late final PhotoPreviewOrientationService _photoPreviewOrientationService;
  late final TextEditingController _keywordController;

  late DateTime _start;
  late DateTime _end;
  bool _dateRangeAll = false;
  String _keyword = '';
  String _groupTypeFilter = _allFilter;
  String _travelAgencyFilter = _allFilter;
  String _guideFilter = _allFilter;
  GuideRecord? _selectedGuideFilter;
  String _tasterFilter = _allFilter;
  late String _tasterScope;
  String? _selectedId;

  bool _loading = true;
  bool _exporting = false;
  String? _errorMessage;
  List<TravelGroupRecord> _groups = const <TravelGroupRecord>[];
  List<GuideRecord> _guides = const <GuideRecord>[];
  List<TasterOption> _tasters = const <TasterOption>[];
  final Set<String> _markingIds = <String>{};
  final Set<String> _summarizingIds = <String>{};
  final Set<String> _notEnteredUpdatingIds = <String>{};
  String? _activeDetailGroupId;
  bool _handlingIncomingAttachments = false;

  @override
  void initState() {
    super.initState();
    _resetDefaultDateRange();
    _tasterScope = _normalizedInitialTasterScope();
    _businessApi =
        BusinessApi(apiClient: widget.apiClient, token: widget.token);
    _attachmentPickerService =
        widget.attachmentPickerService ?? AttachmentPickerService();
    _incomingAttachmentService =
        widget.incomingAttachmentService ?? IncomingAttachmentService.instance;
    _downloadedFileService =
        widget.downloadedFileService ?? DownloadedFileService();
    _photoPreviewOrientationService = widget.photoPreviewOrientationService ??
        const SystemPhotoPreviewOrientationService();
    _incomingAttachmentService.addListener(_onIncomingAttachmentsChanged);
    _keywordController = TextEditingController();
    _loadData();
    unawaited(_incomingAttachmentService.initialize());
  }

  @override
  void didUpdateWidget(covariant TravelGroupQueryPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token ||
        oldWidget.currentUserId != widget.currentUserId ||
        oldWidget.role != widget.role ||
        oldWidget.initialTasterScope != widget.initialTasterScope) {
      _businessApi =
          BusinessApi(apiClient: widget.apiClient, token: widget.token);
      _tasterScope = _normalizedInitialTasterScope();
      if (oldWidget.role != widget.role) {
        _resetDefaultDateRange();
      }
      _loadData();
    }
  }

  void _resetDefaultDateRange() {
    final today = _shanghaiToday();
    if (widget.role == UserRole.sales) {
      _start = today;
      _end = today;
      _dateRangeAll = false;
      return;
    }
    if (widget.role == UserRole.taster) {
      _start = today;
      _end = today;
      _dateRangeAll = true;
      return;
    }
    _start = today.subtract(const Duration(days: 30));
    _end = today;
    _dateRangeAll = false;
  }

  @override
  void dispose() {
    _incomingAttachmentService.removeListener(_onIncomingAttachmentsChanged);
    _keywordController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    try {
      final results = await Future.wait<Object>([
        _businessApi.listTravelGroups(
          limit: 200,
          start: _travelGroupQueryStart(),
          end: _dateRangeAll ? null : _end,
          keyword: _keyword,
          groupType: _optionalFilter(_groupTypeFilter),
          travelAgency: _optionalFilter(_travelAgencyFilter),
          guideId: _optionalFilter(_guideFilter),
          tasterId: _tasterIdFilter(),
          liaisonTasterId: _liaisonTasterIdFilter(),
        ),
        _businessApi.listGuidesPage(
          page: 1,
          pageSize: 20,
          isActive: true,
        ),
        _businessApi.listTasters(),
      ]);

      if (!mounted) {
        return;
      }

      final groups = results[0] as List<TravelGroupRecord>;
      final guidePage = results[1] as GuidePage;
      final guides = _selectedGuideFilter == null
          ? guidePage.guides
          : _mergeGuideRecords(guidePage.guides, [_selectedGuideFilter!]);
      final tasters = results[2] as List<TasterOption>;

      setState(() {
        _groups = groups;
        _guides = guides;
        _tasters = tasters;
        if (_tasterFilter != _allFilter &&
            !tasters.any((taster) => taster.id == _tasterFilter)) {
          _tasterFilter = _allFilter;
        }
        _selectedId = _selectedIdFor(groups);
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

  String _normalizedInitialTasterScope() {
    if (widget.initialTasterScope == _tasterScopeLiaison) {
      return _tasterScopeLiaison;
    }
    if (widget.initialTasterScope == _tasterScopeReception) {
      return _tasterScopeReception;
    }
    return _tasterScopeAll;
  }

  Future<void> _pickGuideFilter() async {
    final result = await showDialog<GuidePickerResult>(
      context: context,
      builder: (context) => RemoteGuidePickerDialog(
        businessApi: _businessApi,
        title: '筛选导游',
        initialGuide: _selectedGuideFilter,
        allowClear: true,
      ),
    );
    if (result == null || !mounted) {
      return;
    }
    setState(() {
      _selectedGuideFilter = result.guide;
      _guideFilter = result.guide?.id ?? _allFilter;
      if (result.guide != null) {
        _guides = _mergeGuideRecords(_guides, [result.guide!]);
      }
    });
    _loadData();
  }

  String? _selectedIdFor(List<TravelGroupRecord> groups) {
    if (groups.isEmpty) {
      return null;
    }
    if (_selectedId != null && groups.any((group) => group.id == _selectedId)) {
      return _selectedId;
    }
    return groups.first.id;
  }

  String? _tasterIdFilter() {
    if (widget.role == UserRole.taster) {
      return _tasterScope == _tasterScopeReception &&
              widget.currentUserId.isNotEmpty
          ? widget.currentUserId
          : null;
    }
    return _optionalFilter(_tasterFilter);
  }

  String? _liaisonTasterIdFilter() {
    return widget.role == UserRole.taster &&
            _tasterScope == _tasterScopeLiaison &&
            widget.currentUserId.isNotEmpty
        ? widget.currentUserId
        : null;
  }

  DateTime? _travelGroupQueryStart() {
    if (widget.role == UserRole.taster && _tasterScope == _tasterScopeLiaison) {
      final today = _shanghaiToday();
      if (_dateRangeAll || _start.isBefore(today)) {
        return today;
      }
    }
    return _dateRangeAll ? null : _start;
  }

  TravelGroupRecord? _recordById(String id) {
    for (final group in _groups) {
      if (group.id == id) {
        return group;
      }
    }
    return null;
  }

  void _onIncomingAttachmentsChanged() {
    if (!mounted) {
      return;
    }
    setState(() {});
    final activeId = _activeDetailGroupId;
    if (activeId == null || _handlingIncomingAttachments) {
      return;
    }
    final group = _recordById(activeId);
    if (group == null || !_canDeleteAttachments(group)) {
      return;
    }
    final claimed = _incomingAttachmentService.claim(
      category: PendingAttachmentCategory.guestInfo,
      includeColdStart: false,
      maxCount: attachmentMaxFileCount,
    );
    if (claimed.isNotEmpty) {
      unawaited(_uploadClaimedIncoming(group, claimed));
    }
  }

  Future<void> _uploadClaimedIncoming(
    TravelGroupRecord group,
    List<PendingIncomingAttachment> claimed,
  ) async {
    if (_handlingIncomingAttachments) {
      _incomingAttachmentService.restore(claimed);
      return;
    }
    _handlingIncomingAttachments = true;
    final outstanding = List<PendingIncomingAttachment>.from(claimed);
    try {
      final grouped =
          <PendingAttachmentCategory, List<PendingIncomingAttachment>>{};
      for (final item in claimed) {
        grouped.putIfAbsent(item.category, () => []).add(item);
      }
      var currentGroup = group;
      for (final entry in grouped.entries) {
        final result = await _businessApi.uploadTravelGroupAttachments(
          currentGroup.id,
          category: entry.key == PendingAttachmentCategory.keyCustomerPhoto
              ? TravelGroupAttachmentCategory.keyCustomerPhoto
              : TravelGroupAttachmentCategory.guestInfo,
          files: entry.value.map((item) => item.attachment.file).toList(),
        );
        currentGroup = result.travelGroup;
        await _incomingAttachmentService.complete(entry.value);
        outstanding.removeWhere(entry.value.contains);
      }
      if (!mounted) {
        return;
      }
      _replaceGroup(currentGroup);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('微信附件已上传。')),
      );
    } catch (error) {
      _incomingAttachmentService.restore(outstanding);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('微信附件上传失败：${_messageForError(error)}'),
            action: SnackBarAction(
              label: '重试',
              onPressed: () {
                final retry = _claimAllPendingAttachments();
                if (retry.isNotEmpty) {
                  unawaited(_uploadClaimedIncoming(group, retry));
                }
              },
            ),
          ),
        );
      }
    } finally {
      _handlingIncomingAttachments = false;
    }
  }

  List<PendingIncomingAttachment> _claimAllPendingAttachments() {
    return <PendingIncomingAttachment>[
      ..._incomingAttachmentService.claim(
        category: PendingAttachmentCategory.keyCustomerPhoto,
        includeColdStart: true,
        maxCount: attachmentMaxFileCount,
      ),
      ..._incomingAttachmentService.claim(
        category: PendingAttachmentCategory.guestInfo,
        includeColdStart: true,
        maxCount: attachmentMaxFileCount,
      ),
    ];
  }

  Future<void> _choosePendingAttachmentTarget() async {
    List<TravelGroupRecord> availableGroups;
    try {
      availableGroups = (await _businessApi.listTravelGroups(limit: 100))
          .where(_canDeleteAttachments)
          .toList();
    } catch (error) {
      _showAttachmentError(error);
      return;
    }
    if (!mounted) {
      return;
    }
    if (availableGroups.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('没有可修改的旅行团，暂时无法导入附件。')),
      );
      return;
    }
    final selected = await showDialog<TravelGroupRecord>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('选择附件所属旅行团'),
        content: SizedBox(
          width: 520,
          child: ListView(
            shrinkWrap: true,
            children: [
              for (final group in availableGroups)
                ListTile(
                  title: Text(group.groupNo),
                  subtitle: Text(
                    '${_display(group.visitDate)} · '
                    '${_display(group.travelAgency)} · '
                    '${_display(group.guideName)}',
                  ),
                  onTap: () => Navigator.of(context).pop(group),
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
      ),
    );
    if (selected == null || !mounted) {
      return;
    }
    final claimed = _claimAllPendingAttachments();
    if (claimed.isNotEmpty) {
      await _uploadClaimedIncoming(selected, claimed);
    }
  }

  Future<void> _discardPendingAttachments() async {
    final items = _incomingAttachmentService.pending;
    if (items.isEmpty) {
      return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('取消导入附件'),
        content: const Text('确定清除全部待导入附件吗？清除后需要重新从微信分享。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('返回'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('清除'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await _incomingAttachmentService.discard(items);
    }
  }

  Future<void> _openTravelGroupDetail(TravelGroupRecord group) async {
    setState(() => _selectedId = group.id);
    _activeDetailGroupId = group.id;
    try {
      await showDialog<void>(
        context: context,
        builder: (context) {
          return StatefulBuilder(
            builder: (context, setDialogState) {
              final selected = _recordById(group.id) ?? group;
              void refreshDetail() {
                if (context.mounted && _activeDetailGroupId == selected.id) {
                  setDialogState(() {});
                }
              }

              Future<void> runAction(Future<void> Function() action) async {
                await action();
                if (mounted) {
                  setDialogState(() {});
                }
              }

              final size = MediaQuery.sizeOf(context);
              final tasterReadOnlyReason = _tasterReadOnlyReason(selected);
              return Dialog(
                clipBehavior: Clip.antiAlias,
                child: ConstrainedBox(
                  constraints: BoxConstraints(
                    maxWidth: size.width < 1040 ? size.width - 32 : 980,
                    maxHeight: size.height < 860 ? size.height - 48 : 820,
                  ),
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (tasterReadOnlyReason != null)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 12),
                            child: StatusTag(
                              key: const ValueKey(
                                'travel-group-taster-read-only-reason',
                              ),
                              label: tasterReadOnlyReason,
                              tone: StatusTone.neutral,
                            ),
                          ),
                        TravelGroupDetailPanel(
                          group: selected,
                          role: widget.role,
                          marking: _markingIds.contains(selected.id),
                          summarizing: _summarizingIds.contains(selected.id),
                          updatingNotEntered:
                              _notEnteredUpdatingIds.contains(selected.id),
                          onCreateOrder: _canCreateOrder(widget.role)
                              ? () => _openOrderForm(selected)
                              : null,
                          onEdit: _canEditGroup(selected)
                              ? () =>
                                  runAction(() => _editTravelGroup(selected))
                              : null,
                          onFinanceMark: _canMark(widget.role)
                              ? () =>
                                  runAction(() => _toggleFinanceMark(selected))
                              : null,
                          onSummary: _canSubmitSummary(widget.role) &&
                                  (widget.role != UserRole.taster ||
                                      selected.canEditByCurrentUser)
                              ? () => runAction(() => _submitSummary(selected))
                              : null,
                          onConfirmNotEntered: selected.entryStatus ==
                                      'pending_entry' &&
                                  canConfirmTravelGroupNotEntered(
                                    widget.role,
                                    liaisonTasterId: selected.liaisonTasterId,
                                    currentUserId: widget.currentUserId,
                                  )
                              ? () => _setTravelGroupNotEntered(
                                    selected,
                                    true,
                                    refreshDetail,
                                  )
                              : null,
                          onRevokeNotEntered:
                              selected.entryStatus == 'not_entered' &&
                                      canRevokeTravelGroupNotEntered(
                                        widget.role,
                                      )
                                  ? () => _setTravelGroupNotEntered(
                                        selected,
                                        false,
                                        refreshDetail,
                                      )
                                  : null,
                          onPreviewAttachment: (attachment) =>
                              _previewAttachment(selected, attachment),
                          onDownloadAttachment: (attachment) =>
                              _downloadAttachment(selected, attachment),
                          onDeleteAttachment: _canDeleteAttachments(selected)
                              ? (attachment) => runAction(
                                    () =>
                                        _deleteAttachment(selected, attachment),
                                  )
                              : null,
                          onUploadKeyCustomerPhotos:
                              _canDeleteAttachments(selected)
                                  ? () => runAction(
                                        () => _uploadAttachments(
                                          selected,
                                          TravelGroupAttachmentCategory
                                              .keyCustomerPhoto,
                                        ),
                                      )
                                  : null,
                          onUploadGuestInfoAttachments:
                              _canDeleteAttachments(selected)
                                  ? () => runAction(
                                        () => _uploadAttachments(
                                          selected,
                                          TravelGroupAttachmentCategory
                                              .guestInfo,
                                        ),
                                      )
                                  : null,
                        ),
                      ],
                    ),
                  ),
                ),
              );
            },
          );
        },
      );
    } finally {
      _activeDetailGroupId = null;
    }
  }

  Future<void> _openOrderForm(TravelGroupRecord group) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (context) => Scaffold(
          appBar: AppBar(title: Text('${group.groupNo} · 录入订单')),
          body: OrderFormPage(
            apiClient: widget.apiClient,
            token: widget.token,
            role: widget.role,
            travelGroupId: group.id,
          ),
        ),
      ),
    );
  }

  Future<void> _toggleFinanceMark(TravelGroupRecord group) async {
    setState(() {
      _markingIds.add(group.id);
      _errorMessage = null;
    });

    try {
      final updated = await _businessApi.setTravelGroupFinanceMark(
        group.id,
        !group.financeMark,
      );
      if (!mounted) {
        return;
      }
      _replaceGroup(updated);
      setState(() {
        _markingIds.remove(group.id);
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _markingIds.remove(group.id);
        _errorMessage = _messageForError(error);
      });
    }
  }

  Future<void> _submitSummary(TravelGroupRecord group) async {
    final summary = await showDialog<String>(
      context: context,
      builder: (context) => _TasterSummaryDialog(group: group),
    );
    if (summary == null) {
      return;
    }

    setState(() {
      _summarizingIds.add(group.id);
      _errorMessage = null;
    });

    try {
      final updated =
          await _businessApi.submitTravelGroupTasterSummary(group.id, summary);
      if (!mounted) {
        return;
      }
      _replaceGroup(updated);
      setState(() {
        _summarizingIds.remove(group.id);
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _summarizingIds.remove(group.id);
        _errorMessage = _messageForError(error);
      });
    }
  }

  Future<void> _setTravelGroupNotEntered(
    TravelGroupRecord group,
    bool confirmed,
    VoidCallback refreshDetail,
  ) async {
    if (_notEnteredUpdatingIds.contains(group.id)) {
      return;
    }
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(confirmed ? '确认未进店' : '撤销未进店'),
        content: Text(
          confirmed
              ? '确定将旅行团 ${group.groupNo} 标记为未进店吗？'
                  '系统将记录本次操作者和确认时间。'
              : '确定撤销旅行团 ${group.groupNo} 的未进店确认吗？'
                  '撤销后将恢复为待进店并重新计算待处理事项。',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('取消'),
          ),
          FilledButton(
            key: ValueKey(
              confirmed
                  ? 'confirm-travel-group-not-entered-dialog-submit'
                  : 'revoke-travel-group-not-entered-dialog-submit',
            ),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(confirmed ? '确认未进店' : '撤销未进店'),
          ),
        ],
      ),
    );
    if (accepted != true || !mounted) {
      return;
    }

    setState(() {
      _notEnteredUpdatingIds.add(group.id);
      _errorMessage = null;
    });
    refreshDetail();
    try {
      final updated = await _businessApi.setTravelGroupNotEntered(
        group.id,
        confirmed,
      );
      if (!mounted) {
        return;
      }
      _replaceGroup(updated);
      setState(() {
        _notEnteredUpdatingIds.remove(group.id);
      });
      refreshDetail();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(confirmed ? '已确认未进店。' : '已撤销未进店。'),
        ),
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      final message = _messageForError(error);
      setState(() {
        _notEnteredUpdatingIds.remove(group.id);
        _errorMessage = message;
      });
      refreshDetail();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    }
  }

  void _replaceGroup(TravelGroupRecord updated) {
    setState(() {
      _groups = [
        for (final group in _groups)
          if (group.id == updated.id) updated else group,
      ];
      _selectedId = updated.id;
    });
  }

  Future<void> _editTravelGroup(TravelGroupRecord group) async {
    final updated = await showDialog<TravelGroupRecord>(
      context: context,
      builder: (context) => _TravelGroupEditDialog(
        businessApi: _businessApi,
        group: group,
        role: widget.role,
        currentUserId: widget.currentUserId,
        guides: _guides,
        tasters: _tasters,
      ),
    );
    if (updated == null || !mounted) {
      return;
    }
    _replaceGroup(updated);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('旅行团信息已保存。')),
    );
  }

  bool _canEditGroup(TravelGroupRecord group) {
    if (widget.role == UserRole.taster) {
      return group.canEditByCurrentUser;
    }
    return _canEdit(widget.role);
  }

  bool _canDeleteAttachments(TravelGroupRecord group) {
    return widget.role == UserRole.superAdmin ||
        widget.role == UserRole.admin ||
        widget.role == UserRole.frontDesk ||
        (widget.role == UserRole.taster && group.canEditByCurrentUser);
  }

  String? _tasterReadOnlyReason(TravelGroupRecord group) {
    if (widget.role != UserRole.taster || group.canEditByCurrentUser) {
      return null;
    }
    final today = formatDate(_shanghaiToday());
    final visitDate = group.visitDate;
    if (visitDate.compareTo(today) < 0) {
      return '历史旅行团仅可查看。';
    }
    if (visitDate.compareTo(today) > 0 &&
        group.liaisonTasterId != widget.currentUserId) {
      return '未来旅行团仅对接品鉴师可以修改，其他品鉴师仅可查看。';
    }
    if (visitDate == today &&
        (group.arrivalTime == null || group.arrivalTime!.isEmpty) &&
        group.tasterId != widget.currentUserId &&
        group.liaisonTasterId != widget.currentUserId) {
      return '该旅行团尚未进店，所有品鉴师均可查看；只有关联品鉴师可以修改。';
    }
    return '当前旅行团为只读。';
  }

  Future<void> _previewAttachment(
    TravelGroupRecord group,
    TravelGroupAttachmentRecord attachment,
  ) async {
    if (!isTravelGroupImageAttachment(attachment)) {
      _showAttachmentError(StateError('该附件不是图片，不能使用照片预览。'));
      return;
    }
    try {
      final downloaded = await _businessApi.downloadTravelGroupAttachment(
        group.id,
        attachment,
      );
      if (!mounted) {
        return;
      }
      await FullscreenPhotoPreviewPage.show(
        context,
        fileName: attachment.originalName,
        bytes: downloaded.bytes,
        orientationService: _photoPreviewOrientationService,
      );
    } catch (error) {
      _showAttachmentError(error);
    }
  }

  Future<void> _uploadAttachments(
    TravelGroupRecord group,
    TravelGroupAttachmentCategory category,
  ) async {
    try {
      AttachmentPickResult picked;
      if (category == TravelGroupAttachmentCategory.keyCustomerPhoto) {
        picked = await _attachmentPickerService.pickKeyCustomerPhotos(
          existingCount: 0,
        );
      } else if (_attachmentPickerService.isMobile) {
        final source = await showGuestAttachmentSourceSheet(context);
        if (!mounted || source == null) {
          return;
        }
        switch (source) {
          case GuestAttachmentSource.gallery:
            picked = await _attachmentPickerService.pickGuestInfoPhotos(
              existingCount: 0,
            );
            break;
          case GuestAttachmentSource.files:
            picked = await _attachmentPickerService.pickGuestInfoFiles(
              existingCount: 0,
            );
            break;
          case GuestAttachmentSource.wechat:
            await _incomingAttachmentService.refresh();
            final claimed = _incomingAttachmentService.claim(
              category: PendingAttachmentCategory.guestInfo,
              includeColdStart: true,
              maxCount: attachmentMaxFileCount,
            );
            if (claimed.isEmpty) {
              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text(
                      '请先在微信中将 Excel、PDF 或 Word 文件分享给本应用。',
                    ),
                  ),
                );
              }
              return;
            }
            await _uploadClaimedIncoming(group, claimed);
            return;
        }
      } else {
        picked = await _attachmentPickerService.pickGuestInfoFiles(
          existingCount: 0,
        );
      }
      if (!mounted) {
        return;
      }
      if (picked.message != null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(picked.message!)),
        );
      }
      if (picked.files.isEmpty) {
        return;
      }
      final result = await _businessApi.uploadTravelGroupAttachments(
        group.id,
        category: category,
        files: picked.files.map((item) => item.file).toList(),
      );
      for (final attachment in picked.files) {
        await attachment.deleteTemporaryCopy();
      }
      if (!mounted) {
        return;
      }
      _replaceGroup(result.travelGroup);
    } catch (error) {
      _showAttachmentError(error);
    }
  }

  Future<void> _downloadAttachment(
    TravelGroupRecord group,
    TravelGroupAttachmentRecord attachment,
  ) async {
    try {
      final downloaded = await _businessApi.downloadTravelGroupAttachment(
        group.id,
        attachment,
      );
      final saved = await _downloadedFileService.save(
        originalFileName: attachment.originalName,
        bytes: downloaded.bytes,
      );
      if (!mounted || saved.cancelled || saved.path == null) {
        return;
      }
      if (!_downloadedFileService.isMobile) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('附件已保存。')),
        );
        return;
      }
      final savedPath = saved.path!;
      final mimeType =
          attachmentKindForFileName(attachment.originalName).mimeType;
      await _showDownloadedAttachmentActions(
        filePath: savedPath,
        mimeType: mimeType,
      );
    } catch (error) {
      _showAttachmentError(error);
    }
  }

  Future<void> _showDownloadedAttachmentActions({
    required String filePath,
    required String mimeType,
  }) async {
    String? openError;
    var opening = false;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('附件已下载'),
          content: openError == null
              ? const Text(
                  '附件来自外部来源。其他应用可能解析文件中的活动内容；'
                  '请仅在确认文件来源可信时选择打开。',
                )
              : Text(openError!),
          actions: [
            TextButton(
              onPressed:
                  opening ? null : () => Navigator.of(dialogContext).pop(),
              child: const Text('关闭'),
            ),
            FilledButton(
              onPressed: opening
                  ? null
                  : () async {
                      setDialogState(() => opening = true);
                      final result = await _downloadedFileService.open(
                        filePath: filePath,
                        mimeType: mimeType,
                      );
                      if (!dialogContext.mounted) {
                        return;
                      }
                      if (result.opened) {
                        Navigator.of(dialogContext).pop();
                        return;
                      }
                      setDialogState(() {
                        opening = false;
                        openError = result.message ?? '打开附件失败，请稍后重试。';
                      });
                    },
              child: opening
                  ? const SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('用其他应用打开'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _deleteAttachment(
    TravelGroupRecord group,
    TravelGroupAttachmentRecord attachment,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('删除附件'),
        content: Text('确定删除“${attachment.originalName}”吗？'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('删除'),
          ),
        ],
      ),
    );
    if (confirmed != true) {
      return;
    }
    try {
      final result = await _businessApi.deleteTravelGroupAttachment(
        group.id,
        attachment.id,
      );
      if (!mounted) {
        return;
      }
      _replaceGroup(result.travelGroup);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('附件已删除。')),
      );
    } catch (error) {
      _showAttachmentError(error);
    }
  }

  void _showAttachmentError(Object error) {
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(_messageForError(error))),
    );
  }

  void _setFilter(VoidCallback change) {
    setState(change);
    _loadData();
  }

  bool get _canExportTravelGroups =>
      widget.role == UserRole.admin || widget.role == UserRole.finance;

  Future<void> _exportTravelGroups() async {
    if (!_canExportTravelGroups || _exporting) {
      return;
    }
    setState(() {
      _exporting = true;
      _errorMessage = null;
    });
    try {
      final downloaded = await _businessApi.downloadTravelGroupsExcel(
        start: _dateRangeAll ? null : _start,
        end: _dateRangeAll ? null : _end,
        keyword: _keyword,
        groupType: _optionalFilter(_groupTypeFilter),
        travelAgency: _optionalFilter(_travelAgencyFilter),
        guideId: _optionalFilter(_guideFilter),
        tasterId: _tasterIdFilter(),
        liaisonTasterId: _liaisonTasterIdFilter(),
      );
      final path = await FilePicker.saveFile(
        dialogTitle: '保存旅行团导出',
        fileName: _safeFileName(downloaded.fileName),
        bytes: downloaded.bytes,
        lockParentWindow: true,
      );
      if (!mounted) {
        return;
      }
      setState(() => _exporting = false);
      if (path != null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('旅行团已导出。')),
        );
      }
    } catch (error) {
      if (!mounted) {
        return;
      }
      final message = _messageForError(error);
      setState(() {
        _exporting = false;
        _errorMessage = message;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return ResponsivePage(
      children: [
        if (_incomingAttachmentService.pendingCount > 0)
          FormSection(
            title: '待导入附件',
            trailing: StatusTag(
              label: '${_incomingAttachmentService.pendingCount} 个文件',
              tone: StatusTone.warning,
            ),
            children: [
              const Text('这些文件尚未关联旅行团，请选择你有权查看和修改的旅行团后再上传。'),
              const SizedBox(height: 10),
              Wrap(
                alignment: WrapAlignment.end,
                spacing: 8,
                runSpacing: 8,
                children: [
                  TextButton(
                    onPressed: _discardPendingAttachments,
                    child: const Text('取消导入'),
                  ),
                  FilledButton.icon(
                    key: const ValueKey(
                      'choose-pending-attachment-travel-group',
                    ),
                    onPressed: _handlingIncomingAttachments
                        ? null
                        : _choosePendingAttachmentTarget,
                    icon: const Icon(Icons.drive_file_move_rounded),
                    label: const Text('选择旅行团并上传'),
                  ),
                ],
              ),
            ],
          ),
        _TravelGroupQueryFilters(
          start: _start,
          end: _end,
          dateRangeAll: _dateRangeAll,
          keywordController: _keywordController,
          groupTypeFilter: _groupTypeFilter,
          travelAgencyFilter: _travelAgencyFilter,
          tasterFilter: _tasterFilter,
          tasterScope: _tasterScope,
          role: widget.role,
          canExport: _canExportTravelGroups,
          exporting: _exporting,
          hasCurrentUserId: widget.currentUserId.isNotEmpty,
          travelAgencyItems:
              _travelAgencyFilterItems(_groups, _travelAgencyFilter),
          selectedGuide: _selectedGuideFilter,
          tasters: _tasters,
          resultCount: _groups.length,
          onKeywordChanged: (value) => _keyword = value,
          onSearch: () {
            setState(() => _keyword = _keywordController.text.trim());
            _loadData();
          },
          onDateRangeChanged: (range) => _setFilter(() {
            _dateRangeAll = false;
            _start = range.start;
            _end = range.end;
          }),
          onAllDatesSelected: () => _setFilter(() => _dateRangeAll = true),
          onGroupTypeChanged: (value) =>
              _setFilter(() => _groupTypeFilter = value),
          onTravelAgencyChanged: (value) =>
              _setFilter(() => _travelAgencyFilter = value),
          onOpenGuidePicker: _pickGuideFilter,
          onTasterChanged: (value) => _setFilter(() => _tasterFilter = value),
          onTasterScopeChanged: (value) =>
              _setFilter(() => _tasterScope = value),
          onExport: _exportTravelGroups,
          onRefresh: _loadData,
        ),
        if (_loading)
          const LoadingState(title: '正在加载旅行团')
        else if (_errorMessage != null)
          ErrorState(title: _errorMessage!, onRetry: _loadData)
        else if (_groups.isEmpty)
          EmptyState(
            title: '没有匹配的旅行团',
            action: OutlinedButton.icon(
              onPressed: _loadData,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('刷新'),
            ),
          )
        else ...[
          MetricGrid(
            metrics: [
              MetricData(
                label: '旅行团数',
                value: '${_groups.length}',
                icon: Icons.directions_bus_rounded,
              ),
              MetricData(
                label: '接待人数',
                value:
                    '${_groups.fold<int>(0, (sum, item) => sum + item.guestCount)}',
                icon: Icons.groups_rounded,
              ),
              if (canViewFinanceMark(widget.role))
                MetricData(
                  label: '已标记',
                  value:
                      '${_groups.where((group) => group.financeMark).length}',
                  icon: Icons.bookmark_added_rounded,
                ),
              MetricData(
                label: '待处理',
                value:
                    '${_groups.where((group) => group.pendingStatus != null).length}',
                icon: Icons.pending_actions_rounded,
              ),
            ],
          ),
          FormSection(
            title: '旅行团列表',
            trailing: StatusTag(
              label: _selectedId == null ? '未选择' : '已选择',
              tone: _selectedId == null ? StatusTone.neutral : StatusTone.info,
            ),
            children: [
              _TravelGroupList(
                groups: _groups,
                selectedId: _selectedId,
                onSelect: _openTravelGroupDetail,
              ),
            ],
          ),
        ],
      ],
    );
  }
}

class _TravelGroupQueryFilters extends StatelessWidget {
  const _TravelGroupQueryFilters({
    required this.start,
    required this.end,
    required this.dateRangeAll,
    required this.keywordController,
    required this.groupTypeFilter,
    required this.travelAgencyFilter,
    required this.tasterFilter,
    required this.tasterScope,
    required this.role,
    required this.canExport,
    required this.exporting,
    required this.hasCurrentUserId,
    required this.travelAgencyItems,
    required this.selectedGuide,
    required this.tasters,
    required this.resultCount,
    required this.onKeywordChanged,
    required this.onSearch,
    required this.onDateRangeChanged,
    required this.onAllDatesSelected,
    required this.onGroupTypeChanged,
    required this.onTravelAgencyChanged,
    required this.onOpenGuidePicker,
    required this.onTasterChanged,
    required this.onTasterScopeChanged,
    required this.onExport,
    required this.onRefresh,
  });

  final DateTime start;
  final DateTime end;
  final bool dateRangeAll;
  final TextEditingController keywordController;
  final String groupTypeFilter;
  final String travelAgencyFilter;
  final String tasterFilter;
  final String tasterScope;
  final UserRole role;
  final bool canExport;
  final bool exporting;
  final bool hasCurrentUserId;
  final List<MapEntry<String, String>> travelAgencyItems;
  final GuideRecord? selectedGuide;
  final List<TasterOption> tasters;
  final int resultCount;
  final ValueChanged<String> onKeywordChanged;
  final VoidCallback onSearch;
  final ValueChanged<DateTimeRange> onDateRangeChanged;
  final VoidCallback onAllDatesSelected;
  final ValueChanged<String> onGroupTypeChanged;
  final ValueChanged<String> onTravelAgencyChanged;
  final VoidCallback onOpenGuidePicker;
  final ValueChanged<String> onTasterChanged;
  final ValueChanged<String> onTasterScopeChanged;
  final VoidCallback onExport;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    return FormSection(
      title: '旅行团管理',
      trailing: StatusTag(label: '$resultCount 个旅行团', tone: StatusTone.info),
      children: [
        ResponsiveFormGrid(
          children: [
            AppSearchField(
              controller: keywordController,
              hintText: '搜索团号、车牌号、旅行社、导游、品鉴师、客源地和重点客户',
              onChanged: onKeywordChanged,
            ),
            AppDateRangeButton(
              start: start,
              end: end,
              allSelected: dateRangeAll,
              onAllSelected: onAllDatesSelected,
              onChanged: onDateRangeChanged,
            ),
            _StringDropdown(
              label: '团型',
              value: groupTypeFilter,
              items: [
                const MapEntry(_allFilter, '全部'),
                for (final type in groupTypes) MapEntry(type, type),
              ],
              onChanged: onGroupTypeChanged,
            ),
            _StringDropdown(
              label: '旅行社',
              value: travelAgencyFilter,
              items: travelAgencyItems,
              onChanged: onTravelAgencyChanged,
            ),
            _GuideFilterField(
              guide: selectedGuide,
              onTap: onOpenGuidePicker,
            ),
            if (role != UserRole.taster)
              _StringDropdown(
                label: '品鉴师',
                value: tasterFilter,
                items: [
                  const MapEntry(_allFilter, '全部'),
                  for (final taster in tasters)
                    MapEntry(taster.id, _tasterLabel(taster)),
                ],
                onChanged: onTasterChanged,
              ),
          ],
        ),
        if (role == UserRole.taster) ...[
          const SizedBox(height: 12),
          SegmentedButton<String>(
            key: const ValueKey('taster-scope-filter'),
            segments: const [
              ButtonSegment(
                value: _tasterScopeAll,
                label: Text('可查看旅行团'),
                icon: Icon(Icons.groups_rounded),
              ),
              ButtonSegment(
                value: _tasterScopeLiaison,
                label: Text('我对接的'),
                icon: Icon(Icons.handshake_rounded),
              ),
              ButtonSegment(
                value: _tasterScopeReception,
                label: Text('我接的团'),
                icon: Icon(Icons.person_pin_rounded),
              ),
            ],
            selected: {tasterScope},
            onSelectionChanged: hasCurrentUserId
                ? (selection) => onTasterScopeChanged(selection.first)
                : null,
          ),
        ],
        const SizedBox(height: 12),
        Wrap(
          alignment: WrapAlignment.end,
          spacing: 10,
          runSpacing: 10,
          children: [
            OutlinedButton.icon(
              onPressed: onRefresh,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('刷新'),
            ),
            if (canExport)
              OutlinedButton.icon(
                key: const ValueKey('travel-group-export-button'),
                onPressed: exporting ? null : onExport,
                icon: exporting
                    ? const SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.download_rounded),
                label: Text(exporting ? '导出中' : '导出 Excel'),
              ),
            FilledButton.icon(
              onPressed: onSearch,
              icon: const Icon(Icons.search_rounded),
              label: const Text('查询'),
            ),
          ],
        ),
      ],
    );
  }
}

class _TravelGroupList extends StatelessWidget {
  const _TravelGroupList({
    required this.groups,
    required this.selectedId,
    required this.onSelect,
  });

  final List<TravelGroupRecord> groups;
  final String? selectedId;
  final ValueChanged<TravelGroupRecord> onSelect;

  @override
  Widget build(BuildContext context) {
    return AppRecordList(
      items: [
        for (final group in groups)
          AppRecordItem(
            title: group.groupNo,
            subtitle:
                '${_display(group.travelAgency)} · ${_display(group.guideName)} · ${group.guestCount > 0 ? '${group.guestCount} 人' : '人数未填写'}',
            meta: [
              if (group.visitDate.isNotEmpty) group.visitDate,
              _display(group.groupType),
              '对接：${_display(group.liaisonTasterName)}',
              '品鉴：${_display(group.tasterName)}',
              '预计：${_display(group.expectedArrivalTime)}',
              '实际：${_display(group.arrivalTime)}',
              if (_frontDeskMissingLabels(group.pendingReasons).isNotEmpty)
                '待补：${_frontDeskMissingLabels(group.pendingReasons).join('、')}',
            ],
            icon: selectedId == group.id
                ? Icons.radio_button_checked_rounded
                : Icons.directions_bus_rounded,
            trailing: StatusTag(
              label: group.pendingStatus == null
                  ? _groupStatusLabel(group.status)
                  : _pendingStatusLabel(group.pendingStatus),
              tone: group.pendingStatus == null
                  ? _groupStatusTone(group.status)
                  : _pendingStatusTone(group.pendingStatus),
            ),
            onTap: () => onSelect(group),
          ),
      ],
    );
  }
}

class _GuideFilterField extends StatelessWidget {
  const _GuideFilterField({
    required this.guide,
    required this.onTap,
  });

  final GuideRecord? guide;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      key: const ValueKey('travel-group-guide-filter'),
      onTap: onTap,
      borderRadius: BorderRadius.circular(4),
      child: InputDecorator(
        decoration: const InputDecoration(
          labelText: '导游',
          suffixIcon: Icon(Icons.manage_search_rounded),
        ),
        child: Text(
          guide == null ? '全部' : '${guide!.name} · ${guide!.phone}',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
      ),
    );
  }
}

class _StringDropdown extends StatelessWidget {
  const _StringDropdown({
    required this.label,
    required this.value,
    required this.items,
    required this.onChanged,
  });

  final String label;
  final String value;
  final List<MapEntry<String, String>> items;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final values = items.map((item) => item.key).toSet();
    final safeValue = values.contains(value) ? value : _allFilter;
    return DropdownButtonFormField<String>(
      key: ValueKey('$label-$safeValue-${items.length}'),
      initialValue: safeValue,
      isExpanded: true,
      decoration: InputDecoration(labelText: label),
      items: [
        for (final item in items)
          DropdownMenuItem(
            value: item.key,
            child: Text(item.value, overflow: TextOverflow.ellipsis),
          ),
      ],
      onChanged: (next) {
        if (next != null) {
          onChanged(next);
        }
      },
    );
  }
}

class _TasterSummaryDialog extends StatefulWidget {
  const _TasterSummaryDialog({required this.group});

  final TravelGroupRecord group;

  @override
  State<_TasterSummaryDialog> createState() => _TasterSummaryDialogState();
}

class _TasterSummaryDialogState extends State<_TasterSummaryDialog> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.group.tasterSummary ?? '');
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final canSubmit = _controller.text.trim().isNotEmpty;
    return AlertDialog(
      title: Text('${widget.group.groupNo} 品鉴总结'),
      content: SizedBox(
        width: 420,
        child: TextField(
          controller: _controller,
          autofocus: true,
          maxLines: 5,
          onChanged: (_) => setState(() {}),
          decoration: const InputDecoration(
            labelText: '总结内容',
            alignLabelWithHint: true,
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        FilledButton.icon(
          onPressed: canSubmit
              ? () => Navigator.of(context).pop(_controller.text.trim())
              : null,
          icon: const Icon(Icons.check_rounded),
          label: const Text('保存'),
        ),
      ],
    );
  }
}

class _TravelGroupEditDialog extends StatefulWidget {
  const _TravelGroupEditDialog({
    required this.businessApi,
    required this.group,
    required this.role,
    required this.currentUserId,
    required this.guides,
    required this.tasters,
  });

  final BusinessApi businessApi;
  final TravelGroupRecord group;
  final UserRole role;
  final String currentUserId;
  final List<GuideRecord> guides;
  final List<TasterOption> tasters;

  @override
  State<_TravelGroupEditDialog> createState() => _TravelGroupEditDialogState();
}

class _TravelGroupEditDialogState extends State<_TravelGroupEditDialog> {
  final _formKey = GlobalKey<FormState>();
  final _tastingItemsKey = GlobalKey<TastingItemsEditorState>();

  late DateTime _visitDate;
  late String _selectedGuideId;
  GuideRecord? _selectedGuide;
  late String _selectedTasterId;
  late String _selectedLiaisonTasterId;
  late String _mentionedFeitianValue;
  String? _groupType;
  late String _status;
  late bool _guideInfoSent;
  late bool _travelAgencyInfoSent;
  bool _guideTouched = false;
  bool _tasterTouched = false;
  bool _liaisonTasterTouched = false;
  bool _saving = false;
  String? _errorMessage;

  late final TextEditingController _groupNoController;
  late final TextEditingController _travelAgencyController;
  late final TextEditingController _licensePlateController;
  late final TextEditingController _adultCountController;
  late final TextEditingController _childCountController;
  late final TextEditingController _cigaretteFeeController;
  late final TextEditingController _tastingRoomNoController;
  late final TextEditingController _arrivalTimeController;
  late final TextEditingController _expectedArrivalTimeController;
  late final TextEditingController _departureTimeController;
  late final TextEditingController _remarksController;
  late final TextEditingController _wineDetailsController;
  late final TextEditingController _tasterSummaryController;
  late final TextEditingController _sourceRegionController;
  late final TextEditingController _ageInfoController;
  late final TextEditingController _previousStopOrderStatusController;
  late final TextEditingController _keyCustomerInfoController;
  late final TextEditingController _salesAmountController;
  late final TextEditingController _paidDepositController;
  late final TextEditingController _cashOnDeliveryController;
  late final TextEditingController _liquorCostDeductionController;
  late final TextEditingController _orderAmountController;
  late final TextEditingController _pointsController;
  late final TextEditingController _returnedPointsController;
  late final TextEditingController _unreturnedPointsController;
  late final List<TastingItemDraft> _initialTastingItems;
  late List<Map<String, dynamic>> _tastingItems;

  bool get _isAdmin =>
      widget.role == UserRole.superAdmin || widget.role == UserRole.admin;
  bool get _isFrontDesk => widget.role == UserRole.frontDesk;
  bool get _isTaster => widget.role == UserRole.taster;
  bool get _isFinance => widget.role == UserRole.finance;
  bool get _isAssociatedTaster =>
      _isTaster &&
      widget.currentUserId.isNotEmpty &&
      (widget.group.tasterId == widget.currentUserId ||
          widget.group.liaisonTasterId == widget.currentUserId);
  bool get _canEditGroupNo => _isAdmin;
  bool get _canEditVisitDate => _isAdmin || _isFrontDesk;
  bool get _canEditTravelAgency => _isAdmin || _isFrontDesk;
  bool get _canEditGuide => _isAdmin || _isFrontDesk;
  bool get _canEditLicensePlate =>
      _isAdmin || _isFrontDesk || _isAssociatedTaster;
  bool get _canEditGuestCounts =>
      _isAdmin || _isFrontDesk || _isAssociatedTaster;
  bool get _canEditCigaretteFee => _isAdmin || _isFrontDesk;
  bool get _canEditFrontDeskOnlyFields => _isAdmin || _isFrontDesk;
  bool get _canManageTasterAssignments => _isAdmin || _isFrontDesk;
  bool get _canEditExpectedArrivalTime => _isAdmin || _isAssociatedTaster;
  bool get _canEditDepartureTime => _isAdmin;
  bool get _canEditTastingItems => _isAdmin;
  bool get _canEditTasterNotes => _isAdmin || _isAssociatedTaster;
  bool get _canEditCustomerFields =>
      _isAdmin || _isFrontDesk || _isAssociatedTaster;
  bool get _canEditRemarks =>
      _isAdmin || _isFrontDesk || _isFinance || _isAssociatedTaster;
  bool get _canEditFinanceFields => _isAdmin || _isFinance;

  bool get _showBasicSection =>
      _canEditGroupNo ||
      _canEditVisitDate ||
      _canEditTravelAgency ||
      _canEditGuide ||
      _canEditLicensePlate ||
      _canEditGuestCounts ||
      _canEditCigaretteFee ||
      _canEditFrontDeskOnlyFields ||
      _canManageTasterAssignments ||
      _canEditExpectedArrivalTime;
  bool get _showSupplementSection =>
      _canEditDepartureTime ||
      _canEditTastingItems ||
      _canEditTasterNotes ||
      _canEditRemarks ||
      _canEditCustomerFields;

  @override
  void initState() {
    super.initState();
    final group = widget.group;
    _visitDate = DateTime.tryParse(group.visitDate) ?? DateTime.now();
    _selectedGuideId = group.guideId ?? '';
    _selectedGuide = _guideForGroup(group, widget.guides);
    _selectedTasterId = group.tasterId ?? '';
    _selectedLiaisonTasterId = group.liaisonTasterId ?? '';
    _mentionedFeitianValue = group.mentionedFeitian == null
        ? 'unset'
        : group.mentionedFeitian!
            ? 'yes'
            : 'no';
    _groupType = _nonEmpty(group.groupType);
    _status =
        _editableStatuses.contains(group.status) ? group.status : 'unmarked';
    _guideInfoSent = group.guideInfoSent;
    _travelAgencyInfoSent = group.travelAgencyInfoSent;

    _groupNoController = TextEditingController(text: group.groupNo);
    _travelAgencyController =
        TextEditingController(text: group.travelAgency ?? '');
    _licensePlateController =
        TextEditingController(text: group.licensePlate ?? '');
    _adultCountController = TextEditingController(
      text: group.adultCount == 0 ? '' : '${group.adultCount}',
    );
    _childCountController = TextEditingController(
      text: group.childCount == 0 ? '' : '${group.childCount}',
    );
    _cigaretteFeeController = TextEditingController(
      text: group.cigaretteFeeCents == null
          ? ''
          : _moneyText(group.cigaretteFeeCents!),
    );
    _tastingRoomNoController =
        TextEditingController(text: group.tastingRoomNo ?? '');
    _arrivalTimeController =
        TextEditingController(text: normalizeTimeText(group.arrivalTime));
    _expectedArrivalTimeController = TextEditingController(
      text: normalizeTimeText(group.expectedArrivalTime),
    );
    _departureTimeController =
        TextEditingController(text: normalizeTimeText(group.departureTime));
    _remarksController = TextEditingController(text: group.remarks ?? '');
    _wineDetailsController =
        TextEditingController(text: group.wineDetails ?? '');
    _tasterSummaryController =
        TextEditingController(text: group.tasterSummary ?? '');
    _sourceRegionController =
        TextEditingController(text: group.sourceRegion ?? '');
    _ageInfoController = TextEditingController(text: group.ageInfo ?? '');
    _previousStopOrderStatusController =
        TextEditingController(text: group.previousStopOrderStatus ?? '');
    _keyCustomerInfoController =
        TextEditingController(text: group.keyCustomerInfo ?? '');
    _salesAmountController =
        TextEditingController(text: _moneyText(group.salesAmountCents));
    _paidDepositController =
        TextEditingController(text: _moneyText(group.paidDepositCents));
    _cashOnDeliveryController =
        TextEditingController(text: _moneyText(group.cashOnDeliveryCents));
    _liquorCostDeductionController =
        TextEditingController(text: _moneyText(group.liquorCostDeductionCents));
    _orderAmountController =
        TextEditingController(text: _moneyText(group.orderAmountCents));
    _pointsController = TextEditingController(text: '${group.points}');
    _returnedPointsController =
        TextEditingController(text: '${group.returnedPoints}');
    _unreturnedPointsController =
        TextEditingController(text: '${group.unreturnedPoints}');
    _initialTastingItems = _tastingDraftsFromGroup(group);
    _tastingItems = _tastingPayloadFromGroup(group);
  }

  @override
  void dispose() {
    _groupNoController.dispose();
    _travelAgencyController.dispose();
    _licensePlateController.dispose();
    _adultCountController.dispose();
    _childCountController.dispose();
    _cigaretteFeeController.dispose();
    _tastingRoomNoController.dispose();
    _arrivalTimeController.dispose();
    _expectedArrivalTimeController.dispose();
    _departureTimeController.dispose();
    _remarksController.dispose();
    _wineDetailsController.dispose();
    _tasterSummaryController.dispose();
    _sourceRegionController.dispose();
    _ageInfoController.dispose();
    _previousStopOrderStatusController.dispose();
    _keyCustomerInfoController.dispose();
    _salesAmountController.dispose();
    _paidDepositController.dispose();
    _cashOnDeliveryController.dispose();
    _liquorCostDeductionController.dispose();
    _orderAmountController.dispose();
    _pointsController.dispose();
    _returnedPointsController.dispose();
    _unreturnedPointsController.dispose();
    super.dispose();
  }

  String? _childCountValidator(String? value) {
    final fieldError = _optionalNonNegativeGuestCountValidator(value);
    if (fieldError != null) {
      return fieldError;
    }
    final adultCountText = _adultCountController.text.trim();
    final childCountText = (value ?? '').trim();
    if (adultCountText.isEmpty && childCountText.isEmpty) {
      return null;
    }
    final adultCount =
        adultCountText.isEmpty ? 0 : int.tryParse(adultCountText);
    final childCount =
        childCountText.isEmpty ? 0 : int.tryParse(childCountText);
    if (adultCount == null || childCount == null) {
      return null;
    }
    if (adultCount + childCount <= 0) {
      return '大人人数与小孩人数合计必须大于 0';
    }
    return null;
  }

  Future<void> _save() async {
    final formValid = _formKey.currentState?.validate() ?? false;
    final tastingValid = !_canEditTastingItems ||
        (_tastingItemsKey.currentState?.validate() ?? true);
    if (!formValid || !tastingValid) {
      setState(() => _errorMessage = '请先修正表单中的提示。');
      return;
    }

    setState(() {
      _saving = true;
      _errorMessage = null;
    });

    try {
      final updated = await widget.businessApi.updateTravelGroup(
        widget.group.id,
        _buildPayload(),
      );
      if (mounted) {
        Navigator.of(context).pop(updated);
      }
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _saving = false;
        _errorMessage = _messageForSaveError(error);
      });
    }
  }

  Map<String, dynamic> _buildPayload() {
    final payload = <String, dynamic>{};

    if (_canEditGroupNo) {
      payload['groupNo'] = _groupNoController.text.trim();
    }
    if (_canEditVisitDate) {
      payload['visitDate'] = formatDate(_visitDate);
    }
    if (_canEditTravelAgency) {
      payload['travelAgency'] = _travelAgencyController.text.trim();
    }
    if (_canEditLicensePlate) {
      payload['licensePlate'] = _licensePlateController.text.trim();
    }
    if (_canEditGuide &&
        (_guideTouched || _selectedGuideId != (widget.group.guideId ?? ''))) {
      payload['guideId'] =
          _selectedGuideId.trim().isEmpty ? null : _selectedGuideId;
    }
    if (_canEditFrontDeskOnlyFields) {
      payload['tastingRoomNo'] = _tastingRoomNoController.text.trim();
      payload['arrivalTime'] = normalizeTimeText(_arrivalTimeController.text);
      if ((_groupType ?? '').trim().isNotEmpty) {
        payload['groupType'] = _groupType!.trim();
      }
    }
    if (_canManageTasterAssignments &&
        (_tasterTouched ||
            _selectedTasterId != (widget.group.tasterId ?? ''))) {
      payload['tasterId'] =
          _selectedTasterId.trim().isEmpty ? null : _selectedTasterId;
    }
    if (_canManageTasterAssignments &&
        (_liaisonTasterTouched ||
            _selectedLiaisonTasterId != (widget.group.liaisonTasterId ?? ''))) {
      payload['liaisonTasterId'] = _selectedLiaisonTasterId.trim().isEmpty
          ? null
          : _selectedLiaisonTasterId;
    }
    if (_canEditExpectedArrivalTime) {
      payload['expectedArrivalTime'] =
          normalizeTimeText(_expectedArrivalTimeController.text);
    }
    if (_canEditGuestCounts) {
      payload['adultCount'] = _intFromText(_adultCountController.text);
      payload['childCount'] = _intFromText(_childCountController.text);
    }
    if (_canEditCigaretteFee) {
      payload['cigaretteFeeCents'] = _cigaretteFeeController.text.trim().isEmpty
          ? null
          : _centsFromMoneyText(_cigaretteFeeController.text);
    }
    if (_canEditDepartureTime) {
      payload['departureTime'] =
          normalizeTimeText(_departureTimeController.text);
    }
    if (_canEditRemarks) {
      payload['remarks'] = _remarksController.text.trim();
    }
    if (_canEditTasterNotes) {
      payload['wineDetails'] = _wineDetailsController.text.trim();
      payload['tasterSummary'] = _tasterSummaryController.text.trim();
    }
    if (_canEditCustomerFields) {
      payload['sourceRegion'] = _sourceRegionController.text.trim();
      payload['ageInfo'] = _ageInfoController.text.trim();
      payload['mentionedFeitian'] = switch (_mentionedFeitianValue) {
        'yes' => true,
        'no' => false,
        _ => null,
      };
      payload['previousStopOrderStatus'] =
          _previousStopOrderStatusController.text.trim();
      payload['keyCustomerInfo'] = _keyCustomerInfoController.text.trim();
    }
    if (_canEditTastingItems) {
      payload['tastingItems'] = _tastingItems;
    }
    if (_canEditFinanceFields) {
      payload['status'] = _status;
      payload['salesAmountCents'] =
          _centsFromMoneyText(_salesAmountController.text);
      payload['paidDepositCents'] =
          _centsFromMoneyText(_paidDepositController.text);
      payload['cashOnDeliveryCents'] =
          _centsFromMoneyText(_cashOnDeliveryController.text);
      payload['liquorCostDeductionCents'] =
          _centsFromMoneyText(_liquorCostDeductionController.text);
      payload['orderAmountCents'] =
          _centsFromMoneyText(_orderAmountController.text);
      payload['points'] = _intFromText(_pointsController.text);
      payload['returnedPoints'] = _intFromText(_returnedPointsController.text);
      payload['unreturnedPoints'] =
          _intFromText(_unreturnedPointsController.text);
      payload['guideInfoSent'] = _guideInfoSent;
      payload['travelAgencyInfoSent'] = _travelAgencyInfoSent;
    }

    return payload;
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('${widget.group.groupNo} 编辑'),
      content: SizedBox(
        width: 760,
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_errorMessage != null) ...[
                  _DialogNotice(message: _errorMessage!),
                  const SizedBox(height: 12),
                ],
                if (_showBasicSection)
                  _DialogSection(
                    title: '基础信息',
                    child: ResponsiveFormGrid(children: _basicFields()),
                  ),
                if (_showBasicSection && _showSupplementSection)
                  const SizedBox(height: 12),
                if (_showSupplementSection)
                  _DialogSection(
                    title: '接待补充',
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        ResponsiveFormGrid(children: _supplementFields()),
                        if (_canEditTastingItems) ...[
                          const SizedBox(height: 12),
                          TastingItemsEditor(
                            key: _tastingItemsKey,
                            businessApi: widget.businessApi,
                            initialItems: _initialTastingItems,
                            onChanged: (items) => _tastingItems = items,
                          ),
                        ],
                      ],
                    ),
                  ),
                if ((_showBasicSection || _showSupplementSection) &&
                    _canEditFinanceFields)
                  const SizedBox(height: 12),
                if (_canEditFinanceFields)
                  _DialogSection(
                    title: '财务信息',
                    child: ResponsiveFormGrid(children: _financeFields()),
                  ),
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
          onPressed: _saving ? null : _save,
          icon: _saving
              ? const SizedBox.square(
                  dimension: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.check_rounded),
          label: Text(_saving ? '保存中...' : '保存修改'),
        ),
      ],
    );
  }

  List<Widget> _basicFields() {
    return [
      if (_canEditGroupNo)
        TextFormField(
          controller: _groupNoController,
          decoration: const InputDecoration(labelText: '团号'),
          validator: _requiredValidator('团号不能为空'),
        ),
      if (_canEditVisitDate)
        _EditDateField(
          label: '进店日期',
          value: _visitDate,
          onTap: _pickVisitDate,
        ),
      if (_canEditTravelAgency)
        TextFormField(
          controller: _travelAgencyController,
          decoration: const InputDecoration(labelText: '旅行社'),
        ),
      if (_canEditGuide) _guideDropdown(),
      if (_canEditLicensePlate)
        TextFormField(
          controller: _licensePlateController,
          decoration: const InputDecoration(labelText: '车牌号'),
        ),
      if (_canEditGuestCounts)
        TextFormField(
          key: const ValueKey('travel-group-edit-adult-count'),
          controller: _adultCountController,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          decoration: const InputDecoration(labelText: '大人人数'),
          validator: _optionalNonNegativeGuestCountValidator,
        ),
      if (_canEditGuestCounts)
        TextFormField(
          key: const ValueKey('travel-group-edit-child-count'),
          controller: _childCountController,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          decoration: const InputDecoration(labelText: '小孩人数'),
          validator: _childCountValidator,
        ),
      if (_canEditCigaretteFee)
        TextFormField(
          key: const ValueKey('travel-group-edit-cigarette-fee'),
          controller: _cigaretteFeeController,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: const InputDecoration(labelText: '香烟费用（元）'),
          validator: _optionalPositiveMoneyValidator,
        ),
      if (_canEditFrontDeskOnlyFields)
        TextFormField(
          controller: _tastingRoomNoController,
          decoration: const InputDecoration(labelText: '品鉴馆号'),
        ),
      if (_canManageTasterAssignments) _tasterDropdown(),
      if (_canManageTasterAssignments) _liaisonTasterDropdown(),
      if (_canEditExpectedArrivalTime)
        AppTimePickerField(
          key: const ValueKey('travel-group-edit-expected-arrival-time'),
          controller: _expectedArrivalTimeController,
          label: '预计进店时间',
          validator: _optionalTimeValidator,
        ),
      if (_canEditFrontDeskOnlyFields)
        AppTimePickerField(
          key: const ValueKey('travel-group-edit-arrival-time'),
          controller: _arrivalTimeController,
          label: '实际进店时间',
        ),
      if (_canEditFrontDeskOnlyFields) _groupTypeDropdown(),
    ];
  }

  List<Widget> _supplementFields() {
    return [
      if (_canEditDepartureTime)
        AppTimePickerField(
          key: const ValueKey('travel-group-edit-departure-time'),
          controller: _departureTimeController,
          label: '离店时间',
        ),
      if (_canEditTasterNotes)
        TextFormField(
          controller: _wineDetailsController,
          decoration: const InputDecoration(labelText: '品鉴备注'),
        ),
      if (_canEditTasterNotes)
        TextFormField(
          controller: _tasterSummaryController,
          minLines: 1,
          maxLines: 3,
          decoration: const InputDecoration(labelText: '品鉴总结'),
        ),
      if (_canEditRemarks)
        TextFormField(
          controller: _remarksController,
          minLines: 1,
          maxLines: 3,
          decoration: const InputDecoration(labelText: '备注'),
        ),
      if (_canEditCustomerFields)
        TextFormField(
          controller: _sourceRegionController,
          decoration: const InputDecoration(labelText: '客源地'),
        ),
      if (_canEditCustomerFields)
        TextFormField(
          controller: _ageInfoController,
          decoration: const InputDecoration(labelText: '年龄描述'),
        ),
      if (_canEditCustomerFields) _mentionedFeitianDropdown(),
      if (_canEditCustomerFields)
        TextFormField(
          controller: _previousStopOrderStatusController,
          decoration: const InputDecoration(labelText: '前站出单情况'),
        ),
      if (_canEditCustomerFields)
        TextFormField(
          controller: _keyCustomerInfoController,
          minLines: 2,
          maxLines: 4,
          decoration: const InputDecoration(labelText: '重点客户信息'),
        ),
    ];
  }

  List<Widget> _financeFields() {
    return [
      _statusDropdown(),
      _moneyField(_salesAmountController, '销售金额（元）'),
      _moneyField(_paidDepositController, '已付定金（元）'),
      _moneyField(_cashOnDeliveryController, '货到付款（元）'),
      _moneyField(_liquorCostDeductionController, '酒水成本扣除（元）'),
      _moneyField(_orderAmountController, '订单金额（元）'),
      _intField(_pointsController, '积分'),
      _intField(_returnedPointsController, '已返积分'),
      _intField(_unreturnedPointsController, '未返积分'),
      CheckboxListTile(
        value: _guideInfoSent,
        contentPadding: EdgeInsets.zero,
        title: const Text('已发送导游信息'),
        onChanged: (value) {
          setState(() => _guideInfoSent = value ?? false);
        },
      ),
      CheckboxListTile(
        value: _travelAgencyInfoSent,
        contentPadding: EdgeInsets.zero,
        title: const Text('已发送旅行社信息'),
        onChanged: (value) {
          setState(() => _travelAgencyInfoSent = value ?? false);
        },
      ),
    ];
  }

  Widget _guideDropdown() {
    return InkWell(
      key: const ValueKey('travel-group-edit-guide-picker'),
      onTap: _pickGuide,
      borderRadius: BorderRadius.circular(4),
      child: InputDecorator(
        decoration: const InputDecoration(
          labelText: '导游',
          suffixIcon: Icon(Icons.manage_search_rounded),
        ),
        child: Text(
          _selectedGuide == null
              ? '未选择'
              : '${_selectedGuide!.name} · ${_selectedGuide!.phone}',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
      ),
    );
  }

  Future<void> _pickGuide() async {
    final result = await showDialog<GuidePickerResult>(
      context: context,
      builder: (context) => RemoteGuidePickerDialog(
        businessApi: widget.businessApi,
        initialGuide: _selectedGuide,
        allowClear: true,
      ),
    );
    if (result == null || !mounted) {
      return;
    }
    setState(() {
      _selectedGuide = result.guide;
      _selectedGuideId = result.guide?.id ?? '';
      _guideTouched = true;
    });
  }

  Widget _tasterDropdown() {
    final items = _tasterItems();
    final values = items.map((item) => item.key).toSet();
    final safeValue =
        values.contains(_selectedTasterId) ? _selectedTasterId : '';
    return DropdownButtonFormField<String>(
      initialValue: safeValue,
      isExpanded: true,
      decoration: const InputDecoration(labelText: '品鉴师'),
      items: [
        const DropdownMenuItem(value: '', child: Text('未选择')),
        for (final item in items)
          DropdownMenuItem(
            value: item.key,
            child: Text(item.value, overflow: TextOverflow.ellipsis),
          ),
      ],
      onChanged: (value) {
        setState(() {
          _selectedTasterId = value ?? '';
          _tasterTouched = true;
        });
      },
    );
  }

  Widget _liaisonTasterDropdown() {
    final items = _tasterItems(liaison: true);
    final values = items.map((item) => item.key).toSet();
    final safeValue = values.contains(_selectedLiaisonTasterId)
        ? _selectedLiaisonTasterId
        : '';
    return DropdownButtonFormField<String>(
      initialValue: safeValue,
      isExpanded: true,
      decoration: const InputDecoration(labelText: '对接品鉴师'),
      items: [
        const DropdownMenuItem(value: '', child: Text('未选择')),
        for (final item in items)
          DropdownMenuItem(
            value: item.key,
            child: Text(item.value, overflow: TextOverflow.ellipsis),
          ),
      ],
      onChanged: (value) {
        setState(() {
          _selectedLiaisonTasterId = value ?? '';
          _liaisonTasterTouched = true;
        });
      },
    );
  }

  Widget _mentionedFeitianDropdown() {
    return DropdownButtonFormField<String>(
      initialValue: _mentionedFeitianValue,
      decoration: const InputDecoration(labelText: '是否提及飞天'),
      items: const [
        DropdownMenuItem(value: 'unset', child: Text('未填写')),
        DropdownMenuItem(value: 'yes', child: Text('是')),
        DropdownMenuItem(value: 'no', child: Text('否')),
      ],
      onChanged: (value) {
        if (value != null) {
          setState(() => _mentionedFeitianValue = value);
        }
      },
    );
  }

  Widget _groupTypeDropdown() {
    final options = [
      for (final type in groupTypes) type,
      if (_groupType != null && !groupTypes.contains(_groupType)) _groupType!,
    ];
    final value =
        _groupType != null && options.contains(_groupType) ? _groupType : null;
    return DropdownButtonFormField<String>(
      initialValue: value,
      isExpanded: true,
      decoration: const InputDecoration(labelText: '团型'),
      items: [
        for (final type in options)
          DropdownMenuItem(value: type, child: Text(type)),
      ],
      onChanged: (value) => setState(() => _groupType = value),
    );
  }

  Widget _statusDropdown() {
    return DropdownButtonFormField<String>(
      initialValue: _status,
      isExpanded: true,
      decoration: const InputDecoration(labelText: '状态'),
      items: const [
        DropdownMenuItem(value: 'unmarked', child: Text('未出单')),
        DropdownMenuItem(value: 'pending_summary', child: Text('待总结')),
        DropdownMenuItem(value: 'ordered', child: Text('已出单')),
      ],
      onChanged: (value) {
        if (value != null) {
          setState(() => _status = value);
        }
      },
    );
  }

  Widget _moneyField(TextEditingController controller, String label) {
    return TextFormField(
      controller: controller,
      keyboardType: const TextInputType.numberWithOptions(
        decimal: true,
        signed: true,
      ),
      decoration: InputDecoration(labelText: label),
      validator: _moneyValidator,
    );
  }

  Widget _intField(TextEditingController controller, String label) {
    return TextFormField(
      controller: controller,
      keyboardType: const TextInputType.numberWithOptions(signed: true),
      decoration: InputDecoration(labelText: label),
      validator: _integerValidator,
    );
  }

  Future<void> _pickVisitDate() async {
    final result = await showDatePicker(
      context: context,
      initialDate: _visitDate,
      firstDate: DateTime(2024),
      lastDate: DateTime(2030),
    );
    if (result != null) {
      setState(() => _visitDate = result);
    }
  }

  List<MapEntry<String, String>> _tasterItems({bool liaison = false}) {
    final items = <String, String>{};
    final snapshotId =
        liaison ? widget.group.liaisonTasterId : widget.group.tasterId;
    final snapshotName =
        liaison ? widget.group.liaisonTasterName : widget.group.tasterName;
    if ((snapshotId ?? '').isNotEmpty) {
      items[snapshotId!] = _display(snapshotName);
    }
    for (final taster in widget.tasters) {
      if (taster.id.trim().isNotEmpty) {
        items[taster.id] = _tasterLabel(taster);
      }
    }
    return items.entries.toList();
  }
}

class _DialogSection extends StatelessWidget {
  const _DialogSection({
    required this.title,
    required this.child,
  });

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border.all(color: scheme.outlineVariant),
        borderRadius: const BorderRadius.all(Radius.circular(8)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              title,
              style: Theme.of(context)
                  .textTheme
                  .titleSmall
                  ?.copyWith(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 10),
            child,
          ],
        ),
      ),
    );
  }
}

class _DialogNotice extends StatelessWidget {
  const _DialogNotice({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return StatusTag(label: message, tone: StatusTone.danger);
  }
}

class _EditDateField extends StatelessWidget {
  const _EditDateField({
    required this.label,
    required this.value,
    required this.onTap,
  });

  final String label;
  final DateTime value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      key: ValueKey(formatDate(value)),
      readOnly: true,
      onTap: onTap,
      initialValue: formatDate(value),
      decoration: InputDecoration(
        labelText: label,
        suffixIcon: const Icon(Icons.calendar_month_rounded),
      ),
    );
  }
}

String? _optionalFilter(String value) {
  return value == _allFilter ? null : value;
}

List<MapEntry<String, String>> _travelAgencyFilterItems(
  List<TravelGroupRecord> groups,
  String selected,
) {
  final names = <String>{};
  for (final group in groups) {
    final name = group.travelAgency?.trim();
    if (name != null && name.isNotEmpty) {
      names.add(name);
    }
  }
  if (selected != _allFilter && selected.trim().isNotEmpty) {
    names.add(selected);
  }
  final sortedNames = names.toList()..sort();
  return [
    const MapEntry(_allFilter, '全部'),
    for (final name in sortedNames) MapEntry(name, name),
  ];
}

GuideRecord? _guideForGroup(
  TravelGroupRecord group,
  List<GuideRecord> guides,
) {
  for (final guide in guides) {
    if (guide.id == group.guideId) {
      return guide;
    }
  }
  final id = group.guideId?.trim() ?? '';
  if (id.isEmpty) {
    return null;
  }
  return GuideRecord(
    id: id,
    name: _display(group.guideName),
    phone: _display(group.guidePhone),
    remarks: null,
    isActive: true,
    createdAt: null,
    updatedAt: null,
  );
}

List<GuideRecord> _mergeGuideRecords(
  List<GuideRecord> existing,
  List<GuideRecord> incoming,
) {
  final byId = <String, GuideRecord>{
    for (final guide in existing) guide.id: guide,
    for (final guide in incoming) guide.id: guide,
  };
  return byId.values.toList();
}

String _display(String? value) {
  final text = value?.trim() ?? '';
  return text.isEmpty ? '-' : text;
}

String _safeFileName(String value) {
  final safe = value.trim().replaceAll(RegExp(r'[/\\]'), '_');
  return safe.isEmpty ? 'attachment' : safe;
}

DateTime _shanghaiToday() {
  final shanghaiNow = DateTime.now().toUtc().add(const Duration(hours: 8));
  return DateTime(shanghaiNow.year, shanghaiNow.month, shanghaiNow.day);
}

String _tasterLabel(TasterOption taster) {
  if (taster.username.trim().isEmpty) {
    return taster.name;
  }
  return '${taster.name} · ${taster.username}';
}

String? _nonEmpty(String? value) {
  final text = value?.trim() ?? '';
  return text.isEmpty ? null : text;
}

int _intFromText(String value) {
  return int.tryParse(value.trim()) ?? 0;
}

String _moneyText(int cents) {
  final sign = cents < 0 ? '-' : '';
  final absolute = cents.abs();
  final yuan = absolute ~/ 100;
  final fraction = absolute % 100;
  if (fraction == 0) {
    return '$sign$yuan';
  }
  return '$sign$yuan.${fraction.toString().padLeft(2, '0')}';
}

int _centsFromMoneyText(String value) {
  final text = value.trim().replaceAll(',', '');
  if (text.isEmpty) {
    return 0;
  }
  final negative = text.startsWith('-');
  final normalized = negative ? text.substring(1) : text;
  final parts = normalized.split('.');
  final yuanText = parts.first.isEmpty ? '0' : parts.first;
  final yuan = int.tryParse(yuanText) ?? 0;
  final fractionText = parts.length > 1 ? parts[1] : '';
  final centsText = fractionText.padRight(2, '0').substring(0, 2);
  final cents = yuan * 100 + (int.tryParse(centsText) ?? 0);
  return negative ? -cents : cents;
}

List<TastingItemDraft> _tastingDraftsFromGroup(TravelGroupRecord group) {
  return [
    for (final item in group.tastingItems)
      TastingItemDraft(
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unit: item.unit,
        note: item.note,
      ),
  ];
}

List<Map<String, dynamic>> _tastingPayloadFromGroup(TravelGroupRecord group) {
  return [
    for (var index = 0; index < group.tastingItems.length; index += 1)
      {
        'productId': group.tastingItems[index].productId,
        'quantity': group.tastingItems[index].quantity,
        'note': group.tastingItems[index].note,
        'sortOrder': index + 1,
      },
  ];
}

FormFieldValidator<String> _requiredValidator(String message) {
  return (value) {
    if (value == null || value.trim().isEmpty) {
      return message;
    }
    return null;
  };
}

String? _optionalNonNegativeGuestCountValidator(String? value) {
  final text = (value ?? '').trim();
  if (text.isEmpty) {
    return null;
  }
  final number = int.tryParse(text);
  if (number == null || number < 0) {
    return '人数必须为非负整数';
  }
  return null;
}

String? _optionalTimeValidator(String? value) {
  final text = (value ?? '').trim();
  if (text.isEmpty) {
    return null;
  }
  if (!RegExp(r'^(?:[01]\d|2[0-3]):[0-5]\d$').hasMatch(text)) {
    return '请输入 HH:mm 格式的时间';
  }
  return null;
}

String? _integerValidator(String? value) {
  final text = (value ?? '').trim();
  if (text.isEmpty) {
    return null;
  }
  if (int.tryParse(text) == null) {
    return '请输入整数';
  }
  return null;
}

String? _moneyValidator(String? value) {
  final text = (value ?? '').trim();
  if (text.isEmpty) {
    return null;
  }
  if (!RegExp(r'^-?\d+(\.\d{1,2})?$').hasMatch(text)) {
    return '请输入有效金额';
  }
  return null;
}

String? _optionalPositiveMoneyValidator(String? value) {
  final text = (value ?? '').trim();
  if (text.isEmpty) {
    return null;
  }
  if (!RegExp(r'^\d+(\.\d{1,2})?$').hasMatch(text)) {
    return '请输入最多两位小数的金额';
  }
  final cents = _centsFromMoneyText(text);
  if (cents <= 0) {
    return '香烟费用必须大于 0';
  }
  if (cents > 2147483647) {
    return '香烟费用超出允许范围';
  }
  return null;
}

bool _canEdit(UserRole role) {
  return role == UserRole.superAdmin ||
      role == UserRole.admin ||
      role == UserRole.frontDesk ||
      role == UserRole.taster ||
      role == UserRole.finance;
}

bool _canCreateOrder(UserRole role) {
  return role == UserRole.superAdmin ||
      role == UserRole.admin ||
      role == UserRole.sales ||
      role == UserRole.finance;
}

bool _canMark(UserRole role) {
  return canViewFinanceMark(role);
}

bool _canSubmitSummary(UserRole role) {
  return role == UserRole.superAdmin ||
      role == UserRole.admin ||
      role == UserRole.taster;
}

String _groupStatusLabel(String status) {
  switch (status) {
    case 'ordered':
      return '已出单';
    case 'pending_summary':
      return '待总结';
    case 'unmarked':
    default:
      return '未出单';
  }
}

StatusTone _groupStatusTone(String status) {
  switch (status) {
    case 'ordered':
      return StatusTone.success;
    case 'pending_summary':
      return StatusTone.info;
    case 'unmarked':
    default:
      return StatusTone.neutral;
  }
}

String _pendingStatusLabel(String? status) {
  switch (status) {
    case 'pending_front_desk':
      return '待前台';
    case 'pending_sales':
      return '待销售';
    case 'pending_taster':
      return '待品鉴师';
    case 'pending_finance':
      return '待财务';
    case 'abnormal':
      return '异常';
    default:
      return '无待处理';
  }
}

StatusTone _pendingStatusTone(String? status) {
  switch (status) {
    case 'abnormal':
      return StatusTone.danger;
    case 'pending_front_desk':
    case 'pending_finance':
      return StatusTone.warning;
    case 'pending_sales':
      return StatusTone.info;
    case 'pending_taster':
      return StatusTone.info;
    default:
      return StatusTone.success;
  }
}

List<String> _frontDeskMissingLabels(List<String> reasons) {
  const labels = <String, String>{
    'missing_license_plate': '车牌号',
    'missing_guest_count': '人数',
    'missing_cigarette_fee': '香烟费用',
    'missing_tasting_room_no': '品鉴馆号',
    'missing_taster': '品鉴师',
    'missing_arrival_time': '进店时间',
    'missing_group_type': '团型',
  };
  return [
    for (final reason in reasons)
      if (labels.containsKey(reason)) labels[reason]!,
  ];
}

String _messageForError(Object error) {
  if (error is ApiException) {
    return error.message;
  }
  return '旅行团加载失败，请稍后重试。';
}

String _messageForSaveError(Object error) {
  if (error is ApiException) {
    return error.message;
  }
  return '旅行团保存失败，请稍后重试。';
}
