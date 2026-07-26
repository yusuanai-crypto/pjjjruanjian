import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import { getRequestIp } from '../../common/request-ip';
import { AuthNestService } from '../auth/auth.nest.service';
import { GuidesNestService } from './guides.nest.service';

@Controller('guides')
export class GuidesNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly guidesService: GuidesNestService,
  ) {}

  @Get()
  async list(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return this.guidesService.listGuides(actor, query);
  }

  @Post()
  async create(@Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      guide: await this.guidesService.createGuide(actor, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      guide: await this.guidesService.getGuide(actor, id),
    };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      guide: await this.guidesService.updateGuide(actor, id, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }

  @Post(':id/disable')
  @HttpCode(200)
  async disable(@Param('id') id: string, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      guide: await this.guidesService.setGuideActive(actor, id, false, {
        ipAddress: getRequestIp(request),
      }),
    };
  }

  @Post(':id/enable')
  @HttpCode(200)
  async enable(@Param('id') id: string, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      guide: await this.guidesService.setGuideActive(actor, id, true, {
        ipAddress: getRequestIp(request),
      }),
    };
  }
}
