import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  Kuaidi100LogisticsProviderClient,
  trackingStateLabel,
} from './kuaidi100-logistics-provider.client';
import {
  logisticsProviderName,
  normalizeLogisticsProviderCode,
} from './logistics-provider.helper';

export interface LogisticsTrackingResolution {
  order: any;
  trackingMessage: string | null;
  cacheUsed: boolean;
}

@Injectable()
export class LogisticsTrackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kuaidi100Client: Kuaidi100LogisticsProviderClient,
  ) {}

  async resolveForSalesSheet(order: any): Promise<LogisticsTrackingResolution> {
    const providerCode = normalizeLogisticsProviderCode(
      order?.logisticsProviderCode,
      order?.logisticsMethod,
    );
    const enrichedOrder = {
      ...order,
      logisticsProviderCode: providerCode,
      logisticsProviderName: logisticsProviderName(
        providerCode,
        order?.logisticsMethod,
      ),
    };
    if (providerCode === 'self_carry') {
      return {
        order: enrichedOrder,
        trackingMessage: '自带，无物流信息',
        cacheUsed: false,
      };
    }
    if (!providerCode) {
      return {
        order: enrichedOrder,
        trackingMessage: '待寄出，快递方式待选择',
        cacheUsed: false,
      };
    }
    if (!normalizeText(order?.logisticsNo)) {
      return {
        order: enrichedOrder,
        trackingMessage: '待寄出，运单号待录入',
        cacheUsed: false,
      };
    }
    if (providerCode === 'other') {
      return {
        order: enrichedOrder,
        trackingMessage: '该快递方式暂不支持实时物流查询',
        cacheUsed: hasTrackingCache(order),
      };
    }

    if (
      normalizeText(process.env.LOGISTICS_TRACKING_PROVIDER)?.toLowerCase() !==
        'kuaidi100' ||
      !this.kuaidi100Client.isConfigured()
    ) {
      return {
        order: enrichedOrder,
        trackingMessage: '物流查询服务暂未配置',
        cacheUsed: hasTrackingCache(order),
      };
    }
    if (isTrackingCacheFresh(order?.trackingCheckedAt)) {
      return {
        order: enrichedOrder,
        trackingMessage: null,
        cacheUsed: true,
      };
    }

    try {
      const tracking = await this.kuaidi100Client.query({
        providerCode,
        logisticsNo: String(order.logisticsNo).trim(),
        customerPhone:
          providerCode === 'shunfeng' ? order?.customerPhone : null,
      });
      const checkedAt = new Date();
      const cacheData = {
        trackingState: tracking.state,
        trackingStateLabel: tracking.stateLabel,
        trackingLatestLocation: tracking.latestLocation,
        trackingLatestDescription: tracking.latestDescription,
        trackingEventAt: tracking.eventAt,
        trackingCheckedAt: checkedAt,
      };
      await this.prisma.salesOrder.update({
        where: { id: order.id },
        data: cacheData,
      });
      return {
        order: {
          ...enrichedOrder,
          ...cacheData,
        },
        trackingMessage: null,
        cacheUsed: false,
      };
    } catch {
      return {
        order: enrichedOrder,
        trackingMessage: hasTrackingCache(order)
          ? '物流实时查询失败，当前显示最近缓存'
          : '物流信息暂未查询到，请稍后刷新',
        cacheUsed: hasTrackingCache(order),
      };
    }
  }
}

export function clearTrackingCacheData() {
  return {
    trackingState: null,
    trackingStateLabel: null,
    trackingLatestLocation: null,
    trackingLatestDescription: null,
    trackingEventAt: null,
    trackingCheckedAt: null,
  };
}

export function isTrackingCacheFresh(
  checkedAt: unknown,
  now = new Date(),
) {
  if (!checkedAt) {
    return false;
  }
  const checkedDate =
    checkedAt instanceof Date ? checkedAt : new Date(String(checkedAt));
  if (Number.isNaN(checkedDate.getTime())) {
    return false;
  }
  const cacheMinutes = configuredPositiveInt(
    'LOGISTICS_TRACKING_CACHE_MINUTES',
    30,
  );
  return now.getTime() - checkedDate.getTime() < cacheMinutes * 60 * 1000;
}

export function trackingDisplayState(order: any) {
  const state = normalizeText(order?.trackingState);
  return {
    state,
    stateLabel:
      normalizeText(order?.trackingStateLabel) ||
      (state ? trackingStateLabel(state) : null),
  };
}

function hasTrackingCache(order: any) {
  return Boolean(
    order?.trackingCheckedAt ||
      order?.trackingState ||
      order?.trackingLatestDescription,
  );
}

function configuredPositiveInt(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

function normalizeText(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}
