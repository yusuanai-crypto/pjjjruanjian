import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { TodoRemindersModule } from '../todo-reminders/todo-reminders.module';
import { InventoryAccountingService } from './inventory-accounting.service';
import { InventoryNestController } from './inventory.nest.controller';
import {
  InventoryPostCommitProjector,
  InventoryPostCommitService,
} from './inventory-post-commit.service';
import { InventoryPrismaRepository } from './inventory.prisma.repository';
import { InventoryQueryPrismaRepository } from './inventory-query.prisma.repository';
import { InventoryQueryService } from './inventory-query.service';
import { InventoryReportService } from './inventory-report.service';
import { InventoryStocktakeService } from './inventory-stocktake.service';
import { SalesOrderInventoryService } from './sales-order-inventory.service';
import { SerializedInventoryAccountingAdapter } from './serialized-inventory-accounting.adapter';
import { AfterSalesInventoryService } from './after-sales-inventory.service';

@Module({
  imports: [AuthModule, OperationLogsModule, TodoRemindersModule],
  controllers: [InventoryNestController],
  providers: [
    InventoryPrismaRepository,
    InventoryQueryPrismaRepository,
    InventoryAccountingService,
    InventoryQueryService,
    InventoryReportService,
    InventoryStocktakeService,
    InventoryPostCommitProjector,
    InventoryPostCommitService,
    SalesOrderInventoryService,
    SerializedInventoryAccountingAdapter,
    AfterSalesInventoryService,
  ],
  exports: [
    InventoryAccountingService,
    InventoryQueryService,
    InventoryReportService,
    InventoryStocktakeService,
    SalesOrderInventoryService,
    SerializedInventoryAccountingAdapter,
    AfterSalesInventoryService,
  ],
})
export class InventoryModule {}
