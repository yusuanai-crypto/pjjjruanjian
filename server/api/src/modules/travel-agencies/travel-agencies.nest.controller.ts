import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';

import { getRequestIp } from '../../common/request-ip';
import { AuthNestService } from '../auth/auth.nest.service';
import { TravelAgenciesNestService } from './travel-agencies.nest.service';

@Controller('travel-agencies')
export class TravelAgenciesNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly travelAgenciesService: TravelAgenciesNestService,
  ) {}

  @Get()
  async list(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      travelAgencies: await this.travelAgenciesService.listTravelAgencies(
        actor,
        query,
      ),
    };
  }

  @Post()
  async create(@Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      travelAgency: await this.travelAgenciesService.createTravelAgency(
        actor,
        body,
        {
          ipAddress: getRequestIp(request),
        },
      ),
    };
  }
}
