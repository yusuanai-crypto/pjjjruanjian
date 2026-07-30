import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/shared/image_export_memory_policy.dart';

void main() {
  test('pixel estimate uses width times height times pixel ratio squared', () {
    expect(
      estimateExportImagePixelCount(
        width: 1000,
        height: 2000,
        pixelRatio: 2,
      ),
      8000000,
    );
  });

  test('pixel plan lowers ratio to stay within the shared budget', () {
    final plan = planExportImagePixels(
      width: 4000,
      height: 3000,
    );

    expect(plan.pixelRatio, lessThan(exportImagePreferredPixelRatio));
    expect(plan.pixelRatio, greaterThanOrEqualTo(exportImageMinimumPixelRatio));
    expect(plan.estimatedPixelCount, closeTo(exportImageMaxPixelCount, 1));
    expect(plan.requiresPagination, isFalse);
  });

  test('pixel plan requests pagination when ratio one is still over budget',
      () {
    final plan = planExportImagePixels(
      width: 10000,
      height: 5000,
    );

    expect(plan.pixelRatio, exportImageMinimumPixelRatio);
    expect(plan.requiresPagination, isTrue);
    expect(plan.estimatedPixelCount, 50000000);
  });

  test('captured image is disposed when PNG encoding fails', () async {
    final image = _FailingDisposableExportImage();

    await expectLater(
      encodeExportImageWithinPixelBudget(
        width: 100,
        height: 100,
        capture: (_) async => image,
      ),
      throwsA(isA<StateError>()),
    );

    expect(image.disposed, isTrue);
  });
}

class _FailingDisposableExportImage implements DisposableExportImage {
  bool disposed = false;

  @override
  Future<ByteData?> toPngByteData() {
    throw StateError('encoding failed');
  }

  @override
  void dispose() {
    disposed = true;
  }
}
