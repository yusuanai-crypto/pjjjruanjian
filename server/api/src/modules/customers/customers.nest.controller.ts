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
import { CustomersNestService } from './customers.nest.service';

@Controller('customers')
export class CustomersNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly customersService: CustomersNestService,
  ) {}

  @Get()
  async list(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      customers: await this.customersService.listCustomers(actor, query),
    };
  }

  @Post()
  async create(@Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      customer: await this.customersService.createCustomer(actor, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      customer: await this.customersService.getCustomer(actor, id),
    };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      customer: await this.customersService.updateCustomer(actor, id, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }

  @Patch(':id/finance-mark')
  async setFinanceMark(@Param('id') id: string, @Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      customer: await this.customersService.setCustomerFinanceMark(actor, id, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }
}
