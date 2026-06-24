import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { SettingsModule } from '../settings/settings.module';
import { BusinessDataNestService } from './business-data.nest.service';
import {
  FinanceNestController,
  ReconciliationsNestController,
  StrikeBonusAwardsNestController,
} from './finance.nest.controller';
import { SalesOrdersNestController } from './sales-orders.nest.controller';
import {
  GuideCarriedGroupsNestController,
  PendingTravelGroupsNestController,
  TravelGroupsNestController,
} from './travel-groups.nest.controller';

@Module({
  imports: [AuthModule, OperationLogsModule, SettingsModule],
  controllers: [
    TravelGroupsNestController,
    GuideCarriedGroupsNestController,
    PendingTravelGroupsNestController,
    SalesOrdersNestController,
    FinanceNestController,
    ReconciliationsNestController,
    StrikeBonusAwardsNestController,
  ],
  providers: [BusinessDataNestService],
})
export class BusinessDataModule {}
