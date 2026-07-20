import 'package:jiangjiu_mobile_desktop/core/storage/session_storage.dart';

class FakeSecureTokenStorage implements SecureTokenStorage {
  FakeSecureTokenStorage({
    Map<String, String>? initialValues,
    this.failWriteAfterMutation = false,
  }) : values = <String, String>{...?initialValues};

  final Map<String, String> values;
  final bool failWriteAfterMutation;

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async {
    values[key] = value;
    if (failWriteAfterMutation) {
      throw StateError('Simulated secure-storage write failure.');
    }
  }

  @override
  Future<void> delete(String key) async {
    values.remove(key);
  }
}
