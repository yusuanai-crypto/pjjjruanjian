import { Module } from '@nestjs/common';

import { RetentionCleanupService } from '../../common/data-retention/retention-cleanup.service';
import { OperationLogsNestService } from './operation-log.nest.service';

@Module({
  providers: [OperationLogsNestService, RetentionCleanupService],
  exports: [OperationLogsNestService, RetentionCleanupService],
})
export class OperationLogsModule {}
