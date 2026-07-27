import { Injectable } from '@nestjs/common';
import { MessageEvent } from '@nestjs/common';
import { Observable, Subject, Subscription, interval } from 'rxjs';

import { createHttpError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';

const SETTING_KEYS = {
  onlyShowMarkedRecords: 'only_show_marked_records',
  restoreRequired: 'marked_records_restore_required',
  openedBy: 'global_mark_query_opened_by',
  openedAt: 'global_mark_query_opened_at',
  restoredBy: 'global_mark_query_restored_by',
  restoredAt: 'global_mark_query_restored_at',
  updatedAt: 'global_mark_query_updated_at',
  revision: 'global_mark_query_revision',
};

@Injectable()
export class SettingsNestService {
  private readonly globalMarkQueryEvents = new Subject<MessageEvent>();
  private globalMarkQueryEventSubscribers = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly operationLogsService: OperationLogsNestService,
  ) {}

  async getGlobalMarkQuery() {
    const settings = await this.prisma.systemSetting.findMany({
      where: {
        settingKey: {
          in: Object.values(SETTING_KEYS),
        },
      },
    });
    return toGlobalMarkQuerySettings(settings);
  }

  async enableGlobalMarkQuery(actor: any, metadata: any = {}) {
    requireAnyRole(actor, ['admin', 'boss', 'front_desk', 'after_sales']);
    const current = await this.getGlobalMarkQuery();
    const now = new Date().toISOString();
    const nextSettings = {
      ...current,
      onlyShowMarkedRecords: true,
      restoreRequired: true,
      openedBy: actor.id,
      openedAt: current.openedAt || now,
      restoredBy: null,
      restoredAt: null,
      updatedAt: now,
      revision: current.revision + 1,
    };

    const saved = await this.saveGlobalMarkQuery(nextSettings, actor.id);
    this.broadcastGlobalMarkQuery(saved);
    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'settings.global_mark.enable',
      entityType: 'system_setting',
      entityId: 'global_mark_query',
      beforeData: current,
      afterData: saved,
      ipAddress: metadata.ipAddress || null,
    });
    return saved;
  }

  async restoreGlobalMarkQuery(actor: any, metadata: any = {}) {
    requireAdmin(actor);
    const current = await this.getGlobalMarkQuery();
    const now = new Date().toISOString();
    const nextSettings = {
      ...current,
      onlyShowMarkedRecords: false,
      restoreRequired: false,
      restoredBy: actor.id,
      restoredAt: now,
      updatedAt: now,
      revision: current.revision + 1,
    };

    const saved = await this.saveGlobalMarkQuery(nextSettings, actor.id);
    this.broadcastGlobalMarkQuery(saved);
    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'settings.global_mark.restore',
      entityType: 'system_setting',
      entityId: 'global_mark_query',
      beforeData: current,
      afterData: saved,
      ipAddress: metadata.ipAddress || null,
    });
    return saved;
  }

  watchGlobalMarkQuery(): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      this.globalMarkQueryEventSubscribers += 1;
      let closed = false;
      const subscriptions = new Subscription();

      subscriptions.add(
        this.globalMarkQueryEvents.subscribe({
          next: (event) => subscriber.next(event),
          error: (error) => subscriber.error(error),
        }),
      );

      void this.getGlobalMarkQuery()
        .then((settings) => {
          if (closed) {
            return;
          }
          subscriber.next(
            toGlobalMarkQueryMessageEvent(
              'global-mark-query.snapshot',
              settings,
            ),
          );
          subscriptions.add(
            interval(globalMarkQueryHeartbeatIntervalMs()).subscribe(() => {
              subscriber.next({
                type: 'heartbeat',
                data: {
                  event: 'heartbeat',
                  updatedAt: new Date().toISOString(),
                },
              });
            }),
          );
        })
        .catch((error) => subscriber.error(error));

      return () => {
        closed = true;
        subscriptions.unsubscribe();
        this.globalMarkQueryEventSubscribers = Math.max(
          0,
          this.globalMarkQueryEventSubscribers - 1,
        );
      };
    });
  }

  getGlobalMarkQueryEventSubscriberCount() {
    return this.globalMarkQueryEventSubscribers;
  }

  private broadcastGlobalMarkQuery(settings: any) {
    // This in-process stream is sufficient for a single API instance. A
    // multi-instance deployment must fan out through Redis Pub/Sub or similar.
    this.globalMarkQueryEvents.next(
      toGlobalMarkQueryMessageEvent(
        'global-mark-query.changed',
        settings,
      ),
    );
  }

  private async saveGlobalMarkQuery(settings: any, updatedBy: string) {
    const updates = [
      [SETTING_KEYS.onlyShowMarkedRecords, String(Boolean(settings.onlyShowMarkedRecords))],
      [SETTING_KEYS.restoreRequired, String(Boolean(settings.restoreRequired))],
      [SETTING_KEYS.openedBy, settings.openedBy || ''],
      [SETTING_KEYS.openedAt, settings.openedAt || ''],
      [SETTING_KEYS.restoredBy, settings.restoredBy || ''],
      [SETTING_KEYS.restoredAt, settings.restoredAt || ''],
      [SETTING_KEYS.updatedAt, settings.updatedAt || new Date().toISOString()],
      [SETTING_KEYS.revision, String(normalizeRevision(settings.revision))],
    ];

    await this.prisma.$transaction(
      updates.map(([settingKey, settingValue]) =>
        this.prisma.systemSetting.upsert({
          where: {
            settingKey,
          },
          update: {
            settingValue,
            updatedBy,
            updatedAt: new Date(),
          },
          create: {
            settingKey,
            settingValue,
            updatedBy,
            updatedAt: new Date(),
          },
        }),
      ),
    );

    return this.getGlobalMarkQuery();
  }
}

