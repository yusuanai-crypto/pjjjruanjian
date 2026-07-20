import { Module } from '@nestjs/common';

import { RateLimitModule } from '../../common/rate-limit/rate-limit.module';
import { AuthModule } from '../auth/auth.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { BusinessDataModule } from '../business-data/business-data.module';
import { CommissionsModule } from '../commissions/commissions.module';
import { CustomersModule } from '../customers/customers.module';
import { SettingsModule } from '../settings/settings.module';
import { AiChatService } from './ai-chat.service';
import { AiConfigService } from './ai-config';
import { AiCapabilitiesController, AiController } from './ai.controller';
import { AiIntentService } from './ai-intent.service';
import { AiModelClient } from './ai-model.client';
import { AiPolicyService } from './ai-policy.service';
import { AiPromptBuilder } from './ai-prompt.builder';
import { AiResponseFormatter } from './ai-response.formatter';
import { AiTemplatesService } from './ai-templates.service';
import { AiToolsService } from './ai-tools.service';

@Module({
  imports: [
    RateLimitModule,
    AuthModule,
    AnalyticsModule,
    BusinessDataModule,
    CommissionsModule,
    CustomersModule,
    SettingsModule,
  ],
  controllers: [AiController, AiCapabilitiesController],
  providers: [
    AiChatService,
    AiConfigService,
    AiIntentService,
    AiModelClient,
    AiPolicyService,
    AiPromptBuilder,
    AiResponseFormatter,
    AiTemplatesService,
    AiToolsService,
  ],
  exports: [
    AiChatService,
    AiConfigService,
    AiIntentService,
    AiModelClient,
    AiPolicyService,
    AiPromptBuilder,
    AiResponseFormatter,
    AiTemplatesService,
    AiToolsService,
  ],
})
export class AiModule {}
