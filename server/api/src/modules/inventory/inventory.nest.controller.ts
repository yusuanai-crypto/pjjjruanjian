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
import { InventoryAccountingService } from './inventory-accounting.service';
import { InventoryQueryService } from './inventory-query.service';
import { InventoryReportService } from './inventory-report.service';
import { InventoryStocktakeService } from './inventory-stocktake.service';

@Controller('inventory')
export class InventoryNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly inventoryService: InventoryAccountingService,
    private readonly inventoryQueryService: InventoryQueryService,
    private readonly stocktakeService: InventoryStocktakeService,
    private readonly inventoryReportService: InventoryReportService,
  ) {}

  @Get('reports/:reportType/export.xlsx')
  async exportReport(
    @Param('reportType') reportType: string,
    @Query() query: any,
    @Req() request: any,
    @Res() response: any,
  ) {
    const result = await this.inventoryReportService.exportXlsx(
      await this.authService.authenticateRequest(request),
      reportType,
      query,
      requestMetadata(request),
    );
    response.status(200);
    response.type(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.fileName}"`,
    );
    result.stream.pipe(response);
    await result.completion;
  }

  @Get('reports/:reportType')
  async queryReport(
    @Param('reportType') reportType: string,
    @Query() query: any,
    @Req() request: any,
  ) {
    return await this.inventoryReportService.query(
      await this.authService.authenticateRequest(request),
      reportType,
      query,
    );
  }

  @Get('stocktakes')
  async listStocktakes(@Query() query: any, @Req() request: any) {
    return await this.stocktakeService.list(
      await this.authService.authenticateRequest(request),
      query,
    );
  }

  @Get('stocktakes/:id')
  async getStocktake(
    @Param('id') id: string,
    @Req() request: any,
  ) {
    return {
      stocktake: await this.stocktakeService.get(
        await this.authService.authenticateRequest(request),
        id,
      ),
    };
  }

  @Post('stocktakes')
  async createStocktake(@Body() body: any, @Req() request: any) {
    return await this.stocktakeService.create(
      await this.authService.authenticateRequest(request),
      body,
      requestMetadata(request),
    );
  }

  @Post('stocktakes/:id/submit')
  async submitStocktake(
    @Param('id') id: string,
    @Body() body: any,
    @Req() request: any,
  ) {
    return await this.stocktakeService.submit(
      await this.authService.authenticateRequest(request),
      id,
      body,
      requestMetadata(request),
    );
  }

  @Post('stocktakes/:id/approve')
  async approveStocktake(
    @Param('id') id: string,
    @Body() body: any,
    @Req() request: any,
  ) {
    return await this.stocktakeService.approve(
      await this.authService.authenticateRequest(request),
      id,
      body,
      requestMetadata(request),
    );
  }

  @Post('stocktakes/:id/reject')
  async rejectStocktake(
    @Param('id') id: string,
    @Body() body: any,
    @Req() request: any,
  ) {
    return await this.stocktakeService.reject(
      await this.authService.authenticateRequest(request),
      id,
      body,
      requestMetadata(request),
    );
  }

  @Post('stocktakes/:id/reverse')
  async reverseStocktake(
    @Param('id') id: string,
    @Body() body: any,
    @Req() request: any,
  ) {
    return await this.stocktakeService.reverse(
      await this.authService.authenticateRequest(request),
      id,
      body,
      requestMetadata(request),
    );
  }

  @Get('warehouses')
  async listWarehouses(@Query() query: any, @Req() request: any) {
    return await this.inventoryQueryService.listWarehouses(
      await this.authService.authenticateRequest(request),
      query,
    );
  }

  @Get('configuration')
  async getConfiguration(@Req() request: any) {
    return {
      configuration:
        await this.inventoryQueryService.getConfiguration(
          await this.authService.authenticateRequest(request),
        ),
    };
  }

  @Patch('configuration')
  async updateConfiguration(
    @Body() body: any,
    @Req() request: any,
  ) {
    return {
      configuration:
        await this.inventoryQueryService.updateConfiguration(
          await this.authService.authenticateRequest(request),
          body,
          requestMetadata(request),
        ),
    };
  }

  @Post('warehouses')
  async createWarehouse(@Body() body: any, @Req() request: any) {
    return {
      warehouse: await this.inventoryQueryService.createWarehouse(
        await this.authService.authenticateRequest(request),
        body,
        requestMetadata(request),
      ),
    };
  }

  @Patch('warehouses')
  async updateWarehouseFromBody(
    @Body() body: any,
    @Req() request: any,
  ) {
    const { id, warehouseId, ...changes } =
      body && typeof body === 'object' && !Array.isArray(body)
        ? body
        : {};
    return {
      warehouse: await this.inventoryQueryService.updateWarehouse(
        await this.authService.authenticateRequest(request),
        id || warehouseId,
        changes,
        requestMetadata(request),
      ),
    };
  }

  @Patch('warehouses/:id')
  async updateWarehouse(
    @Param('id') id: string,
    @Body() body: any,
    @Req() request: any,
  ) {
    return {
      warehouse: await this.inventoryQueryService.updateWarehouse(
        await this.authService.authenticateRequest(request),
        id,
        body,
        requestMetadata(request),
      ),
    };
  }

  @Get('warehouses/:id/products')
  async listWarehouseProducts(
    @Param('id') id: string,
    @Query() query: any,
    @Req() request: any,
  ) {
    return await this.inventoryQueryService.listWarehouseProducts(
      await this.authService.authenticateRequest(request),
      id,
      query,
    );
  }

  @Post('warehouses/:id/products')
  async addWarehouseProduct(
    @Param('id') id: string,
    @Body() body: any,
    @Req() request: any,
  ) {
    return await this.inventoryQueryService.addWarehouseProduct(
      await this.authService.authenticateRequest(request),
      id,
      body,
      requestMetadata(request),
    );
  }

  @Delete('warehouses/:warehouseId/products/:productId')
  async deactivateWarehouseProduct(
    @Param('warehouseId') warehouseId: string,
    @Param('productId') productId: string,
    @Req() request: any,
  ) {
    return await this.inventoryQueryService.deactivateWarehouseProduct(
      await this.authService.authenticateRequest(request),
      warehouseId,
      productId,
      requestMetadata(request),
    );
  }

  @Get('warehouses/:id')
  async getWarehouse(@Param('id') id: string, @Req() request: any) {
    return {
      warehouse: await this.inventoryQueryService.getWarehouse(
        await this.authService.authenticateRequest(request),
        id,
      ),
    };
  }

  @Delete('warehouses/:id')
  async deleteWarehouse(
    @Param('id') id: string,
    @Req() request: any,
  ) {
    return await this.inventoryQueryService.deleteWarehouse(
      await this.authService.authenticateRequest(request),
      id,
      requestMetadata(request),
    );
  }

  @Get('stocks')
  async listStocks(@Query() query: any, @Req() request: any) {
    return await this.inventoryQueryService.listStocks(
      await this.authService.authenticateRequest(request),
      query,
    );
  }

  @Get('stocks/:warehouseId/:productId')
  async getStock(
    @Param('warehouseId') warehouseId: string,
    @Param('productId') productId: string,
    @Req() request: any,
  ) {
    return {
      stock: await this.inventoryQueryService.getStock(
        await this.authService.authenticateRequest(request),
        warehouseId,
        productId,
      ),
    };
  }

  @Get('movements')
  async listMovements(@Query() query: any, @Req() request: any) {
    return await this.inventoryQueryService.listMovements(
      await this.authService.authenticateRequest(request),
      query,
    );
  }

  @Get('alert-configs')
  async listAlertConfigs(@Query() query: any, @Req() request: any) {
    return await this.inventoryQueryService.listAlertConfigs(
      await this.authService.authenticateRequest(request),
      query,
    );
  }

  @Get('inbounds')
  async listInbounds(@Query() query: any, @Req() request: any) {
    return await this.inventoryQueryService.listInboundDocuments(
      await this.authService.authenticateRequest(request),
      query,
    );
  }

  @Get('inbounds/:id')
  async getInbound(
    @Param('id') id: string,
    @Req() request: any,
  ) {
    return {
      inbound:
        await this.inventoryQueryService.getInboundDocument(
          await this.authService.authenticateRequest(request),
          id,
        ),
    };
  }

  @Get('transfers')
  async listTransfers(@Query() query: any, @Req() request: any) {
    return await this.inventoryQueryService.listTransfers(
      await this.authService.authenticateRequest(request),
      query,
    );
  }

  @Get('transfers/:id')
  async getTransfer(
    @Param('id') id: string,
    @Req() request: any,
  ) {
    return {
      transfer: await this.inventoryQueryService.getTransfer(
        await this.authService.authenticateRequest(request),
        id,
      ),
    };
  }

  @Post('transfers')
  async createTransfer(@Body() body: any, @Req() request: any) {
    return await this.inventoryService.createTransfer(
      await this.authService.authenticateRequest(request),
      body,
      requestMetadata(request),
    );
  }

  @Post('transfers/:id/outbound')
  async confirmTransferOutbound(
    @Param('id') id: string,
    @Body() body: any,
    @Req() request: any,
  ) {
    return await this.inventoryService.confirmTransferOutbound(
      await this.authService.authenticateRequest(request),
      withPathId(body, 'transferId', id),
      requestMetadata(request),
    );
  }

  @Post('transfers/:id/outbound/reverse')
  async reverseTransferOutbound(
    @Param('id') id: string,
    @Body() body: any,
    @Req() request: any,
  ) {
    return await this.inventoryService.reverseTransferOutbound(
      await this.authService.authenticateRequest(request),
      withPathId(body, 'transferId', id),
      requestMetadata(request),
    );
  }

  @Post('transfers/:id/receipts')
  async receiveTransfer(
    @Param('id') id: string,
    @Body() body: any,
    @Req() request: any,
  ) {
    return await this.inventoryService.receiveTransfer(
      await this.authService.authenticateRequest(request),
      withPathId(body, 'transferId', id),
      requestMetadata(request),
    );
  }

  @Post('transfers/receipts/:receiptId/reverse')
  async reverseTransferReceipt(
    @Param('receiptId') receiptId: string,
    @Body() body: any,
    @Req() request: any,
  ) {
    return await this.inventoryService.reverseTransferReceipt(
      await this.authService.authenticateRequest(request),
      withPathId(body, 'receiptId', receiptId),
      requestMetadata(request),
    );
  }

  @Post('inbounds')
  async createInbound(@Body() body: any, @Req() request: any) {
    return await this.inventoryService.businessInbound(
      await this.authService.authenticateRequest(request),
      body,
      requestMetadata(request),
    );
  }

  @Post('inbounds/:id/reverse')
  async reverseInbound(
    @Param('id') id: string,
    @Body() body: any,
    @Req() request: any,
  ) {
    return await this.inventoryService.reverseInbound(
      await this.authService.authenticateRequest(request),
      {
        ...(body && typeof body === 'object' && !Array.isArray(body)
          ? body
          : {}),
        documentId: id,
      },
      requestMetadata(request),
    );
  }

  @Patch('batches/:id/cost')
  async updateBatchCost(
    @Param('id') id: string,
    @Body() body: any,
    @Req() request: any,
  ) {
    return await this.inventoryService.updateBatchCost(
      await this.authService.authenticateRequest(request),
      {
        ...(body && typeof body === 'object' && !Array.isArray(body)
          ? body
          : {}),
        batchId: id,
      },
      requestMetadata(request),
    );
  }

  @Patch('alert-configs')
  async updateAlertConfig(
    @Body() body: any,
    @Req() request: any,
  ) {
    return {
      alertConfig:
        await this.inventoryQueryService.updateAlertConfig(
          await this.authService.authenticateRequest(request),
          body,
          requestMetadata(request),
        ),
    };
  }

  @Post('commands/inbound')
  async inbound(@Body() body: any, @Req() request: any) {
    return await this.inventoryService.businessInbound(
      await this.authService.authenticateRequest(request),
      body,
      requestMetadata(request),
    );
  }

  @Post('commands/reserve')
  async reserve(@Body() body: any, @Req() request: any) {
    return await this.inventoryService.reserve(
      await this.authService.authenticateRequest(request),
      body,
      requestMetadata(request),
    );
  }

  @Post('commands/release')
  async release(@Body() body: any, @Req() request: any) {
    return await this.inventoryService.release(
      await this.authService.authenticateRequest(request),
      body,
      requestMetadata(request),
    );
  }

  @Post('commands/outbound')
  async outbound(@Body() body: any, @Req() request: any) {
    return await this.inventoryService.outbound(
      await this.authService.authenticateRequest(request),
      body,
      requestMetadata(request),
    );
  }

  @Post('commands/mark-unavailable')
  async markUnavailable(@Body() body: any, @Req() request: any) {
    return await this.inventoryService.businessMarkUnavailable(
      await this.authService.authenticateRequest(request),
      body,
      requestMetadata(request),
    );
  }

  @Post('commands/restore-available')
  async restoreAvailable(@Body() body: any, @Req() request: any) {
    return await this.inventoryService.businessRestoreAvailable(
      await this.authService.authenticateRequest(request),
      body,
      requestMetadata(request),
    );
  }

  @Post('unavailable/mark')
  async markUnavailableBusiness(
    @Body() body: any,
    @Req() request: any,
  ) {
    return await this.inventoryService.businessMarkUnavailable(
      await this.authService.authenticateRequest(request),
      body,
      requestMetadata(request),
    );
  }

  @Post('unavailable/restore')
  async restoreAvailableBusiness(
    @Body() body: any,
    @Req() request: any,
  ) {
    return await this.inventoryService.businessRestoreAvailable(
      await this.authService.authenticateRequest(request),
      body,
      requestMetadata(request),
    );
  }

  @Post('commands/reverse')
  async reverse(@Body() body: any, @Req() request: any) {
    return await this.inventoryService.reverse(
      await this.authService.authenticateRequest(request),
      body,
      requestMetadata(request),
    );
  }

  @Get('rebuild-check')
  async rebuildCheck(@Query() query: any, @Req() request: any) {
    return await this.inventoryService.rebuildCheck(
      await this.authService.authenticateRequest(request),
      query,
    );
  }

  @Post('repair-preview')
  async repairPreview(@Body() body: any, @Req() request: any) {
    return await this.inventoryService.repairPreview(
      await this.authService.authenticateRequest(request),
      body,
    );
  }
}

function requestMetadata(request: any) {
  return {
    requestId:
      request?.auditRequestId ||
      request?.correlationId ||
      headerValue(request?.headers?.['x-request-id']),
    ipAddress: getRequestIp(request),
  };
}

function withPathId(body: any, field: string, id: string) {
  return {
    ...(body && typeof body === 'object' && !Array.isArray(body)
      ? body
      : {}),
    [field]: id,
  };
}

function headerValue(value: unknown) {
  return Array.isArray(value) ? value[0] : value;
}
