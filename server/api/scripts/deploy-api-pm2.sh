#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PM2_APP_NAME="${PM2_APP_NAME:-jiangjiu-api}"

cd "$API_DIR"

if [[ "${API_DATABASE_BACKUP_CONFIRMED:-}" != "1" ]]; then
  echo "Refusing deployment: confirm the target database and backup first by setting API_DATABASE_BACKUP_CONFIRMED=1." >&2
  exit 64
fi

if [[ ! -f .env ]]; then
  echo "Refusing deployment: $API_DIR/.env is missing." >&2
  exit 65
fi

# A non-zero exit from generate, build, or migrate deploy stops this script
# before PM2 can start or restart the new API process.
npm run prisma:generate
npm run build
test -f dist/main.js
test -f prisma/migrations/20260729000200_special_orders_workflow/migration.sql
test -f prisma/migrations/20260729000400_partial_personal_points_split/migration.sql
npm run prisma:migrate:deploy
npx prisma migrate status
npm run verify:guide-points-schema
npm run verify:commission-schema

if pm2 describe "$PM2_APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_APP_NAME" --update-env
else
  pm2 start node --name "$PM2_APP_NAME" -- -r dotenv/config dist/main.js
fi

pm2 status "$PM2_APP_NAME"
