import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import { AuthUserGuard } from '../../common/guards/auth-user.guard';
import { RequireRoles } from '../../common/guards/required-roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { getRequestIp } from '../../common/request-ip';
import { AuthNestService } from '../auth/auth.nest.service';
import { BusinessDataNestService } from './business-data.nest.service';
import {
  buildAttachmentContentDisposition,
  AttachmentUploadConfigService,
  SecureAttachmentUploadInterceptor,
} from './travel-group-attachment-storage.helper';

@Controller('after-sales-orders')
export class AfterSalesOrdersNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly businessDataService: BusinessDataNestService,
    private readonly uploadConfig: AttachmentUploadConfigService,
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
    return this.businessDataService.createAfterSalesOrder(
      actor,
      body,
      {
        ipAddress: getRequestIp(request),
      },
    );
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
    return this.businessDataService.confirmAfterSalesOrderFinance(
      actor,
      id,
      body,
      {
        ipAddress: getRequestIp(request),
      },
    );
  }

  @Patch(':id/warehouse-confirm')
  async confirmWarehouse(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return this.businessDataService.confirmAfterSalesOrderWarehouse(
      actor,
      id,
      body,
      {
        ipAddress: getRequestIp(request),
      },
    );
  }

  @Post(':id/finance-refund-confirm')
  @UseGuards(AuthUserGuard, RolesGuard)
  @RequireRoles('admin', 'finance')
  @UseInterceptors(SecureAttachmentUploadInterceptor)
  async confirmFinanceRefund(
    @Param('id') id: string,
    @UploadedFiles() files: any[],
    @Req() request: any,
  ) {
    const actor = request.currentUser;
    try {
      return await this.businessDataService.confirmAfterSalesOrderFinanceRefund(
        actor,
        id,
        files,
        {
          ipAddress: getRequestIp(request),
        },
      );
    } finally {
      await this.uploadConfig.cleanupTemporaryFiles(files);
    }
  }

  @Get(':id/refund-proofs/:attachmentId/download')
  async downloadRefundProof(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Req() request: any,
    @Res() response: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    const download =
      await this.businessDataService.downloadAfterSalesRefundProof(
        actor,
        id,
        attachmentId,
      );
    response.status(200);
    response.type(download.contentType || 'application/octet-stream');
    response.setHeader(
      'Content-Disposition',
      buildAttachmentContentDisposition(download.originalName),
    );
    response.setHeader('Content-Length', download.buffer.length);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(download.buffer);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return this.businessDataService.updateAfterSalesOrderStatus(
      actor,
      id,
      body,
      {
        ipAddress: getRequestIp(request),
      },
    );
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return this.businessDataService.updateAfterSalesOrder(
      actor,
      id,
      body,
      {
        ipAddress: getRequestIp(request),
      },
    );
  }
}
