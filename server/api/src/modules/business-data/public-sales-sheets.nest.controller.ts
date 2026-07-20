import { Controller, Get, Param, Res } from '@nestjs/common';

import { BusinessDataNestService } from './business-data.nest.service';

const PUBLIC_SALES_SHEET_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'none'",
  "img-src 'none'",
  "font-src 'none'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

@Controller('public/sales-sheets')
export class PublicSalesSheetsNestController {
  constructor(
    private readonly businessDataService: BusinessDataNestService,
  ) {}

  @Get(':token')
  async get(@Param('token') token: string, @Res() response: any) {
    const result = await this.businessDataService.getPublicSalesSheetHtml(
      token,
    );
    response
      .status(result.statusCode)
      .set({
        'Cache-Control': 'no-store, private',
        Pragma: 'no-cache',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': PUBLIC_SALES_SHEET_CSP,
        'X-Frame-Options': 'DENY',
      })
      .type('html')
      .send(result.html);
  }
}
