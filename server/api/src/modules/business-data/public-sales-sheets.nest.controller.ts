import { Controller, Get, Param, Res } from '@nestjs/common';

import { BusinessDataNestService } from './business-data.nest.service';

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
    response.status(result.statusCode).type('html').send(result.html);
  }
}
