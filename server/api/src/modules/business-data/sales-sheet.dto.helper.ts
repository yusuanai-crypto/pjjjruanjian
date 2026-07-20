const COMPANY_NAME = '贵州酱酒馆';

const ORDER_TYPE_FROM_PRISMA: any = {
  TRAVEL_GROUP: 'travel_group',
  BUYBACK: 'buyback',
  EXTERNAL: 'external',
  INTERNAL: 'internal',
  AFTER_SALES: 'after_sales',
};

const ORDER_TYPE_LABELS: any = {
  travel_group: '旅行团订单',
  buyback: '回购订单',
  external: '外部销售',
  internal: '内部采购',
  after_sales: '售后订单',
};

const ORDER_STATUS_FROM_PRISMA: any = {
  VALID: 'valid',
  PARTIAL_REFUND: 'partial_refund',
  REFUNDED: 'refunded',
  CANCELLED: 'cancelled',
};

const ORDER_STATUS_LABELS: any = {
  valid: '有效',
  partial_refund: '部分退款',
  refunded: '已退款',
  cancelled: '已取消',
};

const DELIVERY_TYPE_FROM_PRISMA: any = {
  SELF_PICKUP: 'self_pickup',
  SHIPPING: 'shipping',
};

const DELIVERY_TYPE_LABELS: any = {
  self_pickup: '自提',
  shipping: '邮寄',
  mixed: '混合配送',
};

const PACKING_STATUS_FROM_PRISMA: any = {
  PENDING: 'pending',
  PACKING: 'packing',
  PACKED: 'packed',
  ABNORMAL: 'abnormal',
};

const PACKING_STATUS_LABELS: any = {
  pending: '待打包',
  packing: '打包中',
  packed: '已打包',
  abnormal: '异常',
};

export interface BuildSalesSheetOptions {
  publicToken?: string | null;
  publicUrl?: string | null;
}

export function buildSalesSheetDto(
  order: any,
  options: BuildSalesSheetOptions = {},
) {
  const orderType = normalizeOrderType(order?.orderType);
  const status = normalizeOrderStatus(order?.status);
  const packingStatus = normalizePackingStatus(order?.packingStatus);
  const customerAddress = buildAddress({
    province: order?.province,
    city: order?.city,
    district: order?.district,
    address: order?.address,
  });
  const items = normalizeItems(order?.items);
  const deliverySummary = buildDeliverySummary(items);
  const salesUser = buildInternalSalesUser(order?.salesUser, order);
  const travelGroup = buildInternalTravelGroup(order?.travelGroup, order);
  const qrCode = buildInternalQrCode(order, options);
  const totalAmountCents = toCents(order?.totalAmountCents);
  const cashOnDeliveryAmountCents = toCents(order?.cashOnDeliveryAmountCents);
  const logisticsFeeCents = toCents(order?.logisticsFeeCents);

  const salesSheet = {
    visibility: 'internal',
    companyName: COMPANY_NAME,
    order: {
      id: order?.id || null,
      orderNo: order?.orderNo || null,
      orderType,
      orderTypeLabel: labelFor(ORDER_TYPE_LABELS, orderType),
      salesFormNo: order?.salesFormNo || null,
      orderDate: formatDate(order?.orderDate),
      remark: order?.remark || null,
    },
    customer: {
      id: order?.customerId || order?.customer?.id || null,
      name: order?.customerName || order?.customer?.name || null,
      phone: order?.customerPhone || order?.customer?.phone || null,
      phoneMasked: maskCustomerPhone(
        order?.customerPhone || order?.customer?.phone,
      ),
      province: order?.province || null,
      city: order?.city || null,
      district: order?.district || null,
      address: order?.address || null,
      fullAddress: customerAddress,
    },
    travelGroup,
    salesUser,
    items,
    amounts: {
      totalAmountCents,
      totalAmountYuan: formatCentsAsYuan(totalAmountCents),
      cashOnDeliveryAmountCents,
      cashOnDeliveryAmountYuan: formatCentsAsYuan(
        cashOnDeliveryAmountCents,
      ),
      logisticsFeeCents,
      logisticsFeeYuan: formatCentsAsYuan(logisticsFeeCents),
    },
    status: {
      value: status,
      label: labelFor(ORDER_STATUS_LABELS, status),
    },
    delivery: {
      summary: deliverySummary,
      summaryLabel: labelFor(DELIVERY_TYPE_LABELS, deliverySummary),
    },
    logistics: {
      method: order?.logisticsMethod || null,
      logisticsNo: order?.logisticsNo || null,
      packingStatus,
      packingStatusLabel: labelFor(PACKING_STATUS_LABELS, packingStatus),
      packageCount: Number(order?.packageCount || 0),
    },
    invoice: {
      required: Boolean(order?.invoiceRequired),
      requiredLabel: order?.invoiceRequired ? '需要开票' : '无需开票',
      issued: Boolean(order?.invoiceIssued),
      issuedLabel: order?.invoiceIssued ? '已开票' : '未开票',
    },
    qrCode,
    internalFields: {
      customerId: order?.customerId || null,
      customerFinanceMark:
        order?.customer?.financeMark === undefined
          ? null
          : Boolean(order.customer.financeMark),
      travelGroupId: order?.travelGroupId || null,
      travelGroupFinanceMark:
        order?.travelGroup?.financeMark === undefined
          ? null
          : Boolean(order.travelGroup.financeMark),
      salesUserId: order?.salesUserId || null,
      financeMark: Boolean(order?.financeMark),
      markedById: order?.markedById || null,
      markedAt: toIsoString(order?.markedAt),
      financeRemark: order?.financeRemark || null,
      warehouseRemark: order?.warehouseRemark || null,
      createdAt: toIsoString(order?.createdAt),
      updatedAt: toIsoString(order?.updatedAt),
    },
  };

  return {
    ...salesSheet,
    public: buildPublicSalesSheetDto(salesSheet),
  };
}

