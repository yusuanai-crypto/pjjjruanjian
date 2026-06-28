import { Module } from '@nestjs/common';

import { AuthModule } from './modules/auth/auth.module';
import { BusinessDataModule } from './modules/business-data/business-data.module';
import { GuidesModule } from './modules/guides/guides.module';
import { OperationLogNestController } from './modules/operation-logs/operation-log.nest.controller';
import { OperationLogsModule } from './modules/operation-logs/operation-logs.module';
import { PreparationConfirmationNestController } from './modules/preparation-confirmation/preparation-confirmation.nest.controller';
import { SettingsModule } from './modules/settings/settings.module';
import { UsersModule } from './modules/users/users.module';
import { PrismaModule } from './prisma/prisma.module';
import {
  PREPARATION_CONFIRMATION_SERVICE,
} from './modules/legacy/legacy.tokens';

const {
  createPreparationConfirmationService,
} = require('./modules/preparation-confirmation/preparation-confirmation.service');

@Module({
  imports: [PrismaModule, OperationLogsModule, UsersModule, AuthModule, SettingsModule, BusinessDataModule, GuidesModule],
  controllers: [
    OperationLogNestController,
    PreparationConfirmationNestController,
  ],
  providers: [
    {
      provide: PREPARATION_CONFIRMATION_SERVICE,
      useFactory: () => createPreparationConfirmationService(),
    },
  ],
})
export class AppModule {}
