import {
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';

import { getRequestIp } from '../../common/request-ip';
import { AuthNestService } from '../auth/auth.nest.service';
import { SettingsNestService } from './settings.nest.service';

@Controller('settings')
export class SettingsNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly settingsService: SettingsNestService,
  ) {}

  @Get('global-mark-query')
  async getGlobalMarkQuery(@Req() request: any) {
    await this.authService.authenticateRequest(request);
    return {
      settings: await this.settingsService.getGlobalMarkQuery(),
    };
  }

  @Post('global-mark-query/enable')
  @HttpCode(200)
  async enableGlobalMarkQuery(@Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      settings: await this.settingsService.enableGlobalMarkQuery(actor, {
        ipAddress: getRequestIp(request),
      }),
    };
  }

  @Post('global-mark-query/restore')
  @HttpCode(200)
  async restoreGlobalMarkQuery(@Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      settings: await this.settingsService.restoreGlobalMarkQuery(actor, {
        ipAddress: getRequestIp(request),
      }),
    };
  }
}
