import {
  Controller,
  Get,
  Query,
  Req,
} from '@nestjs/common';

import { AuthNestService } from '../auth/auth.nest.service';
import { OperationLogsNestService } from './operation-log.nest.service';

@Controller('operation-logs')
export class OperationLogNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly operationLogsService: OperationLogsNestService,
  ) {}

  @Get()
  async list(@Query() query: Record<string, string>, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    this.authService.requireAdmin(actor);

    return this.operationLogsService.listLogs({
      action: query.action || undefined,
      entityType: query.entityType || undefined,
      userId: query.userId || undefined,
      page: query.page || undefined,
      pageSize: query.pageSize || undefined,
    });
  }
}
