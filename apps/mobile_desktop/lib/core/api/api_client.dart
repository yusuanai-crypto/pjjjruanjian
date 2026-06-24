import 'dart:convert';
import 'dart:io';

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
