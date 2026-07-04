import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { SettingsModule } from '../settings/settings.module';
import { AnalyticsNestController } from './analytics.nest.controller';
import { AnalyticsNestService } from './analytics.nest.service';

@Module({
  imports: [AuthModule, OperationLogsModule, SettingsModule],
  controllers: [AnalyticsNestController],
  providers: [AnalyticsNestService],
  exports: [AnalyticsNestService],
})
export class AnalyticsModule {}
