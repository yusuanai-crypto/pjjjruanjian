import { Module } from '@nestjs/common';

import { OperationLogsNestService } from './operation-log.nest.service';

@Module({
  providers: [OperationLogsNestService],
  exports: [OperationLogsNestService],
})
export class OperationLogsModule {}
