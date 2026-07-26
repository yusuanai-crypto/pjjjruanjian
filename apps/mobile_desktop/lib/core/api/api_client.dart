import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';

import '../config/app_config.dart';

const _contentDispositionHeader = 'content-disposition';

class ApiClient {
  ApiClient({
    required String baseUrl,
    this.onSessionRevoked,
    this.onAccessTokenExpired,
    this.accessTokenProvider,
  }) : _baseUrl = AppConfig.normalizeApiBaseUrl(baseUrl);

  final HttpClient _httpClient = HttpClient();
  String _baseUrl;
  FutureOr<void> Function(ApiException error)? onSessionRevoked;
  Future<String?> Function()? onAccessTokenExpired;
  String? Function()? accessTokenProvider;

  set baseUrl(String value) {
    _baseUrl = AppConfig.normalizeApiBaseUrl(value);
  }

  Future<Map<String, dynamic>> getJson(
    String path, {
    String? token,
  }) {
    return _requestJson('GET', path, token: token);
  }

  Future<Map<String, dynamic>> postJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) {
    return _requestJson('POST', path, body: body, token: token);
  }

  Future<Map<String, dynamic>> putJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) {
    return _requestJson('PUT', path, body: body, token: token);
  }

  Future<Map<String, dynamic>> patchJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) {
    return _requestJson('PATCH', path, body: body, token: token);
  }

  Future<Map<String, dynamic>> deleteJson(
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) {
    return _requestJson('DELETE', path, body: body, token: token);
  }

  Future<Map<String, dynamic>> postMultipartFiles(
    String path, {
    required List<ApiMultipartFile> files,
    String fieldName = 'files',
    Map<String, String> fields = const <String, String>{},
    int? maxFileSizeBytes,
    String? token,
  }) {
    return _postMultipartFiles(
      path,
      files: files,
      fieldName: fieldName,
      fields: fields,
      maxFileSizeBytes: maxFileSizeBytes,
      token: token,
      retryAfterRefresh: true,
    );
  }

  Future<Map<String, dynamic>> _postMultipartFiles(
    String path, {
    required List<ApiMultipartFile> files,
    required String fieldName,
    required Map<String, String> fields,
    required int? maxFileSizeBytes,
    required String? token,
    required bool retryAfterRefresh,
  }) async {
    if (files.isEmpty) {
      throw const ApiException(
        statusCode: 0,
        code: 'FILE_REQUIRED',
        message: 'At least one file is required.',
      );
    }
    if (!_multipartFieldNamePattern.hasMatch(fieldName)) {
      throw const ApiException(
        statusCode: 0,
        code: 'INVALID_MULTIPART_FIELD',
        message: 'Multipart field name is invalid.',
      );
    }
    if (fields.keys.any((key) => !_multipartFieldNamePattern.hasMatch(key))) {
      throw const ApiException(
        statusCode: 0,
        code: 'INVALID_MULTIPART_FIELD',
        message: 'Multipart field name is invalid.',
      );
    }

    try {
      if (maxFileSizeBytes != null) {
        for (final file in files) {
          if (await file.length() > maxFileSizeBytes) {
            throw ApiException(
              statusCode: 0,
              code: 'FILE_TOO_LARGE',
              message: 'File ${file.fileName} exceeds the allowed upload size.',
            );
          }
        }
      }

      final boundary = _createMultipartBoundary();
      final request =
          await _httpClient.openUrl('POST', Uri.parse('$_baseUrl$path'));
      request.headers.set(HttpHeaders.acceptHeader, 'application/json');
      request.headers.set(
        HttpHeaders.contentTypeHeader,
        'multipart/form-data; boundary=$boundary',
      );
      final effectiveToken = _effectiveToken(token);
      if (effectiveToken != null && effectiveToken.isNotEmpty) {
        request.headers.set(
          HttpHeaders.authorizationHeader,
          'Bearer $effectiveToken',
        );
      }

      for (final entry in fields.entries) {
        request.add(
          utf8.encode(
            '--$boundary\r\n'
            'Content-Disposition: form-data; '
            'name="${_escapeMultipartHeaderValue(entry.key)}"\r\n\r\n'
            '${entry.value}\r\n',
          ),
        );
      }
      for (final file in files) {
        final fileName = _safeMultipartFileName(file.fileName);
        final encodedFileName = Uri.encodeComponent(fileName);
        request.add(
          utf8.encode(
            '--$boundary\r\n'
            'Content-Disposition: form-data; '
            'name="${_escapeMultipartHeaderValue(fieldName)}"; '
            'filename="${_escapeMultipartHeaderValue(fileName)}"; '
            "filename*=UTF-8''$encodedFileName\r\n"
            'Content-Type: ${_multipartContentType(file)}\r\n\r\n',
          ),
        );
        await request.addStream(file.openRead());
        request.add(const <int>[13, 10]);
      }
      request.add(utf8.encode('--$boundary--\r\n'));

      return await _decodeJsonResponse(await request.close());
    } on ApiException catch (error) {
      final refreshedToken = await _tokenForRetry(
        error,
        requestedToken: token,
        path: path,
        retryAfterRefresh: retryAfterRefresh,
      );
      if (refreshedToken != null) {
        return _postMultipartFiles(
          path,
          files: files,
          fieldName: fieldName,
          fields: fields,
          maxFileSizeBytes: maxFileSizeBytes,
          token: refreshedToken,
          retryAfterRefresh: false,
        );
      }
      rethrow;
    } on FileSystemException {
      throw const ApiException(
        statusCode: 0,
        code: 'FILE_READ_ERROR',
        message: 'The selected file could not be read.',
      );
    } on SocketException {
      throw const ApiException(
        statusCode: 0,
        code: 'NETWORK_ERROR',
        message: '无法连接服务器，请检查服务器地址和网络。',
      );
    } on FormatException {
      throw const ApiException(
        statusCode: 0,
        code: 'INVALID_RESPONSE',
        message: '服务器返回格式异常。',
      );
    } on ArgumentError {
      throw const ApiException(
        statusCode: 0,
        code: 'INVALID_SERVER_URL',
        message: '服务器地址格式不正确。',
      );
    }
  }

  Future<ApiDownloadedFile> getBytes(
    String path, {
    required String defaultFileName,
    String? token,
  }) {
    return _getBytes(
      path,
      defaultFileName: defaultFileName,
      token: token,
      retryAfterRefresh: true,
    );
  }

  Future<ApiDownloadedFile> _getBytes(
    String path, {
    required String defaultFileName,
    required String? token,
    required bool retryAfterRefresh,
  }) async {
    try {
      final request =
          await _httpClient.openUrl('GET', Uri.parse('$_baseUrl$path'));
      request.headers.set(HttpHeaders.acceptHeader, '*/*');
      final effectiveToken = _effectiveToken(token);
      if (effectiveToken != null && effectiveToken.isNotEmpty) {
        request.headers.set(
          HttpHeaders.authorizationHeader,
          'Bearer $effectiveToken',
        );
      }

      final response = await request.close();
      final bytesBuilder = BytesBuilder(copy: false);
      await for (final chunk in response) {
        bytesBuilder.add(chunk);
      }
      final bytes = bytesBuilder.takeBytes();

      if (response.statusCode < 200 || response.statusCode >= 300) {
        final error = apiExceptionFromResponseBytes(response.statusCode, bytes);
        await _notifySessionRevoked(error);
        throw error;
      }

      final contentDisposition =
          response.headers.value(_contentDispositionHeader);
      final contentType = response.headers.value(HttpHeaders.contentTypeHeader);

      return ApiDownloadedFile(
        bytes: bytes,
        contentType: contentType,
        fileName: parseContentDispositionFileName(contentDisposition) ??
            defaultFileName,
      );
    } on ApiException catch (error) {
      final refreshedToken = await _tokenForRetry(
        error,
        requestedToken: token,
        path: path,
        retryAfterRefresh: retryAfterRefresh,
      );
      if (refreshedToken != null) {
        return _getBytes(
          path,
          defaultFileName: defaultFileName,
          token: refreshedToken,
          retryAfterRefresh: false,
        );
      }
      rethrow;
    } on SocketException {
      throw const ApiException(
        statusCode: 0,
        code: 'NETWORK_ERROR',
        message: '无法连接服务器，请检查服务器地址和网络。',
      );
    } on FormatException {
      throw const ApiException(
        statusCode: 0,
        code: 'INVALID_RESPONSE',
        message: '服务器返回格式异常。',
      );
    } on ArgumentError {
      throw const ApiException(
        statusCode: 0,
        code: 'INVALID_SERVER_URL',
        message: '服务器地址格式不正确。',
      );
    }
  }

  Future<ApiDownloadedFile> postBytes(
    String path, {
    required Map<String, dynamic> body,
    required String defaultFileName,
    String? token,
  }) {
    return _postBytes(
      path,
      body: body,
      defaultFileName: defaultFileName,
      token: token,
      retryAfterRefresh: true,
    );
  }

  Future<ApiDownloadedFile> _postBytes(
    String path, {
    required Map<String, dynamic> body,
    required String defaultFileName,
    required String? token,
    required bool retryAfterRefresh,
  }) async {
    try {
      final request =
          await _httpClient.openUrl('POST', Uri.parse('$_baseUrl$path'));
      request.headers.set(HttpHeaders.acceptHeader, '*/*');
      request.headers.set(
        HttpHeaders.contentTypeHeader,
        'application/json; charset=utf-8',
      );
      final effectiveToken = _effectiveToken(token);
      if (effectiveToken != null && effectiveToken.isNotEmpty) {
        request.headers.set(
          HttpHeaders.authorizationHeader,
          'Bearer $effectiveToken',
        );
      }
      request.add(utf8.encode(jsonEncode(body)));

      final response = await request.close();
      final bytesBuilder = BytesBuilder(copy: false);
      await for (final chunk in response) {
        bytesBuilder.add(chunk);
      }
      final bytes = bytesBuilder.takeBytes();
      if (response.statusCode < 200 || response.statusCode >= 300) {
        final error = apiExceptionFromResponseBytes(response.statusCode, bytes);
        await _notifySessionRevoked(error);
        throw error;
      }

      return ApiDownloadedFile(
        bytes: bytes,
        contentType: response.headers.value(HttpHeaders.contentTypeHeader),
        fileName: parseContentDispositionFileName(
              response.headers.value(_contentDispositionHeader),
            ) ??
            defaultFileName,
      );
    } on ApiException catch (error) {
      final refreshedToken = await _tokenForRetry(
        error,
        requestedToken: token,
        path: path,
        retryAfterRefresh: retryAfterRefresh,
      );
      if (refreshedToken != null) {
        return _postBytes(
          path,
          body: body,
          defaultFileName: defaultFileName,
          token: refreshedToken,
          retryAfterRefresh: false,
        );
      }
      rethrow;
    } on SocketException {
      throw const ApiException(
        statusCode: 0,
        code: 'NETWORK_ERROR',
        message: '无法连接服务器，请检查服务器地址和网络。',
      );
    } on FormatException {
      throw const ApiException(
        statusCode: 0,
        code: 'INVALID_RESPONSE',
        message: '服务器返回格式异常。',
      );
    } on ArgumentError {
      throw const ApiException(
        statusCode: 0,
        code: 'INVALID_SERVER_URL',
        message: '服务器地址格式不正确。',
      );
    }
  }

  void close({bool force = false}) {
    _httpClient.close(force: force);
  }

  Future<Map<String, dynamic>> _requestJson(
    String method,
    String path, {
    Map<String, dynamic>? body,
    String? token,
    bool retryAfterRefresh = true,
  }) async {
    try {
      final request =
          await _httpClient.openUrl(method, Uri.parse('$_baseUrl$path'));
      request.headers.set(HttpHeaders.acceptHeader, 'application/json');
      final effectiveToken = _effectiveToken(token);
      if (effectiveToken != null && effectiveToken.isNotEmpty) {
        request.headers.set(
          HttpHeaders.authorizationHeader,
          'Bearer $effectiveToken',
        );
      }
      if (body != null) {
        request.headers.set(
            HttpHeaders.contentTypeHeader, 'application/json; charset=utf-8');
        request.write(jsonEncode(body));
      }

      return await _decodeJsonResponse(await request.close());
    } on ApiException catch (error) {
      final refreshedToken = await _tokenForRetry(
        error,
        requestedToken: token,
        path: path,
        retryAfterRefresh: retryAfterRefresh,
      );
      if (refreshedToken != null) {
        return _requestJson(
          method,
          path,
          body: body,
          token: refreshedToken,
          retryAfterRefresh: false,
        );
      }
      rethrow;
    } on SocketException {
      throw const ApiException(
        statusCode: 0,
        code: 'NETWORK_ERROR',
        message: '无法连接服务器，请检查服务器地址和网络。',
      );
    } on FormatException {
      throw const ApiException(
        statusCode: 0,
        code: 'INVALID_RESPONSE',
        message: '服务器返回格式异常。',
      );
    } on ArgumentError {
      throw const ApiException(
        statusCode: 0,
        code: 'INVALID_SERVER_URL',
        message: '服务器地址格式不正确。',
      );
    }
  }

  Future<Map<String, dynamic>> _decodeJsonResponse(
    HttpClientResponse response,
  ) async {
    final bytesBuilder = BytesBuilder(copy: false);
    await for (final chunk in response) {
      bytesBuilder.add(chunk);
    }
    final bytes = bytesBuilder.takeBytes();

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final error = apiExceptionFromResponseBytes(response.statusCode, bytes);
      await _notifySessionRevoked(error);
      throw error;
    }

    final text = utf8.decode(bytes);
    final decoded = text.isEmpty ? <String, dynamic>{} : jsonDecode(text);
    final payload =
        decoded is Map ? _stringKeyMap(decoded) : <String, dynamic>{};

    return payload;
  }

  Future<void> _notifySessionRevoked(ApiException error) async {
    if (error.code == 'SESSION_REVOKED' ||
        error.code == 'ACCOUNT_DISABLED' ||
        error.code == 'ACCOUNT_FROZEN' ||
        error.code == 'USER_DISABLED' ||
        error.code == 'REFRESH_TOKEN_EXPIRED' ||
        error.code == 'REFRESH_TOKEN_INVALID' ||
        error.code == 'REFRESH_TOKEN_REUSED') {
      await onSessionRevoked?.call(error);
    }
  }

  String? _effectiveToken(String? requestedToken) {
    if (requestedToken == null || requestedToken.isEmpty) {
      return requestedToken;
    }
    final currentToken = accessTokenProvider?.call();
    return currentToken == null || currentToken.isEmpty
        ? requestedToken
        : currentToken;
  }

  Future<String?> _tokenForRetry(
    ApiException error, {
    required String? requestedToken,
    required String path,
    required bool retryAfterRefresh,
  }) async {
    if (!retryAfterRefresh ||
        requestedToken == null ||
        requestedToken.isEmpty ||
        path == '/api/auth/refresh' ||
        error.code != 'AUTH_TOKEN_EXPIRED') {
      return null;
    }
    final refreshedToken = await onAccessTokenExpired?.call();
    return refreshedToken == null || refreshedToken.isEmpty
        ? null
        : refreshedToken;
  }
}

