import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';

import { getRequestIp } from '../../common/request-ip';
import { AuthNestService } from '../auth/auth.nest.service';
import { SpecialOrderCommissionService } from '../commissions/special-order-commission.service';
import { SpecialOrdersNestService } from './special-orders.nest.service';

@Controller('special-orders')
export class SpecialOrdersNestController {
  constructor(
    private readonly auth: AuthNestService,
    private readonly specialOrders: SpecialOrdersNestService,
    private readonly commissions: SpecialOrderCommissionService,
  ) {}

  @Get()
  async list(@Query() query: any, @Req() request: any) {
    const actor = await this.auth.authenticateRequest(request);
    return this.specialOrders.list(actor, query);
  }

  @Post()
  async create(@Body() body: unknown, @Req() request: any) {
    const actor = await this.auth.authenticateRequest(request);
    return {
      specialOrder: await this.specialOrders.create(
        actor,
        body,
        requestMetadata(request),
      ),
    };
  }

  @Get('export.xlsx')
  async exportXlsx(
    @Query() query: any,
    @Req() request: any,
    @Res() response: any,
  ) {
    const actor = await this.auth.authenticateRequest(request);
    const exported = await this.specialOrders.exportXlsx(actor, query);
    response.status(200);
    response.type(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${exported.fileName}"`,
    );
    response.setHeader('Content-Length', exported.buffer.length);
    response.send(exported.buffer);
  }

  @Get('reference-data')
  async referenceData(@Query() query: any, @Req() request: any) {
    const actor = await this.auth.authenticateRequest(request);
    return {
      referenceData: await this.specialOrders.getReferenceData(actor, query),
    };
  }

  @Get(':id/print-data')
  async printData(@Param('id') id: string, @Req() request: any) {
    const actor = await this.auth.authenticateRequest(request);
    return {
      printData: await this.specialOrders.getPrintData(actor, id),
    };
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() request: any) {
    const actor = await this.auth.authenticateRequest(request);
    return {
      specialOrder: await this.specialOrders.get(actor, id),
    };
  }

  @Get(':id/commissions')
  async listCommissions(
    @Param('id') id: string,
    @Query() query: any,
    @Req() request: any,
  ) {
    const actor = await this.auth.authenticateRequest(request);
    return {
      commissions: await this.commissions.list(
        actor,
        id,
        String(query?.includeInactive || '').toLowerCase() === 'true',
      ),
    };
  }

  @Post(':id/commissions')
  async createCommission(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.auth.authenticateRequest(request);
    return {
      commission: await this.commissions.create(
        actor,
        id,
        body,
        requestMetadata(request),
      ),
    };
  }

  @Patch(':id/commissions/:commissionId')
  async updateCommission(
    @Param('id') id: string,
    @Param('commissionId') commissionId: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.auth.authenticateRequest(request);
    return {
      commission: await this.commissions.update(
        actor,
        id,
        commissionId,
        body,
        requestMetadata(request),
      ),
    };
  }

  @Delete(':id/commissions/:commissionId')
  async deleteCommission(
    @Param('id') id: string,
    @Param('commissionId') commissionId: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.auth.authenticateRequest(request);
    return {
      commission: await this.commissions.remove(
        actor,
        id,
        commissionId,
        body,
        requestMetadata(request),
      ),
    };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.auth.authenticateRequest(request);
    return {
      specialOrder: await this.specialOrders.update(
        actor,
        id,
        body,
        requestMetadata(request),
      ),
    };
  }

  @Delete(':id')
  async cancel(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.auth.authenticateRequest(request);
    return {
      specialOrder: await this.specialOrders.cancel(
        actor,
        id,
        body,
        requestMetadata(request),
      ),
    };
  }

  @Post(':id/submit')
  async submit(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.auth.authenticateRequest(request);
    return {
      specialOrder: await this.specialOrders.submit(
        actor,
        id,
        body,
        requestMetadata(request),
      ),
    };
  }

  @Post(':id/withdraw')
  async withdraw(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.auth.authenticateRequest(request);
    return {
      specialOrder: await this.specialOrders.withdraw(
        actor,
        id,
        body,
        requestMetadata(request),
      ),
    };
  }

  @Post(':id/approve')
  async approve(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.auth.authenticateRequest(request);
    return {
      specialOrder: await this.specialOrders.approve(
        actor,
        id,
        body,
        requestMetadata(request),
      ),
    };
  }

  @Post(':id/reject')
  async reject(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.auth.authenticateRequest(request);
    return {
      specialOrder: await this.specialOrders.reject(
        actor,
        id,
        body,
        requestMetadata(request),
      ),
    };
  }

  @Post(':id/unapprove')
  async unapprove(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.auth.authenticateRequest(request);
    return {
      specialOrder: await this.specialOrders.unapprove(
        actor,
        id,
        body,
        requestMetadata(request),
      ),
    };
  }

  @Post(':id/complete')
  async complete(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.auth.authenticateRequest(request);
    return {
      specialOrder: await this.specialOrders.complete(
        actor,
        id,
        body,
        requestMetadata(request),
      ),
    };
  }

  @Post(':id/payments')
  async recordPayment(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.auth.authenticateRequest(request);
    return {
      specialOrder: await this.specialOrders.recordPayment(
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
    requestId:
      request?.headers?.['x-request-id'] ||
      request?.headers?.['x-correlation-id'] ||
      null,
  };
}
