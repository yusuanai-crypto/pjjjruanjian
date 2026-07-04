import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { SettingsModule } from '../settings/settings.module';
import { CommissionRecordsNestController } from './commission-records.nest.controller';
import { CommissionRecordsNestService } from './commission-records.nest.service';
import { TravelGroupFinanceSummariesNestController } from './travel-group-finance-summaries.nest.controller';
import { TravelGroupFinanceSummaryNestService } from './travel-group-finance-summary.nest.service';

@Module({
  imports: [AuthModule, OperationLogsModule, SettingsModule],
  controllers: [
    CommissionRecordsNestController,
    TravelGroupFinanceSummariesNestController,
  ],
  providers: [CommissionRecordsNestService, TravelGroupFinanceSummaryNestService],
  exports: [CommissionRecordsNestService, TravelGroupFinanceSummaryNestService],
})
export class CommissionsModule {}