class ApiMultipartFile {
  const ApiMultipartFile.fromBytes({
    required this.fileName,
    required Uint8List bytes,
    this.contentType,
  })  : _bytes = bytes,
        _path = null;

  const ApiMultipartFile.fromPath({
    required this.fileName,
    required String path,
    this.contentType,
  })  : _path = path,
        _bytes = null;

  factory ApiMultipartFile.fromPlatformFile(
    PlatformFile file, {
    String? contentType,
  }) {
    final bytes = file.bytes;
    if (bytes != null) {
      return ApiMultipartFile.fromBytes(
        fileName: file.name,
        bytes: bytes,
        contentType: contentType,
      );
    }
    final path = file.path;
    if (path == null || path.trim().isEmpty) {
      throw ArgumentError.value(
        file.name,
        'file',
        'Selected file has neither bytes nor a readable path.',
      );
    }
    return ApiMultipartFile.fromPath(
      fileName: file.name,
      path: path,
      contentType: contentType,
    );
  }

  final String fileName;
  final String? contentType;
  final Uint8List? _bytes;
  final String? _path;

  Future<int> length() async {
    final bytes = _bytes;
    if (bytes != null) {
      return bytes.length;
    }
    return File(_path!).length();
  }

  Stream<List<int>> openRead() {
    final bytes = _bytes;
    if (bytes != null) {
      return Stream<List<int>>.value(bytes);
    }
    return File(_path!).openRead();
  }
}

