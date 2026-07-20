import { forwardRef, Module } from '@nestjs/common';

import { RateLimitModule } from '../../common/rate-limit/rate-limit.module';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { UsersModule } from '../users/users.module';
import { AuthNestController } from './auth.nest.controller';
import { AuthNestService } from './auth.nest.service';

@Module({
  imports: [
    RateLimitModule,
    forwardRef(() => UsersModule),
    OperationLogsModule,
  ],
  controllers: [AuthNestController],
  providers: [AuthNestService],
  exports: [AuthNestService],
})
export class AuthModule {}