export function buildPublicSalesSheetDto(source: any) {
  const salesSheet = source?.visibility === 'internal'
    ? source
    : buildSalesSheetDto(source);

  return {
    visibility: 'public',
    companyName: salesSheet.companyName,
    order: {
      orderNo: salesSheet.order.orderNo,
      orderDate: salesSheet.order.orderDate,
    },
    customer: {
      name: salesSheet.customer.name,
      phoneMasked: salesSheet.customer.phoneMasked,
      addressMasked: maskCustomerAddress({
        province: salesSheet.customer.province,
        city: salesSheet.customer.city,
        district: salesSheet.customer.district,
        address: salesSheet.customer.address,
      }),
    },
    items: salesSheet.items.map((item: any) => ({
      productName: item.productName,
      quantity: item.quantity,
      deliveryType: item.deliveryType,
      deliveryTypeLabel: item.deliveryTypeLabel,
    })),
    status: salesSheet.status,
    delivery: salesSheet.delivery,
    qrCode: salesSheet.qrCode
      ? {
          generatedAt: salesSheet.qrCode.generatedAt,
          expiresAt: salesSheet.qrCode.expiresAt,
        }
      : null,
  };
}

export function maskCustomerPhone(value: unknown) {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }
  const digits = text.replace(/\D/g, '');
  if (/^1\d{10}$/.test(digits)) {
    return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
  }
  if (digits.length >= 7) {
    return `${digits.slice(0, 3)}****${digits.slice(-2)}`;
  }
  const visible = digits || text;
  if (visible.length <= 2) {
    return '*'.repeat(visible.length);
  }
  return `${visible.slice(0, 1)}${'*'.repeat(Math.max(2, visible.length - 2))}${visible.slice(-1)}`;
}

export function maskCustomerAddress(parts: any) {
  const masked = [
    maskAddressSegment(parts?.province),
    maskAddressSegment(parts?.city),
    maskAddressSegment(parts?.district),
    maskDetailedAddress(parts?.address),
  ].filter(Boolean);
  return masked.length > 0 ? masked.join(' ') : null;
}

export function formatCentsAsYuan(value: unknown) {
  const cents = toCents(value);
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const yuan = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, '0');
  return `${sign}${yuan}.${fraction}`;
}

function buildInternalSalesUser(user: any, order: any) {
  if (!user && !order?.salesUserId) {
    return null;
  }
  return {
    id: user?.id || order?.salesUserId || null,
    name: user?.name || null,
    username: user?.username || null,
  };
}

