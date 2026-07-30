export function renderPublicSalesSheetHtml(salesSheet: any) {
  return renderDocument({
    title: `${displayText(salesSheet?.companyName, '贵州酱酒馆')}销售单`,
    body: `
      <header class="sheet-header">
        <div class="company">${text(salesSheet?.companyName, '贵州酱酒馆')}</div>
        <div class="venue">${text(salesSheet?.venueName, '茅台集团茅乡酱酒体验馆')}</div>
        <h1>销售单</h1>
        <p>请核对订单、收货信息和酒品数量</p>
      </header>
      <main>
        <section>
          <h2>订单信息</h2>
          ${renderRows([
            ['系统单号', salesSheet?.order?.orderNo],
            ['订单日期', salesSheet?.order?.orderDate],
            ['发货日期', salesSheet?.order?.shippingDate],
            ['订单状态', salesSheet?.status?.label],
          ])}
        </section>
        <section>
          <h2>客户信息</h2>
          ${renderRows([
            ['客户姓名', salesSheet?.customer?.name],
            ['客户电话', salesSheet?.customer?.phone],
            ['收货地址', salesSheet?.customer?.fullAddress],
          ])}
        </section>
        <section>
          <h2>酒品明细</h2>
          ${renderItems(salesSheet?.items)}
        </section>
        <section>
          <h2>收款明细</h2>
          ${renderPaymentDetails(salesSheet?.paymentDetails)}
        </section>
        <section>
          <h2>配送</h2>
          ${renderRows([
            ['配送方式', salesSheet?.delivery?.summaryLabel],
            ['快递方式', salesSheet?.logistics?.providerName],
            ['快递单号', salesSheet?.logistics?.logisticsNo],
            [
              '最新运输状态',
              salesSheet?.logistics?.trackingStateLabel,
            ],
            [
              '当前所在地点',
              salesSheet?.logistics?.trackingLatestLocation,
            ],
            [
              '最新物流动态',
              salesSheet?.logistics?.trackingLatestDescription,
            ],
            ['轨迹发生时间', salesSheet?.logistics?.trackingEventAt],
            ['查询更新时间', salesSheet?.logistics?.trackingCheckedAt],
            ['物流提示', salesSheet?.logistics?.trackingMessage],
          ])}
        </section>
      </main>
      <footer>如需售后服务，请联系：${text(salesSheet?.afterSalesPhone, '177-8530-5984')}</footer>
    `,
  });
}

export function renderPublicSalesSheetErrorHtml(input: any) {
  return renderDocument({
    title: displayText(input?.title, '销售单无法打开'),
    body: `
      <main class="message-page">
        <section class="message-box">
          <h1>${text(input?.title, '销售单无法打开')}</h1>
          <p>${text(input?.message, '请联系销售人员重新确认二维码。')}</p>
        </section>
      </main>
    `,
  });
}

function renderItems(items: any[]) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<p class="empty">暂无明细</p>';
  }
  return `
    <div class="items">
      ${items
        .map(
          (item) => `
            <article class="item">
              <div class="item-title">${text(item?.productName)}</div>
              ${renderRows([
                ['数量', item?.quantity],
                ['配送选择', item?.deliveryTypeLabel],
              ])}
            </article>
          `,
        )
        .join('')}
    </div>
  `;
}

