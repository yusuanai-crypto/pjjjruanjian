import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';

import { getRequestIp } from '../../common/request-ip';
import { AuthNestService } from '../auth/auth.nest.service';
import { BusinessDataNestService } from './business-data.nest.service';

@Controller('finance')
export class FinanceNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly businessDataService: BusinessDataNestService,
  ) {}

  @Get('overview')
  async overview(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      overview: await this.businessDataService.getFinanceOverview(actor, query),
    };
  }

  @Get('workbench')
  async workbench(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      workbench: await this.businessDataService.getFinanceWorkbench(
        actor,
        query,
      ),
    };
  }
}

@Controller('reconciliations')
export class ReconciliationsNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly businessDataService: BusinessDataNestService,
  ) {}

  @Get(':businessDate')
  async get(@Param('businessDate') businessDate: string, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      reconciliation: await this.businessDataService.getReconciliation(actor, businessDate),
    };
  }

  @Put(':businessDate')
  async upsert(@Param('businessDate') businessDate: string, @Body() body: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      reconciliation: await this.businessDataService.upsertReconciliation(
        actor,
        {
          ...(body || {}),
          businessDate,
        },
        {
          ipAddress: getRequestIp(request),
        },
      ),
    };
  }
}

@Controller('strike-bonus-awards')
export class StrikeBonusAwardsNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly businessDataService: BusinessDataNestService,
  ) {}

  @Get()
  async list(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      strikeBonusAwards: await this.businessDataService.listStrikeBonusAwards(actor, query),
    };
  }

  @Post()
  async create(@Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      strikeBonusAward: await this.businessDataService.createStrikeBonusAward(actor, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }
}
