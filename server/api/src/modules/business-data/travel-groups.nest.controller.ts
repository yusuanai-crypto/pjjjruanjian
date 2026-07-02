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
import { BusinessDataNestService } from './business-data.nest.service';

@Controller('travel-groups')
export class TravelGroupsNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly businessDataService: BusinessDataNestService,
  ) {}

  @Get()
  async list(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      travelGroups: await this.businessDataService.listGroups('travel', actor, query),
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