function renderPaymentDetails(details: any[]) {
  if (!Array.isArray(details) || details.length === 0) {
    return '<p class="empty">暂无收款明细</p>';
  }
  return `
    <div class="table-wrap">
      <table class="payment-table">
        <thead>
          <tr>
            <th scope="col">收款方式</th>
            <th scope="col">收款金额</th>
            <th scope="col">收款属性</th>
            <th scope="col">确认状态</th>
          </tr>
        </thead>
        <tbody>
          ${details
            .map(
              (detail) => `
                <tr class="payment-row">
                  <td>${text(detail?.paymentMethodNameSnapshot)}</td>
                  <td class="amount">¥${text(detail?.amountYuan, '0.00')}</td>
                  <td>${text(paymentCategoryLabel(detail))}</td>
                  <td>${text(paymentConfirmationLabel(detail))}</td>
                </tr>
              `,
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function paymentCategoryLabel(detail: any) {
  if (hasDisplayValue(detail?.paymentMethodCategoryLabel)) {
    return detail.paymentMethodCategoryLabel;
  }
  const category = String(
    detail?.paymentMethodCategorySnapshot || '',
  ).toLowerCase();
  return category === 'collect_on_delivery' ||
    category === 'agency_collection'
    ? '代收营业款'
    : '即时收款';
}

function paymentConfirmationLabel(detail: any) {
  if (hasDisplayValue(detail?.confirmationStatusLabel)) {
    return detail.confirmationStatusLabel;
  }
  if (paymentCategoryLabel(detail) !== '代收营业款') {
    return '无需确认';
  }
  return detail?.agencyCollectionConfirmed
    ? '已确认到账'
    : '代收款（待确认）';
}

function renderRows(rows: Array<[string, unknown]>) {
  const visibleRows = rows.filter(([, value]) => hasDisplayValue(value));
  if (visibleRows.length === 0) {
    return '<p class="empty">暂无信息</p>';
  }
  return `
    <dl class="rows">
      ${visibleRows
        .map(
          ([label, value]) => `
            <div class="row">
              <dt>${text(label)}</dt>
              <dd>${text(value)}</dd>
            </div>
          `,
        )
        .join('')}
    </dl>
  `;
}

function renderDocument(input: any) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow, noarchive">
  <title>${text(input.title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #f4f5f7;
      color: #1f2933;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.55;
    }
    .sheet-header {
      background: #ffffff;
      border-bottom: 1px solid #dde2e8;
      padding: 24px 18px 18px;
      text-align: center;
    }
    .company {
      color: #7a1f1f;
      font-size: 15px;
      font-weight: 700;
    }
    .venue {
      color: #7a1f1f;
      font-size: 17px;
      font-weight: 700;
      margin: 4px 0 6px;
    }
    h1, h2, p, dl, dd { margin: 0; }
    h1 { font-size: 28px; letter-spacing: 0; }
    .sheet-header p, footer, .empty { color: #65758b; }
    main {
      width: min(100%, 720px);
      margin: 0 auto;
      padding: 12px;
    }
    section, .message-box {
      background: #ffffff;
      border: 1px solid #dde2e8;
      border-radius: 8px;
      margin: 10px 0;
      padding: 14px;
    }
    h2 {
      border-bottom: 1px solid #edf0f3;
      font-size: 18px;
      margin-bottom: 10px;
      padding-bottom: 8px;
    }
    .row {
      display: grid;
      gap: 8px;
      grid-template-columns: 104px 1fr;
      padding: 8px 0;
    }
    .row + .row { border-top: 1px solid #f0f2f5; }
    dt { color: #65758b; }
    dd { color: #111827; font-weight: 600; overflow-wrap: anywhere; }
    .item {
      border: 1px solid #e5e9ef;
      border-radius: 8px;
      padding: 12px;
    }
    .item + .item { margin-top: 10px; }
    .item-title {
      font-size: 17px;
      font-weight: 700;
      margin-bottom: 8px;
      overflow-wrap: anywhere;
    }
    .table-wrap { overflow-x: auto; }
    .payment-table {
      border-collapse: collapse;
      min-width: 560px;
      width: 100%;
    }
    .payment-table th,
    .payment-table td {
      border: 1px solid #e5e9ef;
      padding: 9px 10px;
      text-align: left;
      vertical-align: top;
    }
    .payment-table th {
      background: #f7f8fa;
      color: #4b5d73;
      font-weight: 700;
    }
    .payment-table .amount {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    footer {
      padding: 16px 18px 28px;
      text-align: center;
    }
    .message-page {
      align-items: center;
      display: flex;
      min-height: 100vh;
    }
    .message-box {
      margin: 0 auto;
      text-align: center;
      width: min(100%, 520px);
    }
    .message-box h1 {
      font-size: 24px;
      margin-bottom: 10px;
    }
    @media (max-width: 420px) {
      .row { grid-template-columns: 88px 1fr; }
      h1 { font-size: 25px; }
    }
    @media print {
      body { background: #ffffff; }
      .sheet-header { padding-top: 0; }
      main { max-width: none; padding: 0; width: 100%; }
      section { break-inside: avoid; border-color: #cfd5dc; }
      .payment-row { break-inside: avoid; }
      footer { padding-bottom: 0; }
    }
  </style>
</head>
<body>
${input.body}
</body>
</html>`;
}

function text(value: unknown, fallback = '-') {
  return escapeHtml(displayText(value, fallback));
}

function displayText(value: unknown, fallback = '-') {
  return hasDisplayValue(value) ? String(value).trim() : fallback;
}

function hasDisplayValue(value: unknown) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
