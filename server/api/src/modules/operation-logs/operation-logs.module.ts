import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { RetentionCleanupService } from '../../common/data-retention/retention-cleanup.service';
import { AuditContextService } from './audit-context.service';
import { AuditInterceptor } from './audit.interceptor';
import { OperationLogsNestService } from './operation-log.nest.service';

@Module({
  providers: [
    AuditContextService,
    OperationLogsNestService,
    RetentionCleanupService,
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
  exports: [
    AuditContextService,
    OperationLogsNestService,
    RetentionCleanupService,
  ],
})
export class OperationLogsModule {}
