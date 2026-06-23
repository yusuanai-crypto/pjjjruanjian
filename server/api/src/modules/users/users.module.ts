import { forwardRef, Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { UsersNestController } from './users.nest.controller';
import { UsersNestService } from './users.nest.service';

@Module({
  imports: [OperationLogsModule, forwardRef(() => AuthModule)],
  controllers: [UsersNestController],
  providers: [UsersNestService],
  exports: [UsersNestService],
})
export class UsersModule {}