final RegExp _multipartFieldNamePattern = RegExp(r'^[A-Za-z0-9_.-]+$');
final RegExp _multipartContentTypePattern =
    RegExp(r'^[A-Za-z0-9.+_-]+/[A-Za-z0-9.+_-]+$');

String _createMultipartBoundary() {
  final random = Random.secure();
  final randomHex = List<String>.generate(
    24,
    (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
  ).join();
  return '----jiangjiu-$randomHex';
}

String _escapeMultipartHeaderValue(String value) {
  return value
      .replaceAll(RegExp(r'[\u0000-\u001f\u007f]'), '_')
      .replaceAll('\\', '_')
      .replaceAll('"', '_');
}

String _safeMultipartFileName(String value) {
  final segments = value.replaceAll('\\', '/').split('/');
  final baseName = segments.isEmpty ? '' : segments.last;
  final sanitized = _escapeMultipartHeaderValue(baseName).trim();
  final fileName = sanitized.isEmpty ? 'attachment' : sanitized;
  return fileName.length <= 255 ? fileName : fileName.substring(0, 255);
}

String _multipartContentType(ApiMultipartFile file) {
  final provided = file.contentType?.split(';').first.trim().toLowerCase();
  if (provided != null && _multipartContentTypePattern.hasMatch(provided)) {
    return provided;
  }
  return _inferContentType(file.fileName);
}

String _inferContentType(String fileName) {
  final normalized = fileName.toLowerCase();
  final dotIndex = normalized.lastIndexOf('.');
  final extension = dotIndex >= 0 ? normalized.substring(dotIndex) : '';
  return const <String, String>{
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.tif': 'image/tiff',
        '.tiff': 'image/tiff',
        '.avif': 'image/avif',
        '.pdf': 'application/pdf',
        '.doc': 'application/msword',
        '.docx':
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel',
        '.xlsx':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.csv': 'text/csv',
        '.txt': 'text/plain',
        '.log': 'text/plain',
        '.md': 'text/markdown',
      }[extension] ??
      'application/octet-stream';
}

Map<String, dynamic> _stringKeyMap(Map value) {
  return value.map((key, mapValue) => MapEntry('$key', mapValue));
}

class ApiDownloadedFile {
  const ApiDownloadedFile({
    required this.bytes,
    required this.fileName,
    this.contentType,
  });

  final Uint8List bytes;
  final String? contentType;
  final String fileName;
}

String? parseContentDispositionFileName(String? contentDisposition) {
  if (contentDisposition == null || contentDisposition.trim().isEmpty) {
    return null;
  }

  final parameters = _parseHeaderParameters(contentDisposition);
  final encodedFileName = parameters['filename*'];
  if (encodedFileName != null && encodedFileName.trim().isNotEmpty) {
    final encodedValue = encodedFileName.trim();
    final separatorIndex = encodedValue.indexOf("''");
    final value = separatorIndex >= 0
        ? encodedValue.substring(separatorIndex + 2)
        : encodedValue;
    return _decodeHeaderValue(value);
  }

  final fileName = parameters['filename'];
  if (fileName == null || fileName.trim().isEmpty) {
    return null;
  }
  return fileName.trim();
}

ApiException apiExceptionFromResponseBytes(
  int statusCode,
  List<int> bodyBytes,
) {
  if (bodyBytes.isNotEmpty) {
    try {
      final decoded = jsonDecode(utf8.decode(bodyBytes));
      if (decoded is Map) {
        return ApiException.fromPayload(statusCode, _stringKeyMap(decoded));
      }
    } on FormatException {
      // Fall through to a generic HTTP error when the body is not JSON.
    }
  }

  return ApiException(
    statusCode: statusCode,
    code: 'HTTP_ERROR',
    message: '请求失败，HTTP $statusCode。',
  );
}

Map<String, String> _parseHeaderParameters(String headerValue) {
  final parameters = <String, String>{};
  for (final segment in _splitHeaderSegments(headerValue).skip(1)) {
    final equalsIndex = segment.indexOf('=');
    if (equalsIndex <= 0) {
      continue;
    }
    final key = segment.substring(0, equalsIndex).trim().toLowerCase();
    final value = segment.substring(equalsIndex + 1).trim();
    parameters[key] = _unquoteHeaderValue(value);
  }
  return parameters;
}

List<String> _splitHeaderSegments(String headerValue) {
  final segments = <String>[];
  final current = StringBuffer();
  var inQuotes = false;
  var escaping = false;

  for (var index = 0; index < headerValue.length; index += 1) {
    final character = headerValue[index];
    if (escaping) {
      current.write(character);
      escaping = false;
      continue;
    }
    if (character == '\\' && inQuotes) {
      current.write(character);
      escaping = true;
      continue;
    }
    if (character == '"') {
      inQuotes = !inQuotes;
      current.write(character);
      continue;
    }
    if (character == ';' && !inQuotes) {
      segments.add(current.toString().trim());
      current.clear();
      continue;
    }
    current.write(character);
  }
  segments.add(current.toString().trim());
  return segments;
}

String _unquoteHeaderValue(String value) {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) {
    return value;
  }
  return value
      .substring(1, value.length - 1)
      .replaceAll(r'\"', '"')
      .replaceAll(r'\\', '\\');
}

