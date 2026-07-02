export function renderPublicSalesSheetHtml(salesSheet: any) {
  return renderDocument({
    title: `${displayText(salesSheet?.companyName, '贵州酱酒馆')}销售单`,
    body: `
      <header class="sheet-header">
        <div class="company">${text(salesSheet?.companyName, '贵州酱酒馆')}</div>
        <h1>销售单</h1>
        <p>请核对订单、收货和酒品明细信息</p>
      </header>
      <main>
        <section>
          <h2>订单信息</h2>
          ${renderRows([
            ['系统单号', salesSheet?.order?.orderNo],
            ['销售单号', salesSheet?.order?.salesFormNo],
            ['订单日期', salesSheet?.order?.orderDate],
            ['订单类型', salesSheet?.order?.orderTypeLabel],
            ['订单状态', salesSheet?.status?.label],
          ])}
        </section>
        <section>
          <h2>客户信息</h2>
          ${renderRows([
            ['客户姓名', salesSheet?.customer?.name],
            ['客户电话', salesSheet?.customer?.phoneMasked],
            ['收货地址', salesSheet?.customer?.fullAddress],
          ])}
        </section>
        ${renderTravelGroup(salesSheet?.travelGroup)}
        <section>
          <h2>销售人员</h2>
          ${renderRows([['姓名', salesSheet?.salesUser?.name]])}
        </section>
        <section>
          <h2>酒品明细</h2>
          ${renderItems(salesSheet?.items)}
        </section>
        <section>
          <h2>金额</h2>
          ${renderRows([
            ['订单总额', formatYuan(salesSheet?.amounts?.totalAmountYuan)],
            [
              '货到付款金额',
              formatYuan(salesSheet?.amounts?.cashOnDeliveryAmountYuan),
            ],
          ])}
        </section>
        <section>
          <h2>配送和开票</h2>
          ${renderRows([
            ['配送方式', salesSheet?.delivery?.summaryLabel],
            ['物流方式', salesSheet?.logistics?.method],
            ['物流单号', salesSheet?.logistics?.logisticsNo],
            ['是否需要开票', salesSheet?.invoice?.requiredLabel],
            ['是否已开票', salesSheet?.invoice?.issuedLabel],
          ])}
        </section>
        ${renderRemark(salesSheet?.order?.remark)}
      </main>
      <footer>请保存此页面或拍照留存。如信息有误，请联系销售人员处理。</footer>
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

function renderTravelGroup(group: any) {
  if (!group) {
    return '';
  }
  return `
    <section>
      <h2>旅行团概要</h2>
      ${renderRows([
        ['团号', group.groupNo],
        ['到店日期', group.visitDate],
        ['旅行社', group.travelAgency],
        ['导游', group.guideName],
        ['品鉴师', group.tasterName],
        ['品鉴厅', group.tastingRoomNo],
      ])}
    </section>
  `;
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
                ['单价', formatYuan(item?.unitPriceYuan)],
                ['小计', formatYuan(item?.subtotalYuan)],
                ['配送选择', item?.deliveryTypeLabel],
              ])}
            </article>
          `,
        )
        .join('')}
    </div>
  `;
}

function renderRemark(remark: unknown) {
  if (!hasDisplayValue(remark)) {
    return '';
  }
  return `
    <section>
      <h2>备注</h2>
      <p class="remark">${text(remark)}</p>
    </section>
  `;
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
      margin-bottom: 6px;
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
    .remark {
      color: #111827;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
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
  </style>
</head>
<body>
${input.body}
</body>
</html>`;
}

function formatYuan(value: unknown) {
  if (!hasDisplayValue(value)) {
    return null;
  }
  return `¥${String(value).trim()}`;
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
