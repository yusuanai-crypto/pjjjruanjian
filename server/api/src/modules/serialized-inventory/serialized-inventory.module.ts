import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { SerializedInventoryNestController } from './serialized-inventory.nest.controller';
import { SerializedInventoryNestService } from './serialized-inventory.nest.service';

@Module({
  imports: [AuthModule, OperationLogsModule],
  controllers: [SerializedInventoryNestController],
  providers: [SerializedInventoryNestService],
  exports: [SerializedInventoryNestService],
})
export class SerializedInventoryModule {}
