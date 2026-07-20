# API deployment security checklist

## Authentication secret

Set `AUTH_TOKEN_SECRET` through the deployment platform's secret manager before
starting the API. The value must be a non-placeholder secret of at least 32
bytes. Do not commit it to an environment file or inject the value at image
build time.

The API validates this setting while the authentication module is initialized.
A missing, placeholder, or undersized value prevents startup. The same setting
is used for JWT signatures and SMS verification-code HMACs.

When rotating the secret:

1. Generate a new random secret in the deployment secret manager.
2. Update every API instance to use the same new value.
3. Restart the API instances through the normal deployment process.
4. Expect existing login tokens and outstanding SMS verification codes to
   become invalid, and notify users if required.
5. Remove the previous value from the secret manager after the rollout is
   verified.

Do not run old and new values concurrently unless the application is first
extended with an explicit multi-key rotation strategy.

## Database seed credentials

`npm.cmd run prisma:seed` requires `SEED_ADMIN_PASSWORD`; the seed exits before
performing a database operation when it is absent or is a placeholder. The
seeded administrator is marked `mustChangePassword=true`.

Demo accounts and their related sample data are disabled by default. To create
them in a disposable environment only, set `SEED_CREATE_DEMO_USERS=true` and
provide `SEED_DEMO_PASSWORD` separately through the secret manager. Demo
accounts are also marked to change their password on first use. Keep
`SEED_CREATE_DEMO_USERS=false` in production.

## Server-side rate limiting

Apply the Prisma migrations before starting the API. Production deployments
must use `RATE_LIMIT_STORE=database` and must provide a non-placeholder
`RATE_LIMIT_KEY_SECRET` of at least 32 bytes through the secret manager. Every
API instance must use the same database and fingerprint secret. Startup fails
if production is configured with the in-memory store or if the shared store's
fingerprint secret is missing or weak.

The database store performs each fixed-window increment in a transaction using
an atomic upsert. This prevents concurrent requests on different API instances
from passing the final remaining slot. The in-memory store is intended only for
development and automated tests.

Configure these policies according to the deployment's traffic profile:

- `LOGIN_RATE_LIMIT_MAX_REQUESTS` and
  `LOGIN_RATE_LIMIT_WINDOW_SECONDS` protect each source-IP and normalized-account
  pair before password hashing.
- `SMS_CODE_RATE_LIMIT_MAX_REQUESTS` and
  `SMS_CODE_RATE_LIMIT_WINDOW_SECONDS` protect each
  operator/target-user/phone combination before SMS delivery.
- `PASSWORD_RESET_RATE_LIMIT_MAX_REQUESTS` and
  `PASSWORD_RESET_RATE_LIMIT_WINDOW_SECONDS` protect each
  operator/target-user combination before password hashing.
- `AI_RATE_LIMIT_MAX_REQUESTS` and `AI_RATE_LIMIT_WINDOW_SECONDS` define the
  short AI request window. `AI_DAILY_LIMIT_PER_USER` is also enforced per user
  for each Asia/Shanghai calendar day before any model or tool call.

Accepted requests consume both their short-window and applicable long-window
allowance at admission time. Allowance is not refunded if later validation,
storage, an SMS provider, an AI tool, or the AI model fails. This fail-closed
accounting avoids retry storms and makes the concurrency rule deterministic.
Rejected responses use HTTP 429, a stable error code, and `Retry-After`.

Rate-limit audit messages contain only the policy name, retry interval, and a
truncated keyed fingerprint. They must never be augmented with passwords,
verification codes, bearer tokens, account names, or full phone numbers.

Set `TRUSTED_PROXY_IPS` to the exact comma-separated IP addresses of reverse
proxies that connect directly to the API. When the immediate peer is not on
that list, the API ignores `X-Forwarded-For`. Keep the setting empty when the
API is not behind a trusted proxy. Do not add broad client subnets or values
supplied by a request.

The legacy server has no shared database limiter implementation. Consequently,
`npm.cmd run start:legacy` refuses production configuration instead of exposing
the high-risk routes with process-local counters. Use the NestJS production
entry point after migrations have been applied.

## Session revocation and SMS verification

Apply the session-lifecycle migration before deploying the new API. It adds
`users.token_version` and the unique active-key constraint used by password
reset verification codes. Codes created before the migration are intentionally
revoked.

Every JWT contains the user's current session version. Password changes,
password resets, and account freezes increment that version in the same
database update as the protected state change. Old tokens then return HTTP 401
with `SESSION_REVOKED`; unfreezing an account does not restore them.

Only one verification code per user and purpose remains active. Issuing a new
code invalidates the previous code before contacting the SMS provider.
Consumption and failed-attempt increments use conditional atomic database
updates, so concurrent requests cannot reuse a code or lose attempt counts.
Reset callers must submit both the received code and a user-chosen
`newPassword`; no shared temporary password is generated or returned.

Keep `SMS_VERIFICATION_DEBUG=false` outside automated tests. The API refuses to
initialize when this setting is enabled unless `NODE_ENV=test`.

## Attachment upload isolation

Multipart attachment endpoints authenticate the caller and check the required
role before the request body is parsed. Accepted files are streamed to a
private temporary directory and removed after success, validation failure,
permission denial, or transaction failure.

Keep `ATTACHMENT_UPLOAD_TEMP_DIR` and `TRAVEL_GROUP_ATTACHMENT_DIR` outside every
web/static root, on storage accessible only to the API service account. They
must be separate, non-nested directories. Do not configure either path as a
filesystem root or under a directory named `public`, `static`, `www`,
`wwwroot`, or `htdocs`.

