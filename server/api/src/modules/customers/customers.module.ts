import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { SettingsModule } from '../settings/settings.module';
import { CustomersNestController } from './customers.nest.controller';
import { CustomersNestService } from './customers.nest.service';

@Module({
  imports: [AuthModule, OperationLogsModule, SettingsModule],
  controllers: [CustomersNestController],
  providers: [CustomersNestService],
  exports: [CustomersNestService],
})
export class CustomersModule {}
