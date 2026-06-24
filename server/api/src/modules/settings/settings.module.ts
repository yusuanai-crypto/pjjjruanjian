import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { SettingsNestController } from './settings.nest.controller';
import { SettingsNestService } from './settings.nest.service';

@Module({
  imports: [AuthModule, OperationLogsModule],
  controllers: [SettingsNestController],
  providers: [SettingsNestService],
  exports: [SettingsNestService],
})
export class SettingsModule {}
