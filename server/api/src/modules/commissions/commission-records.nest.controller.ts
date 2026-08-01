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
} from '@nestjs/common';

import { getRequestIp } from '../../common/request-ip';
import { AuthNestService } from '../auth/auth.nest.service';
import { AgencyRuleRecalculationNestService } from './agency-rule-recalculation.nest.service';
import { CommissionRecordsNestService } from './commission-records.nest.service';

@Controller('commission-records')
export class CommissionRecordsNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly commissionRecordsService: CommissionRecordsNestService,
    private readonly agencyRuleRecalculationService: AgencyRuleRecalculationNestService,
  ) {}

  @Get()
  async list(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      commissionRecords:
        await this.commissionRecordsService.listCommissionRecords(
          actor,
          query,
        ),
    };
  }

  @Get('me')
  async listMine(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      commissionRecords:
        await this.commissionRecordsService.listMyTasterCommissionRecords(
          actor,
          query,
        ),
    };
  }

  @Get('export')
  async exportXlsx(@Query() query: any, @Req() request: any, @Res() response: any) {
    const actor = await this.authService.authenticateRequest(request);
    const exportResult =
      await this.commissionRecordsService.exportCommissionRecordsXlsx(
        actor,
        query,
        {
          ipAddress: getRequestIp(request),
        },
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

  @Post('recalculate')
  async recalculate(@Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return this.agencyRuleRecalculationService.recalculateExplicit(
      actor,
      body,
      {
        ipAddress: getRequestIp(request),
      },
    );
  }

  @Get('assignment-preflight')
  async assignmentPreflight(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      preflight:
        await this.commissionRecordsService.preflightEmployeeCommissionAssignments(
          actor,
          query,
        ),
    };
  }

  @Post('assignment-repair')
  async assignmentRepair(@Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      repair:
        await this.commissionRecordsService.repairEmployeeCommissionAssignments(
          actor,
          body,
          { ipAddress: getRequestIp(request) },
        ),
    };
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      commissionRecord:
        await this.commissionRecordsService.getCommissionRecord(actor, id),
    };
  }

  @Patch(':id/manual-amount')
  async updateManualAmount(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      commissionRecord:
        await this.commissionRecordsService.updateTasterManualAmount(
          actor,
          id,
          body,
          {
            ipAddress: getRequestIp(request),
          },
        ),
    };
  }

  @Patch(':id/confirm')
  async confirm(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      commissionRecord:
        await this.commissionRecordsService.confirmTasterCommissionRecord(
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
