import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { CommissionsModule } from '../commissions/commissions.module';
import {
  AgencyDeductionRulesNestController,
  AgencyRebateRulesNestController,
  CommissionRulesNestController,
  SalesDeductionRulesNestController,
} from './commission-rules.nest.controller';
import { CommissionRulesNestService } from './commission-rules.nest.service';

@Module({
  imports: [AuthModule, OperationLogsModule, CommissionsModule],
  controllers: [
    CommissionRulesNestController,
    SalesDeductionRulesNestController,
    AgencyDeductionRulesNestController,
    AgencyRebateRulesNestController,
  ],
  providers: [CommissionRulesNestService],
})
export class CommissionRulesModule {}
