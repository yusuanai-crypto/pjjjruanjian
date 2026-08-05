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

@Controller('travel-groups')
export class TravelGroupsNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly businessDataService: BusinessDataNestService,
    private readonly uploadConfig: AttachmentUploadConfigService,
  ) {}

  @Get()
  async list(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      travelGroups: await this.businessDataService.listGroups('travel', actor, query),
    };
  }

  @Get('today')
  @UseGuards(AuthUserGuard, RolesGuard)
  @RequireRoles('admin', 'boss', 'front_desk', 'sales', 'taster')
  async listToday(@Req() request: any) {
    return {
      travelGroups: await this.businessDataService.listTodayTravelGroups(
        request.currentUser,
      ),
    };
  }

  @Get('order-entry-options')
  async listOrderEntryOptions(
    @Query() query: any,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      travelGroups:
        await this.businessDataService.listSalesOrderEntryTravelGroups(
          actor,
          query,
        ),
    };
  }

  @Post()
  async create(@Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      travelGroup: await this.businessDataService.createGroup('travel', actor, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }

  @Get('export.xlsx')
  async exportXlsx(@Query() query: any, @Req() request: any, @Res() response: any) {
    const actor = await this.authService.authenticateRequest(request);
    const exportResult = await this.businessDataService.exportTravelGroupsXlsx(
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

  @Post(':id/attachments/:category')
  @UseGuards(AuthUserGuard, RolesGuard)
  @RequireRoles('admin', 'front_desk', 'taster')
  @UseInterceptors(SecureAttachmentUploadInterceptor)
  async uploadAttachments(
    @Param('id') id: string,
    @Param('category') category: string,
    @UploadedFiles() files: any[],
    @Req() request: any,
  ) {
    const actor = request.currentUser;
    try {
      return await this.businessDataService.uploadTravelGroupAttachments(
        actor,
        id,
        category,
        files,
        {
          ipAddress: getRequestIp(request),
        },
      );
    } finally {
      await this.uploadConfig.cleanupTemporaryFiles(files);
    }
  }

  @Get(':id/attachments/:attachmentId/download')
  async downloadAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Req() request: any,
    @Res() response: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    const download =
      await this.businessDataService.downloadTravelGroupAttachment(
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

  @Delete(':id/attachments/:attachmentId')
  async deleteAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return this.businessDataService.deleteTravelGroupAttachment(
      actor,
      id,
      attachmentId,
      {
        ipAddress: getRequestIp(request),
      },
    );
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      travelGroup: await this.businessDataService.getGroup('travel', actor, id),
    };
  }

  @Patch(':id/finance-mark')
  async setFinanceMark(@Param('id') id: string, @Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      travelGroup: await this.businessDataService.setGroupFinanceMark('travel', actor, id, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }

  @Post(':id/taster-summary')
  async submitTasterSummary(@Param('id') id: string, @Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      travelGroup: await this.businessDataService.submitTravelGroupTasterSummary(actor, id, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }

  @Patch(':id/not-entered')
  async setNotEntered(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      travelGroup: await this.businessDataService.setTravelGroupNotEntered(
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
  async update(@Param('id') id: string, @Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      travelGroup: await this.businessDataService.updateGroup('travel', actor, id, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }
}

@Controller('guide-carried-groups')
export class GuideCarriedGroupsNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly businessDataService: BusinessDataNestService,
  ) {}

  @Get()
  async list(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      guideCarriedGroups: await this.businessDataService.listGroups('guideCarried', actor, query),
    };
  }

  @Post()
  async create(@Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      guideCarriedGroup: await this.businessDataService.createGroup('guideCarried', actor, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      guideCarriedGroup: await this.businessDataService.getGroup('guideCarried', actor, id),
    };
  }

  @Patch(':id/finance-mark')
  async setFinanceMark(@Param('id') id: string, @Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      guideCarriedGroup: await this.businessDataService.setGroupFinanceMark('guideCarried', actor, id, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      guideCarriedGroup: await this.businessDataService.updateGroup('guideCarried', actor, id, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }
}

@Controller('pending-travel-groups')
export class PendingTravelGroupsNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly businessDataService: BusinessDataNestService,
  ) {}

  @Get()
  async list(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      pendingTravelGroups: await this.businessDataService.listPendingTravelGroups(actor, query),
    };
  }

  @Post()
  async create(@Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      pendingTravelGroup: await this.businessDataService.createGroup('pending', actor, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      pendingTravelGroup: await this.businessDataService.getGroup('pending', actor, id),
    };
  }

  @Patch(':id/finance-mark')
  async setFinanceMark(@Param('id') id: string, @Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      pendingTravelGroup: await this.businessDataService.setGroupFinanceMark('pending', actor, id, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      pendingTravelGroup: await this.businessDataService.updateGroup('pending', actor, id, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }
}
