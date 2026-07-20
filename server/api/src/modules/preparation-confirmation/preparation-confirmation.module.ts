import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PREPARATION_CONFIRMATION_SERVICE } from '../legacy/legacy.tokens';
import { PreparationConfirmationNestController } from './preparation-confirmation.nest.controller';

const {
  createPreparationConfirmationService,
} = require('./preparation-confirmation.service');

@Module({
  imports: [AuthModule],
  controllers: [PreparationConfirmationNestController],
  providers: [
    {
      provide: PREPARATION_CONFIRMATION_SERVICE,
      useFactory: () => createPreparationConfirmationService(),
    },
  ],
})
export class PreparationConfirmationModule {}
