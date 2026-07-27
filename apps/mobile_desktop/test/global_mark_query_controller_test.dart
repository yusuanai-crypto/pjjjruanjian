import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/api/api_client.dart';
import 'package:jiangjiu_mobile_desktop/features/shell/global_mark_query_controller.dart';

void main() {
  test(
      'controllers apply snapshots and broadcasts, reject old events, and stop cleanly',
      () async {
    final apiClient = ApiClient(baseUrl: 'http://127.0.0.1');
    addTearDown(() => apiClient.close(force: true));
    final events = StreamController<ApiSseEvent>.broadcast(sync: true);
    addTearDown(events.close);
    var state = _settingsPayload(
      restricted: false,
      restoreRequired: false,
      revision: 0,
    );

    Future<Map<String, dynamic>> mutate(bool restricted) async {
      final revision =
          ((state['data']['settings']['revision'] as num?) ?? 0).toInt() + 1;
      state = _settingsPayload(
        restricted: restricted,
        restoreRequired: restricted,
        revision: revision,
      );
      events.add(
        _event(
          'global-mark-query.changed',
          restricted: restricted,
          restoreRequired: restricted,
          revision: revision,
        ),
      );
      return state;
    }

    GlobalMarkQueryController createController() {
      return GlobalMarkQueryController(
        apiClient: apiClient,
        token: 'token',
        settingsLoader: () async => state,
        mutation: mutate,
        eventStreamFactory: () => events.stream,
        reconnectDelay: (_) => const Duration(seconds: 5),
      );
    }

    final first = createController();
    final second = createController();
    await first.start();
    await second.start();

    expect(first.settings?.onlyShowMarkedRecords, false);
    expect(second.settings?.onlyShowMarkedRecords, false);
    expect(first.dataRevision, 1);
    expect(second.dataRevision, 1);

    events.add(
      _event(
        'global-mark-query.snapshot',
        restricted: false,
        restoreRequired: false,
        revision: 0,
      ),
    );
    await Future<void>.delayed(Duration.zero);
    expect(first.connected, true);
    expect(second.connected, true);

    await first.setRestricted(true);
    expect(first.settings?.onlyShowMarkedRecords, true);
    expect(second.settings?.onlyShowMarkedRecords, true);
    expect(first.settings?.revision, 1);
    expect(second.settings?.revision, 1);

    events.add(
      _event(
        'global-mark-query.changed',
        restricted: false,
        restoreRequired: false,
        revision: 0,
      ),
    );
    expect(first.settings?.onlyShowMarkedRecords, true);
    expect(second.settings?.onlyShowMarkedRecords, true);

    state = _settingsPayload(
      restricted: false,
      restoreRequired: false,
      revision: 2,
    );
    events.add(
      _event(
        'global-mark-query.changed',
        restricted: false,
        restoreRequired: false,
        revision: 2,
      ),
    );
    expect(first.settings?.onlyShowMarkedRecords, false);
    expect(second.settings?.onlyShowMarkedRecords, false);

    second.dispose();
    events.add(
      _event(
        'global-mark-query.changed',
        restricted: true,
        restoreRequired: true,
        revision: 3,
      ),
    );
    expect(first.settings?.onlyShowMarkedRecords, true);
    expect(second.settings?.onlyShowMarkedRecords, false);

    await first.stop();
    events.add(
      _event(
        'global-mark-query.changed',
        restricted: false,
        restoreRequired: false,
        revision: 4,
      ),
    );
    expect(first.settings?.onlyShowMarkedRecords, true);
    first.dispose();
  });

  test('controller reconnects with backoff and calibrates after a snapshot',
      () async {
    final apiClient = ApiClient(baseUrl: 'http://127.0.0.1');
    addTearDown(() => apiClient.close(force: true));
    final connections = <StreamController<ApiSseEvent>>[];
    var loaderCalls = 0;
    final controller = GlobalMarkQueryController(
      apiClient: apiClient,
      token: 'token',
      settingsLoader: () async {
        loaderCalls += 1;
        return _settingsPayload(
          restricted: false,
          restoreRequired: false,
          revision: 0,
        );
      },
      mutation: (_) async => _settingsPayload(
        restricted: false,
        restoreRequired: false,
        revision: 0,
      ),
      eventStreamFactory: () {
        final connection = StreamController<ApiSseEvent>();
        connections.add(connection);
        return connection.stream;
      },
      reconnectDelay: (_) => Duration.zero,
    );
    addTearDown(controller.dispose);

    await controller.start();
    expect(connections, hasLength(1));
    connections.first.add(
      _event(
        'global-mark-query.snapshot',
        restricted: false,
        restoreRequired: false,
        revision: 0,
      ),
    );
    await Future<void>.delayed(Duration.zero);
    expect(controller.connected, true);
    expect(loaderCalls, greaterThanOrEqualTo(2));

    await connections.first.close();
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(connections.length, greaterThanOrEqualTo(2));

    connections.last.add(
      _event(
        'global-mark-query.snapshot',
        restricted: false,
        restoreRequired: false,
        revision: 0,
      ),
    );
    await Future<void>.delayed(Duration.zero);
    expect(controller.connected, true);
    expect(loaderCalls, greaterThanOrEqualTo(3));

    for (final connection in connections.skip(1)) {
      await connection.close();
    }
  });
}

Map<String, dynamic> _settingsPayload({
  required bool restricted,
  required bool restoreRequired,
  required int revision,
}) {
  return {
    'data': {
      'settings': {
        'onlyShowMarkedRecords': restricted,
        'restoreRequired': restoreRequired,
        'revision': revision,
        'updatedAt':
            DateTime.utc(2026, 7, 27, 0, 0, revision).toIso8601String(),
      },
    },
  };
}

ApiSseEvent _event(
  String event, {
  required bool restricted,
  required bool restoreRequired,
  required int revision,
}) {
  return ApiSseEvent(
    event: event,
    id: '$revision',
    data: jsonEncode({
      'event': event,
      'onlyShowMarkedRecords': restricted,
      'restoreRequired': restoreRequired,
      'revision': revision,
      'updatedAt': DateTime.utc(2026, 7, 27, 0, 0, revision).toIso8601String(),
    }),
  );
}
