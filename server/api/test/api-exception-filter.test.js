const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ApiExceptionFilter,
} = require('../src/common/filters/api-exception.filter');
const {
  createHttpError,
} = require('../src/common/errors');
const {
  REDACTED,
  REDACTED_PHONE,
  redactSensitive,
} = require('../src/common/logging/safe-logging');
const {
  AliyunSmsNestService,
} = require('../src/modules/sms/aliyun-sms.nest.service');
const {
  AiModelClient,
} = require('../src/modules/ai/ai-model.client');

test('unknown exceptions return a generic 5xx response and a generated request ID', () => {
  const logEntries = [];
  const filter = new ApiExceptionFilter({
    error: (entry) => logEntries.push(entry),
  });
  const exception = new Error(
    'SELECT hidden_column FROM secret_table; C:\\private\\service.env; ' +
      'AUTH_TOKEN_SECRET=fake-sensitive-value; phone=13800138000',
  );
  exception.stack =
    'Error: fake-sensitive-value\n    at C:\\private\\server\\handler.ts:10:2';
  exception.password = 'fake-password-value';
  exception.details = {
    authorization: 'Bearer fake-bearer-value',
    purchaseUnitCostCents: 987654321,
    inventoryAmountCents: 876543210,
    onHandQty: 765432109,
    logisticsCode: 'inventory-logistics-secret',
    nested: [
      {
        verificationCode: '246810',
        phone: '13800138000',
        address: 'Fake full street address',
      },
    ],
  };
  const { host, response } = createFilterContext({
    headers: {
      'x-correlation-id': 'invalid correlation id',
    },
    url: '/api/example?token=fake-query-token',
  });

  filter.catch(exception, host);

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body.error, {
    code: 'INTERNAL_ERROR',
    message: 'Unexpected server error.',
  });
  assert.match(response.body.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(
    response.headers['X-Correlation-ID'],
    response.body.requestId,
  );
  const responseText = JSON.stringify(response.body);
  for (const forbidden of [
    'SELECT hidden_column',
    'secret_table',
    'C:\\private',
    'fake-sensitive-value',
    '13800138000',
    '987654321',
    '876543210',
    '765432109',
    'inventory-logistics-secret',
  ]) {
    assert.equal(responseText.includes(forbidden), false);
  }

  assert.equal(logEntries.length, 1);
  const logText = logEntries[0];
  for (const forbidden of [
    'fake-sensitive-value',
    'fake-password-value',
    'fake-bearer-value',
    '246810',
    '13800138000',
    'Fake full street address',
    'fake-query-token',
    '987654321',
    '876543210',
    '765432109',
    'inventory-logistics-secret',
  ]) {
    assert.equal(logText.includes(forbidden), false);
  }
});

test('known 4xx business errors preserve their status, code, and message', () => {
  const filter = new ApiExceptionFilter({
    error: () => assert.fail('known 4xx errors should not be logged'),
  });
  const { host, response } = createFilterContext({
    headers: {
      'x-correlation-id': 'request-123',
    },
  });

  filter.catch(
    createHttpError(
      409,
      'USERNAME_EXISTS',
      'Username already exists.',
    ),
    host,
  );

  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.body, {
    error: {
      code: 'USERNAME_EXISTS',
      message: 'Username already exists.',
    },
  });
  assert.equal(response.headers['X-Correlation-ID'], 'request-123');
});

test('unmarked status and message properties are not treated as public business errors', () => {
  const filter = new ApiExceptionFilter({ error: () => {} });
  const { host, response } = createFilterContext();
  const exception = Object.assign(
    new Error('raw untrusted client message'),
    {
      statusCode: 400,
      code: 'UNTRUSTED_ERROR',
    },
  );

  filter.catch(exception, host);

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body.error, {
    code: 'INTERNAL_ERROR',
    message: 'Unexpected server error.',
  });
  assert.equal(
    JSON.stringify(response.body).includes('raw untrusted client message'),
    false,
  );
});

test('Prisma errors use stable mappings without exposing query metadata', () => {
  const filter = new ApiExceptionFilter({ error: () => {} });
  const { host, response } = createFilterContext();
  const exception = Object.assign(
    new Error('Unique constraint failed on secret_table.hidden_column'),
    {
      code: 'P2002',
      meta: {
        modelName: 'SecretUser',
        target: ['hidden_column'],
      },
    },
  );

  filter.catch(exception, host);

  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.body, {
    error: {
      code: 'UNIQUE_CONSTRAINT_CONFLICT',
      message: 'A record with the same unique value already exists.',
    },
  });
  const responseText = JSON.stringify(response.body);
  assert.equal(responseText.includes('secret_table'), false);
  assert.equal(responseText.includes('hidden_column'), false);
  assert.equal(responseText.includes('SecretUser'), false);
});

test('foreign-key and missing-record Prisma errors have stable contracts', () => {
  const cases = [
    {
      prismaCode: 'P2003',
      statusCode: 409,
      code: 'FOREIGN_KEY_CONFLICT',
      message:
        'The requested operation conflicts with a related record.',
    },
    {
      prismaCode: 'P2025',
      statusCode: 404,
      code: 'RECORD_NOT_FOUND',
      message: 'The requested record does not exist.',
    },
  ];

  for (const item of cases) {
    const filter = new ApiExceptionFilter({ error: () => {} });
    const { host, response } = createFilterContext();
    filter.catch(
      Object.assign(new Error('raw Prisma query detail'), {
        code: item.prismaCode,
      }),
      host,
    );
    assert.equal(response.statusCode, item.statusCode);
    assert.deepEqual(response.body.error, {
      code: item.code,
      message: item.message,
    });
  }
});

