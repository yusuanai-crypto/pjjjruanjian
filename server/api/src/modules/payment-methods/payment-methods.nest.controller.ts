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
import { PaymentMethodsNestService } from './payment-methods.nest.service';

@Controller('payment-methods')
export class PaymentMethodsNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly paymentMethodsService: PaymentMethodsNestService,
  ) {}

  @Get()
  async list(@Query() query: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      paymentMethods: await this.paymentMethodsService.list(actor, query),
    };
  }

  @Post()
  async create(@Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      paymentMethod: await this.paymentMethodsService.create(
        actor,
        body,
        requestMetadata(request),
      ),
    };
  }

  @Patch('sort-order')
  async sort(@Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      paymentMethods: await this.paymentMethodsService.sort(
        actor,
        body,
        requestMetadata(request),
      ),
    };
  }

  @Patch(':id/enable')
  async enable(@Param('id') id: string, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      paymentMethod: await this.paymentMethodsService.enable(
        actor,
        id,
        requestMetadata(request),
      ),
    };
  }

  @Patch(':id/disable')
  async disable(@Param('id') id: string, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      paymentMethod: await this.paymentMethodsService.disable(
        actor,
        id,
        requestMetadata(request),
      ),
    };
  }

  @Patch(':id/default')
  async setDefault(@Param('id') id: string, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      paymentMethod: await this.paymentMethodsService.setDefault(
        actor,
        id,
        requestMetadata(request),
      ),
    };
  }

  // Kept as the stable edit endpoint. It also accepts the existing
  // isActive/isDefault/sortOrder fields for backward-compatible clients.
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      paymentMethod: await this.paymentMethodsService.update(
        actor,
        id,
        body,
        requestMetadata(request),
      ),
    };
  }
}

function requestMetadata(request: any) {
  return {
    ipAddress: getRequestIp(request),
  };
}
