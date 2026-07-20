import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

import { executeRetentionCleanup } from '../src/common/data-retention/retention-cleanup.service';

async function main() {
  const args = process.argv.slice(2);
  const unknownArgs = args.filter(
    (argument) => argument !== '--apply' && argument !== '--dry-run',
  );
  if (unknownArgs.length > 0 || (args.includes('--apply') && args.includes('--dry-run'))) {
    throw new Error('Use either --dry-run or --apply.');
  }

  const prisma = new PrismaClient();
  try {
    const result = await executeRetentionCleanup(prisma, {
      apply: args.includes('--apply'),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: any) => {
  process.stderr.write(
    `${JSON.stringify({
      code:
        typeof error?.code === 'string'
          ? error.code
          : 'RETENTION_CLEANUP_FAILED',
      message:
        typeof error?.message === 'string' &&
        error.message.startsWith('Use either')
          ? error.message
          : 'Retention cleanup failed.',
    })}\n`,
  );
  process.exitCode = 1;
});
