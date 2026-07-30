import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { PaymentMethodsNestController } from './payment-methods.nest.controller';
import { PaymentMethodsNestService } from './payment-methods.nest.service';

@Module({
  imports: [AuthModule, OperationLogsModule],
  controllers: [PaymentMethodsNestController],
  providers: [PaymentMethodsNestService],
  exports: [PaymentMethodsNestService],
})
export class PaymentMethodsModule {}
