const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createUser,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');

test('contract: global mark SSE authenticates, snapshots, broadcasts, and cleans up', async () => {
  await withPhase1Server(async (baseUrl, { settingsService }) => {
    const unauthorized = await fetch(
      `${baseUrl}/api/settings/global-mark-query/events`,
    );
    assert.equal(unauthorized.status, 401);
    assert.match(
      unauthorized.headers.get('content-type') || '',
      /^application\/json/,
    );
    const unauthorizedBody = await unauthorized.json();
    assert.equal(unauthorizedBody.error.code, 'AUTH_TOKEN_REQUIRED');

    const admin = await login(baseUrl);
    await createUser(baseUrl, admin.token, {
      name: 'Global Mark SSE Finance',
      username: 'global-mark-sse-finance',
      password: 'Password123',
      role: 'finance',
    });
    const finance = await login(
      baseUrl,
      'global-mark-sse-finance',
      'Password123',
    );

    const adminConnection = await openSse(baseUrl, admin.token);
    const financeConnection = await openSse(baseUrl, finance.token);
    try {
      const adminSnapshot = await adminConnection.nextStateEvent();
      const financeSnapshot = await financeConnection.nextStateEvent();
      for (const snapshot of [adminSnapshot, financeSnapshot]) {
        assert.equal(snapshot.event, 'global-mark-query.snapshot');
        assert.equal(snapshot.data.event, 'global-mark-query.snapshot');
        assert.equal(snapshot.data.onlyShowMarkedRecords, false);
        assert.equal(snapshot.data.restoreRequired, false);
        assert.equal(snapshot.data.revision, 0);
        assert.equal(typeof snapshot.data.updatedAt, 'string');
      }
      assert.equal(
        await waitFor(
          () =>
            settingsService.getGlobalMarkQueryEventSubscriberCount() === 2,
        ),
        true,
      );

      const enabled = await requestJson(
        baseUrl,
        '/api/settings/global-mark-query/enable',
        {
          method: 'POST',
          token: admin.token,
        },
      );
      assert.equal(enabled.response.status, 200);
      assert.equal(enabled.body.data.settings.revision, 1);

      const adminEnabled = await adminConnection.nextStateEvent();
      const financeEnabled = await financeConnection.nextStateEvent();
      for (const event of [adminEnabled, financeEnabled]) {
        assert.equal(event.event, 'global-mark-query.changed');
        assert.equal(event.data.event, 'global-mark-query.changed');
        assert.equal(event.data.onlyShowMarkedRecords, true);
        assert.equal(event.data.restoreRequired, true);
        assert.equal(event.data.revision, 1);
      }

      const restored = await requestJson(
        baseUrl,
        '/api/settings/global-mark-query/restore',
        {
          method: 'POST',
          token: admin.token,
        },
      );
      assert.equal(restored.response.status, 200);
      assert.equal(restored.body.data.settings.revision, 2);

      const financeRestored = await financeConnection.nextStateEvent();
      assert.equal(financeRestored.event, 'global-mark-query.changed');
      assert.equal(financeRestored.data.onlyShowMarkedRecords, false);
      assert.equal(financeRestored.data.restoreRequired, false);
      assert.equal(financeRestored.data.revision, 2);
    } finally {
      await adminConnection.close();
      await financeConnection.close();
    }

    assert.equal(
      await waitFor(
        () =>
          settingsService.getGlobalMarkQueryEventSubscriberCount() === 0,
      ),
      true,
    );
  });
});

async function openSse(baseUrl, token) {
  const abortController = new AbortController();
  const response = await fetch(
    `${baseUrl}/api/settings/global-mark-query/events`,
    {
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      signal: abortController.signal,
    },
  );
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get('content-type') || '',
    /^text\/event-stream/,
  );
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const queued = [];

  async function nextStateEvent() {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      while (queued.length > 0) {
        const event = queued.shift();
        if (
          event.event === 'global-mark-query.snapshot' ||
          event.event === 'global-mark-query.changed'
        ) {
          return event;
        }
      }

      const remaining = Math.max(1, deadline - Date.now());
      const result = await Promise.race([
        reader.read(),
        timeout(remaining).then(() => ({ timedOut: true })),
      ]);
      if (result.timedOut) {
        break;
      }
      if (result.done) {
        throw new Error('SSE connection closed before the next state event.');
      }
      buffer += decoder.decode(result.value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() || '';
      queued.push(...frames.map(parseSseFrame).filter(Boolean));
    }
    throw new Error('Timed out waiting for a global mark SSE event.');
  }

  return {
    nextStateEvent,
    async close() {
      abortController.abort();
      try {
        await reader.cancel();
      } catch {
        // The abort already closed the stream.
      }
    },
  };
}

function parseSseFrame(frame) {
  let event = 'message';
  const dataLines = [];
  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) {
      continue;
    }
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    const value =
      separator < 0
        ? ''
        : line.slice(separator + 1).replace(/^ /, '');
    if (field === 'event') {
      event = value;
    } else if (field === 'data') {
      dataLines.push(value);
    }
  }
  if (dataLines.length === 0) {
    return null;
  }
  return {
    event,
    data: JSON.parse(dataLines.join('\n')),
  };
}

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await timeout(20);
  }
  return predicate();
}

function timeout(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
