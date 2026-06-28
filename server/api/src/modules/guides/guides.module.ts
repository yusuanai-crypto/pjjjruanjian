import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { GuidesNestController } from './guides.nest.controller';
import { GuidesNestService } from './guides.nest.service';

@Module({
  imports: [AuthModule, OperationLogsModule],
  controllers: [GuidesNestController],
  providers: [GuidesNestService],
})
export class GuidesModule {}
