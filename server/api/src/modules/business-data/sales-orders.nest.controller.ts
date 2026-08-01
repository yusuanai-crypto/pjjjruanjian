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
import { GuidePointsSummaryNestService } from '../commissions/guide-points-summary.nest.service';
import { BusinessDataNestService } from './business-data.nest.service';
import { getConfiguredPublicSalesSheetBaseUrl } from './qr-code-token.helper';

@Controller('sales-orders')
export class SalesOrdersNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly businessDataService: BusinessDataNestService,
    private readonly guidePointsService: GuidePointsSummaryNestService,
  ) {}

  @Get()
  async list(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      salesOrders: await this.businessDataService.listSalesOrders(actor, query),
    };
  }

  @Get('assignment-options')
  async assignmentOptions(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      assignmentOptions:
        await this.businessDataService.getSalesOrderAssignmentOptions(
          actor,
          query,
        ),
    };
  }

  @Post()
  async create(@Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return this.businessDataService.createSalesOrder(actor, body, {
        ipAddress: getRequestIp(request),
      });
  }

  @Get('export.xlsx')
  async exportXlsx(@Query() query: any, @Req() request: any, @Res() response: any) {
    const actor = await this.authService.authenticateRequest(request);
    const exportResult = await this.businessDataService.exportSalesOrdersXlsx(
      actor,
      query,
    );
    response.status(200);
    response.type(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${exportResult.fileName}"`,
    );
    response.setHeader('Content-Length', exportResult.buffer.length);
    response.send(exportResult.buffer);
  }

  @Get(':id/sales-sheet')
  async getSalesSheet(@Param('id') id: string, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      salesSheet: await this.businessDataService.getSalesOrderSalesSheet(
        actor,
        id,
      ),
    };
  }

  @Post(':id/qr-code')
  async generateQrCode(@Param('id') id: string, @Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return await this.businessDataService.generateSalesOrderQrCode(
      actor,
      id,
      body,
      {
        ipAddress: getRequestIp(request),
        publicSalesSheetBaseUrl: getConfiguredPublicSalesSheetBaseUrl({
          required: true,
        }),
      },
    );
  }

  @Delete(':id/qr-code')
  async revokeQrCode(@Param('id') id: string, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return await this.businessDataService.revokeSalesOrderQrCode(actor, id, {
      ipAddress: getRequestIp(request),
    });
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      salesOrder: await this.businessDataService.getSalesOrder(actor, id),
    };
  }

  @Patch(':id/sales-edit')
  async salesEdit(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return this.businessDataService.salesEditSalesOrder(
      actor,
      id,
      body,
      {
        ipAddress: getRequestIp(request),
      },
    );
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

  @Patch(':id/payment-details')
  async replacePaymentDetails(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      salesOrder:
        await this.businessDataService.replaceSalesOrderPaymentDetails(
          actor,
          id,
          body,
          { ipAddress: getRequestIp(request) },
        ),
    };
  }

  @Patch(':id/payment-details/:detailId/agency-confirmation')
  async confirmAgencyCollection(
    @Param('id') id: string,
    @Param('detailId') detailId: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      salesOrder:
        await this.businessDataService.confirmAgencyCollectionPayment(
          actor,
          id,
          detailId,
          body,
          { ipAddress: getRequestIp(request) },
        ),
    };
  }

  @Patch(':id/completion')
  async setCompletion(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      salesOrder: await this.businessDataService.setSalesOrderCompletion(
        actor,
        id,
        body,
        { ipAddress: getRequestIp(request) },
      ),
    };
  }

  @Patch(':id/payment-details-lock')
  async setPaymentDetailsLock(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      salesOrder:
        await this.businessDataService.setSalesOrderPaymentDetailsLock(
          actor,
          id,
          body,
          { ipAddress: getRequestIp(request) },
        ),
    };
  }

  @Patch(':id/points-destination')
  async updatePointsDestination(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    await this.guidePointsService.updateSalesOrderPointsDestination(
      actor,
      id,
      body,
      { ipAddress: getRequestIp(request) },
    );
    return {
      salesOrder: await this.businessDataService.getSalesOrder(actor, id),
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

  @Patch(':id/shipping-date')
  async updateShippingDate(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      salesOrder:
        await this.businessDataService.updateSalesOrderShippingDate(
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
    return this.businessDataService.updateSalesOrder(actor, id, body, {
        ipAddress: getRequestIp(request),
      });
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
