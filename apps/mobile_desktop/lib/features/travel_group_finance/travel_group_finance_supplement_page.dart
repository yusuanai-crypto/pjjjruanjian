import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:gal/gal.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';
import 'package:path_provider/path_provider.dart';

import '../../core/api/api_client.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/status_tag.dart';

const financeImageAlbumName = '贵州酱酒馆积分表';

typedef FinanceImageSaver = Future<FinanceImageSaveResult> Function(
  Uint8List bytes, {
  required String album,
  required String name,
});
typedef FinanceFolderOpener = Future<void> Function(String directoryPath);
typedef FinanceGalleryWriter = Future<void> Function(
  Uint8List bytes, {
  required String album,
  required String name,
});
typedef FinanceTableImageRenderer = Future<Uint8List> Function(
  FinanceExportTablePage page,
);

enum FinanceImageType {
  guide(
    'guide',
    '旅行社积分导游联络图',
    '批量导出旅行社积分导游联络图',
    '旅行社积分导游联络表',
    '旅行社积分导游联络表',
  ),
  travelAgency(
    'travelAgency',
    '旅行社图片',
    '批量导出旅行社表格图',
    '旅行社积分表',
    '积分表',
  );

  const FinanceImageType(
    this.name,
    this.label,
    this.batchLabel,
    this.tableTitle,
    this.fileTypeLabel,
  );

  final String name;
  final String label;
  final String batchLabel;
  final String tableTitle;
  final String fileTypeLabel;
}

class FinanceExportTableRow {
  const FinanceExportTableRow({
    required this.travelGroupId,
    required this.cells,
  });

  final String travelGroupId;
  final List<String> cells;
}

class FinanceExportTablePage {
  const FinanceExportTablePage({
    required this.type,
    required this.receiverKey,
    required this.receiverName,
    required this.headers,
    required this.columnWidths,
    required this.rows,
    required this.dateRangeLabel,
    required this.pageNumber,
    required this.totalPages,
    required this.exportDate,
  });

  final FinanceImageType type;
  final String receiverKey;
  final String receiverName;
  final List<String> headers;
  final List<double> columnWidths;
  final List<FinanceExportTableRow> rows;
  final String dateRangeLabel;
  final int pageNumber;
  final int totalPages;
  final String exportDate;

  double get canvasWidth =>
      columnWidths.fold<double>(0, (sum, width) => sum + width) + 64;

  String get fileName => _safeExportFileName(
        '$receiverName-${type.fileTypeLabel}-$dateRangeLabel-第$pageNumber页.png',
      );
}

enum FinanceImageSaveTarget {
  windowsFolder,
  systemGallery,
}

class FinanceImageSaveResult {
  const FinanceImageSaveResult({
    required this.target,
    required this.album,
    required this.filePath,
    required this.directoryPath,
  });

  final FinanceImageSaveTarget target;
  final String album;
  final String? filePath;
  final String? directoryPath;

  String get successMessage => switch (target) {
        FinanceImageSaveTarget.windowsFolder => '已保存到：$filePath',
        FinanceImageSaveTarget.systemGallery => '已保存到系统相册：$album',
      };
}

class FinanceImageSaveException implements Exception {
  const FinanceImageSaveException(this.message);

  final String message;

  @override
  String toString() => message;
}

class FinanceImageSaveService {
  FinanceImageSaveService({
    bool? isWindows,
    String? windowsUserProfile,
    FinanceGalleryWriter? galleryWriter,
  })  : _isWindows = isWindows ?? Platform.isWindows,
        _windowsUserProfile = windowsUserProfile,
        _galleryWriter = galleryWriter ?? _saveFinanceImageToGallery;

  final bool _isWindows;
  final String? _windowsUserProfile;
  final FinanceGalleryWriter _galleryWriter;

  Future<FinanceImageSaveResult> save(
    Uint8List bytes, {
    required String album,
    required String name,
  }) async {
    if (_isWindows) {
      return _saveToWindowsPictures(bytes, album: album, name: name);
    }
    await _galleryWriter(bytes, album: album, name: name);
    return FinanceImageSaveResult(
      target: FinanceImageSaveTarget.systemGallery,
      album: album,
      filePath: null,
      directoryPath: null,
    );
  }

  Future<FinanceImageSaveResult> _saveToWindowsPictures(
    Uint8List bytes, {
    required String album,
    required String name,
  }) async {
    final userProfile =
        (_windowsUserProfile ?? Platform.environment['USERPROFILE'] ?? '')
            .trim();
    if (userProfile.isEmpty) {
      throw const FinanceImageSaveException(
        '无法读取当前 Windows 用户目录，图片未保存。',
      );
    }
    try {
      final directory = Directory(
        _joinPath([userProfile, 'Pictures', financeImageAlbumName]),
      );
      await directory.create(recursive: true);
      final safeName = _safeExportFileName(name);
      final baseName = safeName.toLowerCase().endsWith('.png')
          ? safeName.substring(0, safeName.length - 4)
          : safeName;
      var sequence = 0;
      File target;
      do {
        final suffix = sequence == 0 ? '' : ' ($sequence)';
        target = File(_joinPath([directory.path, '$baseName$suffix.png']));
        sequence += 1;
      } while (await target.exists());
      await target.writeAsBytes(bytes, flush: true);
      return FinanceImageSaveResult(
        target: FinanceImageSaveTarget.windowsFolder,
        album: album,
        filePath: target.absolute.path,
        directoryPath: directory.absolute.path,
      );
    } on FinanceImageSaveException {
      rethrow;
    } on FileSystemException catch (error) {
      throw FinanceImageSaveException(
        '保存图片失败：${error.osError?.message ?? error.message}',
      );
    }
  }
}

final FinanceImageSaveService _defaultFinanceImageSaveService =
    FinanceImageSaveService();

Future<FinanceImageSaveResult> saveFinanceImage(
  Uint8List bytes, {
  required String album,
  required String name,
}) {
  return _defaultFinanceImageSaveService.save(
    bytes,
    album: album,
    name: name,
  );
}

Future<void> openFinanceImageFolder(String directoryPath) async {
  if (!Platform.isWindows) {
    throw const FinanceImageSaveException('当前平台不支持打开 Windows 文件夹。');
  }
  try {
    await Process.start(
      'explorer.exe',
      [directoryPath],
      mode: ProcessStartMode.detached,
    );
  } on ProcessException catch (error) {
    throw FinanceImageSaveException('无法打开保存文件夹：${error.message}');
  }
}

Future<void> _saveFinanceImageToGallery(
  Uint8List bytes, {
  required String album,
  required String name,
}) async {
  try {
    final hasAccess = await Gal.hasAccess(toAlbum: true);
    final accessGranted = hasAccess || await Gal.requestAccess(toAlbum: true);
    if (!accessGranted) {
      throw const FinanceImageSaveException(
        '相册权限被拒绝，请在系统设置中允许照片写入权限。',
      );
    }
    await Gal.putImageBytes(bytes, album: album, name: name);
  } on FinanceImageSaveException {
    rethrow;
  } on GalException catch (error) {
    throw FinanceImageSaveException(
      switch (error.type) {
        GalExceptionType.accessDenied => '相册权限被拒绝，请在系统设置中允许照片写入权限。',
        GalExceptionType.notEnoughSpace => '设备存储空间不足，无法保存到相册。',
        GalExceptionType.notSupportedFormat => '图片格式不受支持，无法保存到相册。',
        GalExceptionType.unexpected => '保存到相册失败，请稍后重试。',
      },
    );
  } catch (_) {
    throw const FinanceImageSaveException('保存到相册失败，请稍后重试。');
  }
}

String _joinPath(List<String> parts) {
  return parts.where((part) => part.isNotEmpty).join(Platform.pathSeparator);
}

class TravelGroupFinanceSupplementPage extends StatefulWidget {
  const TravelGroupFinanceSupplementPage({
    super.key,
    required this.apiClient,
    required this.token,
    this.imageSaver = saveFinanceImage,
    this.folderOpener = openFinanceImageFolder,
    this.tableImageRenderer,
    this.documentsDirectoryProvider,
  });

  final ApiClient apiClient;
  final String token;
  final FinanceImageSaver imageSaver;
  final FinanceFolderOpener folderOpener;
  final FinanceTableImageRenderer? tableImageRenderer;
  final Future<Directory> Function()? documentsDirectoryProvider;

  @override
  State<TravelGroupFinanceSupplementPage> createState() =>
      _TravelGroupFinanceSupplementPageState();
}

