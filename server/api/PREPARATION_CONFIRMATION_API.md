# Preparation confirmation API

The preparation-confirmation API manages deployment and system-configuration
checklist state. It is not a public API.

Every request must include an authenticated administrator token:

```http
Authorization: Bearer <token>
```

Only users with the `super_admin` or `admin` role may read or update the
checklist. Missing or invalid authentication returns `401`. An authenticated
user without an administrator role receives `403`; the response does not
include checklist content.

Protected endpoints:

- `GET /api/preparation-confirmation/items`
- `GET /api/preparation-confirmation/summary`
- `PUT /api/preparation-confirmation/items/:id`

The `start:legacy` server applies the same authentication and authorization
checks to these paths. It does not expose an unauthenticated compatibility
route.

Write requests continue to use the existing item, status, confirmation, and
evidence-field validation contracts after authorization succeeds.
