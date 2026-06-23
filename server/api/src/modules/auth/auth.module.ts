import { forwardRef, Module } from '@nestjs/common';

import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { UsersModule } from '../users/users.module';
import { AuthNestController } from './auth.nest.controller';
import { AuthNestService } from './auth.nest.service';

@Module({
  imports: [forwardRef(() => UsersModule), OperationLogsModule],
  controllers: [AuthNestController],
  providers: [AuthNestService],
  exports: [AuthNestService],
})
export class AuthModule {}