class _TravelGroupFinanceSupplementPageState
    extends State<TravelGroupFinanceSupplementPage> {
  late BusinessApi _businessApi;
  late final TextEditingController _agencyFilterController;
  late final TextEditingController _guideFilterController;
  late final TextEditingController _unreturnedPointsFilterController;

  List<TravelGroupFinanceSummaryRecord> _summaries =
      const <TravelGroupFinanceSummaryRecord>[];
  final Set<String> _selectedTravelGroupIds = <String>{};
  final Set<String> _guideImageReadyIds = <String>{};
  final Set<String> _travelAgencyImageReadyIds = <String>{};
  final Set<String> _imageExportingKeys = <String>{};
  final Set<String> _agencyDeductionUpdatingIds = <String>{};
  final Set<String> _rebateUpdatingKeys = <String>{};
  final Set<String> _sentUpdatingKeys = <String>{};

  String _agencyQuery = '';
  String _guideQuery = '';
  DateTimeRange? _dateRange;
  String _tasterFilter = _allFilter;
  String _unreturnedPointsQuery = '';
  String _guideInfoSentFilter = _allFilter;
  String _travelAgencyInfoSentFilter = _allFilter;
  String _statusFilter = _allFilter;
  bool _loading = true;
  bool _recalculating = false;
  bool _batchExporting = false;
  bool _exportingExcel = false;
  String? _errorMessage;
  String? _successMessage;
  String? _lastWindowsSaveDirectory;

  @override
  void initState() {
    super.initState();
    _businessApi =
        BusinessApi(apiClient: widget.apiClient, token: widget.token);
    _agencyFilterController = TextEditingController();
    _guideFilterController = TextEditingController();
    _unreturnedPointsFilterController = TextEditingController();
    _loadData();
  }

  @override
  void didUpdateWidget(covariant TravelGroupFinanceSupplementPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token) {
      _businessApi =
          BusinessApi(apiClient: widget.apiClient, token: widget.token);
      _loadData();
    }
  }

  @override
  void activate() {
    super.activate();
    if (!_loading) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          _loadData();
        }
      });
    }
  }

  @override
  void dispose() {
    _agencyFilterController.dispose();
    _guideFilterController.dispose();
    _unreturnedPointsFilterController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    try {
      final summaries = await _businessApi.listFinanceRows(
        limit: 200,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _summaries = summaries;
        _selectedTravelGroupIds.removeWhere(
          (id) => summaries.every((summary) => summary.financeRowId != id),
        );
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

  List<TravelGroupFinanceSummaryRecord> get _visibleSummaries {
    final agencyQuery = _agencyQuery.trim().toLowerCase();
    final guideQuery = _guideQuery.trim().toLowerCase();
    final unreturnedPointsFilter = int.tryParse(_unreturnedPointsQuery.trim());

    return _summaries.where((summary) {
      final group = summary.travelGroup;
      if (_dateRange != null) {
        final date = _dateFromText(
          summary.financeDate ?? group?.visitDate ?? '',
        );
        if (date == null ||
            date.isBefore(_dateRange!.start) ||
            date.isAfter(_dateRange!.end)) {
          return false;
        }
      }
      if (agencyQuery.isNotEmpty &&
          !_text(group?.travelAgency).toLowerCase().contains(agencyQuery)) {
        return false;
      }
      if (guideQuery.isNotEmpty &&
          !_text(group?.guideName).toLowerCase().contains(guideQuery)) {
        return false;
      }
      if (_tasterFilter != _allFilter &&
          _text(group?.tasterName) != _tasterFilter) {
        return false;
      }
      if (unreturnedPointsFilter != null &&
          scalePointsTableAmountCents(summary.unpaidRebateCents) !=
              unreturnedPointsFilter) {
        return false;
      }
      if (!_matchesSentFilter(summary.guideInfoSent, _guideInfoSentFilter)) {
        return false;
      }
      if (!_matchesSentFilter(
        summary.travelAgencyInfoSent,
        _travelAgencyInfoSentFilter,
      )) {
        return false;
      }
      if (_statusFilter != _allFilter &&
          _summaryStatus(summary) != _statusFilter) {
        return false;
      }
      return true;
    }).toList();
  }

  int get _visibleOrderAmountCents {
    return _visibleSummaries.fold<int>(
      0,
      (sum, summary) =>
          sum +
          (summary.includedInFormalTotals
              ? summary.totalAgencyNetAmountCents
              : 0),
    );
  }

  int get _visibleReturnedAmountCents {
    return _visibleSummaries.fold<int>(
      0,
      (sum, summary) =>
          sum + (summary.includedInFormalTotals ? summary.paidRebateCents : 0),
    );
  }

  List<String> get _tasterOptions {
    final options = _summaries
        .map((summary) => _text(summary.travelGroup?.tasterName).trim())
        .where((name) => name.isNotEmpty)
        .toSet()
        .toList();
    options.sort();
    return options;
  }

  DateTime get _datePickerInitialDate {
    final dates = _summaries
        .map(
          (summary) => _dateFromText(
            summary.financeDate ?? summary.travelGroup?.visitDate ?? '',
          ),
        )
        .whereType<DateTime>()
        .toList();
    if (dates.isEmpty) {
      return DateTime.now();
    }
    dates.sort();
    return dates.last;
  }

  void _clearFilters() {
    setState(() {
      _agencyFilterController.clear();
      _guideFilterController.clear();
      _unreturnedPointsFilterController.clear();
      _agencyQuery = '';
      _guideQuery = '';
      _dateRange = null;
      _tasterFilter = _allFilter;
      _unreturnedPointsQuery = '';
      _guideInfoSentFilter = _allFilter;
      _travelAgencyInfoSentFilter = _allFilter;
      _statusFilter = _allFilter;
    });
  }

  void _toggleSelection(String travelGroupId, bool selected) {
    setState(() {
      if (selected) {
        _selectedTravelGroupIds.add(travelGroupId);
      } else {
        _selectedTravelGroupIds.remove(travelGroupId);
      }
    });
  }

  void _toggleVisibleSelection(bool selected) {
    setState(() {
      final ids = _visibleSummaries.map((summary) => summary.financeRowId);
      if (selected) {
        _selectedTravelGroupIds.addAll(ids);
      } else {
        _selectedTravelGroupIds.removeAll(ids);
      }
    });
  }

  Future<void> _setDailyRebatePaid(
    TravelGroupFinanceSummaryRecord summary,
    bool isPaid,
  ) {
    if (!summary.summaryExists || summary.isAfterSales) {
      return Future<void>.value();
    }
    return _runSummaryAction(
      busyKey: '${summary.travelGroupId}:dailyRebatePaid',
      action: () => _businessApi.setDailyRebatePaid(
        summary.travelGroupId,
        isPaid,
      ),
      successMessage: isPaid ? '已标记日返积分已返' : '已取消日返积分已返',
      busySet: _rebateUpdatingKeys,
    );
  }

  Future<void> _saveAgencyDeduction(
    TravelGroupFinanceSummaryRecord summary,
    int totalAgencyDeductionCents,
  ) async {
    if (!summary.summaryExists) {
      return;
    }
    final rowId = summary.financeRowId;
    if (_agencyDeductionUpdatingIds.contains(rowId)) {
      return;
    }
    setState(() {
      _agencyDeductionUpdatingIds.add(rowId);
      _errorMessage = null;
      _successMessage = null;
    });

    try {
      if (summary.isAfterSales) {
        await _businessApi.updateAfterSalesAgencyDeduction(
          summary.id!,
          totalAgencyDeductionCents,
        );
        await _loadData();
      } else {
        final updated = await _businessApi.updateAgencyDeduction(
          summary.travelGroupId,
          totalAgencyDeductionCents,
        );
        _replaceSummary(updated);
      }
      if (!mounted) {
        return;
      }
      setState(() {
        _agencyDeductionUpdatingIds.remove(rowId);
        _successMessage = '扣酒成本已保存。';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _agencyDeductionUpdatingIds.remove(rowId);
        _errorMessage = '扣酒成本保存失败：${_messageForError(error)}';
      });
    }
  }

  Future<void> _setMonthlyRebatePaid(
    TravelGroupFinanceSummaryRecord summary,
    bool isPaid,
  ) {
    if (!summary.summaryExists || summary.isAfterSales) {
      return Future<void>.value();
    }
    return _runSummaryAction(
      busyKey: '${summary.travelGroupId}:monthlyRebatePaid',
      action: () => _businessApi.setMonthlyRebatePaid(
        summary.travelGroupId,
        isPaid,
      ),
      successMessage: isPaid ? '已标记月返积分已返' : '已取消月返积分已返',
      busySet: _rebateUpdatingKeys,
    );
  }

  Future<void> _setGuideInfoSent(
    TravelGroupFinanceSummaryRecord summary,
    bool value,
  ) {
    if (!summary.summaryExists || summary.isAfterSales) {
      return Future<void>.value();
    }
    if (value && !_guideImageReadyIds.contains(summary.travelGroupId)) {
      return Future<void>.value();
    }
    return _runSummaryAction(
      busyKey: '${summary.travelGroupId}:guideInfoSent',
      action: () => _businessApi.updateTravelGroupFinanceSummary(
        summary.travelGroupId,
        {'guideInfoSent': value},
      ),
      successMessage: value ? '已标记导游信息已发送' : '已取消导游信息发送标记',
      busySet: _sentUpdatingKeys,
    );
  }

  Future<void> _setTravelAgencyInfoSent(
    TravelGroupFinanceSummaryRecord summary,
    bool value,
  ) {
    if (!summary.summaryExists || summary.isAfterSales) {
      return Future<void>.value();
    }
    if (value && !_travelAgencyImageReadyIds.contains(summary.travelGroupId)) {
      return Future<void>.value();
    }
    return _runSummaryAction(
      busyKey: '${summary.travelGroupId}:travelAgencyInfoSent',
      action: () => _businessApi.updateTravelGroupFinanceSummary(
        summary.travelGroupId,
        {'travelAgencyInfoSent': value},
      ),
      successMessage: value ? '已标记旅行社信息已发送' : '已取消旅行社信息发送标记',
      busySet: _sentUpdatingKeys,
    );
  }

  Future<void> _runSummaryAction({
    required String busyKey,
    required Future<TravelGroupFinanceSummaryRecord> Function() action,
    required String successMessage,
    required Set<String> busySet,
  }) async {
    if (busySet.contains(busyKey)) {
      return;
    }
    setState(() {
      busySet.add(busyKey);
      _errorMessage = null;
      _successMessage = null;
    });

    try {
      final updated = await action();
      if (!mounted) {
        return;
      }
      setState(() {
        busySet.remove(busyKey);
        _replaceSummary(updated);
        _successMessage = successMessage;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        busySet.remove(busyKey);
        _errorMessage = _messageForError(error);
      });
    }
  }

  void _replaceSummary(TravelGroupFinanceSummaryRecord updated) {
    _summaries = [
      for (final summary in _summaries)
        !summary.isAfterSales && summary.travelGroupId == updated.travelGroupId
            ? updated
            : summary,
    ];
  }

  Future<void> _recalculateSelected() async {
    if (_recalculating || _selectedTravelGroupIds.isEmpty) {
      return;
    }
    final travelGroupIds = _visibleSummaries
        .where(
          (summary) =>
              !summary.isAfterSales &&
              _selectedTravelGroupIds.contains(summary.financeRowId),
        )
        .map((summary) => summary.travelGroupId)
        .toSet()
        .toList();
    if (travelGroupIds.isEmpty) {
      setState(() => _successMessage = '售后调整行无需重新计算原旅行团汇总。');
      return;
    }
    setState(() {
      _recalculating = true;
      _errorMessage = null;
      _successMessage = null;
    });
    try {
      final result = await _businessApi.recalculateTravelGroups(
        travelGroupIds,
      );
      if (!mounted) {
        return;
      }
      final message = result.displayMessage;
      await _loadData();
      if (!mounted) {
        return;
      }
      setState(() {
        _recalculating = false;
        _successMessage = message;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _recalculating = false;
        _errorMessage = '重新计算失败：${_messageForError(error)}';
      });
    }
  }

  Future<void> _exportSelectedExcel() async {
    if (_exportingExcel) {
      return;
    }
    final selected = _visibleSummaries
        .where(
          (summary) => _selectedTravelGroupIds.contains(summary.financeRowId),
        )
        .toList();
    if (selected.isEmpty) {
      return;
    }

    setState(() {
      _exportingExcel = true;
      _errorMessage = null;
      _successMessage = null;
    });
    try {
      final downloadedFile =
          await _businessApi.downloadSelectedFinanceRowsExcel(
        selected.map((summary) => summary.financeRowId).toList(),
      );
      final targetFile = await _writeSelectedExcelFile(downloadedFile);
      if (!mounted) {
        return;
      }
      setState(() {
        _lastWindowsSaveDirectory =
            Platform.isWindows ? targetFile.parent.absolute.path : null;
        _successMessage =
            '已导出 ${selected.length} 行积分信息：${targetFile.absolute.path}';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _errorMessage = _messageForError(error);
      });
    } finally {
      if (mounted) {
        setState(() {
          _exportingExcel = false;
        });
      }
    }
  }

  Future<File> _writeSelectedExcelFile(DownloadedFile downloadedFile) async {
    final documentsDirectory =
        await (widget.documentsDirectoryProvider?.call() ??
            getApplicationDocumentsDirectory());
    final exportDirectory = Directory(
      _joinPath([documentsDirectory.path, 'exports']),
    );
    await exportDirectory.create(recursive: true);
    final targetFile = await _nextExcelExportFile(
      exportDirectory,
      _safeExcelExportFileName(downloadedFile.fileName),
    );
    await targetFile.writeAsBytes(downloadedFile.bytes, flush: true);
    return targetFile;
  }

  Future<void> _exportSelectedImages(FinanceImageType type) async {
    if (_batchExporting) {
      return;
    }
    final selected = _visibleSummaries
        .where(
          (summary) =>
              !summary.isAfterSales &&
              _selectedTravelGroupIds.contains(summary.financeRowId),
        )
        .toList();
    if (selected.isEmpty) {
      return;
    }
    final pages = _buildFinanceExportTablePages(selected, type);
    var successCount = 0;
    setState(() {
      _batchExporting = true;
      _lastWindowsSaveDirectory = null;
      _errorMessage = null;
      _successMessage = null;
    });
    try {
      for (final page in pages) {
        try {
          final bytes = await (widget.tableImageRenderer?.call(page) ??
              _renderTableImageBytes(page));
          final fileName = page.fileName;
          final imageName = fileName.toLowerCase().endsWith('.png')
              ? fileName.substring(0, fileName.length - 4)
              : fileName;
          final saveResult = await widget.imageSaver(
            bytes,
            album: financeImageAlbumName,
            name: imageName,
          );
          successCount += 1;
          if (!mounted) {
            return;
          }
          setState(() {
            final readyIds = page.rows.map((row) => row.travelGroupId);
            if (type == FinanceImageType.guide) {
              _guideImageReadyIds.addAll(readyIds);
            } else {
              _travelAgencyImageReadyIds.addAll(readyIds);
            }
            if (saveResult.directoryPath != null) {
              _lastWindowsSaveDirectory = saveResult.directoryPath;
            }
          });
        } catch (_) {
          // A failed page must not mark any of its rows as image-ready.
        }
      }
    } finally {
      if (mounted) {
        setState(() => _batchExporting = false);
      }
    }
    if (!mounted) {
      return;
    }
    final failureCount = pages.length - successCount;
    final destination = _lastWindowsSaveDirectory == null
        ? '系统相册：$financeImageAlbumName'
        : _lastWindowsSaveDirectory!;
    final message =
        '批量导出完成：成功 $successCount 张表格，失败 $failureCount 张；保存位置：$destination';
    setState(() {
      if (failureCount == 0) {
        _successMessage = message;
        _errorMessage = null;
      } else {
        _successMessage = null;
        _errorMessage = message;
      }
    });
    ScaffoldMessenger.of(context).hideCurrentSnackBar();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  Future<bool> _exportImage(
    TravelGroupFinanceSummaryRecord summary,
    FinanceImageType type, {
    bool showSnackBar = true,
  }) async {
    if (summary.isAfterSales) {
      return false;
    }
    final busyKey = '${summary.financeRowId}:${type.name}';
    if (_imageExportingKeys.contains(busyKey)) {
      return false;
    }
    setState(() {
      _imageExportingKeys.add(busyKey);
      _errorMessage = null;
      _successMessage = null;
    });

    try {
      final bytes = await _renderImageBytes(summary, type);
      final fileName = _imageFileName(summary, type);
      final imageName = fileName.toLowerCase().endsWith('.png')
          ? fileName.substring(0, fileName.length - 4)
          : fileName;
      final saveResult = await widget.imageSaver(
        bytes,
        album: financeImageAlbumName,
        name: imageName,
      );
      if (!mounted) {
        return false;
      }
      setState(() {
        _imageExportingKeys.remove(busyKey);
        if (type == FinanceImageType.guide) {
          _guideImageReadyIds.add(summary.travelGroupId);
        } else {
          _travelAgencyImageReadyIds.add(summary.travelGroupId);
        }
        _lastWindowsSaveDirectory = saveResult.directoryPath;
        _successMessage = saveResult.successMessage;
      });
      if (showSnackBar) {
        ScaffoldMessenger.of(context).hideCurrentSnackBar();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(saveResult.successMessage),
            action: saveResult.directoryPath == null
                ? null
                : SnackBarAction(
                    label: '打开文件夹',
                    onPressed: () =>
                        _openSavedDirectory(saveResult.directoryPath!),
                  ),
          ),
        );
      }
      return true;
    } catch (error) {
      if (!mounted) {
        return false;
      }
      setState(() {
        _imageExportingKeys.remove(busyKey);
        _errorMessage = _messageForError(error);
      });
      return false;
    }
  }

  Future<void> _openSavedDirectory(String directoryPath) async {
    try {
      await widget.folderOpener(directoryPath);
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() => _errorMessage = _messageForError(error));
    }
  }

  Future<Uint8List> _renderImageBytes(
    TravelGroupFinanceSummaryRecord summary,
    FinanceImageType type,
  ) {
    return _renderOffstageWidgetBytes(
      _FinanceExportImageCard(
        summary: summary,
        type: type,
      ),
    );
  }

  Future<Uint8List> _renderTableImageBytes(FinanceExportTablePage page) {
    return _renderOffstageWidgetBytes(
      FinanceExportTableImage(page: page),
    );
  }

  Future<Uint8List> _renderOffstageWidgetBytes(Widget child) async {
    final repaintKey = GlobalKey();
    final overlay = Overlay.of(context, rootOverlay: true);
    final entry = OverlayEntry(
      builder: (context) => Positioned(
        left: 0,
        top: 0,
        child: IgnorePointer(
          child: Opacity(
            opacity: 0.01,
            child: Material(
              color: Colors.transparent,
              child: RepaintBoundary(
                key: repaintKey,
                child: child,
              ),
            ),
          ),
        ),
      ),
    );

    overlay.insert(entry);
    try {
      await WidgetsBinding.instance.endOfFrame;
      await WidgetsBinding.instance.endOfFrame;
      final boundary = repaintKey.currentContext?.findRenderObject()
          as RenderRepaintBoundary?;
      if (boundary == null) {
        throw StateError('无法生成图片。');
      }
      final image = await boundary.toImage(pixelRatio: 2);
      try {
        final byteData = await image.toByteData(format: ui.ImageByteFormat.png);
        final bytes = byteData?.buffer.asUint8List();
        if (bytes == null || bytes.isEmpty) {
          throw StateError('无法生成图片。');
        }
        return bytes;
      } finally {
        image.dispose();
      }
    } finally {
      entry.remove();
    }
  }

  String _imageFileName(
    TravelGroupFinanceSummaryRecord summary,
    FinanceImageType type,
  ) {
    final group = summary.travelGroup;
    final date = _dateOnlyText(group?.visitDate ?? '');
    final safeDate = date.isEmpty ? '未知日期' : date;
    final agency = _text(group?.travelAgency, fallback: '未知旅行社');
    final guide = _text(group?.guideName, fallback: '未知导游');
    final suffix = type == FinanceImageType.guide ? '旅行社积分导游联络表' : '积分表';
    return _safeExportFileName('$safeDate-$agency-$guide-$suffix.png');
  }

  @override
  Widget build(BuildContext context) {
    final visibleSummaries = _visibleSummaries;
    final selectedVisibleCount = visibleSummaries
        .where(
          (summary) => _selectedTravelGroupIds.contains(summary.financeRowId),
        )
        .length;

    return ResponsivePage(
      maxWidth: 1480,
      children: [
        FormSection(
          title: '筛选条件',
          trailing: StatusTag(
            label: '${visibleSummaries.length} 行',
            tone: StatusTone.info,
          ),
          children: [
            ResponsiveFormGrid(
              children: [
                TextField(
                  key: const ValueKey('finance-filter-agency'),
                  controller: _agencyFilterController,
                  decoration: const InputDecoration(labelText: '旅行社'),
                  onChanged: (value) => setState(() => _agencyQuery = value),
                ),
                TextField(
                  key: const ValueKey('finance-filter-guide'),
                  controller: _guideFilterController,
                  decoration: const InputDecoration(labelText: '导游'),
                  onChanged: (value) => setState(() => _guideQuery = value),
                ),
                _DateRangeFilter(
                  value: _dateRange,
                  initialDate: _datePickerInitialDate,
                  onChanged: (value) => setState(() => _dateRange = value),
                ),
                _FilterDropdown(
                  controlKey: const ValueKey('finance-filter-taster'),
                  label: '品鉴师',
                  value: _tasterFilter,
                  items: [
                    const MapEntry(_allFilter, '全部'),
                    for (final taster in _tasterOptions)
                      MapEntry(taster, taster),
                  ],
                  onChanged: (value) => setState(() => _tasterFilter = value),
                ),
                TextField(
                  key: const ValueKey('finance-filter-unreturned-points'),
                  controller: _unreturnedPointsFilterController,
                  keyboardType: TextInputType.number,
                  inputFormatters: const [_NonNegativeIntegerFormatter()],
                  decoration: const InputDecoration(
                    labelText: '未返积分',
                    hintText: '请输入非负整数',
                  ),
                  onChanged: (value) => setState(
                    () => _unreturnedPointsQuery = value,
                  ),
                ),
                _FilterDropdown(
                  controlKey: const ValueKey('finance-filter-guide-info-sent'),
                  label: '导游信息发送',
                  value: _guideInfoSentFilter,
                  items: _sentFilterItems,
                  onChanged: (value) =>
                      setState(() => _guideInfoSentFilter = value),
                ),
                _FilterDropdown(
                  controlKey: const ValueKey('finance-filter-agency-info-sent'),
                  label: '旅行社信息发送',
                  value: _travelAgencyInfoSentFilter,
                  items: _sentFilterItems,
                  onChanged: (value) =>
                      setState(() => _travelAgencyInfoSentFilter = value),
                ),
                _FilterDropdown(
                  controlKey: const ValueKey('finance-filter-status'),
                  label: '状态',
                  value: _statusFilter,
                  items: const [
                    MapEntry(_allFilter, '全部'),
                    MapEntry(_statusMissing, '未生成汇总'),
                    MapEntry(_statusPending, '待返'),
                    MapEntry(_statusComplete, '已完成'),
                    MapEntry(_statusAfterSalesProcessing, '售后处理中'),
                    MapEntry(_statusRefundPending, '退款待确认'),
                    MapEntry(_statusFinanceRequired, '需财务处理'),
                    MapEntry(_statusAfterSalesConfirmed, '售后已确认'),
                    MapEntry(_statusAfterSalesRecovery, '待追回/下期抵扣'),
                    MapEntry(_statusNoFinancialEffect, '无财务影响'),
                  ],
                  onChanged: (value) => setState(() => _statusFilter = value),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerRight,
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  TextButton.icon(
                    key: const ValueKey('finance-filter-clear'),
                    onPressed: _clearFilters,
                    icon: const Icon(Icons.filter_alt_off_rounded),
                    label: const Text('清空筛选'),
                  ),
                  OutlinedButton.icon(
                    key: const ValueKey('finance-refresh-button'),
                    onPressed: _loading ? null : _loadData,
                    icon: const Icon(Icons.refresh_rounded),
                    label: const Text('刷新'),
                  ),
                ],
              ),
            ),
          ],
        ),
        if (_errorMessage != null)
          _InlineNotice(message: _errorMessage!, tone: StatusTone.danger),
        if (_successMessage != null)
          _InlineNotice(
            message: _successMessage!,
            tone: StatusTone.success,
            action: _lastWindowsSaveDirectory == null
                ? null
                : TextButton.icon(
                    key: const ValueKey('finance-open-save-folder-button'),
                    onPressed: () =>
                        _openSavedDirectory(_lastWindowsSaveDirectory!),
                    icon: const Icon(Icons.folder_open_rounded),
                    label: const Text('打开文件夹'),
                  ),
          ),
        _FinanceSummaryStrip(
          visibleCount: visibleSummaries.length,
          totalCount: _summaries.length,
          orderAmountCents: _visibleOrderAmountCents,
          returnedAmountCents: _visibleReturnedAmountCents,
          pendingCount: visibleSummaries
              .where((summary) => _summaryStatus(summary) == _statusPending)
              .length,
        ),
        FormSection(
          title: '积分表',
          trailing: Wrap(
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              StatusTag(
                label: '已选 $selectedVisibleCount 行',
                tone: selectedVisibleCount == 0
                    ? StatusTone.neutral
                    : StatusTone.info,
              ),
              FilledButton.icon(
                key: const ValueKey('finance-recalculate-button'),
                onPressed: selectedVisibleCount == 0 || _recalculating
                    ? null
                    : _recalculateSelected,
                icon: _recalculating
                    ? const SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.calculate_rounded),
                label: Text(_recalculating ? '计算中' : '重新计算'),
              ),
              OutlinedButton.icon(
                key: const ValueKey(
                  'finance-export-selected-excel-button',
                ),
                onPressed: selectedVisibleCount == 0 || _exportingExcel
                    ? null
                    : _exportSelectedExcel,
                icon: const Icon(Icons.table_view_rounded),
                label: Text(_exportingExcel ? 'Excel 导出中' : '导出所选 Excel'),
              ),
              OutlinedButton.icon(
                key: const ValueKey('finance-export-guide-images-button'),
                onPressed: selectedVisibleCount == 0 || _batchExporting
                    ? null
                    : () => _exportSelectedImages(FinanceImageType.guide),
                icon: const Icon(Icons.badge_rounded),
                label: Text(
                  _batchExporting ? '表格导出中' : FinanceImageType.guide.batchLabel,
                ),
              ),
              OutlinedButton.icon(
                key: const ValueKey('finance-export-agency-images-button'),
                onPressed: selectedVisibleCount == 0 || _batchExporting
                    ? null
                    : () =>
                        _exportSelectedImages(FinanceImageType.travelAgency),
                icon: const Icon(Icons.apartment_rounded),
                label: Text(
                  _batchExporting
                      ? '表格导出中'
                      : FinanceImageType.travelAgency.batchLabel,
                ),
              ),
            ],
          ),
          children: [
            if (_loading)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 28),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (visibleSummaries.isEmpty)
              const _EmptyFinanceTable()
            else
              _FinancePointTable(
                summaries: visibleSummaries,
                selectedTravelGroupIds: _selectedTravelGroupIds,
                guideImageReadyIds: _guideImageReadyIds,
                travelAgencyImageReadyIds: _travelAgencyImageReadyIds,
                imageExportingKeys: _imageExportingKeys,
                agencyDeductionUpdatingIds: _agencyDeductionUpdatingIds,
                rebateUpdatingKeys: _rebateUpdatingKeys,
                sentUpdatingKeys: _sentUpdatingKeys,
                onSelectionChanged: _toggleSelection,
                onSelectAllChanged: _toggleVisibleSelection,
                onAgencyDeductionSaved: _saveAgencyDeduction,
                onDailyRebatePaidChanged: _setDailyRebatePaid,
                onMonthlyRebatePaidChanged: _setMonthlyRebatePaid,
                onExportImage: _exportImage,
                onGuideInfoSentChanged: _setGuideInfoSent,
                onTravelAgencyInfoSentChanged: _setTravelAgencyInfoSent,
              ),
          ],
        ),
      ],
    );
  }
}

