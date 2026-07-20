import { Module } from '@nestjs/common';

import { AiModule } from './modules/ai/ai.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AuthModule } from './modules/auth/auth.module';
import { BusinessDataModule } from './modules/business-data/business-data.module';
import { CommissionRulesModule } from './modules/commission-rules/commission-rules.module';
import { CommissionsModule } from './modules/commissions/commissions.module';
import { CustomersModule } from './modules/customers/customers.module';
import { GuidesModule } from './modules/guides/guides.module';
import { OperationLogNestController } from './modules/operation-logs/operation-log.nest.controller';
import { OperationLogsModule } from './modules/operation-logs/operation-logs.module';
import { PreparationConfirmationModule } from './modules/preparation-confirmation/preparation-confirmation.module';
import { ProductsModule } from './modules/products/products.module';
import { SettingsModule } from './modules/settings/settings.module';
import { TravelAgenciesModule } from './modules/travel-agencies/travel-agencies.module';
import { UsersModule } from './modules/users/users.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    OperationLogsModule,
    UsersModule,
    AuthModule,
    PreparationConfirmationModule,
    SettingsModule,
    AiModule,
    BusinessDataModule,
    AnalyticsModule,
    CommissionRulesModule,
    CommissionsModule,
    CustomersModule,
    GuidesModule,
    ProductsModule,
    TravelAgenciesModule,
  ],
  controllers: [OperationLogNestController],
})
export class AppModule {}
