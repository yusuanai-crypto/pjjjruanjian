# Audit route coverage

Inventory date: 2026-07-25.

The NestJS controller inventory contains 21 controllers and 166 HTTP route
handlers. `AuditInterceptor` covers every non-public handler at the request
boundary. It records route templates, safe filter summaries, result, status,
duration and request ID. Existing explicit `appendLog()` calls remain the
source of object IDs and before/after/delete snapshots; the request audit
context supplies the common fields and suppresses a duplicate request-level
write log.

| Controller/module | Routes | Coverage |
| --- | ---: | --- |
| auth | 6 | interceptor plus explicit login, refresh, logout and password-change logs |
| users | 11 | interceptor plus explicit account, role, status and reset logs |
| customers | 5 | interceptor plus explicit create/update snapshots |
| guides | 6 | interceptor plus explicit lifecycle snapshots |
| products | 10 | interceptor plus explicit product/cost status snapshots |
| serialized inventory | 7 | interceptor plus explicit import/export and inventory snapshots |
| sales orders | 13 | interceptor plus explicit business writes, exports and QR lifecycle |
| travel groups | 20 | interceptor plus explicit writes, exports, attachment upload/download/delete |
| after-sales orders | 9 | interceptor plus explicit update/status/review snapshots |
| warehouse | 2 | interceptor plus explicit packing/status writes |
| finance | 10 | interceptor plus explicit finance/status writes |
| commission records | 7 | interceptor plus explicit recalculate/confirm/export logs |
| travel-group finance summaries | 9 | interceptor plus explicit confirm/status/export logs |
| commission rules | 19 | interceptor plus explicit CRUD/import snapshots |
| travel agencies | 3 | interceptor plus explicit create/update snapshots |
| analytics | 14 | interceptor plus explicit export logs |
| AI | 4 | interceptor; query summaries never contain the raw question or response |
| settings | 3 | interceptor plus explicit setting/status snapshots |
| preparation confirmation | 3 | interceptor plus explicit status snapshots |
| operation logs | 4 | read/detail/options request logs and explicit export log |
| public sales sheet | 1 | intentionally excluded public anonymous route |

Authentication and authorization failures happen before normal interceptor
execution on guarded controllers, so `AuthUserGuard` and `RolesGuard` record
those failures explicitly. `/api/public/*`, health checks and static assets are
the only request-level exclusions. Scheduled jobs and internal service reads
are not audited as user CRUD.

The route inventory can be refreshed with:

```powershell
rg -l "@(Get|Post|Put|Patch|Delete)\(" server/api/src --glob "*.controller.ts" --glob "*.nest.controller.ts"
rg -n "appendLog\(" server/api/src
```