class _DateRangeFilter extends StatelessWidget {
  const _DateRangeFilter({
    required this.value,
    required this.initialDate,
    required this.onChanged,
  });

  final DateTimeRange? value;
  final DateTime initialDate;
  final ValueChanged<DateTimeRange?> onChanged;

  Future<void> _pickRange(BuildContext context) async {
    final initialRange = value ??
        DateTimeRange(
          start: initialDate,
          end: initialDate,
        );
    final result = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2024),
      lastDate: DateTime(2030),
      initialDateRange: initialRange,
      locale: const Locale('zh', 'CN'),
      helpText: '选择日期范围',
      cancelText: '取消',
      confirmText: '确定',
      saveText: '确定',
      fieldStartHintText: '开始日期',
      fieldEndHintText: '结束日期',
      fieldStartLabelText: '开始日期',
      fieldEndLabelText: '结束日期',
      errorFormatText: '请输入正确日期',
      errorInvalidText: '日期无效',
      errorInvalidRangeText: '结束日期不能早于开始日期',
    );
    if (result != null) {
      onChanged(
        DateTimeRange(
          start: _dateOnly(result.start),
          end: _dateOnly(result.end),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final label = value == null
        ? '全部日期'
        : '${_formatDate(value!.start)} 至 ${_formatDate(value!.end)}';
    return Material(
      color: Colors.transparent,
      child: InkWell(
        key: const ValueKey('finance-filter-date'),
        borderRadius: const BorderRadius.all(Radius.circular(8)),
        onTap: () => _pickRange(context),
        child: InputDecorator(
          decoration: InputDecoration(
            labelText: '日期',
            prefixIcon: const Icon(Icons.date_range_rounded),
            suffixIcon: value == null
                ? null
                : IconButton(
                    key: const ValueKey('finance-filter-date-clear'),
                    tooltip: '清除日期',
                    onPressed: () => onChanged(null),
                    icon: const Icon(Icons.close_rounded),
                  ),
          ),
          child: Text(label, overflow: TextOverflow.ellipsis),
        ),
      ),
    );
  }
}

class _FilterDropdown extends StatelessWidget {
  const _FilterDropdown({
    required this.controlKey,
    required this.label,
    required this.value,
    required this.items,
    required this.onChanged,
  });

  final Key controlKey;
  final String label;
  final String value;
  final List<MapEntry<String, String>> items;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final values = items.map((item) => item.key).toSet();
    final safeValue = values.contains(value) ? value : _allFilter;
    return InputDecorator(
      decoration: InputDecoration(labelText: label),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          key: controlKey,
          value: safeValue,
          isExpanded: true,
          isDense: true,
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
        ),
      ),
    );
  }
}

