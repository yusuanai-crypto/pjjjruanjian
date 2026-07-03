import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

const _contentDispositionHeader = 'content-disposition';

class ApiClient {
  ApiClient({required String baseUrl}) : _baseUrl = baseUrl;

  final HttpClient _httpClient = HttpClient();
  String _baseUrl;

  set baseUrl(String value) {
    _baseUrl = value;
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

  Future<ApiDownloadedFile> getBytes(
    String path, {
    required String defaultFileName,
    String? token,
  }) async {
    try {
      final request =
          await _httpClient.openUrl('GET', Uri.parse('$_baseUrl$path'));
      request.headers.set(HttpHeaders.acceptHeader, '*/*');
      if (token != null && token.isNotEmpty) {
        request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
      }

      final response = await request.close();
      final bytesBuilder = BytesBuilder(copy: false);
      await for (final chunk in response) {
        bytesBuilder.add(chunk);
      }
      final bytes = bytesBuilder.takeBytes();

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw apiExceptionFromResponseBytes(response.statusCode, bytes);
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
    } on ApiException {
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
  }) async {
    try {
      final request =
          await _httpClient.openUrl(method, Uri.parse('$_baseUrl$path'));
      request.headers.set(HttpHeaders.acceptHeader, 'application/json');
      if (token != null && token.isNotEmpty) {
        request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
      }
      if (body != null) {
        request.headers.set(
            HttpHeaders.contentTypeHeader, 'application/json; charset=utf-8');
        request.write(jsonEncode(body));
      }

      final response = await request.close();
      final text = await utf8.decoder.bind(response).join();
      final decoded = text.isEmpty ? <String, dynamic>{} : jsonDecode(text);
      final payload =
          decoded is Map ? _stringKeyMap(decoded) : <String, dynamic>{};

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw ApiException.fromPayload(response.statusCode, payload);
      }

      return payload;
    } on ApiException {
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
  });

  final int statusCode;
  final String code;
  final String message;

  factory ApiException.fromPayload(
      int statusCode, Map<String, dynamic> payload) {
    final error = payload['error'];
    if (error is Map<String, dynamic>) {
      final rawMessage = '${error['message'] ?? '请求失败'}';
      return ApiException(
        statusCode: statusCode,
        code: '${error['code'] ?? 'HTTP_ERROR'}',
        message: _friendlyMessage(rawMessage),
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
