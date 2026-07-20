import { Inject, Injectable } from '@nestjs/common';

import {
  RATE_LIMIT_CLOCK,
  RATE_LIMIT_CONFIG,
  RATE_LIMIT_STORE,
} from './rate-limit.tokens';

const { SecurityRateLimiter } = require('./rate-limit');

@Injectable()
export class RateLimitService {
  private readonly limiter: any;

  constructor(
    @Inject(RATE_LIMIT_STORE) store: any,
    @Inject(RATE_LIMIT_CLOCK) clock: any,
    @Inject(RATE_LIMIT_CONFIG) config: any,
  ) {
    this.limiter = new SecurityRateLimiter({
      store,
      clock,
      config,
      fingerprintSecret: config.fingerprintSecret,
    });
  }

  enforceLogin(input: { ipAddress?: string | null; username: string }) {
    return this.limiter.enforceLogin(input);
  }

  enforceSmsCode(input: {
    actorId: string;
    targetUserId: string;
    phone: string;
  }) {
    return this.limiter.enforceSmsCode(input);
  }

  enforcePasswordReset(input: {
    actorId: string;
    targetUserId: string;
  }) {
    return this.limiter.enforcePasswordReset(input);
  }

  enforceAi(input: { userId: string; dailyLimit: number }) {
    return this.limiter.enforceAi(input);
  }
}
