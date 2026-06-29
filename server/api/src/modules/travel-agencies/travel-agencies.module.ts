import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { TravelAgenciesNestController } from './travel-agencies.nest.controller';
import { TravelAgenciesNestService } from './travel-agencies.nest.service';

@Module({
  imports: [AuthModule, OperationLogsModule],
  controllers: [TravelAgenciesNestController],
  providers: [TravelAgenciesNestService],
})
export class TravelAgenciesModule {}
