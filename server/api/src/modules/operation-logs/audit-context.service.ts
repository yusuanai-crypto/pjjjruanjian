import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface AuditRequestContext {
  requestId: string;
  startedAtMs: number;
  httpMethod: string;
  requestPath: string;
  ipAddress: string | null;
  userAgent: string | null;
  requestSummary: Record<string, unknown> | null;
  actor: any | null;
  explicitLogCount: number;
  explicitActions: Set<string>;
}

@Injectable()
export class AuditContextService {
  private readonly storage = new AsyncLocalStorage<AuditRequestContext>();

  run<T>(context: AuditRequestContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  current(): AuditRequestContext | undefined {
    return this.storage.getStore();
  }

  setActor(actor: any) {
    const context = this.current();
    if (context) {
      context.actor = actor || null;
    }
  }

  markExplicitLog(action?: string) {
    const context = this.current();
    if (context) {
      context.explicitLogCount += 1;
      if (action) {
        context.explicitActions.add(action);
      }
    }
  }
}
