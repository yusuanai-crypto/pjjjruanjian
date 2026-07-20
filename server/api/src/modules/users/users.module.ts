import { forwardRef, Module } from '@nestjs/common';

import { RateLimitModule } from '../../common/rate-limit/rate-limit.module';
import { AuthModule } from '../auth/auth.module';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { SmsModule } from '../sms/sms.module';
import { UsersNestController } from './users.nest.controller';
import { UsersNestService } from './users.nest.service';

@Module({
  imports: [
    RateLimitModule,
    OperationLogsModule,
    SmsModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [UsersNestController],
  providers: [UsersNestService],
  exports: [UsersNestService],
})
export class UsersModule {}
