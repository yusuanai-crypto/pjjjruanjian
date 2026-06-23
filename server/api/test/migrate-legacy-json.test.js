const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('legacy JSON migration dry-run skips missing source files without failing', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jiangjiu-missing-legacy-json-'));
  const result = spawnSync(
    process.execPath,
    ['scripts/migrate-legacy-json.js', '--dry-run', '--data-dir', dataDir],
    {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /DRY RUN - no database writes/);
  assert.match(result.stdout, /users: imported=0, skipped=1, failed=0/);
  assert.match(result.stdout, /systemSettings: imported=0, skipped=1, failed=0/);
  assert.match(result.stdout, /operationLogs: imported=0, skipped=1, failed=0/);
  assert.match(result.stdout, /SKIP users\.json: File not found/);
  assert.match(result.stdout, /SKIP system-settings\.json: File not found/);
  assert.match(result.stdout, /SKIP operation-logs\.json: File not found/);
  assert.doesNotMatch(result.stdout, /ERROR .*File not found/);
});