String _decodeHeaderValue(String value) {
  try {
    return Uri.decodeFull(value);
  } on FormatException {
    return value;
  }
}

class ApiException implements Exception {
  const ApiException({
    required this.statusCode,
    required this.code,
    required this.message,
    this.missingFields = const <String>[],
  });

  final int statusCode;
  final String code;
  final String message;
  final List<String> missingFields;

  factory ApiException.fromPayload(
      int statusCode, Map<String, dynamic> payload) {
    final error = payload['error'];
    if (error is Map<String, dynamic>) {
      final rawMessage = '${error['message'] ?? '请求失败'}';
      return ApiException(
        statusCode: statusCode,
        code: '${error['code'] ?? 'HTTP_ERROR'}',
        message: _friendlyMessage(rawMessage),
        missingFields: error['missingFields'] is List
            ? [
                for (final field in error['missingFields'] as List)
                  if (field is String && field.trim().isNotEmpty) field.trim(),
              ]
            : const <String>[],
      );
    }

    return ApiException(
      statusCode: statusCode,
      code: 'HTTP_ERROR',
      message: '请求失败，HTTP $statusCode。',
    );
  }

  @override
  String toString() => message;
}

String _friendlyMessage(String message) {
  if (message.contains('does not exist in the current database') ||
      message.contains('Invalid `delegate.') ||
      message.contains('PrismaClientKnownRequestError')) {
    return '业务数据表尚未初始化，请先完成数据库迁移或联系管理员处理。';
  }

  return message;
}