class _FinanceSummaryStrip extends StatelessWidget {
  const _FinanceSummaryStrip({
    required this.visibleCount,
    required this.totalCount,
    required this.orderAmountCents,
    required this.returnedAmountCents,
    required this.pendingCount,
  });

  final int visibleCount;
  final int totalCount;
  final int orderAmountCents;
  final int returnedAmountCents;
  final int pendingCount;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 10,
      runSpacing: 10,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        StatusTag(
            label: '当前显示 $visibleCount/$totalCount 行', tone: StatusTone.info),
        StatusTag(label: '待返 $pendingCount 行', tone: StatusTone.warning),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('上单金额 '),
            Text(formatPointsTableMoneyCents(orderAmountCents)),
          ],
        ),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('已返积分 '),
            Text(formatPointsTableMoneyCents(returnedAmountCents)),
          ],
        ),
      ],
    );
  }
}

class _FinancePointTable extends StatelessWidget {
  const _FinancePointTable({
    required this.summaries,
    required this.selectedTravelGroupIds,
    required this.guideImageReadyIds,
    required this.travelAgencyImageReadyIds,
    required this.imageExportingKeys,
    required this.agencyDeductionUpdatingIds,
    required this.rebateUpdatingKeys,
    required this.sentUpdatingKeys,
    required this.onSelectionChanged,
    required this.onSelectAllChanged,
    required this.onAgencyDeductionSaved,
    required this.onDailyRebatePaidChanged,
    required this.onMonthlyRebatePaidChanged,
    required this.onExportImage,
    required this.onGuideInfoSentChanged,
    required this.onTravelAgencyInfoSentChanged,
  });

