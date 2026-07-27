export const LOGISTICS_PROVIDER_LABELS: Record<string, string> = Object.freeze({
  shunfeng: '顺丰速运',
  annengwuliu: '安能快运',
  yunda: '韵达快递',
  self_carry: '自带',
  other: '其他',
});

const LOGISTICS_METHOD_ALIASES: Record<string, string> = Object.freeze({
  顺丰: 'shunfeng',
  顺丰速运: 'shunfeng',
  sf: 'shunfeng',
  安能: 'annengwuliu',
  安能物流: 'annengwuliu',
  安能快运: 'annengwuliu',
  韵达: 'yunda',
  韵达快递: 'yunda',
  自带: 'self_carry',
  自提: 'self_carry',
  客户自提: 'self_carry',
});

export const SUPPORTED_LOGISTICS_PROVIDER_CODES = Object.freeze(
  Object.keys(LOGISTICS_PROVIDER_LABELS),
);

export function normalizeLogisticsProviderCode(
  providerCode: unknown,
  logisticsMethod?: unknown,
) {
  const explicit = normalizeText(providerCode)?.toLowerCase();
  if (explicit && SUPPORTED_LOGISTICS_PROVIDER_CODES.includes(explicit)) {
    return explicit;
  }
  const legacyMethod = normalizeText(logisticsMethod);
  if (!legacyMethod) {
    return null;
  }
  return LOGISTICS_METHOD_ALIASES[legacyMethod] ||
    LOGISTICS_METHOD_ALIASES[legacyMethod.toLowerCase()] ||
    'other';
}

export function logisticsProviderName(
  providerCode: unknown,
  logisticsMethod?: unknown,
) {
  const normalized = normalizeLogisticsProviderCode(
    providerCode,
    logisticsMethod,
  );
  if (!normalized) {
    return null;
  }
  if (normalized === 'other') {
    return normalizeText(logisticsMethod) || LOGISTICS_PROVIDER_LABELS.other;
  }
  return LOGISTICS_PROVIDER_LABELS[normalized] || null;
}

export function assertLogisticsProviderCode(value: unknown) {
  const normalized = normalizeText(value)?.toLowerCase();
  if (!normalized || !SUPPORTED_LOGISTICS_PROVIDER_CODES.includes(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeText(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}
