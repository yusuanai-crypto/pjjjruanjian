const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('PM2 deployment gates restart on backup, Prisma generation, build, and migrations', () => {
  const script = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'deploy-api-pm2.sh'),
    'utf8',
  );
  const backupGate = script.indexOf('API_DATABASE_BACKUP_CONFIRMED');
  const generate = script.indexOf('npm run prisma:generate');
  const build = script.indexOf('npm run build');
  const migrate = script.indexOf('npm run prisma:migrate:deploy');
  const migrateStatus = script.indexOf('npx prisma migrate status');
  const guideSchema = script.indexOf('npm run verify:guide-points-schema');
  const restart = script.indexOf('pm2 restart');
  const start = script.indexOf('pm2 start');

  for (const [name, position] of Object.entries({
    backupGate,
    generate,
    build,
    migrate,
    migrateStatus,
    guideSchema,
    restart,
    start,
  })) {
    assert.notEqual(position, -1, `missing deployment step: ${name}`);
  }
  assert.ok(backupGate < generate);
  assert.ok(generate < build);
  assert.ok(build < migrate);
  assert.ok(migrate < migrateStatus);
  assert.ok(migrateStatus < guideSchema);
  assert.ok(guideSchema < restart);
  assert.ok(guideSchema < start);
  assert.match(
    script,
    /20260729000400_partial_personal_points_split\/migration\.sql/,
  );
  assert.doesNotMatch(script, /prisma:seed/);
});
