import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';

import { getRequestIp } from '../../common/request-ip';
import { AuthNestService } from '../auth/auth.nest.service';
import { BusinessDataNestService } from './business-data.nest.service';

@Controller('after-sales-orders')
export class AfterSalesOrdersNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly businessDataService: BusinessDataNestService,
  ) {}

  @Get()
  async list(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      afterSalesOrders: await this.businessDataService.listAfterSalesOrders(
        actor,
        query,
      ),
    };
  }

  @Post()
  async create(@Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      afterSalesOrder: await this.businessDataService.createAfterSalesOrder(
        actor,
        body,
        {
          ipAddress: getRequestIp(request),
        },
      ),
    };
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      afterSalesOrder: await this.businessDataService.getAfterSalesOrder(
        actor,
        id,
      ),
    };
  }

  @Patch(':id/finance-confirm')
  async confirmFinance(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      afterSalesOrder:
        await this.businessDataService.confirmAfterSalesOrderFinance(
          actor,
          id,
          body,
          {
            ipAddress: getRequestIp(request),
          },
        ),
    };
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      afterSalesOrder:
        await this.businessDataService.updateAfterSalesOrderStatus(
          actor,
          id,
          body,
          {
            ipAddress: getRequestIp(request),
          },
        ),
    };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      afterSalesOrder: await this.businessDataService.updateAfterSalesOrder(
        actor,
        id,
        body,
        {
          ipAddress: getRequestIp(request),
        },
      ),
    };
  }
}
