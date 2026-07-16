import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import {
  ProductActualCostsNestController,
  ProductsNestController,
} from './products.nest.controller';
import { ProductsNestService } from './products.nest.service';

@Module({
  imports: [AuthModule, OperationLogsModule],
  controllers: [ProductsNestController, ProductActualCostsNestController],
  providers: [ProductsNestService],
})
export class ProductsModule {}