The safe defaults allow at most 10 MiB per file, five files, and 25 MiB of file
content per request. Deployments may lower these values through
`ATTACHMENT_UPLOAD_MAX_FILE_BYTES`, `ATTACHMENT_UPLOAD_MAX_FILES`, and
`ATTACHMENT_UPLOAD_MAX_REQUEST_BYTES`; the application refuses values above
the built-in safety caps or inconsistent combinations during startup.

## Public sales-sheet QR capabilities

Set `PUBLIC_SALES_SHEET_BASE_URL` to the exact public HTTPS origin (and optional
fixed path prefix) that serves the API. The value must be explicit, must not
contain credentials, query parameters, or a fragment, and must not point to
localhost or a private network. The API never derives public links from
`Host`, `X-Forwarded-Host`, or other request headers.

`PUBLIC_SALES_SHEET_DEFAULT_TTL_DAYS` defaults to 30 when omitted. Deployments
may lower it, but every generated token must expire and the built-in maximum is
90 days. QR bearer values are returned only by the generation response; the
database stores a SHA-256 lookup hash and operation logs store only its short
fingerprint. Configure the reverse proxy to suppress access logging for
`/api/public/sales-sheets/` or redact its final path segment, and never copy the
bearer value into query parameters. Do not add public-route paths, bearer
values, or query strings to application analytics.

Apply migration `20260720000300_public_sales_sheet_capabilities` before rollout.
Legacy QR codes without an expiry are revoked by the migration. Existing
time-limited QR codes keep their current expiry while their raw database value
is replaced by a hash. Operators can revoke a code with
`DELETE /api/sales-orders/:id/qr-code`; generating with
`{"regenerate":true}` rotates the capability and immediately invalidates the
old token.

## API errors, correlation IDs, and diagnostic logs

The API exposes detailed messages only for application errors created through
the shared business-error helper. Unknown exceptions never inherit a
`statusCode`, `code`, or `message` merely because an SDK or thrown object
contains those properties. Prisma unique, foreign-key, missing-record, and
transaction-conflict errors and common file-system failures use explicit,
stable mappings.

Every error response includes `X-Correlation-ID`. A caller-provided
`X-Correlation-ID` or `X-Request-ID` is accepted only when it is 1-64
characters and contains the configured safe identifier character set; all
other values are replaced with a random UUID. All 5xx responses use
`Unexpected server error.` and add the same identifier as the top-level
`requestId`. Their stable business code may remain specific, such as
`SMS_SEND_FAILED` or `AI_PROVIDER_REQUEST_FAILED`, but provider response bodies
and exception messages are never returned.

Application exception logs contain the correlation ID, method, a query-free
request path, the mapped code, and a recursively sanitized exception. The
sanitizer removes passwords, bearer and other tokens, authorization and cookie
values, secrets, verification codes, complete phone numbers, and addresses
from nested objects, arrays, causes, messages, and stacks. Do not configure the
process manager, reverse proxy, APM agent, or log shipper to independently dump
request bodies, authorization/cookie headers, query strings, SMS payloads, AI
provider bodies, or unredacted exception objects. Preserve
`X-Correlation-ID` through the reverse proxy so operators can locate the
sanitized server-side diagnostic event without asking users for sensitive
request data.

## Operation-log and AI-history retention

Apply migration `20260720000400_audit_data_minimization` before rollout. It
adds the internal `operation_logs.sanitization_summary` field, which records
only redacted field categories and truncation categories. It never stores the
removed values. Every operation-log writer, including the legacy JSON and
Prisma repositories, sanitizes `beforeData` and `afterData` immediately before
persistence. The sanitizer removes credentials and connection strings, masks
phone numbers and addresses, and bounds strings, arrays, object depth, object
keys, cycles, and total JSON size.

Set the following non-secret retention controls:

- `OPERATION_LOG_RETENTION_DAYS`: default `365`, allowed range `30`-`3650`.
- `AI_HISTORY_RETENTION_DAYS`: default `180`, allowed range `7`-`3650`.
- `RETENTION_CLEANUP_BATCH_SIZE`: default `500`, allowed range `1`-`1000`.

The API validates these values during module initialization. Operation-log
queries always paginate: `page` defaults to `1`, `pageSize` defaults to `50`,
and the server caps `pageSize` at `100`.

Before enabling deletion in a new environment, run the cleanup in its default
dry-run mode:

```powershell
npm.cmd run retention:cleanup
```

The output contains only the task ID, mode, cutoff timestamps, matched/deleted
counts, and batch counts. Review those counts, then explicitly enable deletion:

```powershell
npm.cmd run retention:cleanup -- --apply
```

Each target is deleted in bounded ID batches without one long transaction.
Rows exactly on the cutoff timestamp are retained. Re-running either mode is
safe, and dry-run never deletes records. The command does not print deleted
records, questions, audit payloads, user IDs, or other PII.

Run one cleanup job per environment rather than one job per API instance. A
daily cron entry with an overlap lock is sufficient; adapt paths to the
deployment and load environment variables through the service manager rather
than placing secrets in the crontab:

```cron
15 3 * * * cd /opt/jiangjiu/server/api && /usr/bin/flock -n /run/lock/jiangjiu-retention.lock /usr/bin/npm run retention:cleanup -- --apply >> /var/log/jiangjiu-retention.log 2>&1
```

Protect the cleanup log with the same access and rotation policy as API logs.
Alert when the command exits non-zero or when matched counts grow unexpectedly.
Do not modify the job to dump candidate IDs or record contents. AI questions
are minimized before model dispatch and history persistence; the original
question exists only in the in-memory authorization and internal lookup flow
for the current request.
