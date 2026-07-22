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
import { TravelGroupFinanceSummaryNestService } from './travel-group-finance-summary.nest.service';

@Controller('travel-group-finance-summaries')
export class TravelGroupFinanceSummariesNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly summaryService: TravelGroupFinanceSummaryNestService,
  ) {}

  @Get()
  async list(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      travelGroupFinanceSummaries:
        await this.summaryService.listTravelGroupFinanceSummaries(
          actor,
          query,
        ),
    };
  }

  @Get('export')
  async exportXlsx(@Query() query: any, @Req() request: any, @Res() response: any) {
    const actor = await this.authService.authenticateRequest(request);
    const exportResult =
      await this.summaryService.exportTravelGroupFinanceSummariesXlsx(
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

  @Get(':travelGroupId')
  async detail(@Param('travelGroupId') travelGroupId: string, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      travelGroupFinanceSummary:
        await this.summaryService.getTravelGroupFinanceSummary(
          actor,
          travelGroupId,
        ),
    };
  }

  @Patch(':travelGroupId/agency-deduction-confirm')
  async confirmAgencyDeduction(
    @Param('travelGroupId') travelGroupId: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      travelGroupFinanceSummary:
        await this.summaryService.confirmAgencyDeduction(
          actor,
          travelGroupId,
          body,
          {
            ipAddress: getRequestIp(request),
          },
        ),
    };
  }

  @Patch(':travelGroupId/agency-deduction')
  async updateAgencyDeduction(
    @Param('travelGroupId') travelGroupId: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      travelGroupFinanceSummary:
        await this.summaryService.updateAgencyDeduction(
          actor,
          travelGroupId,
          body,
          {
            ipAddress: getRequestIp(request),
          },
        ),
    };
  }

  @Patch(':travelGroupId/daily-rebate-paid')
  async setDailyRebatePaid(
    @Param('travelGroupId') travelGroupId: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      travelGroupFinanceSummary:
        await this.summaryService.setRebatePaymentStatus(
          actor,
          travelGroupId,
          'daily',
          body,
          {
            ipAddress: getRequestIp(request),
          },
        ),
    };
  }

  @Patch(':travelGroupId/monthly-rebate-paid')
  async setMonthlyRebatePaid(
    @Param('travelGroupId') travelGroupId: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      travelGroupFinanceSummary:
        await this.summaryService.setRebatePaymentStatus(
          actor,
          travelGroupId,
          'monthly',
          body,
          {
            ipAddress: getRequestIp(request),
          },
        ),
    };
  }

  @Post(':travelGroupId/refresh')
  async refresh(
    @Param('travelGroupId') travelGroupId: string,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return this.summaryService.refreshTravelGroupFinanceSummaryForApi(
      actor,
      travelGroupId,
      {
        ipAddress: getRequestIp(request),
      },
    );
  }

  @Patch(':travelGroupId')
  async update(
    @Param('travelGroupId') travelGroupId: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      travelGroupFinanceSummary:
        await this.summaryService.updateTravelGroupFinanceSummary(
          actor,
          travelGroupId,
          body,
          {
            ipAddress: getRequestIp(request),
          },
        ),
    };
  }
}