function toGlobalMarkQuerySettings(settings: any[]) {
  const values = Object.fromEntries(settings.map((item) => [item.settingKey, item.settingValue]));
  return {
    onlyShowMarkedRecords: values[SETTING_KEYS.onlyShowMarkedRecords] === 'true',
    restoreRequired: values[SETTING_KEYS.restoreRequired] === 'true',
    openedBy: nonEmptyOrNull(values[SETTING_KEYS.openedBy]),
    openedAt: nonEmptyOrNull(values[SETTING_KEYS.openedAt]),
    restoredBy: nonEmptyOrNull(values[SETTING_KEYS.restoredBy]),
    restoredAt: nonEmptyOrNull(values[SETTING_KEYS.restoredAt]),
    updatedAt: nonEmptyOrNull(values[SETTING_KEYS.updatedAt]),
    revision: normalizeRevision(values[SETTING_KEYS.revision]),
  };
}

function toGlobalMarkQueryMessageEvent(
  event: 'global-mark-query.snapshot' | 'global-mark-query.changed',
  settings: any,
): MessageEvent {
  const revision = normalizeRevision(settings?.revision);
  return {
    id: String(revision),
    type: event,
    data: {
      event,
      onlyShowMarkedRecords: Boolean(settings?.onlyShowMarkedRecords),
      restoreRequired: Boolean(settings?.restoreRequired),
      updatedAt: nonEmptyOrNull(settings?.updatedAt),
      revision,
    },
  };
}

function globalMarkQueryHeartbeatIntervalMs() {
  const configured = Number(
    process.env.GLOBAL_MARK_QUERY_HEARTBEAT_INTERVAL_MS,
  );
  return Number.isFinite(configured) && configured >= 1000
    ? Math.trunc(configured)
    : 15_000;
}

function normalizeRevision(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function requireAdmin(actor: any) {
  if (!actor || !isAdminRole(actor.role)) {
    throw createHttpError(403, 'ADMIN_REQUIRED', 'Administrator permission is required.');
  }
}

function requireAnyRole(actor: any, roles: string[]) {
  if (!actor || !isRoleAllowed(actor.role, roles)) {
    throw createHttpError(403, 'PERMISSION_DENIED', 'You do not have permission to perform this action.');
  }
}

function isAdminRole(role: string) {
  return role === 'super_admin' || role === 'admin';
}

function isRoleAllowed(role: string, roles: string[]) {
  return roles.includes(role) || (role === 'super_admin' && roles.includes('admin'));
}

function nonEmptyOrNull(value: unknown) {
  const text = value === undefined || value === null ? '' : String(value).trim();
  return text || null;
}