  final List<TravelGroupFinanceSummaryRecord> summaries;
  final Set<String> selectedTravelGroupIds;
  final Set<String> guideImageReadyIds;
  final Set<String> travelAgencyImageReadyIds;
  final Set<String> imageExportingKeys;
  final Set<String> agencyDeductionUpdatingIds;
  final Set<String> rebateUpdatingKeys;
  final Set<String> sentUpdatingKeys;
  final void Function(String travelGroupId, bool selected) onSelectionChanged;
  final ValueChanged<bool> onSelectAllChanged;
  final Future<void> Function(TravelGroupFinanceSummaryRecord, int)
      onAgencyDeductionSaved;
  final Future<void> Function(TravelGroupFinanceSummaryRecord, bool)
      onDailyRebatePaidChanged;
  final Future<void> Function(TravelGroupFinanceSummaryRecord, bool)
      onMonthlyRebatePaidChanged;
  final Future<bool> Function(
    TravelGroupFinanceSummaryRecord,
    FinanceImageType,
  ) onExportImage;
  final Future<void> Function(TravelGroupFinanceSummaryRecord, bool)
      onGuideInfoSentChanged;
  final Future<void> Function(TravelGroupFinanceSummaryRecord, bool)
      onTravelAgencyInfoSentChanged;

  @override
  Widget build(BuildContext context) {
    final selectedCount = summaries
        .where(
          (summary) => selectedTravelGroupIds.contains(summary.financeRowId),
        )
        .length;
    final allSelected =
        selectedCount == summaries.length && summaries.isNotEmpty;
    return _TableScroller(
      child: DataTable(
        showCheckboxColumn: false,
        columnSpacing: 18,
        horizontalMargin: 12,
        headingRowHeight: 44,
        dataRowMinHeight: 68,
        dataRowMaxHeight: 104,
        columns: [
          DataColumn(
            label: Checkbox(
              key: const ValueKey('finance-select-all'),
              value: allSelected,
              onChanged: (value) => onSelectAllChanged(value ?? false),
            ),
          ),
          const DataColumn(label: Text('行类型')),
          const DataColumn(label: Text('售后单号')),
          const DataColumn(label: Text('原订单号')),
          const DataColumn(label: Text('售后状态')),
          const DataColumn(label: Text('日期')),
          const DataColumn(label: Text('旅行社')),
          const DataColumn(label: Text('导游')),
          const DataColumn(label: Text('车牌')),
          const DataColumn(label: Text('人数')),
          const DataColumn(label: Text('品鉴师')),
          const DataColumn(label: Text('销售额')),
          const DataColumn(label: Text('已确认退款')),
          const DataColumn(label: Text('有效销售额')),
          const DataColumn(label: Text('货到付款')),
          const DataColumn(label: Text('已付定金')),
          const DataColumn(label: Text('扣酒成本')),
          const DataColumn(label: Text('上单金额')),
          const DataColumn(label: Text('积分/日返积分')),
          const DataColumn(label: Text('已返积分')),
          const DataColumn(label: Text('未返积分')),
          const DataColumn(label: Text('月返积分')),
          const DataColumn(label: Text('已返月返积分')),
          const DataColumn(label: Text('未返月返积分')),
          const DataColumn(label: Text('售后影响')),
          const DataColumn(label: Text('旅行社积分导游联络图')),
          const DataColumn(label: Text('旅行社图片')),
          const DataColumn(label: Text('导游信息发送')),
          const DataColumn(label: Text('旅行社信息发送')),
          const DataColumn(label: Text('状态')),
        ],
        rows: [
          for (final summary in summaries) _buildRow(context, summary),
        ],
      ),
    );
  }

  DataRow _buildRow(
    BuildContext context,
    TravelGroupFinanceSummaryRecord summary,
  ) {
    final rowKey = summary.financeRowId;
    final travelGroupKey = summary.travelGroupId;
    final group = summary.travelGroup;
    final selected = selectedTravelGroupIds.contains(rowKey);
    final guideReady =
        !summary.isAfterSales && guideImageReadyIds.contains(travelGroupKey);
    final agencyReady = !summary.isAfterSales &&
        travelAgencyImageReadyIds.contains(travelGroupKey);
    final guideSentBusy =
        sentUpdatingKeys.contains('$travelGroupKey:guideInfoSent');
    final agencySentBusy =
        sentUpdatingKeys.contains('$travelGroupKey:travelAgencyInfoSent');
    return DataRow(
      key: ValueKey('finance-row-$rowKey'),
      selected: selected,
      onSelectChanged: (value) => onSelectionChanged(rowKey, value ?? false),
      cells: [
        DataCell(Checkbox(
          key: ValueKey('$rowKey:select'),
          value: selected,
          onChanged: (value) => onSelectionChanged(rowKey, value ?? false),
        )),
        DataCell(_TextCell(
          value: summary.isAfterSales ? '售后调整' : '原销售',
          width: 84,
        )),
        DataCell(_TextCell(value: _text(summary.afterSalesNo), width: 128)),
        DataCell(
          _TextCell(value: _text(summary.sourceSalesOrderNo), width: 128),
        ),
        DataCell(_TextCell(
          value: summary.isAfterSales
              ? _afterSalesStatusLabel(summary.afterSalesStatus)
              : '',
          width: 96,
        )),
        DataCell(_TextCell(
          key: ValueKey('$rowKey:rowTapTarget'),
          value: _dateOnlyText(
            summary.financeDate ?? group?.visitDate ?? '',
          ),
        )),
        DataCell(_TextCell(value: _text(group?.travelAgency), width: 132)),
        DataCell(_TextCell(value: _text(group?.guideName), width: 96)),
        DataCell(_TextCell(value: _text(group?.licensePlate), width: 104)),
        DataCell(_TextCell(value: '${group?.guestCount ?? 0}', width: 64)),
        DataCell(_TextCell(value: _text(group?.tasterName), width: 104)),
        DataCell(_MoneyCell(cents: summary.totalSalesAmountCents)),
        DataCell(_MoneyCell(cents: summary.confirmedRefundAmountCents)),
        DataCell(_MoneyCell(cents: summary.effectiveSalesAmountCents)),
        DataCell(_MoneyCell(cents: summary.totalCashOnDeliveryCents)),
        DataCell(_MoneyCell(cents: summary.totalPaidDepositCents)),
        DataCell(_AgencyDeductionEditor(
          key: ValueKey('$rowKey:agencyDeductionEditor'),
          summary: summary,
          saving: agencyDeductionUpdatingIds.contains(rowKey),
          onSave: (cents) => onAgencyDeductionSaved(summary, cents),
        )),
        DataCell(_MoneyCell(cents: summary.totalAgencyNetAmountCents)),
        DataCell(_MoneyCell(cents: summary.totalDailyRebateCents)),
        DataCell(_RebatePaidButton(
          key: ValueKey('$rowKey:dailyRebatePaid'),
          amountCents: summary.paidDailyRebateCents,
          paid: summary.dailyRebatePaid,
          busy: rebateUpdatingKeys.contains('$travelGroupKey:dailyRebatePaid'),
          onPressed: summary.summaryExists && !summary.isAfterSales
              ? () => onDailyRebatePaidChanged(
                    summary,
                    !summary.dailyRebatePaid,
                  )
              : null,
        )),
        DataCell(_MoneyCell(cents: summary.unpaidDailyRebateCents)),
        DataCell(_MoneyCell(cents: summary.totalMonthlyRebateCents)),
        DataCell(_RebatePaidButton(
          key: ValueKey('$rowKey:monthlyRebatePaid'),
          amountCents: summary.paidMonthlyRebateCents,
          paid: summary.monthlyRebatePaid,
          busy:
              rebateUpdatingKeys.contains('$travelGroupKey:monthlyRebatePaid'),
          onPressed: summary.summaryExists && !summary.isAfterSales
              ? () => onMonthlyRebatePaidChanged(
                    summary,
                    !summary.monthlyRebatePaid,
                  )
              : null,
        )),
        DataCell(_MoneyCell(cents: summary.unpaidMonthlyRebateCents)),
        DataCell(_AfterSalesImpactCell(summary: summary)),
        DataCell(_ImageExportButton(
          key: ValueKey('$rowKey:guideImage'),
          label: '旅行社积分导游联络图',
          busy: imageExportingKeys.contains('$rowKey:guide'),
          ready: guideReady,
          onPressed: summary.isAfterSales
              ? null
              : () => onExportImage(summary, FinanceImageType.guide),
        )),
        DataCell(_ImageExportButton(
          key: ValueKey('$rowKey:travelAgencyImage'),
          label: '旅行社图片',
          busy: imageExportingKeys.contains('$rowKey:travelAgency'),
          ready: agencyReady,
          onPressed: summary.isAfterSales
              ? null
              : () => onExportImage(summary, FinanceImageType.travelAgency),
        )),
        DataCell(Switch(
          key: ValueKey('$rowKey:guideInfoSent'),
          value: summary.guideInfoSent,
          onChanged: summary.isAfterSales ||
                  !summary.summaryExists ||
                  guideSentBusy ||
                  (!guideReady && !summary.guideInfoSent)
              ? null
              : (value) => onGuideInfoSentChanged(summary, value),
        )),
        DataCell(Switch(
          key: ValueKey('$rowKey:travelAgencyInfoSent'),
          value: summary.travelAgencyInfoSent,
          onChanged: summary.isAfterSales ||
                  !summary.summaryExists ||
                  agencySentBusy ||
                  (!agencyReady && !summary.travelAgencyInfoSent)
              ? null
              : (value) => onTravelAgencyInfoSentChanged(summary, value),
        )),
        DataCell(StatusTag(
          label: _summaryStatus(summary),
          tone: _summaryStatusTone(summary),
        )),
      ],
    );
  }
}

