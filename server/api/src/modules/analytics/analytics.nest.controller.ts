import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';

import { getRequestIp } from '../../common/request-ip';
import { AuthNestService } from '../auth/auth.nest.service';
import { AnalyticsNestService } from './analytics.nest.service';

@Controller('analytics')
export class AnalyticsNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly analyticsService: AnalyticsNestService,
  ) {}

  @Get('overview')
  async overview(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return this.analyticsService.getOverview(actor, query);
  }

  @Get('overview/export')
  async overviewExport(
    @Query() query: any,
    @Req() request: any,
    @Res() response: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    const exportResult = await this.analyticsService.exportOverviewXlsx(
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

  @Get('profit-overview')
  async profitOverview(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return this.analyticsService.getProfitOverview(actor, query);
  }

  @Get('sales-performance')
  async salesPerformance(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return this.analyticsService.listSalesPerformance(actor, query);
  }

  @Get('sales-performance/export')
  async salesPerformanceExport(
    @Query() query: any,
    @Req() request: any,
    @Res() response: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    const exportResult =
      await this.analyticsService.exportSalesPerformanceXlsx(
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

  @Get('sales-performance/:salesUserId')
  async salesPerformanceDetail(
    @Param('salesUserId') salesUserId: string,
    @Query() query: any,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return this.analyticsService.getSalesPerformanceDetail(
      actor,
      salesUserId,
      query,
    );
  }

  @Get('travel-group-profits')
  async travelGroupProfits(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return this.analyticsService.listTravelGroupProfits(actor, query);
  }

  @Get('travel-group-profits/export')
  async travelGroupProfitsExport(
    @Query() query: any,
    @Req() request: any,
    @Res() response: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    const exportResult =
      await this.analyticsService.exportTravelGroupProfitsXlsx(
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

  @Post('travel-group-profits/:travelGroupId/recalculate')
  @HttpCode(HttpStatus.OK)
  async recalculateTravelGroupProfit(
    @Param('travelGroupId') travelGroupId: string,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return this.analyticsService.recalculateTravelGroupProfit(
      actor,
      travelGroupId,
      { ipAddress: getRequestIp(request) },
    );
  }

  @Get('daily-loss-profits')
  async dailyLossProfits(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return this.analyticsService.listDailyLossProfits(actor, query);
  }

  @Get('daily-loss-profits/export')
  async dailyLossProfitsExport(
    @Query() query: any,
    @Req() request: any,
    @Res() response: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    const exportResult =
      await this.analyticsService.exportDailyLossProfitsXlsx(
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

  @Get('trends')
  async trends(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return this.analyticsService.listTrends(actor, query);
  }

  @Get('taster-rankings')
  async tasterRankings(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return this.analyticsService.listTasterRankings(actor, query);
  }

  @Get('taster-rankings/export')
  async tasterRankingsExport(
    @Query() query: any,
    @Req() request: any,
    @Res() response: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    const exportResult =
      await this.analyticsService.exportTasterRankingsXlsx(actor, query, {
        ipAddress: getRequestIp(request),
      });
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

  @Get('taster-rankings/:tasterId')
  async tasterRankingDetail(
    @Param('tasterId') tasterId: string,
    @Query() query: any,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return this.analyticsService.getTasterRankingDetail(
      actor,
      tasterId,
      query,
    );
  }

  @Get('source/orders')
  async sourceOrders(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return this.analyticsService.listSourceOrders(actor, query);
  }

  @Get('source/travel-groups')
  async sourceTravelGroups(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return this.analyticsService.listSourceTravelGroups(actor, query);
  }

  @Get('source/after-sales')
  async sourceAfterSales(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return this.analyticsService.listSourceAfterSales(actor, query);
  }
}
