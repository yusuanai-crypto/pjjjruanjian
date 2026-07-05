import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CommissionsModule } from '../commissions/commissions.module';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { SettingsModule } from '../settings/settings.module';
import { BusinessDataNestService } from './business-data.nest.service';
import { AfterSalesOrdersNestController } from './after-sales-orders.nest.controller';
import {
  FinanceNestController,
  ReconciliationsNestController,
  StrikeBonusAwardsNestController,
} from './finance.nest.controller';
import { PublicSalesSheetsNestController } from './public-sales-sheets.nest.controller';
import { SalesOrdersNestController } from './sales-orders.nest.controller';
import { WarehouseOrdersNestController } from './warehouse-orders.nest.controller';
import {
  GuideCarriedGroupsNestController,
  PendingTravelGroupsNestController,
  TravelGroupsNestController,
} from './travel-groups.nest.controller';

@Module({
  imports: [AuthModule, OperationLogsModule, SettingsModule, CommissionsModule],
  controllers: [
    TravelGroupsNestController,
    GuideCarriedGroupsNestController,
    PendingTravelGroupsNestController,
    PublicSalesSheetsNestController,
    SalesOrdersNestController,
    AfterSalesOrdersNestController,
    WarehouseOrdersNestController,
    FinanceNestController,
    ReconciliationsNestController,
    StrikeBonusAwardsNestController,
  ],
  providers: [BusinessDataNestService],
  exports: [BusinessDataNestService],
})
export class BusinessDataModule {}
