import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';

void main() {
  test('parses Content-Disposition filenames', () {
    expect(
      parseContentDispositionFileName(
        'attachment; filename="sales-orders-20260701-090000.xlsx"',
      ),
      'sales-orders-20260701-090000.xlsx',
    );
    expect(
      parseContentDispositionFileName(
        "attachment; filename*=UTF-8''travel%20groups.xlsx",
      ),
      'travel groups.xlsx',
    );
    expect(
      parseContentDispositionFileName(
        'attachment; filename="report; final.xlsx"',
      ),
      'report; final.xlsx',
    );
    expect(parseContentDispositionFileName('inline'), isNull);
    expect(parseContentDispositionFileName(null), isNull);
  });

  test('parses JSON error bytes and falls back for non-JSON errors', () {
    final parsed = apiExceptionFromResponseBytes(
      403,
      utf8.encode(
        jsonEncode({
          'error': {
            'code': 'PERMISSION_DENIED',
            'message': 'No export permission',
          },
        }),
      ),
    );

    expect(parsed.statusCode, 403);
    expect(parsed.code, 'PERMISSION_DENIED');
    expect(parsed.message, 'No export permission');

    final fallback = apiExceptionFromResponseBytes(
      502,
      utf8.encode('<html>Bad gateway</html>'),
    );
    expect(fallback.statusCode, 502);
    expect(fallback.code, 'HTTP_ERROR');
    expect(fallback.message, contains('502'));
  });

  test('getBytes downloads bytes, metadata, and filename', () async {
    final server = await _startServer((request) async {
      expect(request.method, 'GET');
      expect(request.uri.path, '/api/sales-orders/export.xlsx');
      expect(
        request.headers.value(HttpHeaders.authorizationHeader),
        'Bearer test-token',
      );

      request.response.statusCode = 200;
      request.response.headers.set(
        HttpHeaders.contentTypeHeader,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      request.response.headers.set(
        'content-disposition',
        'attachment; filename="sales-orders-20260701-090000.xlsx"',
      );
      request.response.add(<int>[0x50, 0x4b, 0x03, 0x04]);
      await request.response.close();
    });
    final client = ApiClient(baseUrl: server.baseUrl);
    addTearDown(() => client.close(force: true));

    final file = await client.getBytes(
      '/api/sales-orders/export.xlsx',
      token: 'test-token',
      defaultFileName: 'fallback.xlsx',
    );
    await server.handled;

    expect(file.bytes, orderedEquals(<int>[0x50, 0x4b, 0x03, 0x04]));
    expect(
      file.contentType,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(file.fileName, 'sales-orders-20260701-090000.xlsx');
  });

  test('getBytes converts JSON error body to ApiException', () async {
    final server = await _startServer((request) async {
      request.response.statusCode = 400;
      request.response.headers.contentType = ContentType.json;
      request.response.write(
        jsonEncode({
          'error': {
            'code': 'EXPORT_LIMIT_EXCEEDED',
            'message': 'Please narrow the filters',
          },
        }),
      );
      await request.response.close();
    });
    final client = ApiClient(baseUrl: server.baseUrl);
    addTearDown(() => client.close(force: true));

    await expectLater(
      client.getBytes('/api/sales-orders/export.xlsx',
          defaultFileName: 'fallback.xlsx'),
      throwsA(
        isA<ApiException>()
            .having((error) => error.statusCode, 'statusCode', 400)
            .having((error) => error.code, 'code', 'EXPORT_LIMIT_EXCEEDED')
            .having(
              (error) => error.message,
              'message',
              'Please narrow the filters',
            ),
      ),
    );
    await server.handled;
  });
}

Future<_TestServer> _startServer(
  Future<void> Function(HttpRequest request) handler,
) async {
  final httpServer = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
  final handled = Completer<void>();

  httpServer.listen((request) async {
    try {
      await handler(request);
      if (!handled.isCompleted) {
        handled.complete();
      }
    } catch (error, stackTrace) {
      if (!handled.isCompleted) {
        handled.completeError(error, stackTrace);
      }
      rethrow;
    }
  });

  addTearDown(() async {
    await httpServer.close(force: true);
  });

  return _TestServer(
    baseUrl: 'http://${httpServer.address.host}:${httpServer.port}',
    handled: handled.future,
  );
}

class _TestServer {
  const _TestServer({
    required this.baseUrl,
    required this.handled,
  });

  final String baseUrl;
  final Future<void> handled;
}