test('file-system errors map without returning absolute paths', () => {
  const filter = new ApiExceptionFilter({ error: () => {} });
  const { host, response } = createFilterContext();
  filter.catch(
    Object.assign(
      new Error(
        "ENOENT: no such file or directory, open 'C:\\private\\upload.tmp'",
      ),
      {
        code: 'ENOENT',
        path: 'C:\\private\\upload.tmp',
      },
    ),
    host,
  );

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, {
    error: {
      code: 'FILE_NOT_FOUND',
      message: 'The requested file does not exist.',
    },
  });
  assert.equal(JSON.stringify(response.body).includes('C:\\private'), false);
});

test('all expected 5xx errors keep only a stable code and generic message', () => {
  const logs = [];
  const filter = new ApiExceptionFilter({
    error: (entry) => logs.push(entry),
  });
  const { host, response } = createFilterContext();
  const exception = createHttpError(
    502,
    'SMS_SEND_FAILED',
    'supplier body must not pass through',
    {
      cause: {
        providerMessage: 'authorization=Bearer provider-sensitive-value',
      },
    },
  );

  filter.catch(exception, host);

  assert.equal(response.statusCode, 502);
  assert.equal(response.body.error.code, 'SMS_SEND_FAILED');
  assert.equal(response.body.error.message, 'Unexpected server error.');
  assert.equal(typeof response.body.requestId, 'string');
  assert.equal(
    JSON.stringify(response.body).includes('supplier body'),
    false,
  );
  assert.equal(logs[0].includes('provider-sensitive-value'), false);
});

test('redaction recursively handles objects, arrays, errors, and cycles', () => {
  const input = {
    safe: 'visible',
    password: 'fake-password',
    nested: [
      {
        accessToken: 'fake-token',
        headers: {
          authorization: 'Bearer fake-bearer',
          cookie: 'session=fake-cookie',
        },
        verificationCode: '135790',
        customerPhone: '13800138000',
        shippingAddress: 'Fake complete address',
      },
    ],
    error: Object.assign(new Error('token=fake-inline-token'), {
      apiKey: 'fake-api-key',
    }),
  };
  input.self = input;

  const output = redactSensitive(input);

  assert.equal(output.safe, 'visible');
  assert.equal(output.password, REDACTED);
  assert.equal(output.nested[0].accessToken, REDACTED);
  assert.equal(output.nested[0].headers.authorization, REDACTED);
  assert.equal(output.nested[0].headers.cookie, REDACTED);
  assert.equal(output.nested[0].verificationCode, REDACTED);
  assert.equal(output.nested[0].customerPhone, REDACTED_PHONE);
  assert.equal(output.nested[0].shippingAddress, REDACTED);
  assert.equal(output.error.apiKey, REDACTED);
  assert.equal(output.error.message.includes('fake-inline-token'), false);
  assert.equal(output.self, '[Circular]');
});

test('SMS and AI adapters do not expose upstream response text', async () => {
  await withEnvironment(
    {
      NODE_ENV: 'test',
      SMS_VERIFICATION_DEBUG: 'false',
      ALIYUN_SMS_MOCK: 'false',
      ALIYUN_SMS_ACCESS_KEY_ID: 'fake-access-key-id',
      ALIYUN_SMS_ACCESS_KEY_SECRET: 'fake-access-key-secret',
      ALIYUN_SMS_SIGN_NAME: 'fake-sign-name',
      ALIYUN_SMS_TEMPLATE_CODE: 'fake-template-code',
    },
    async () => {
      const originalFetch = global.fetch;
      try {
        global.fetch = async () => ({
          ok: false,
          status: 400,
          text: async () =>
            JSON.stringify({
              Code: 'Fake.Provider.Code',
              Message: 'fake SMS provider response body',
            }),
        });
        let smsFailure;
        try {
          await new AliyunSmsNestService().sendVerificationCode(
            '10000000000',
            '000000',
          );
        } catch (error) {
          smsFailure = error;
        }
        assert.equal(smsFailure?.statusCode, 502);
        assert.equal(smsFailure?.code, 'SMS_SEND_FAILED');
        assert.equal(smsFailure?.message, 'SMS provider request failed.');
        assert.equal(
          String(smsFailure?.message).includes('provider response body'),
          false,
        );
      } finally {
        global.fetch = originalFetch;
      }
    },
  );

  const client = new AiModelClient({
    getConfig: () => {
      throw new Error('test should pass explicit AI config');
    },
  });
  let aiFailure;
  try {
    await client.generateAnswer(
      { question: 'safe test question' },
      {
        config: {
          enabled: true,
          mockMode: false,
          provider: 'openai_compatible',
          apiKey: 'fake-ai-key',
          baseUrl: 'https://ai.invalid/v1',
          model: 'fake-model',
          maxQuestionLength: 500,
          dailyLimitPerUser: 10,
          historyRetentionDays: 30,
          timeoutMs: 1000,
        },
        fetchImpl: async () => ({
          ok: false,
          status: 502,
          json: async () => ({
            message: 'fake AI provider response body',
          }),
        }),
      },
    );
  } catch (error) {
    aiFailure = error;
  }
  assert.equal(aiFailure?.statusCode, 502);
  assert.equal(aiFailure?.code, 'AI_PROVIDER_REQUEST_FAILED');
  assert.equal(
    String(aiFailure?.message).includes('provider response body'),
    false,
  );
});

function createFilterContext(options = {}) {
  const response = {
    body: null,
    headers: {},
    statusCode: null,
    setHeader(name, value) {
      this.headers[name] = String(value);
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  const request = {
    headers: options.headers || {},
    method: options.method || 'GET',
    url: options.url || '/api/test',
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  };
  return { host, request, response };
}

async function withEnvironment(values, callback) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
