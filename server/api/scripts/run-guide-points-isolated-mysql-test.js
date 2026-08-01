const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const { PrismaClient } = require('@prisma/client');

const apiDirectory = path.resolve(__dirname, '..');
const temporaryRoot = path.join(apiDirectory, '.tmp');

async function main() {
  const schemaPushOnly = process.argv.includes('--schema-push');
  const mysqldPath = resolveMysqldPath();
  const mysqlBaseDirectory = path.dirname(path.dirname(mysqldPath));
  const mysqlAdminPath = path.join(
    path.dirname(mysqldPath),
    'mysqladmin.exe',
  );
  runNpm(['run', 'prisma:generate'], {
    DATABASE_URL: 'mysql://root@127.0.0.1:1/isolated_generation_only',
  });
  const instanceName = `guide-points-mysql-${crypto.randomUUID()}`;
  const dataDirectory = path.join(temporaryRoot, instanceName);
  assertTemporaryDataDirectory(dataDirectory, instanceName);
  fs.mkdirSync(dataDirectory, { recursive: true });

  let server;
  try {
    run(
      mysqldPath,
      [
        '--no-defaults',
        '--initialize-insecure',
        `--basedir=${mysqlBaseDirectory}`,
        `--datadir=${dataDirectory}`,
      ],
      {},
    );

    const port = await findFreePort();
    const errorLogPath = path.join(dataDirectory, 'isolated-mysql.err');
    server = spawn(
      mysqldPath,
      [
        '--no-defaults',
        `--basedir=${mysqlBaseDirectory}`,
        `--datadir=${dataDirectory}`,
        `--port=${port}`,
        '--bind-address=127.0.0.1',
        '--mysqlx=0',
        '--skip-log-bin',
        `--pid-file=${path.join(dataDirectory, 'isolated-mysql.pid')}`,
        `--log-error=${errorLogPath}`,
      ],
      {
        cwd: apiDirectory,
        stdio: 'ignore',
        windowsHide: true,
      },
    );

    const administrationUrl = `mysql://root@127.0.0.1:${port}/mysql`;
    const administration = await waitForMysql(
      administrationUrl,
      server,
      errorLogPath,
    );
    try {
      const versionRows = await administration.$queryRawUnsafe(
        'SELECT VERSION() AS version',
      );
      const version = String(versionRows[0].version);
      if (!version.startsWith('8.')) {
        throw new Error('The isolated verification requires MySQL 8.x.');
      }

      const databaseName = `jiangjiu_points_it_${crypto
        .randomUUID()
        .replaceAll('-', '')}`;
      assertTemporaryDatabaseName(databaseName);
      await administration.$executeRawUnsafe(
        `CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
      );
      const isolatedUrl = new URL(administrationUrl);
      isolatedUrl.pathname = `/${databaseName}`;
      console.log(`Started isolated MySQL ${version.split('-')[0]} instance.`);

      if (schemaPushOnly) {
        console.log(
          'Applying the current Prisma schema for functional transaction verification only.',
        );
        runNpm(['exec', '--', 'prisma', 'db', 'push', '--skip-generate'], {
          DATABASE_URL: isolatedUrl.toString(),
        });
      } else {
        runNpm(['run', 'prisma:migrate:deploy'], {
          DATABASE_URL: isolatedUrl.toString(),
        });
      }
      run(
        process.execPath,
        [
          '--test',
          '--require',
          'ts-node/register',
          'test/guide-personal-points.mysql.test.js',
        ],
        {
          DATABASE_URL: isolatedUrl.toString(),
          GUIDE_POINTS_TEST_DATABASE_URL: isolatedUrl.toString(),
          GUIDE_POINTS_ISOLATED_DATABASE_CONFIRMED: '1',
          GUIDE_POINTS_EXPECT_MIGRATION_HISTORY: schemaPushOnly ? '0' : '1',
        },
      );
    } finally {
      await administration.$disconnect();
    }
  } finally {
    if (server) {
      await stopMysql(server, mysqlAdminPath);
    }
    assertTemporaryDataDirectory(dataDirectory, instanceName);
    await removeTemporaryDirectory(dataDirectory);
    console.log('Removed isolated MySQL data directory.');
  }
}

function runNpm(args, additionalEnvironment) {
  const npmCliPath = process.env.npm_execpath;
  if (!npmCliPath || !fs.existsSync(npmCliPath)) {
    throw new Error(
      'npm_execpath is required; run this verifier through its npm script.',
    );
  }
  run(process.execPath, [npmCliPath, ...args], additionalEnvironment);
}

function run(command, args, additionalEnvironment) {
  const result = spawnSync(command, args, {
    cwd: apiDirectory,
    env: { ...process.env, ...additionalEnvironment },
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} exited with status ${result.status}.`);
  }
}

function resolveMysqldPath() {
  const candidates = [
    process.env.MYSQLD_PATH,
    'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqld.exe',
  ].filter(Boolean);
  const resolved = candidates.find((candidate) => fs.existsSync(candidate));
  if (!resolved) {
    throw new Error(
      'MySQL 8.0 server binary was not found; set MYSQLD_PATH explicitly.',
    );
  }
  return path.resolve(resolved);
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.unref();
    socket.on('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address();
      socket.close(() => resolve(address.port));
    });
  });
}

async function waitForMysql(databaseUrl, server, errorLogPath) {
  const deadline = Date.now() + 30000;
  let lastError;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(
        `The isolated MySQL server exited before startup (see ${errorLogPath}).`,
      );
    }
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
    try {
      await prisma.$queryRawUnsafe('SELECT 1');
      return prisma;
    } catch (error) {
      lastError = error;
      await prisma.$disconnect();
      await delay(200);
    }
  }
  throw new Error(
    `The isolated MySQL server did not become ready (see ${errorLogPath}; ${
      lastError?.code || 'startup timeout'
    }).`,
  );
}

async function stopMysql(server, mysqlAdminPath) {
  if (server.exitCode !== null) {
    return;
  }
  const portArgument = server.spawnargs.find((argument) =>
    argument.startsWith('--port='),
  );
  if (fs.existsSync(mysqlAdminPath) && portArgument) {
    spawnSync(
      mysqlAdminPath,
      [
        '--no-defaults',
        '--protocol=TCP',
        '--host=127.0.0.1',
        portArgument,
        '--user=root',
        'shutdown',
      ],
      { stdio: 'ignore', windowsHide: true },
    );
  }
  const exited = await Promise.race([
    new Promise((resolve) => server.once('exit', () => resolve(true))),
    delay(5000).then(() => false),
  ]);
  if (!exited && server.exitCode === null) {
    server.kill('SIGKILL');
    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      delay(5000),
    ]);
  }
}

async function removeTemporaryDirectory(dataDirectory) {
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.rmSync(dataDirectory, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }
  throw lastError;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assertTemporaryDatabaseName(databaseName) {
  if (!/^jiangjiu_points_it_[a-f0-9]{32}$/.test(databaseName)) {
    throw new Error('Unsafe temporary database name.');
  }
}

function assertTemporaryDataDirectory(dataDirectory, instanceName) {
  if (!/^guide-points-mysql-[a-f0-9-]{36}$/.test(instanceName)) {
    throw new Error('Unsafe temporary MySQL instance name.');
  }
  const expected = path.resolve(temporaryRoot, instanceName);
  if (path.resolve(dataDirectory) !== expected) {
    throw new Error('Unsafe temporary MySQL data directory.');
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