class _TextCell extends StatelessWidget {
  const _TextCell({
    super.key,
    required this.value,
    this.width = 116,
  });

  final String value;
  final double width;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      child: Text(
        value,
        overflow: TextOverflow.ellipsis,
        maxLines: 2,
      ),
    );
  }
}

class _MoneyCell extends StatelessWidget {
  const _MoneyCell({required this.cents});

  final int cents;

  @override
  Widget build(BuildContext context) {
    final color = cents < 0 ? const Color(0xFFC62828) : null;
    return SizedBox(
      width: 112,
      child: Text(
        formatPointsTableMoneyCents(cents),
        style: TextStyle(
          color: color,
          fontWeight: cents < 0 ? FontWeight.w700 : FontWeight.normal,
        ),
      ),
    );
  }
}

class _AfterSalesImpactCell extends StatelessWidget {
  const _AfterSalesImpactCell({required this.summary});

  final TravelGroupFinanceSummaryRecord summary;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      key: ValueKey('${summary.financeRowId}:afterSalesImpact'),
      width: 190,
      child: StatusTag(
        label: _afterSalesImpactLabel(summary),
        tone: _afterSalesImpactTone(summary),
      ),
    );
  }
}

class _AgencyDeductionEditor extends StatefulWidget {
  const _AgencyDeductionEditor({
    super.key,
    required this.summary,
    required this.saving,
    required this.onSave,
  });

  final TravelGroupFinanceSummaryRecord summary;
  final bool saving;
  final Future<void> Function(int cents) onSave;

  @override
  State<_AgencyDeductionEditor> createState() => _AgencyDeductionEditorState();
}

class _AgencyDeductionEditorState extends State<_AgencyDeductionEditor> {
  late final TextEditingController _controller;
  String? _validationError;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(
      text: _inputText(widget.summary),
    );
  }

  @override
  void didUpdateWidget(covariant _AgencyDeductionEditor oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (_inputCents(oldWidget.summary) != _inputCents(widget.summary) ||
        oldWidget.summary.deductionCalculationMode !=
            widget.summary.deductionCalculationMode) {
      _controller.text = _inputText(widget.summary);
      _validationError = null;
    }
  }

  int? _inputCents(TravelGroupFinanceSummaryRecord summary) {
    if (summary.isAfterSales) {
      return summary.agencyDeductionAdjustmentCents;
    }
    return summary.totalAgencyDeductionCents;
  }

  String _inputText(TravelGroupFinanceSummaryRecord summary) {
    final cents = _inputCents(summary);
    if (cents == null) {
      return '';
    }
    return _yuanInput(scalePointsTableAmountCents(cents.abs()));
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_editable || widget.saving) {
      return;
    }
    final result = _parseAgencyDeduction(
      _controller.text,
      widget.summary.totalSalesAmountCents.abs(),
    );
    if (result.error != null) {
      setState(() => _validationError = result.error);
      return;
    }
    setState(() => _validationError = null);
    await widget.onSave(result.cents!);
  }

  @override
  Widget build(BuildContext context) {
    if (widget.summary.isAfterSales &&
        widget.summary.deductionCalculationMode != 'manual_product_reference') {
      return SizedBox(
        width: 220,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            _MoneyCell(cents: widget.summary.totalAgencyDeductionCents),
            const Text(
              '按原单有效销售占比自动计算',
              style: TextStyle(fontSize: 11, color: Color(0xFF667085)),
            ),
          ],
        ),
      );
    }
    final pendingManualCost = widget.summary.isAfterSales &&
        widget.summary.agencyDeductionAdjustmentCents == null;
    return SizedBox(
      width: 220,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: TextField(
              key: ValueKey(
                '${widget.summary.financeRowId}:agencyDeductionInput',
              ),
              controller: _controller,
              enabled: _editable && !widget.saving,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              textInputAction: TextInputAction.done,
              onChanged: (_) {
                if (_validationError != null) {
                  setState(() => _validationError = null);
                }
              },
              onSubmitted: (_) => _save(),
              decoration: InputDecoration(
                isDense: true,
                prefixText: '¥ ',
                hintText: pendingManualCost ? '待填写扣酒成本' : null,
                errorText: _validationError,
                errorMaxLines: 2,
              ),
            ),
          ),
          const SizedBox(width: 6),
          SizedBox(
            width: 68,
            child: FilledButton(
              key: ValueKey(
                '${widget.summary.financeRowId}:agencyDeductionSave',
              ),
              onPressed: !_editable || widget.saving ? null : _save,
              child: widget.saving
                  ? const SizedBox.square(
                      dimension: 14,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('保存'),
            ),
          ),
        ],
      ),
    );
  }

  bool get _editable =>
      widget.summary.summaryExists &&
      (!widget.summary.isAfterSales ||
          widget.summary.deductionCalculationMode ==
              'manual_product_reference');
}

class _AgencyDeductionParseResult {
  const _AgencyDeductionParseResult({this.cents, this.error});

  final int? cents;
  final String? error;
}

_AgencyDeductionParseResult _parseAgencyDeduction(
  String value,
  int totalSalesAmountCents,
) {
  final text = value.trim();
  if (text.isEmpty) {
    return const _AgencyDeductionParseResult(error: '请输入扣酒成本。');
  }
  if (text.startsWith('-')) {
    return const _AgencyDeductionParseResult(error: '扣酒成本不能小于 0。');
  }
  final match = RegExp(r'^(\d+)(?:\.(\d{1,2}))?$').firstMatch(text);
  if (match == null) {
    return const _AgencyDeductionParseResult(
      error: '请输入最多两位小数的有效金额。',
    );
  }
  final yuan = int.tryParse(match.group(1)!);
  if (yuan == null) {
    return const _AgencyDeductionParseResult(error: '金额过大，请重新输入。');
  }
  final decimal = (match.group(2) ?? '').padRight(2, '0');
  final displayCents = yuan * 100 + (decimal.isEmpty ? 0 : int.parse(decimal));
  final sourceCents = pointsTableDisplayCentsToSourceCents(displayCents);
  if (sourceCents > totalSalesAmountCents) {
    return const _AgencyDeductionParseResult(
      error: '扣酒成本不能大于该旅行团销售额。',
    );
  }
  return _AgencyDeductionParseResult(cents: sourceCents);
}

String _yuanInput(int cents) {
  final yuan = cents ~/ 100;
  final decimal = (cents % 100).abs().toString().padLeft(2, '0');
  return '$yuan.$decimal';
}

class _RebatePaidButton extends StatelessWidget {
  const _RebatePaidButton({
    super.key,
    required this.amountCents,
    required this.paid,
    required this.busy,
    required this.onPressed,
  });

  final int amountCents;
  final bool paid;
  final bool busy;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final action = busy
        ? const SizedBox.square(
            dimension: 16,
            child: CircularProgressIndicator(strokeWidth: 2),
          )
        : Text(paid ? '已返' : '标记已返');
    return SizedBox(
      width: 112,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(formatPointsTableMoneyCents(amountCents)),
          const SizedBox(height: 4),
          paid
              ? FilledButton(
                  onPressed: busy ? null : onPressed,
                  child: action,
                )
              : OutlinedButton(
                  onPressed: busy ? null : onPressed,
                  child: action,
                ),
        ],
      ),
    );
  }
}

class _ImageExportButton extends StatelessWidget {
  const _ImageExportButton({
    super.key,
    required this.label,
    required this.busy,
    required this.ready,
    required this.onPressed,
  });

  final String label;
  final bool busy;
  final bool ready;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 118,
      child: OutlinedButton.icon(
        onPressed: busy ? null : onPressed,
        icon: busy
            ? const SizedBox.square(
                dimension: 14,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : Icon(ready ? Icons.check_circle_rounded : Icons.image_rounded),
        label: Text(label),
      ),
    );
  }
}

class _FinanceExportImageCard extends StatelessWidget {
  const _FinanceExportImageCard({
    required this.summary,
    required this.type,
  });

  final TravelGroupFinanceSummaryRecord summary;
  final FinanceImageType type;

