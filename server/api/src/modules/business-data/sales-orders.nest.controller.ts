import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import { getRequestIp } from '../../common/request-ip';
import { AuthNestService } from '../auth/auth.nest.service';
import { BusinessDataNestService } from './business-data.nest.service';

@Controller('sales-orders')
export class SalesOrdersNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly businessDataService: BusinessDataNestService,
  ) {}

  @Get()
  async list(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      salesOrders: await this.businessDataService.listSalesOrders(actor, query),
    };
  }

  @Post()
  async create(@Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      salesOrder: await this.businessDataService.createSalesOrder(actor, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      salesOrder: await this.businessDataService.getSalesOrder(actor, id),
    };
  }

  @Patch(':id/finance')
  async updateFinance(@Param('id') id: string, @Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      salesOrder: await this.businessDataService.updateSalesOrderFinance(actor, id, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }

  @Patch(':id/packing')
  async updatePacking(@Param('id') id: string, @Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      salesOrder: await this.businessDataService.updateSalesOrderPacking(actor, id, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }

  @Patch(':id/status')
  async updateStatus(@Param('id') id: string, @Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      salesOrder: await this.businessDataService.updateSalesOrderStatus(actor, id, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      salesOrder: await this.businessDataService.updateSalesOrder(actor, id, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }

  @Patch(':id/finance-mark')
  async setFinanceMark(@Param('id') id: string, @Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      salesOrder: await this.businessDataService.setSalesOrderFinanceMark(actor, id, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }
}
