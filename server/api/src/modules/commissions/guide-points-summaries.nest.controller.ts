import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  Res,
} from '@nestjs/common';

import { getRequestIp } from '../../common/request-ip';
import { AuthNestService } from '../auth/auth.nest.service';
import { GuidePointsSummaryNestService } from './guide-points-summary.nest.service';

@Controller('guide-points-summaries')
export class GuidePointsSummariesNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly guidePointsService: GuidePointsSummaryNestService,
  ) {}

  @Get()
  async list(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      guidePointsSummaries:
        await this.guidePointsService.listGuidePointsSummaries(
          actor,
          query,
        ),
    };
  }

  @Get('export.xlsx')
  async exportXlsx(
    @Query() query: any,
    @Req() request: any,
    @Res() response: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    const result =
      await this.guidePointsService.exportGuidePointsSummariesXlsx(
        actor,
        query,
        { ipAddress: getRequestIp(request) },
      );
    response.status(200);
    response.type(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.fileName}"`,
    );
    response.setHeader('Content-Length', result.buffer.length);
    response.send(result.buffer);
  }

  @Patch('orders/:orderId/rates')
  async updateOrderRates(
    @Param('orderId') orderId: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    const result =
      await this.guidePointsService.updateGuidePersonalOrderRates(
        actor,
        orderId,
        body,
        { ipAddress: getRequestIp(request) },
      );
    const summaryId = result.guideRefresh?.summaries?.find(
      (summary: any) =>
        summary.guideId === result.guideId &&
        Number(summary.orderCount || 0) > 0,
    )?.id;
    return {
      guidePointsSummary: summaryId
        ? await this.guidePointsService.getGuidePointsSummary(
            actor,
            summaryId,
          )
        : null,
    };
  }

  @Patch('orders/:orderId/liquor-cost-deduction')
  async updateOrderLiquorCostDeduction(
    @Param('orderId') orderId: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      guidePointsSummary:
        await this.guidePointsService.updateGuidePersonalOrderLiquorCostDeduction(
          actor,
          orderId,
          body,
          { ipAddress: getRequestIp(request) },
        ),
    };
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      guidePointsSummary:
        await this.guidePointsService.getGuidePointsSummary(actor, id),
    };
  }

  @Patch(':id/daily-points-paid')
  async setDailyPaid(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      guidePointsSummary:
        await this.guidePointsService.setGuidePointsPaymentStatus(
          actor,
          id,
          'daily',
          body,
          { ipAddress: getRequestIp(request) },
        ),
    };
  }

  @Patch(':id/monthly-points-paid')
  async setMonthlyPaid(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      guidePointsSummary:
        await this.guidePointsService.setGuidePointsPaymentStatus(
          actor,
          id,
          'monthly',
          body,
          { ipAddress: getRequestIp(request) },
        ),
    };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      guidePointsSummary:
        await this.guidePointsService.updateGuidePointsSummary(
          actor,
          id,
          body,
          { ipAddress: getRequestIp(request) },
        ),
    };
  }
}
