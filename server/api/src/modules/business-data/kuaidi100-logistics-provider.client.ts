import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

const KUAIDI100_QUERY_URL =
  'https://poll.kuaidi100.com/poll/query.do';

export interface LogisticsProviderQuery {
  providerCode: string;
  logisticsNo: string;
  customerPhone?: string | null;
}

export interface NormalizedLogisticsTracking {
  state: string;
  stateLabel: string;
  latestLocation: string | null;
  latestDescription: string | null;
  eventAt: Date | null;
}

export class LogisticsProviderUnavailableError extends Error {
  constructor(message = 'Logistics provider is unavailable.') {
    super(message);
    this.name = 'LogisticsProviderUnavailableError';
  }
}

@Injectable()
export class Kuaidi100LogisticsProviderClient {
  async query(
    input: LogisticsProviderQuery,
  ): Promise<NormalizedLogisticsTracking> {
    const customer = normalizeText(process.env.KUAIDI100_CUSTOMER);
    const key = normalizeText(process.env.KUAIDI100_KEY);
    if (!customer || !key) {
      throw new LogisticsProviderUnavailableError(
        'Logistics tracking service is not configured.',
      );
    }

    const param: Record<string, string> = {
      com: input.providerCode,
      num: input.logisticsNo,
      resultv2: '4',
      show: '0',
      order: 'desc',
      lang: 'zh',
    };
    if (requiresCustomerPhone(input.providerCode)) {
      const customerPhone = normalizeText(input.customerPhone);
      if (customerPhone) {
        param.phone = customerPhone;
      }
    }
    const paramJson = JSON.stringify(param);
    const sign = crypto
      .createHash('md5')
      .update(`${paramJson}${key}${customer}`)
      .digest('hex')
      .toUpperCase();
    const body = new URLSearchParams({
      customer,
      sign,
      param: paramJson,
    });
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      configuredPositiveInt('LOGISTICS_TRACKING_TIMEOUT_MS', 4000),
    );

    try {
      const response = await fetch(KUAIDI100_QUERY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new LogisticsProviderUnavailableError();
      }
      const payload = await response.json();
      if (
        !payload ||
        typeof payload !== 'object' ||
        String((payload as any).status || '') !== '200' ||
        !Array.isArray((payload as any).data)
      ) {
        throw new LogisticsProviderUnavailableError();
      }
      return normalizeKuaidi100Tracking(payload);
    } catch (error) {
      if (error instanceof LogisticsProviderUnavailableError) {
        throw error;
      }
      throw new LogisticsProviderUnavailableError();
    } finally {
      clearTimeout(timeout);
    }
  }

  isConfigured() {
    return Boolean(
      normalizeText(process.env.KUAIDI100_CUSTOMER) &&
        normalizeText(process.env.KUAIDI100_KEY),
    );
  }
}

export function normalizeKuaidi100Tracking(
  payload: any,
): NormalizedLogisticsTracking {
  const latest =
    Array.isArray(payload?.data) && payload.data.length > 0
      ? payload.data[0]
      : {};
  const state = mapKuaidi100State(
    latest?.statusCode ?? payload?.state,
    latest?.status ?? latest?.context,
  );
  return {
    state,
    stateLabel: trackingStateLabel(state),
    latestLocation:
      normalizeText(latest?.location) ||
      normalizeText(latest?.areaName) ||
      normalizeText(payload?.routeInfo?.cur?.name),
    latestDescription: normalizeText(latest?.context),
    eventAt: parseKuaidi100EventAt(latest?.ftime || latest?.time),
  };
}

export function mapKuaidi100State(
  value: unknown,
  description?: unknown,
) {
  const code = normalizeText(value) || '';
  const text = normalizeText(description) || '';
  if (
    code === '101' ||
    code === '102' ||
    /已下单|待揽收|暂无轨迹|未发货/.test(text)
  ) {
    return 'not_shipped';
  }
  if (code === '1' || code === '103' || /已揽收|揽收/.test(text)) {
    return 'picked_up';
  }
  if (code === '5' || code === '501' || /派件|派送/.test(text)) {
    return 'out_for_delivery';
  }
  if (code === '3' || /^30[1-4]$/.test(code) || /已签收|签收/.test(text)) {
    return 'signed';
  }
  if (
    ['4', '6', '14', '401'].includes(code) ||
    /退回|退签|拒签|拒收/.test(text)
  ) {
    return 'returned';
  }
  if (
    code === '2' ||
    code === '13' ||
    /^20\d$/.test(code) ||
    /异常|疑难|破损|超时|滞留|无法联系/.test(text)
  ) {
    return 'exception';
  }
  if (
    ['0', '7', '8', '10', '11', '12', '1001', '1002', '1003'].includes(
      code,
    ) ||
    /在途|运输|转运|发往|清关/.test(text)
  ) {
    return 'in_transit';
  }
  return 'unknown';
}

export function trackingStateLabel(state: unknown) {
  const labels: Record<string, string> = {
    not_shipped: '待寄出',
    picked_up: '已揽收',
    in_transit: '运输中',
    out_for_delivery: '派送中',
    signed: '已签收',
    exception: '物流异常',
    returned: '退回中',
    unknown: '状态未知',
  };
  return labels[String(state || '')] || labels.unknown;
}

function requiresCustomerPhone(providerCode: string) {
  return providerCode === 'shunfeng';
}

function parseKuaidi100EventAt(value: unknown) {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }
  const normalized = text.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    ? `${text.replace(' ', 'T')}+08:00`
    : text;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
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
