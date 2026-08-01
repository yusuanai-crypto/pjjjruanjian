import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { SettingsModule } from '../settings/settings.module';
import { AgencyRuleRecalculationNestService } from './agency-rule-recalculation.nest.service';
import { CommissionRecordsNestController } from './commission-records.nest.controller';
import { CommissionRecordsNestService } from './commission-records.nest.service';
import { EmployeeCommissionRuleRecalculationNestService } from './employee-commission-rule-recalculation.nest.service';
import { GuidePointsSummariesNestController } from './guide-points-summaries.nest.controller';
import { GuidePointsSummaryNestService } from './guide-points-summary.nest.service';
import { SpecialOrderCommissionService } from './special-order-commission.service';
import { TravelGroupFinanceSummariesNestController } from './travel-group-finance-summaries.nest.controller';
import { TravelGroupFinanceSummaryNestService } from './travel-group-finance-summary.nest.service';

@Module({
  imports: [AuthModule, OperationLogsModule, SettingsModule],
  controllers: [
    CommissionRecordsNestController,
    TravelGroupFinanceSummariesNestController,
    GuidePointsSummariesNestController,
  ],
  providers: [
    CommissionRecordsNestService,
    TravelGroupFinanceSummaryNestService,
    AgencyRuleRecalculationNestService,
    EmployeeCommissionRuleRecalculationNestService,
    GuidePointsSummaryNestService,
    SpecialOrderCommissionService,
  ],
  exports: [
    CommissionRecordsNestService,
    TravelGroupFinanceSummaryNestService,
    AgencyRuleRecalculationNestService,
    EmployeeCommissionRuleRecalculationNestService,
    GuidePointsSummaryNestService,
    SpecialOrderCommissionService,
  ],
})
export class CommissionsModule {}
