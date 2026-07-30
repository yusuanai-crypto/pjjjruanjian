import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CommissionsModule } from '../commissions/commissions.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { SpecialOrderInventoryService } from './special-order-inventory.service';
import { SpecialOrdersNestController } from './special-orders.nest.controller';
import { SpecialOrdersNestService } from './special-orders.nest.service';

@Module({
  imports: [
    AuthModule,
    CommissionsModule,
    InventoryModule,
    OperationLogsModule,
  ],
  controllers: [SpecialOrdersNestController],
  providers: [
    SpecialOrdersNestService,
    SpecialOrderInventoryService,
  ],
  exports: [SpecialOrdersNestService],
})
export class SpecialOrdersModule {}
