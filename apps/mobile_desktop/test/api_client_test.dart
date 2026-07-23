import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

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

  test('getJson preserves an HTML 502 response as an HTTP error', () async {
    final server = await _startServer((request) async {
      request.response.statusCode = 502;
      request.response.headers.contentType = ContentType.html;
      request.response.write('<html>Bad gateway</html>');
      await request.response.close();
    });
    final client = ApiClient(baseUrl: server.baseUrl);
    addTearDown(() => client.close(force: true));

    await expectLater(
      client.getJson('/api/auth/login'),
      throwsA(
        isA<ApiException>()
            .having((error) => error.statusCode, 'statusCode', 502)
            .having((error) => error.code, 'code', 'HTTP_ERROR')
            .having((error) => error.message, 'message', contains('502')),
      ),
    );
    await server.handled;
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

  test('postMultipartFiles uploads multiple sanitized files with auth',
      () async {
    final server = await _startServer((request) async {
      expect(request.method, 'POST');
      expect(request.uri.path,
          '/api/travel-groups/group-1/attachments/guest_info');
      expect(
        request.headers.value(HttpHeaders.authorizationHeader),
        'Bearer test-token',
      );
      final contentType =
          request.headers.value(HttpHeaders.contentTypeHeader) ?? '';
      expect(contentType, startsWith('multipart/form-data; boundary='));

      final body = utf8.decode(await request.fold<List<int>>(
        <int>[],
        (bytes, chunk) => bytes..addAll(chunk),
      ));
      expect(body, contains('name="files"'));
      expect(body, contains('filename="guest-list.csv"'));
      expect(body, contains("filename*=UTF-8''guest-list.csv"));
      expect(body, contains('Content-Type: text/csv'));
      expect(body, contains('name,phone'));
      expect(body, contains('filename="notes.txt"'));
      expect(body, contains('guest notes'));
      expect(body, isNot(contains('../private')));
      expect(body, isNot(contains(r'..\private')));

      request.response.statusCode = 201;
      request.response.headers.contentType = ContentType.json;
      request.response.write(
        jsonEncode({
          'data': {
            'attachments': [
              {'id': 'attachment-1'},
              {'id': 'attachment-2'},
            ],
          },
        }),
      );
      await request.response.close();
    });
    final client = ApiClient(baseUrl: server.baseUrl);
    addTearDown(() => client.close(force: true));

    final payload = await client.postMultipartFiles(
      '/api/travel-groups/group-1/attachments/guest_info',
      token: 'test-token',
      maxFileSizeBytes: 20 * 1024 * 1024,
      files: <ApiMultipartFile>[
        ApiMultipartFile.fromBytes(
          fileName: '../../private\\guest-list.csv',
          bytes: Uint8List.fromList(utf8.encode('name,phone')),
        ),
        ApiMultipartFile.fromBytes(
          fileName: 'notes.txt',
          bytes: Uint8List.fromList(utf8.encode('guest notes')),
          contentType: 'text/plain',
        ),
      ],
    );
    await server.handled;

    expect((payload['data'] as Map)['attachments'], hasLength(2));
  });

  test('postMultipartFiles rejects oversized data before network access',
      () async {
    final client = ApiClient(baseUrl: 'http://127.0.0.1:1');
    addTearDown(() => client.close(force: true));

    await expectLater(
      client.postMultipartFiles(
        '/api/upload',
        maxFileSizeBytes: 3,
        files: <ApiMultipartFile>[
          ApiMultipartFile.fromBytes(
            fileName: 'too-large.txt',
            bytes: Uint8List.fromList(<int>[1, 2, 3, 4]),
          ),
        ],
      ),
      throwsA(
        isA<ApiException>()
            .having((error) => error.statusCode, 'statusCode', 0)
            .having((error) => error.code, 'code', 'FILE_TOO_LARGE'),
      ),
    );
  });

  test('deleteJson preserves JSON response and error behavior', () async {
    final server = await _startServer((request) async {
      expect(request.method, 'DELETE');
      expect(request.uri.path, '/api/travel-groups/group-1/attachments/file-1');
      expect(
        request.headers.value(HttpHeaders.authorizationHeader),
        'Bearer test-token',
      );
      request.response.headers.contentType = ContentType.json;
      request.response.write(
        jsonEncode({
          'data': {
            'attachment': {'id': 'file-1'},
          },
        }),
      );
      await request.response.close();
    });
    final client = ApiClient(baseUrl: server.baseUrl);
    addTearDown(() => client.close(force: true));

    final payload = await client.deleteJson(
      '/api/travel-groups/group-1/attachments/file-1',
      token: 'test-token',
    );
    await server.handled;

    expect(((payload['data'] as Map)['attachment'] as Map)['id'], 'file-1');
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