function buildInternalTravelGroup(group: any, order: any) {
  if (!group && !order?.travelGroupId) {
    return null;
  }
  return {
    id: group?.id || order?.travelGroupId || null,
    groupNo: group?.groupNo || null,
    visitDate: formatDate(group?.visitDate),
    travelAgency: group?.travelAgency || null,
    guideName: group?.guideName || null,
    guidePhone: group?.guidePhone || null,
    tasterName: group?.tasterName || null,
    tastingRoomNo: group?.tastingRoomNo || null,
    financeMark:
      group?.financeMark === undefined ? null : Boolean(group.financeMark),
  };
}

function buildInternalQrCode(order: any, options: BuildSalesSheetOptions) {
  if (
    !order?.qrCodeTokenHash &&
    !order?.qrCodeGeneratedAt &&
    !order?.qrCodeRevokedAt &&
    !options.publicToken &&
    !options.publicUrl
  ) {
    return null;
  }
  const expiresAt = toIsoString(order?.qrCodeExpiresAt);
  const expiresAtTime = expiresAt ? new Date(expiresAt).getTime() : Number.NaN;
  return {
    active:
      Boolean(order?.qrCodeTokenHash) &&
      !order?.qrCodeRevokedAt &&
      Number.isFinite(expiresAtTime) &&
      expiresAtTime > Date.now(),
    token: options.publicToken || null,
    url: options.publicUrl || null,
    generatedAt: toIsoString(order?.qrCodeGeneratedAt),
    expiresAt,
    revokedAt: toIsoString(order?.qrCodeRevokedAt),
  };
}

function maskAddressSegment(value: unknown) {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }
  return text.length === 1
    ? '*'
    : `${text.slice(0, 1)}${'*'.repeat(text.length - 1)}`;
}

function maskDetailedAddress(value: unknown) {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }
  return `${text.slice(0, 1)}***`;
}

function normalizeItems(items: any[]) {
  return (Array.isArray(items) ? items : [])
    .map((item: any, index: number) => ({
      item,
      index,
      sortOrder: Number(item?.sortOrder || 0),
    }))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.index - right.index)
    .map(({ item }) => {
      const deliveryType = normalizeDeliveryType(item?.deliveryType);
      const unitPriceCents = toCents(item?.unitPriceCents);
      const subtotalCents = toCents(
        item?.subtotalCents ?? Number(item?.quantity || 0) * unitPriceCents,
      );
      return {
        id: item?.id || null,
        productName: item?.productName || null,
        quantity: Number(item?.quantity || 0),
        unitPriceCents,
        unitPriceYuan: formatCentsAsYuan(unitPriceCents),
        subtotalCents,
        subtotalYuan: formatCentsAsYuan(subtotalCents),
        deliveryType,
        deliveryTypeLabel: labelFor(DELIVERY_TYPE_LABELS, deliveryType),
        notes: item?.notes || null,
        sortOrder: Number(item?.sortOrder || 0),
      };
    });
}

function buildDeliverySummary(items: any[]) {
  const types = new Set(
    items
      .map((item: any) => item.deliveryType)
      .filter((type: any) => type === 'shipping' || type === 'self_pickup'),
  );
  if (types.size === 0) {
    return null;
  }
  if (types.size > 1) {
    return 'mixed';
  }
  return Array.from(types)[0];
}

function buildAddress(parts: any) {
  const text = [
    parts.province,
    parts.city,
    parts.district,
    parts.address,
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join('');
  return text || null;
}

function normalizeOrderType(value: unknown) {
  const text = normalizeEnumText(value);
  return ORDER_TYPE_FROM_PRISMA[text] || text || null;
}

function normalizeOrderStatus(value: unknown) {
  const text = normalizeEnumText(value);
  return ORDER_STATUS_FROM_PRISMA[text] || text || null;
}

function normalizeDeliveryType(value: unknown) {
  const text = normalizeEnumText(value);
  return DELIVERY_TYPE_FROM_PRISMA[text] || text || null;
}

function normalizePackingStatus(value: unknown) {
  const text = normalizeEnumText(value);
  return PACKING_STATUS_FROM_PRISMA[text] || text || null;
}

function normalizeEnumText(value: unknown) {
  return normalizeText(value)?.toUpperCase() || null;
}

function labelFor(labels: any, value: unknown) {
  return labels[String(value || '')] || null;
}

function toCents(value: unknown) {
  const numberValue = Number(value || 0);
  if (!Number.isFinite(numberValue)) {
    return 0;
  }
  return Math.trunc(numberValue);
}

function normalizeText(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function formatDate(value: unknown) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toISOString().slice(0, 10);
}

function toIsoString(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value ? String(value) : null;
}
