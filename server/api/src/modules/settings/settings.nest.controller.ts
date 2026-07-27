import {
  Controller,
  Get,
  HttpCode,
  MessageEvent,
  Post,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable } from 'rxjs';

import { getRequestIp } from '../../common/request-ip';
import { AuthUserGuard } from '../../common/guards/auth-user.guard';
import { AuthNestService } from '../auth/auth.nest.service';
import { AuditOperation } from '../operation-logs/audit-operation.decorator';
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

  @Sse('global-mark-query/events')
  @UseGuards(AuthUserGuard)
  @AuditOperation({ exclude: true })
  watchGlobalMarkQuery(): Observable<MessageEvent> {
    return this.settingsService.watchGlobalMarkQuery();
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
