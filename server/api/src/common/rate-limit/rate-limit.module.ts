import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { RateLimitService } from './rate-limit.service';
import {
  RATE_LIMIT_CLOCK,
  RATE_LIMIT_CONFIG,
  RATE_LIMIT_STORE,
} from './rate-limit.tokens';

const {
  MemoryRateLimitStore,
  PrismaRateLimitStore,
  readRateLimitConfig,
} = require('./rate-limit');

@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: RATE_LIMIT_CLOCK,
      useValue: {
        now: () => Date.now(),
      },
    },
    {
      provide: RATE_LIMIT_CONFIG,
      useFactory: () => readRateLimitConfig(process.env),
    },
    {
      provide: RATE_LIMIT_STORE,
      inject: [PrismaService, RATE_LIMIT_CONFIG],
      useFactory: (prisma: PrismaService, config: any) =>
        config.storeMode === 'database'
          ? new PrismaRateLimitStore(prisma)
          : new MemoryRateLimitStore(),
    },
    RateLimitService,
  ],
  exports: [
    RATE_LIMIT_CLOCK,
    RATE_LIMIT_CONFIG,
    RATE_LIMIT_STORE,
    RateLimitService,
  ],
})
export class RateLimitModule {}