  @override
  Widget build(BuildContext context) {
    final group = summary.travelGroup;
    final fields = type == FinanceImageType.guide
        ? <MapEntry<String, String>>[
            MapEntry('日期', _dateOnlyText(group?.visitDate ?? '')),
            MapEntry('旅行社', _text(group?.travelAgency)),
            MapEntry('导游', _text(group?.guideName)),
            MapEntry('车牌', _text(group?.licensePlate)),
            MapEntry('人数', '${group?.guestCount ?? 0} 人'),
            MapEntry('品鉴师', _text(group?.tasterName)),
            MapEntry(
              '上单金额',
              formatPointsTableMoneyCents(
                summary.totalAgencyNetAmountCents,
              ),
            ),
          ]
        : <MapEntry<String, String>>[
            MapEntry('日期', _dateOnlyText(group?.visitDate ?? '')),
            MapEntry('旅行社', _text(group?.travelAgency)),
            MapEntry('导游', _text(group?.guideName)),
            MapEntry('车牌', _text(group?.licensePlate)),
            MapEntry('人数', '${group?.guestCount ?? 0} 人'),
            MapEntry('品鉴师', _text(group?.tasterName)),
            MapEntry(
              '销售额',
              formatPointsTableMoneyCents(summary.totalSalesAmountCents),
            ),
            MapEntry(
              '上单金额',
              formatPointsTableMoneyCents(
                summary.totalAgencyNetAmountCents,
              ),
            ),
          ];

    return SizedBox(
      key: ValueKey('finance-export-single-image-${type.name}'),
      width: 760,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: const Color(0xFFE1E5EA)),
          borderRadius: const BorderRadius.all(Radius.circular(8)),
        ),
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: DefaultTextStyle(
            style: const TextStyle(
              color: Color(0xFF17212B),
              fontSize: 20,
              height: 1.35,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                for (final field in fields)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SizedBox(
                          width: 120,
                          child: Text(
                            field.key,
                            style: const TextStyle(
                              color: Color(0xFF5A6673),
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        Expanded(
                          child: Text(
                            field.value,
                            style: const TextStyle(
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

const _financeExportPageSize = 20;

const _guideExportHeaders = <String>[
  '日期',
  '旅行社',
  '导游',
  '车牌',
  '人数',
  '品鉴师',
  '上单金额',
];

const _guideExportColumnWidths = <double>[
  130,
  190,
  150,
  150,
  80,
  150,
  160,
];

const _agencyExportHeaders = <String>[
  '日期',
  '旅行社',
  '导游',
  '销售额',
  '上单金额',
];

const _agencyExportColumnWidths = <double>[
  130,
  190,
  150,
  150,
  150,
];

List<FinanceExportTablePage> _buildFinanceExportTablePages(
  List<TravelGroupFinanceSummaryRecord> summaries,
  FinanceImageType type,
) {
  final grouped = <String, List<TravelGroupFinanceSummaryRecord>>{};
  for (final summary in summaries) {
    final key = type == FinanceImageType.guide
        ? _guideExportGroupKey(summary)
        : _agencyExportGroupKey(summary);
    grouped.putIfAbsent(key, () => []).add(summary);
  }

  final pages = <FinanceExportTablePage>[];
  final exportDate = _formatDate(DateTime.now());
  for (final entry in grouped.entries) {
    final groupRows = entry.value;
    final receiverName = type == FinanceImageType.guide
        ? _text(groupRows.first.travelGroup?.guideName, fallback: '未知导游')
        : _text(
            groupRows.first.travelGroup?.travelAgency,
            fallback: '未知旅行社',
          );
    final dateRangeLabel = _exportDateRangeLabel(groupRows);
    final totalPages = (groupRows.length + _financeExportPageSize - 1) ~/
        _financeExportPageSize;
    for (var pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
      final start = pageIndex * _financeExportPageSize;
      final end =
          (start + _financeExportPageSize).clamp(0, groupRows.length).toInt();
      final pageRows = groupRows
          .sublist(start, end)
          .map((summary) => _buildFinanceExportTableRow(summary, type))
          .toList(growable: false);
      pages.add(
        FinanceExportTablePage(
          type: type,
          receiverKey: entry.key,
          receiverName: receiverName,
          headers: type == FinanceImageType.guide
              ? _guideExportHeaders
              : _agencyExportHeaders,
          columnWidths: type == FinanceImageType.guide
              ? _guideExportColumnWidths
              : _agencyExportColumnWidths,
          rows: pageRows,
          dateRangeLabel: dateRangeLabel,
          pageNumber: pageIndex + 1,
          totalPages: totalPages,
          exportDate: exportDate,
        ),
      );
    }
  }
  return pages;
}

FinanceExportTableRow _buildFinanceExportTableRow(
  TravelGroupFinanceSummaryRecord summary,
  FinanceImageType type,
) {
  final group = summary.travelGroup;
  final common = <String>[
    _dateOnlyText(group?.visitDate ?? ''),
    _text(group?.travelAgency),
    _text(group?.guideName),
  ];
  final cells = type == FinanceImageType.guide
      ? <String>[
          ...common,
          _text(group?.licensePlate),
          '${group?.guestCount ?? 0}',
          _text(group?.tasterName),
          formatPointsTableMoneyCents(summary.totalAgencyNetAmountCents),
        ]
      : <String>[
          ...common,
          formatPointsTableMoneyCents(summary.totalSalesAmountCents),
          formatPointsTableMoneyCents(summary.totalAgencyNetAmountCents),
        ];
  return FinanceExportTableRow(
    travelGroupId: summary.travelGroupId,
    cells: cells,
  );
}

String _guideExportGroupKey(TravelGroupFinanceSummaryRecord summary) {
  final group = summary.travelGroup;
  final guideId = _text(group?.guideId);
  final agencyKey = _agencyExportGroupKey(summary);
  if (guideId.isNotEmpty) {
    return 'guide-id:$guideId|$agencyKey';
  }
  final name = _normalizeExportGroupingText(group?.guideName);
  final phone = _normalizeExportPhone(group?.guidePhone);
  if (name.isNotEmpty || phone.isNotEmpty) {
    return 'guide-fallback:$name|$phone|$agencyKey';
  }
  return 'guide-travel-group:${summary.travelGroupId}';
}

String _agencyExportGroupKey(TravelGroupFinanceSummaryRecord summary) {
  final group = summary.travelGroup;
  final agencyId = _text(group?.agencyId);
  if (agencyId.isNotEmpty) {
    return 'agency-id:$agencyId';
  }
  final agencyName = _normalizeExportGroupingText(group?.travelAgency);
  if (agencyName.isNotEmpty) {
    return 'agency-fallback:$agencyName';
  }
  return 'agency-travel-group:${summary.travelGroupId}';
}

String _normalizeExportGroupingText(String? value) {
  return _text(value).toLowerCase().replaceAll(RegExp(r'\s+'), ' ').trim();
}

String _normalizeExportPhone(String? value) {
  return _text(value).replaceAll(RegExp(r'[^0-9+]'), '');
}

String _exportDateRangeLabel(
  List<TravelGroupFinanceSummaryRecord> summaries,
) {
  final dates = summaries
      .map((summary) => _dateOnlyText(summary.travelGroup?.visitDate ?? ''))
      .where((date) => RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(date))
      .toList()
    ..sort();
  if (dates.isEmpty) {
    return '未知日期';
  }
  return '${dates.first}至${dates.last}';
}

class FinanceExportTableImage extends StatelessWidget {
  const FinanceExportTableImage({
    super.key,
    required this.page,
  });

  final FinanceExportTablePage page;

  @override
  Widget build(BuildContext context) {
    final columnWidths = <int, TableColumnWidth>{
      for (var index = 0; index < page.columnWidths.length; index += 1)
        index: FixedColumnWidth(page.columnWidths[index]),
    };
    return SizedBox(
      key: const ValueKey('finance-export-table-image'),
      width: page.canvasWidth,
      child: ColoredBox(
        color: Colors.white,
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: DefaultTextStyle(
            style: const TextStyle(
              color: Color(0xFF17212B),
              fontSize: 18,
              height: 1.3,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  page.type.tableTitle,
                  style: const TextStyle(
                    fontSize: 32,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  '接收对象：${page.receiverName}',
                  style: const TextStyle(
                    fontSize: 21,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '日期范围：${page.dateRangeLabel}  '
                  '页码：${page.pageNumber}/${page.totalPages}  '
                  '导出日期：${page.exportDate}',
                  style: const TextStyle(color: Color(0xFF5A6673)),
                ),
                const SizedBox(height: 18),
                Table(
                  key: const ValueKey('finance-export-table'),
                  border: TableBorder.all(
                    color: const Color(0xFF9AA5B1),
                    width: 1,
                  ),
                  columnWidths: columnWidths,
                  defaultVerticalAlignment: TableCellVerticalAlignment.middle,
                  children: [
                    TableRow(
                      key: const ValueKey('finance-export-table-header'),
                      decoration: const BoxDecoration(
                        color: Color(0xFFEFF3F7),
                      ),
                      children: [
                        for (final header in page.headers)
                          _FinanceExportTableCell(
                            value: header,
                            header: true,
                          ),
                      ],
                    ),
                    for (var rowIndex = 0;
                        rowIndex < page.rows.length;
                        rowIndex += 1)
                      TableRow(
                        key: ValueKey(
                          'finance-export-table-row-$rowIndex',
                        ),
                        children: [
                          for (final cell in page.rows[rowIndex].cells)
                            _FinanceExportTableCell(value: cell),
                        ],
                      ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _FinanceExportTableCell extends StatelessWidget {
  const _FinanceExportTableCell({
    required this.value,
    this.header = false,
  });

  final String value;
  final bool header;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: BoxConstraints(minHeight: header ? 54 : 64),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        child: Align(
          alignment: Alignment.centerLeft,
          child: Text(
            value,
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontWeight: header ? FontWeight.w800 : FontWeight.w500,
            ),
          ),
        ),
      ),
    );
  }
}

class _TableScroller extends StatefulWidget {
  const _TableScroller({required this.child});

  final Widget child;

  @override
  State<_TableScroller> createState() => _TableScrollerState();
}

class _TableScrollerState extends State<_TableScroller> {
  final ScrollController _scrollController = ScrollController();
  bool _hasHorizontalOverflow = false;
  bool _overflowUpdateScheduled = false;
  bool? _pendingOverflow;

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _scheduleOverflowUpdate(bool hasOverflow) {
    _pendingOverflow = hasOverflow;
    if (_overflowUpdateScheduled) {
      return;
    }
    _overflowUpdateScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _overflowUpdateScheduled = false;
      final next = _pendingOverflow;
      _pendingOverflow = null;
      if (!mounted || next == null || next == _hasHorizontalOverflow) {
        return;
      }
      setState(() => _hasHorizontalOverflow = next);
    });
  }

  bool _handleScrollMetrics(ScrollMetricsNotification notification) {
    if (notification.metrics.axis == Axis.horizontal) {
      _scheduleOverflowUpdate(notification.metrics.maxScrollExtent > 0);
    }
    return false;
  }

  void _handlePointerSignal(PointerSignalEvent event) {
    if (event is! PointerScrollEvent || !_scrollController.hasClients) {
      return;
    }

    final delta = event.scrollDelta;
    final shiftPressed = HardwareKeyboard.instance.isShiftPressed;
    final isHorizontalGesture = delta.dx.abs() > delta.dy.abs();
    if (!shiftPressed && !isHorizontalGesture) {
      return;
    }

    final horizontalDelta =
        shiftPressed && delta.dy.abs() > delta.dx.abs() ? delta.dy : delta.dx;
    if (horizontalDelta == 0) {
      return;
    }

    GestureBinding.instance.pointerSignalResolver.register(event, (_) {
      if (!_scrollController.hasClients) {
        return;
      }
      final position = _scrollController.position;
      final target = (_scrollController.offset + horizontalDelta)
          .clamp(position.minScrollExtent, position.maxScrollExtent)
          .toDouble();
      _scrollController.jumpTo(target);
    });
  }

  @override
  Widget build(BuildContext context) {
    final scrollbarTheme = Theme.of(context).scrollbarTheme.copyWith(
          thickness: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.dragged) ||
                states.contains(WidgetState.hovered)) {
              return 10;
            }
            return 8;
          }),
          radius: const Radius.circular(8),
          minThumbLength: 48,
          mainAxisMargin: 4,
          crossAxisMargin: 1,
        );

    return NotificationListener<ScrollMetricsNotification>(
      onNotification: _handleScrollMetrics,
      child: ScrollbarTheme(
        data: scrollbarTheme,
        child: Scrollbar(
          key: const ValueKey('finance-table-scrollbar'),
          controller: _scrollController,
          thumbVisibility: _hasHorizontalOverflow,
          interactive: true,
          child: Padding(
            padding: EdgeInsets.only(
              bottom: _hasHorizontalOverflow ? 10 : 0,
            ),
            child: SingleChildScrollView(
              key: const ValueKey('finance-table-horizontal-scroll-view'),
              controller: _scrollController,
              primary: false,
              scrollDirection: Axis.horizontal,
              child: Listener(
                behavior: HitTestBehavior.translucent,
                onPointerSignal: _handlePointerSignal,
                child: widget.child,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _EmptyFinanceTable extends StatelessWidget {
  const _EmptyFinanceTable();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.table_rows_rounded, size: 34, color: scheme.primary),
          const SizedBox(height: 10),
          Text(
            '没有符合条件的积分记录',
            style: Theme.of(context)
                .textTheme
                .titleSmall
                ?.copyWith(fontWeight: FontWeight.w800),
          ),
        ],
      ),
    );
  }
}

class _InlineNotice extends StatelessWidget {
  const _InlineNotice({
    required this.message,
    required this.tone,
    this.action,
  });

  final String message;
  final StatusTone tone;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final color = switch (tone) {
      StatusTone.success => Colors.green.shade700,
      StatusTone.danger => Colors.red.shade700,
      _ => Theme.of(context).colorScheme.primary,
    };
    return DecoratedBox(
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: const BorderRadius.all(Radius.circular(8)),
        border: Border.all(color: color.withValues(alpha: 0.24)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Row(
          children: [
            Expanded(
              child: Text(
                message,
                style: TextStyle(color: color, fontWeight: FontWeight.w700),
              ),
            ),
            if (action != null) ...[
              const SizedBox(width: 12),
              action!,
            ],
          ],
        ),
      ),
    );
  }
}

const _allFilter = '__all__';
const _sentFilter = '__sent__';
const _notSentFilter = '__not_sent__';
const _statusMissing = '未生成汇总';
const _statusPending = '待返';
const _statusComplete = '已完成';
const _statusAfterSalesProcessing = '售后处理中';
const _statusRefundPending = '退款待确认';
const _statusFinanceRequired = '需财务处理';
const _statusAfterSalesConfirmed = '售后已确认';
const _statusAfterSalesRecovery = '待追回/下期抵扣';
const _statusNoFinancialEffect = '无财务影响';

const _sentFilterItems = <MapEntry<String, String>>[
  MapEntry(_allFilter, '全部'),
  MapEntry(_sentFilter, '已发送'),
  MapEntry(_notSentFilter, '未发送'),
];

bool _matchesSentFilter(bool sent, String filter) {
  return switch (filter) {
    _sentFilter => sent,
    _notSentFilter => !sent,
    _ => true,
  };
}

String _summaryStatus(TravelGroupFinanceSummaryRecord summary) {
  if (summary.isAfterSales) {
    return switch (summary.financialEffectStatus) {
      'confirmed' => _statusAfterSalesConfirmed,
      'pending_recovery' => _statusAfterSalesRecovery,
      'no_financial_effect' => _statusNoFinancialEffect,
      _ => _statusRefundPending,
    };
  }
  if (!summary.summaryExists) {
    return _statusMissing;
  }
  switch (summary.afterSalesImpactStatus) {
    case 'after_rebate_paid_requires_finance':
      return _statusFinanceRequired;
    case 'refund_pending_confirmation':
      return _statusRefundPending;
    case 'after_sales_processing':
      return _statusAfterSalesProcessing;
  }
  return summary.unpaidRebateCents == 0 ? _statusComplete : _statusPending;
}

StatusTone _summaryStatusTone(TravelGroupFinanceSummaryRecord summary) {
  return switch (_summaryStatus(summary)) {
    _statusMissing => StatusTone.neutral,
    _statusComplete => StatusTone.success,
    _statusAfterSalesConfirmed => StatusTone.success,
    _statusNoFinancialEffect => StatusTone.neutral,
    _statusAfterSalesRecovery => StatusTone.danger,
    _statusFinanceRequired => StatusTone.danger,
    _ => StatusTone.warning,
  };
}

String _afterSalesImpactLabel(TravelGroupFinanceSummaryRecord summary) {
  if (summary.isAfterSales) {
    return switch (summary.financialEffectStatus) {
      'confirmed' => '已确认独立负向调整',
      'pending_recovery' => '待追回/下期抵扣',
      'no_financial_effect' => '0 金额记录',
      _ => summary.financialAmountsReady ? '待财务确认' : '待填写扣酒成本',
    };
  }
  return switch (summary.afterSalesImpactStatus) {
    'after_sales_processing' => '售后处理中',
    'refund_pending_confirmation' =>
      '退款待确认 ${formatPointsTableMoneyCents(summary.pendingAfterSalesRefundAmountCents)}',
    'refund_adjusted' => '已按退款调整',
    'after_rebate_paid_requires_finance' => '已返后发生售后，需财务处理',
    _ => '无',
  };
}

StatusTone _afterSalesImpactTone(TravelGroupFinanceSummaryRecord summary) {
  if (summary.isAfterSales) {
    return switch (summary.financialEffectStatus) {
      'confirmed' => StatusTone.success,
      'pending_recovery' => StatusTone.danger,
      'no_financial_effect' => StatusTone.neutral,
      _ => StatusTone.warning,
    };
  }
  return switch (summary.afterSalesImpactStatus) {
    'after_rebate_paid_requires_finance' => StatusTone.danger,
    'refund_pending_confirmation' => StatusTone.warning,
    'after_sales_processing' => StatusTone.warning,
    'refund_adjusted' => StatusTone.info,
    _ => StatusTone.neutral,
  };
}

String _afterSalesStatusLabel(String? status) {
  return switch (status) {
    'negotiating' => '协商中',
    'pending_warehouse' => '待仓库确认',
    'pending_finance' => '待财务确认',
    'processing' => '处理中',
    'completed' => '已完成',
    'cancelled' => '已取消',
    null || '' => '',
    _ => status,
  };
}

String _text(String? value, {String fallback = ''}) {
  final text = value?.trim() ?? '';
  return text.isEmpty ? fallback : text;
}

DateTime? _dateFromText(String value) {
  final normalized = _dateOnlyText(value);
  final match = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(normalized);
  if (match == null) {
    return null;
  }
  final year = int.parse(match.group(1)!);
  final month = int.parse(match.group(2)!);
  final day = int.parse(match.group(3)!);
  final date = DateTime(year, month, day);
  if (date.year != year || date.month != month || date.day != day) {
    return null;
  }
  return date;
}

DateTime _dateOnly(DateTime value) =>
    DateTime(value.year, value.month, value.day);

String _dateOnlyText(String value) {
  final text = value.trim();
  if (text.length >= 10 && RegExp(r'^\d{4}-\d{2}-\d{2}').hasMatch(text)) {
    return text.substring(0, 10);
  }
  return text;
}

String _formatDate(DateTime value) {
  final month = value.month.toString().padLeft(2, '0');
  final day = value.day.toString().padLeft(2, '0');
  return '${value.year}-$month-$day';
}

String _messageForError(Object error) {
  if (error is FinanceImageSaveException) {
    return error.message;
  }
  if (error is ApiException) {
    return error.message;
  }
  return '操作失败，请稍后重试。';
}

String _safeExportFileName(String fileName) {
  final sanitized = fileName
      .replaceAll(RegExp(r'[\\/:*?"<>|]'), '-')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  return sanitized.isEmpty ? '积分表图片.png' : sanitized;
}

String _safeExcelExportFileName(String? fileName) {
  var sanitized = (fileName ?? '')
      .trim()
      .replaceAll(RegExp(r'[<>:"/\\|?*\x00-\x1F]'), '_')
      .replaceAll(RegExp(r'[. ]+$'), '');
  if (sanitized.isEmpty) {
    sanitized = 'points-table-selected.xlsx';
  }
  return sanitized.toLowerCase().endsWith('.xlsx')
      ? sanitized
      : '$sanitized.xlsx';
}

Future<File> _nextExcelExportFile(
  Directory directory,
  String fileName,
) async {
  final first = File(_joinPath([directory.path, fileName]));
  if (!await first.exists()) {
    return first;
  }
  final dotIndex = fileName.lastIndexOf('.');
  final stem = dotIndex <= 0 ? fileName : fileName.substring(0, dotIndex);
  final extension = dotIndex <= 0 ? '' : fileName.substring(dotIndex);
  for (var index = 1; index < 1000; index += 1) {
    final candidate = File(
      _joinPath([directory.path, '$stem ($index)$extension']),
    );
    if (!await candidate.exists()) {
      return candidate;
    }
  }
  return File(
    _joinPath([
      directory.path,
      '$stem (${DateTime.now().microsecondsSinceEpoch})$extension',
    ]),
  );
}

class _NonNegativeIntegerFormatter extends TextInputFormatter {
  const _NonNegativeIntegerFormatter();

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    return RegExp(r'^\d*$').hasMatch(newValue.text) ? newValue : oldValue;
  }
}
