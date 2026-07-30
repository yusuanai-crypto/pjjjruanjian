import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/rendering.dart';

import '../core/crash_reporting/crash_reporter.dart';

const exportImageMaxPixelCount = 16 * 1024 * 1024;
const exportImagePreferredPixelRatio = 2.0;
const exportImageMinimumPixelRatio = 1.0;

@immutable
class ExportImagePixelPlan {
  const ExportImagePixelPlan({
    required this.pixelRatio,
    required this.estimatedPixelCount,
    required this.requiresPagination,
  });

  final double pixelRatio;
  final double estimatedPixelCount;
  final bool requiresPagination;
}

double estimateExportImagePixelCount({
  required double width,
  required double height,
  required double pixelRatio,
}) {
  if (!width.isFinite ||
      !height.isFinite ||
      !pixelRatio.isFinite ||
      width <= 0 ||
      height <= 0 ||
      pixelRatio <= 0) {
    throw ArgumentError('图片尺寸和像素倍率必须为有效正数。');
  }
  return width * height * pixelRatio * pixelRatio;
}

ExportImagePixelPlan planExportImagePixels({
  required double width,
  required double height,
  double preferredPixelRatio = exportImagePreferredPixelRatio,
  double minimumPixelRatio = exportImageMinimumPixelRatio,
  int maxPixelCount = exportImageMaxPixelCount,
}) {
  if (minimumPixelRatio <= 0 ||
      preferredPixelRatio < minimumPixelRatio ||
      maxPixelCount <= 0) {
    throw ArgumentError('图片导出像素预算参数无效。');
  }
  final preferredPixels = estimateExportImagePixelCount(
    width: width,
    height: height,
    pixelRatio: preferredPixelRatio,
  );
  var pixelRatio = preferredPixelRatio;
  if (preferredPixels > maxPixelCount) {
    final logicalPixels = width * height;
    final budgetRatio = math.sqrt(maxPixelCount / logicalPixels) * (1 - 1e-12);
    pixelRatio =
        budgetRatio.clamp(minimumPixelRatio, preferredPixelRatio).toDouble();
  }
  final estimatedPixels = estimateExportImagePixelCount(
    width: width,
    height: height,
    pixelRatio: pixelRatio,
  );
  return ExportImagePixelPlan(
    pixelRatio: pixelRatio,
    estimatedPixelCount: estimatedPixels,
    requiresPagination: estimatedPixels > maxPixelCount,
  );
}

class ExportImagePixelBudgetException implements Exception {
  const ExportImagePixelBudgetException([
    this.message = '图片内容过长，单页生成会占用过多内存，请分页导出。',
  ]);

  final String message;

  @override
  String toString() => message;
}

abstract interface class DisposableExportImage {
  Future<ByteData?> toPngByteData();

  void dispose();
}

typedef ExportImageCapture = Future<DisposableExportImage> Function(
  double pixelRatio,
);

Future<Uint8List> encodeExportImageWithinPixelBudget({
  required double width,
  required double height,
  required ExportImageCapture capture,
  double preferredPixelRatio = exportImagePreferredPixelRatio,
  double minimumPixelRatio = exportImageMinimumPixelRatio,
  int maxPixelCount = exportImageMaxPixelCount,
}) async {
  final plan = planExportImagePixels(
    width: width,
    height: height,
    preferredPixelRatio: preferredPixelRatio,
    minimumPixelRatio: minimumPixelRatio,
    maxPixelCount: maxPixelCount,
  );
  CrashReporting.setUserAction('export_long_image');
  CrashReporting.breadcrumb(
    'long_image.plan',
    data: {
      'logicalWidth': width,
      'logicalHeight': height,
      'preferredPixelRatio': preferredPixelRatio,
      'pixelRatio': plan.pixelRatio,
      'estimatedPixelCount': plan.estimatedPixelCount,
      'maxPixelCount': maxPixelCount,
      'requiresPagination': plan.requiresPagination,
      'imageWidth': (width * plan.pixelRatio).ceil(),
      'imageHeight': (height * plan.pixelRatio).ceil(),
    },
  );
  if (plan.requiresPagination) {
    CrashReporting.breadcrumb(
      'long_image.pagination_required',
      data: {
        'estimatedPixelCount': plan.estimatedPixelCount,
        'maxPixelCount': maxPixelCount,
      },
    );
    throw const ExportImagePixelBudgetException();
  }
  DisposableExportImage? image;
  try {
    CrashReporting.breadcrumb(
      'long_image.render.start',
      data: {
        'pixelRatio': plan.pixelRatio,
        'estimatedPixelCount': plan.estimatedPixelCount,
      },
    );
    image = await capture(plan.pixelRatio);
    final byteData = await image.toPngByteData();
    if (byteData == null || byteData.lengthInBytes == 0) {
      throw StateError('图片编码失败。');
    }
    CrashReporting.breadcrumb(
      'long_image.render.success',
      data: {
        'imageWidth': (width * plan.pixelRatio).ceil(),
        'imageHeight': (height * plan.pixelRatio).ceil(),
        'pixelRatio': plan.pixelRatio,
        'encodedSizeBytes': byteData.lengthInBytes,
      },
    );
    return byteData.buffer.asUint8List(
      byteData.offsetInBytes,
      byteData.lengthInBytes,
    );
  } catch (error, stackTrace) {
    CrashReporting.breadcrumb(
      'long_image.render.failure',
      data: {'exceptionType': error.runtimeType.toString()},
    );
    unawaited(
      CrashReporting.recordError(
        error,
        stackTrace,
        source: 'long_image.render',
        context: {
          'logicalWidth': width,
          'logicalHeight': height,
          'pixelRatio': plan.pixelRatio,
          'estimatedPixelCount': plan.estimatedPixelCount,
        },
      ),
    );
    rethrow;
  } finally {
    image?.dispose();
    if (image != null) {
      CrashReporting.breadcrumb('long_image.image_disposed');
    }
  }
}

Future<Uint8List> renderRepaintBoundaryPngWithinPixelBudget(
  RenderRepaintBoundary boundary,
) {
  final size = boundary.size;
  return encodeExportImageWithinPixelBudget(
    width: size.width,
    height: size.height,
    capture: (pixelRatio) async => _UiDisposableExportImage(
      await boundary.toImage(pixelRatio: pixelRatio),
    ),
  );
}

class _UiDisposableExportImage implements DisposableExportImage {
  const _UiDisposableExportImage(this.image);

  final ui.Image image;

  @override
  Future<ByteData?> toPngByteData() {
    return image.toByteData(format: ui.ImageByteFormat.png);
  }

  @override
  void dispose() {
    image.dispose();
  }
}
